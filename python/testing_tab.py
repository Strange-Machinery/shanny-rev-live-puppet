"""Offline R&D tab for the inspected Tk Studio launcher and standalone use."""
import base64
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import tkinter as tk
from tkinter import ttk, filedialog
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]

class TestingPanel(ttk.Frame):
    def __init__(self, parent, repo=ROOT, node=None, config=None, **kwargs):
        super().__init__(parent, padding=16, **kwargs)
        self.repo = Path(repo)
        self.node = node
        self.on_ready = lambda: None
        self.on_startup_progress = lambda message: None
        self.on_result = lambda action, result: None
        self.on_error = lambda message: None
        self.events = queue.Queue(); self.process = None; self.endpoint = None; self.token = None
        self.starting_process = None
        self.generation = 0; self.closed = False; self.record_stop = threading.Event(); self.recording = False
        self.mic_armed = False; self.tts_process = None
        self.sharing_status = tk.StringVar(self, 'Sharing is off. Nothing is published until you press Share testing with Buff.')
        self.configuration = str(self.repo / 'offline-testing.local.json') if (self.repo / 'offline-testing.local.json').is_file() else None
        if config:
            self.configuration = str(config)
        self.mode_scope = {}; self.last_event_seq = 0
        self.poll_count = 0; self.status_pending = False
        from desktop_audio import DesktopAudio
        self.desktop_audio = DesktopAudio(); self.audio_jobs = queue.Queue(maxsize=20); self.played_ids = set()
        self.audio_admission = False
        threading.Thread(target=self.audio_worker, daemon=True).start()
        ttk.Label(self, text='Testing — offline R&D', font=('Segoe UI', 20, 'bold')).pack(anchor='w')
        ttk.Label(self, text='No YouTube session or livestream needed. Default: mock Qwen, silent WAVs, simulated stage/player.', wraplength=900).pack(anchor='w', pady=(4, 10))
        row = ttk.Frame(self); row.pack(fill='x')
        ttk.Button(row, text='Start offline lab', command=self.start_lab).pack(side='left')
        ttk.Button(row, text='Local Whisper / Qwen config…', command=self.configure).pack(side='left', padx=5)
        ttk.Button(row, text='Arm test stage', command=lambda: self.action('arm')).pack(side='left', padx=5)
        ttk.Button(row, text='Status / metrics', command=lambda: self.action('status')).pack(side='left', padx=5)
        ttk.Button(row, text='SHUT UP — stop & resume test show', command=self.stop).pack(side='right')
        self.status = tk.StringVar(self, 'Stopped. Start the lab, then explicitly arm the test stage.')
        ttk.Label(self, textvariable=self.status, foreground='#285b51', wraplength=900).pack(anchor='w', pady=10)
        notebook = ttk.Notebook(self); notebook.pack(fill='both', expand=True)
        api_tab = ttk.Frame(notebook, padding=12); mic_tab = ttk.Frame(notebook, padding=12)
        notebook.add(api_tab, text='Donations & API'); notebook.add(mic_tab, text='Whisper & live responses')
        self.text = tk.Text(api_tab, height=4, wrap='word', font=('Segoe UI', 11))
        self.text.pack(fill='x'); self.text.insert('1.0', 'Buff, tell Shanny that Rev needs a turn to explain.')
        self.actor = tk.StringVar(self, 'SHANNY')
        controls = ttk.Frame(api_tab); controls.pack(fill='x', pady=8)
        ttk.Combobox(controls, textvariable=self.actor, values=['SHANNY', 'REV'], state='readonly', width=10).pack(side='left')
        for label, fn in [('Send donation', lambda: self.donate()), ('Read as Rev', lambda: self.donate('REV')),
                          ('Read as Shanny', lambda: self.donate('SHANNY')), ('Repeat donation ID', lambda: self.action('duplicate', self.input())),
                          ('Typed puppet TTS', lambda: self.action('tts', self.input()))]:
            ttk.Button(controls, text=label, command=fn).pack(side='left', padx=3)
        failures = ttk.Frame(api_tab); failures.pack(fill='x', pady=5)
        self.scenario = tk.StringVar(self, 'normal')
        ttk.Combobox(failures, textvariable=self.scenario, state='readonly', width=25,
                     values=['normal', 'delayed_qwen', 'late_qwen', 'timeout_qwen', 'invalid_duration', 'synthesis_failure', 'panic_during_synthesis']).pack(side='left')
        ttk.Button(failures, text='Set test scenario', command=lambda: self.action('scenario', self.scenario.get())).pack(side='left', padx=5)
        ttk.Button(failures, text='Shanny interrupts Rev', command=lambda: self.action('interrupt', self.input())).pack(side='left', padx=5)
        ttk.Button(failures, text='Finish current test audio', command=lambda: self.action('finish')).pack(side='left')
        ttk.Label(api_tab, text='Typed puppet TTS exercises the real gateway API with synthetic WAVs. Device TTS below is audible using Windows voices.', wraplength=870).pack(anchor='w', pady=8)
        self.transcript = tk.Text(mic_tab, height=3, wrap='word', font=('Segoe UI', 11))
        self.transcript.pack(fill='x'); self.transcript.insert('1.0', 'Rev, explain why you keep interrupting Shanny.')
        row = ttk.Frame(mic_tab); row.pack(fill='x', pady=8)
        ttk.Button(row, text='Replay final transcript → live response', command=lambda: self.action('transcript', self.transcript.get('1.0', 'end-1c'))).pack(side='left')
        ttk.Button(row, text='WAV → local Whisper → response…', command=self.audio_file).pack(side='left', padx=6)
        ttk.Button(row, text='Speak text with device TTS', command=self.device_tts).pack(side='left')
        mic = ttk.LabelFrame(mic_tab, text='Real microphone — explicit test opt-in', padding=10); mic.pack(fill='x', pady=10)
        self.device = tk.StringVar(self); self.device_picker = ttk.Combobox(mic, textvariable=self.device, state='readonly', width=54)
        self.device_picker.grid(row=0, column=0, sticky='ew')
        ttk.Button(mic, text='Refresh input devices', command=self.refresh_devices).grid(row=0, column=1, padx=6)
        self.isolated = tk.BooleanVar(self, False)
        ttk.Checkbutton(mic, text="I selected Buff's isolated microphone, not OBS/mixed system audio", variable=self.isolated).grid(row=1, column=0, columnspan=3, sticky='w', pady=6)
        self.mic_state = tk.StringVar(self, 'Microphone disarmed — no capture')
        ttk.Button(mic, text='Arm test microphone', command=self.arm_mic).grid(row=2, column=0, sticky='w')
        self.ptt = ttk.Button(mic, text='Hold to talk → release to transcribe')
        self.ptt.grid(row=2, column=1, padx=6)
        self.ptt.bind('<ButtonPress-1>', self.record_start); self.ptt.bind('<ButtonRelease-1>', self.record_finish)
        self.auto_vad = tk.BooleanVar(self, False)
        ttk.Checkbutton(mic, text='Test auto VAD (explicit arm required)', variable=self.auto_vad, command=self.toggle_vad).grid(row=3, column=0, columnspan=2, sticky='w', pady=5)
        ttk.Label(mic, textvariable=self.mic_state, wraplength=850).grid(row=4, column=0, columnspan=3, sticky='w')
        self.level = ttk.Progressbar(mic, maximum=8000); self.level.grid(row=5, column=0, columnspan=3, sticky='ew', pady=4)
        self.log = tk.Text(self, height=10, wrap='word', font=('Consolas', 9), state='disabled')
        self.log.pack(fill='both', expand=True, pady=(10, 0))
        self.poll_timer = self.after(100, self.poll)
        self.bind('<Destroy>', lambda event: self.close() if event.widget is self else None)
        self.refresh_devices()
    def input(self):
        return self.text.get('1.0', 'end-1c')
    def write(self, text):
        self.log.configure(state='normal'); self.log.insert('end', text + '\n')
        if int(self.log.index('end-1c').split('.')[0]) > 250:
            self.log.delete('1.0', '40.0')
        self.log.see('end'); self.log.configure(state='disabled')
    def configure(self):
        path = filedialog.askopenfilename(parent=self, title='Select private offline-testing.local.json', filetypes=[('Private JSON config', '*.json')])
        if path:
            self.stop(); self.configuration = path
            self.status.set('Private local service configuration selected. Restart the lab to apply it.')
    def start_lab(self):
        if self.closed:
            return
        self.stop_local(); self.generation += 1; captured = self.generation
        if self.process:
            self.process.stdin.close(); self.process = None
        if self.starting_process:
            self.terminate_owned(self.starting_process); self.starting_process = None
        self.endpoint = None; self.token = None; self.mode_scope = {}; self.last_event_seq = 0; self.played_ids.clear()
        self.status.set('Starting isolated offline services…')
        args = [self.node or shutil.which('node.exe') or shutil.which('node') or 'node', str(self.repo / 'src/testing/lab.mjs')]
        if self.configuration:
            args.append(self.configuration)
        def worker():
            process = None; timer = None; errors = []
            try:
                process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           text=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                if captured != self.generation:
                    process.stdin.close(); return
                self.starting_process = process
                timer = threading.Timer(240, lambda: self.terminate_owned(process)); timer.daemon = True; timer.start()
                def drain():
                    for line in process.stderr:
                        errors.append(line[-2000:])
                        del errors[:-40]
                        if line.startswith('BUFF_STARTUP '):
                            self.events.put(('startup_progress', (captured, line[13:].strip())))
                threading.Thread(target=drain, daemon=True).start()
                line = process.stdout.readline()
                if not line:
                    details = ''.join(errors).strip()
                    raise RuntimeError('Character services could not start. ' + (details[-1200:] if details else 'The startup process stopped before reporting Ready.'))
                info = json.loads(line)
                if info.get('error'):
                    raise RuntimeError(info['error'])
                if captured != self.generation:
                    process.stdin.close(); return
                self.process = process
                self.endpoint = 'http://127.0.0.1:' + str(info['port']) + '/action'; self.token = info['token']
                self.events.put(('message', 'Offline lab ready. Test stage and microphone remain disarmed.'))
                self.events.put(('ready', captured))
            except Exception as error:
                if process and process.poll() is None:
                    self.terminate_owned(process)
                self.events.put(('error', (captured, str(error))))
            finally:
                if timer:
                    timer.cancel()
                if self.starting_process is process:
                    self.starting_process = None
        threading.Thread(target=worker, daemon=True).start()
    def terminate_owned(self, process):
        if process.poll() is not None:
            return
        if os.name == 'nt':
            subprocess.run(['taskkill.exe', '/PID', str(process.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), timeout=10)
        else:
            process.terminate()

    def request(self, data):
        if not self.endpoint:
            raise RuntimeError('Start the offline lab first')
        req = Request(self.endpoint, data=json.dumps(data).encode(), headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        opener = build_opener(ProxyHandler({}))
        try:
            with opener.open(req, timeout=75) as reply:
                return json.load(reply)
        except HTTPError as error:
            raise RuntimeError(json.load(error).get('error', 'Test action failed')) from None
    def action(self, action, text=None, **fields):
        captured = self.generation
        data = dict(action=action, actor=self.actor.get(), **fields)
        if action == 'transcript':
            data.update(self.mode_scope)
        if text is not None:
            data['text'] = text
        def worker():
            try:
                if captured != self.generation:
                    return
                result = self.request(data)
                self.events.put(('result', (action, result, captured)))
            except Exception as error:
                if action == 'status':
                    self.events.put(('status_failed', None))
                self.events.put(('error', (captured, str(error))))
        threading.Thread(target=worker, daemon=True).start()
    def donate(self, actor=None):
        text = self.input()
        self.action('donate', ('(' + actor.lower() + ') ' if actor else '') + text)
    def stop_local(self):
        self.mic_armed = False; self.record_stop.set(); self.auto_vad.set(False)
        self.audio_admission = False
        self.desktop_audio.stop()
        try:
            while True:
                self.audio_jobs.get_nowait()
        except queue.Empty:
            pass
        self.mic_state.set('Microphone disarmed — no capture')
        if self.tts_process and self.tts_process.poll() is None:
            self.tts_process.terminate()
    def stop(self):
        self.generation += 1; self.stop_local(); self.mode_scope = {}
        if self.endpoint:
            self.action('stop')
        self.status.set('Stopping all test speech and microphone admission…')
    def refresh_devices(self):
        try:
            from microphone import devices
            self.devices = {f"{row['id']}: {row['name']}": row for row in devices() if row['isolated_candidate']}
            self.device_picker.configure(values=list(self.devices))
            if self.devices and self.device.get() not in self.devices:
                self.device.set(next(iter(self.devices)))
        except Exception as error:
            self.devices = {}; self.mic_state.set(str(error))
    def arm_mic(self):
        if not self.endpoint or not self.mode_scope or not self.isolated.get() or self.device.get() not in self.devices:
            self.mic_state.set('Start the lab, arm the test stage, select an isolated input, and confirm its source before arming.'); return
        self.mic_armed = True; self.mic_state.set('Test microphone armed. Hold to talk; stop always disarms it.')
    def record_start(self, event=None):
        if not self.mic_armed or self.recording:
            return
        self.recording = True; self.record_stop = threading.Event(); captured = self.generation
        device_id = self.devices[self.device.get()]['id']; auto = self.auto_vad.get(); stop_event = self.record_stop
        mode_scope = dict(self.mode_scope)
        self.mic_state.set('Capturing selected microphone locally…')
        def worker():
            path = None
            try:
                from microphone import capture
                data, observation = capture(device_id, stop_event, auto_vad=auto, level=lambda rms: self.events.put(('level', rms)))
                if captured != self.generation or not self.mic_armed:
                    return
                self.events.put(('message', 'Microphone: ' + json.dumps(observation)))
                if data:
                    folder = self.repo / 'work/test-audio'; folder.mkdir(parents=True, exist_ok=True)
                    with tempfile.NamedTemporaryFile(dir=folder, suffix='.wav', delete=False) as handle:
                        handle.write(data); path = Path(handle.name)
                    result = self.request(dict(action='transcript', actor=self.actor_value, audioPath=str(path), source='BUFF_ISOLATED_MIC_TEST', **mode_scope))
                    if captured == self.generation:
                        self.events.put(('result', ('microphone → Whisper → response', result, captured)))
                else:
                    self.events.put(('result', ('microphone', {'status': 'no_speech'}, captured)))
            except Exception as error:
                self.events.put(('error', (captured, str(error))))
            finally:
                if path:
                    path.unlink(missing_ok=True)
                self.events.put(('record_done', captured))
        self.actor_value = self.actor.get()
        threading.Thread(target=worker, daemon=True).start()
    def record_finish(self, event=None):
        self.record_stop.set()
    def toggle_vad(self):
        if self.auto_vad.get() and self.mic_armed:
            self.check_vad_ready()
        else:
            self.record_stop.set()
    def check_vad_ready(self):
        if not self.mic_armed or not self.auto_vad.get() or self.closed:
            return
        captured = self.generation
        def worker():
            try:
                result = self.request(dict(action='status'))
                self.events.put(('vad_ready', (captured, not result['active_audio'] and not result['conversation_busy'] and not result['turn_busy'])))
            except Exception as error:
                self.events.put(('error', (captured, str(error))))
        threading.Thread(target=worker, daemon=True).start()
    def audio_file(self):
        path = filedialog.askopenfilename(parent=self, title='Local PCM16 mono WAV (16/48 kHz, up to 30 seconds)', filetypes=[('WAV audio', '*.wav')])
        if path:
            self.action('transcript', audioPath=path)
    def device_tts(self):
        text = self.transcript.get('1.0', 'end-1c')
        if os.name != 'nt' or not text.strip() or len(text) > 1000:
            self.status.set('Device TTS requires Windows and 1–1000 characters.'); return
        encoded = base64.b64encode(text.encode('utf-8')).decode('ascii')
        script = "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + encoded + "'))); $s.Dispose()"
        if self.tts_process and self.tts_process.poll() is None:
            self.tts_process.terminate()
        self.tts_process = subprocess.Popen(['powershell.exe', '-NoProfile', '-EncodedCommand', base64.b64encode(script.encode('utf-16le')).decode('ascii')], creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.write('Device TTS: Windows generic voice, not Shanny/Rev OmniVoice.')
    def audio_worker(self):
        while True:
            item = self.audio_jobs.get()
            if item is None:
                return
            event, captured, endpoint, token = item
            if self.closed or captured != self.generation:
                continue
            try:
                req = Request(endpoint.replace('/action', '/audio/' + event['id']), headers={'Authorization': 'Bearer ' + token})
                with build_opener(ProxyHandler({})).open(req, timeout=5) as reply:
                    audio = reply.read(24 * 1024 * 1024 + 1)
                if len(audio) > 24 * 1024 * 1024:
                    raise RuntimeError('Desktop audio budget exceeded')
                completed = self.desktop_audio.play(audio, lambda: not self.closed and self.audio_admission and captured == self.generation,
                    lambda: self.request(dict(action='playback', id=event['id'], state='started')))
                if captured == self.generation:
                    self.request(dict(action='playback', id=event['id'], state='finished' if completed else 'stopped'))
            except Exception as error:
                self.desktop_audio.stop()
                if captured == self.generation:
                    self.events.put(('message', 'Desktop audio failed: ' + str(error)))
                    self.events.put(('audio_failed', captured))
    def poll(self):
        if self.closed:
            return
        try:
            while True:
                kind, value = self.events.get_nowait()
                if kind == 'level':
                    self.level['value'] = value
                elif kind == 'sharing':
                    self.sharing_status.set(value)
                elif kind == 'ready':
                    if value == self.generation:
                        self.on_ready()
                elif kind == 'startup_progress':
                    captured, message = value
                    if captured == self.generation:
                        self.status.set(message)
                        self.on_startup_progress(message)
                elif kind == 'error':
                    captured, message = value
                    if captured == self.generation:
                        self.status.set(message); self.write(message); self.on_error(message)
                elif kind == 'status_failed':
                    self.status_pending = False
                elif kind == 'audio_failed':
                    if value == self.generation:
                        self.stop()
                elif kind == 'vad_ready':
                    captured, ready = value
                    if captured == self.generation and self.mic_armed and self.auto_vad.get():
                        if ready:
                            self.record_start()
                        else:
                            self.after(250, self.check_vad_ready)
                elif kind == 'record_done':
                    self.recording = False
                    if value == self.generation and self.mic_armed:
                        self.mic_state.set('Test mic armed; capture complete.')
                        if self.auto_vad.get():
                            self.after(300, self.check_vad_ready)
                elif kind == 'result':
                    action, result, captured = value
                    if action == 'status':
                        self.status_pending = False
                    if captured != self.generation:
                        continue
                    if action == 'arm':
                        self.mode_scope = {key: result[key] for key in ('session_id', 'mode_epoch')}
                        self.audio_admission = True
                    if action == 'status':
                        self.status.set(f"{result['mode']} | mic {'armed' if self.mic_armed else 'disarmed'} | {result['qwen']} | {result['playback']} | Whisper {'configured' if result['whisper_available'] else 'needs local config'}")
                        for event in result['trace']:
                            if event['seq'] > self.last_event_seq:
                                self.write(json.dumps(event)); self.last_event_seq = event['seq']
                            if self.audio_admission and result['playback'] == 'WINDOWS_DESKTOP_AUDIO' and result['mode'] == 'live' and event['epoch'] == result['gateway_epoch'] and event['type'] == 'speech.ready' and event['id'] not in self.played_ids:
                                self.played_ids.add(event['id'])
                                try:
                                    self.audio_jobs.put_nowait((event, captured, self.endpoint, self.token))
                                except queue.Full:
                                    self.stop()
                                if len(self.played_ids) > 256:
                                    self.played_ids = {row.get('id') for row in result['trace']}
                        if result['reaction_metrics']['sample_count']:
                            self.write('Metrics: ' + json.dumps(result['reaction_metrics']))
                    else:
                        self.write(action + ': ' + json.dumps(result, ensure_ascii=False)); self.status.set(action + ' completed')
                    self.on_result(action, result)
                else:
                    self.status.set(str(value)); self.write(str(value))
        except queue.Empty:
            pass
        self.poll_count += 1
        if self.endpoint and not self.status_pending and self.poll_count % 10 == 0:
            self.status_pending = True; self.action('status')
        self.poll_timer = self.after(100, self.poll)
    def close(self):
        if self.closed:
            return
        self.closed = True; self.generation += 1; self.stop_local()
        self.after_cancel(self.poll_timer)
        self.audio_jobs.put_nowait(None)
        if self.starting_process:
            self.terminate_owned(self.starting_process); self.starting_process = None
        if self.process:
            try:
                self.process.stdin.close()
            except OSError:
                pass
            self.process = None

def install_testing(app, main, repo=ROOT):
    """Wrap the existing operator frame; episode widgets and callbacks stay intact."""
    main.pack_forget()
    tabs = ttk.Notebook(app); tabs.pack(fill='both', expand=True)
    tabs.add(main, text='Episodes')
    from easy_testing import EasyTesting
    panel = EasyTesting(tabs, repo=repo); tabs.add(panel, text='Testing')
    app.testing_panel = panel.engine
    return panel.engine

if __name__ == '__main__':
    app = tk.Tk(); app.title('Stank Tank AI — Offline Testing'); app.geometry('1100x820')
    panel = TestingPanel(app); panel.pack(fill='both', expand=True)
    app.protocol('WM_DELETE_WINDOW', lambda: (panel.close(), app.destroy()))
    app.mainloop()

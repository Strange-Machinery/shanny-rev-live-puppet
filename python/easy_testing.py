"""Button-only offline testing home. Each test click explicitly admits that test."""
import json
import os
from pathlib import Path
import sys
import tkinter as tk
from tkinter import ttk, messagebox

from testing_tab import TestingPanel, ROOT
from remote_sharing import RemoteSharing


def bundled_settings(bundle):
    """Generate machine-local paths after extraction; never ship author paths."""
    bundle = Path(bundle).resolve()
    repo = bundle / 'app'
    config = repo / 'offline-testing.local.json'
    data = {'whisper': {
        'python': str(bundle / 'runtime/python/python.exe'),
        'modelPath': str(bundle / 'models/whisper-small.en')
    }}
    catalog = repo / 'data/animation-repertoire.json'
    if catalog.is_file():
        data['animationCatalog'] = str(catalog)
    config.write_text(json.dumps(data, indent=2), encoding='utf-8')
    return repo, str(bundle / 'runtime/node/node.exe'), config


class EasyTesting(ttk.Frame):
    def __init__(self, parent, repo=ROOT, node=None, config=None):
        super().__init__(parent, padding=20)
        self.pending = None
        self.record_requested = False
        self.ready = False
        self.busy = False
        self.awaiting_result = False
        self.real_mode = False
        self.real_profile = Path(os.environ.get('BUFF_REAL_PROFILE', str(Path(repo) / 'producer.local.json')))
        self.last_history = None
        self.heading = tk.StringVar(self, 'Getting ready…')
        ttk.Label(self, text='Producer — testing and connection', font=('Segoe UI', 24, 'bold')).pack(anchor='w')
        ttk.Label(self, text='Private practice. No YouTube, OBS, or internet needed.', font=('Segoe UI', 11)).pack(anchor='w', pady=(2, 10))
        ttk.Label(self, textvariable=self.heading, font=('Segoe UI', 12, 'bold'), wraplength=750).pack(anchor='w', pady=8)
        self.tabs = ttk.Notebook(self); self.tabs.pack(fill='both', expand=True)
        home = ttk.Frame(self.tabs, padding=16)
        advanced = ttk.Frame(self.tabs)
        self.tabs.add(home, text='Easy testing')
        self.tabs.add(advanced, text='Advanced tests')
        self.engine = TestingPanel(advanced, repo=repo, node=node, config=config)
        self.engine.pack(fill='both', expand=True)
        self.engine.on_ready = self.services_ready
        self.engine.on_result = self.result
        self.engine.on_error = self.show_error
        self.sharing = RemoteSharing(self.engine, lambda message: self.engine.events.put(('sharing', message)))
        share = ttk.Frame(self.tabs, padding=16); self.tabs.add(share, text='Connect Buff')
        ttk.Label(share, text='Your computer runs the models. Buff opens a tiny launcher.', font=('Segoe UI', 16, 'bold'), wraplength=760).pack(anchor='w')
        ttk.Label(share, text='Start sharing, then send Buff the generated launcher. He needs a browser and microphone; no Python, Node, Whisper, or model install.', wraplength=760).pack(anchor='w', pady=14)
        ttk.Button(share, text='Share testing with Buff', command=self.share).pack(anchor='w', pady=6, ipady=10)
        ttk.Button(share, text='Open Buff launcher folder', command=self.sharing.open_folder).pack(anchor='w', pady=6, ipady=10)
        ttk.Button(share, text='Stop sharing', command=self.sharing.close).pack(anchor='w', pady=6)
        ttk.Label(share, textvariable=self.engine.sharing_status, wraplength=760).pack(anchor='w', pady=14)
        ttk.Label(share, text='This connects the testing panel. Real character audio/video and the production show are not yet connected. Local testing works without internet; Buff needs internet to reach this computer.', wraplength=760).pack(anchor='w', pady=14)
        ttk.Label(home, text='Microphone', font=('Segoe UI', 14, 'bold')).pack(anchor='w')
        ttk.Label(home, text='Use headphones. Choose your microphone below; recording only starts when you press Test microphone.', wraplength=740).pack(anchor='w', pady=(4, 8))
        row = ttk.Frame(home); row.pack(fill='x')
        self.picker = ttk.Combobox(row, textvariable=self.engine.device, state='readonly', width=55,
                                  values=list(self.engine.devices))
        self.picker.pack(side='left', fill='x', expand=True)
        ttk.Button(row, text='Refresh', command=self.refresh).pack(side='left', padx=6)
        self.mic_button = ttk.Button(home, text='Test microphone', command=self.microphone)
        self.mic_button.pack(anchor='w', pady=10, ipady=8)
        ttk.Label(home, textvariable=self.engine.mic_state, wraplength=740).pack(anchor='w')
        self.meter = ttk.Progressbar(home, maximum=8000); self.meter.pack(fill='x', pady=6)
        ttk.Separator(home).pack(fill='x', pady=14)
        ttk.Label(home, text='Donation / speech', font=('Segoe UI', 14, 'bold')).pack(anchor='w')
        self.text = tk.Text(home, height=3, wrap='word', font=('Segoe UI', 11))
        self.text.pack(fill='x', pady=8)
        self.text.insert('1.0', 'Buff, tell Rev to let Shanny finish her sentence.')
        row = ttk.Frame(home); row.pack(fill='x')
        ttk.Button(row, text='Test donation', command=lambda: self.begin('donate')).pack(side='left', ipady=6)
        ttk.Button(row, text='Test typed response', command=lambda: self.begin('transcript')).pack(side='left', padx=8, ipady=6)
        ttk.Button(row, text='Hear text (Windows voice)', command=self.speak).pack(side='left', ipady=6)
        animation_row = ttk.Frame(home); animation_row.pack(fill='x', pady=8)
        self.animation_button = ttk.Menubutton(animation_row, text='Animations ▾')
        self.animation_button.pack(side='left', ipady=6)
        self.animation_menu = tk.Menu(self.animation_button, tearoff=False,
                                      postcommand=lambda: self.engine.action('animations') if self.ready else None)
        self.animation_button.configure(menu=self.animation_menu)
        self.animation_children = []
        self.animation_menu.add_command(label='Loading MotionLab catalog…', state='disabled')
        self.animation_note = tk.StringVar(self, 'MotionLab defines the gestures; unavailable clips stay disabled.')
        ttk.Label(animation_row, textvariable=self.animation_note, wraplength=580).pack(side='left', padx=10)
        self.service_note = tk.StringVar(self, 'Included: real offline speech recognition. Character replies, character audio, and episode playback are simulated in this package.')
        ttk.Label(home, textvariable=self.service_note, wraplength=740, foreground='#745300').pack(anchor='w', pady=14)
        if self.real_profile.is_file():
            ttk.Button(home, text='Start real characters — Blackout Shanny', command=self.start_real).pack(anchor='w', pady=4, ipady=6)
        self.output = tk.Text(home, height=6, wrap='word', state='disabled', font=('Segoe UI', 11))
        self.output.pack(fill='both', expand=True)
        row = ttk.Frame(self); row.pack(fill='x', pady=(12, 0))
        ttk.Button(row, text='STOP — silence and cancel', command=self.stop).pack(side='left', ipady=8)
        ttk.Button(row, text='Restart testing', command=self.restart).pack(side='right', ipady=8)
        self.start_timer = self.after(100, self.engine.start_lab)
        self.meter_timer = self.after(100, self.update_meter)
        self.bind('<Destroy>', lambda e: self.close() if e.widget is self else None)

    def refresh(self):
        self.engine.refresh_devices()
        self.picker.configure(values=list(self.engine.devices))

    def share(self):
        if not self.ready:
            self.engine.sharing_status.set('Wait until local testing is ready, then try again.')
            return
        self.engine.sharing_status.set('Starting the producer connection…')
        self.sharing.start()

    def services_ready(self):
        self.ready = True
        self.heading.set('Real characters ready. Microphone off.' if self.real_mode else 'Ready. Choose a test below.')
        self.engine.action('animations')

    def start_real(self):
        self.sharing.close()
        self.stop(); self.ready = False; self.real_mode = True; self.last_history = None
        self.engine.configuration = str(self.real_profile)
        self.service_note.set('Fast local Qwen + saved OmniVoice voices + Unity characters. Blackout Shanny leads. OBS output and episode handoff are separate.')
        self.heading.set('Loading real character services… This can take a minute. Microphone stays off.')
        self.engine.start_lab()

    def show_error(self, message):
        if self.ready:
            self.ready = False
            self.stop()
        else:
            self.engine.stop_local()
        self.heading.set(message + ' — click Restart testing to try again.')

    def begin(self, action):
        if not self.ready:
            self.heading.set('Still getting ready. Try again in a moment, or click Restart testing.')
            return
        if self.busy or self.engine.recording:
            self.heading.set('Let the current test finish, or press STOP.')
            return
        self.busy = True
        self.awaiting_result = True
        self.pending = (action, self.text.get('1.0', 'end-1c'))
        self.heading.set('Starting your test…')
        # This button press is the explicit resume; startup/reconnect never resumes.
        self.engine.action('arm')

    def microphone(self):
        if self.record_requested:
            self.record_requested = False
            if self.engine.recording:
                self.engine.record_finish()
                self.heading.set('Listening finished. Reading your words…')
            else:
                self.stop()
            self.mic_button.configure(text='Test microphone')
            return
        if self.engine.device.get() not in self.engine.devices:
            self.heading.set('Plug in a microphone, then click Refresh.')
            return
        if not self.ready or self.busy:
            self.heading.set('Wait for the current test, or click Restart testing.')
            return
        self.record_requested = True
        self.mic_button.configure(text='Finish recording')
        self.begin('microphone')

    def result(self, action, result):
        if action == 'animations':
            self.animation_catalog(result)
        elif action == 'arm' and self.pending:
            action, text = self.pending
            self.pending = None
            if action == 'microphone':
                if not self.record_requested:
                    return
                self.engine.isolated.set(True)
                self.engine.arm_mic()
                self.engine.record_start()
                self.heading.set('Speak now. Click Finish recording when done (30 seconds maximum).')
            else:
                self.engine.action(action, text)
        elif action == 'status':
            if result.get('real_characters'):
                self.real_mode = True
                history = result.get('history', [])
                if history and history != self.last_history:
                    self.last_history = history
                    self.display('\n\n'.join(row['actor'].title() + ': ' + row['text'] for row in history))
                if result.get('error'):
                    self.heading.set(result['error'] + ' — press a test button to retry.')
            self.meter['value'] = self.engine.level['value']
            if self.busy and not self.awaiting_result and not self.pending and not self.engine.recording and not result['turn_busy'] and not result['conversation_busy'] and not result['active_audio']:
                self.busy = False
                timing = result.get('latency') or {}
                first = timing.get('first_reply_ms')
                message = ('First reply: %.1f seconds. ' % (first / 1000)) if first is not None else ''
                self.heading.set(result['error'] + ' — press a test button to retry.' if result.get('error') else message + 'Ready for another test.')
        elif action not in ('arm', 'status'):
            self.awaiting_result = False
            if result.get('status') == 'no_speech':
                self.stop()
                self.display('No speech was detected. Check the selected microphone and try again.')
            if 'transcript' in result:
                self.display('Input: ' + result['transcript'] + ('\n\nThe real characters are responding in the stage window.' if result.get('kind') == 'REAL_CHARACTERS' else '\n\nOffline Whisper worked. The simulated character-response path completed.'))
                self.engine.mic_armed = False
                self.engine.mic_state.set('Microphone off. Click Test microphone to record again.')
                self.record_requested = False
                self.mic_button.configure(text='Test microphone')
            elif action == 'donate':
                self.display('Test donation accepted. Watch the Advanced tests tab for read → prepared response → playback events.')

    def animation_catalog(self, catalog):
        self.animation_note.set(catalog.get('message', 'MotionLab catalog'))
        self.animation_menu.delete(0, 'end')
        for menu in reversed(self.animation_children):
            menu.destroy()
        self.animation_children.clear()
        for target, name in [('SHANNY', 'Shanny'), ('REV', 'Rev'), ('BOTH', 'Both')]:
            actors = tk.Menu(self.animation_menu, tearoff=False)
            self.animation_children.append(actors)
            self.animation_menu.add_cascade(label=name, menu=actors)
            rows = [row for row in catalog['items'] if row['target'] == target]
            if not rows:
                actors.add_command(label='Awaiting MotionLab definitions', state='disabled')
            for category in sorted({row['category'] for row in rows}):
                groups = tk.Menu(actors, tearoff=False); actors.add_cascade(label=category, menu=groups)
                self.animation_children.append(groups)
                group_rows = [row for row in rows if row['category'] == category]
                for context in sorted({context for row in group_rows for context in row['contexts']}):
                    gestures = tk.Menu(groups, tearoff=False); groups.add_cascade(label=context, menu=gestures)
                    self.animation_children.append(gestures)
                    for row in group_rows:
                        if context in row['contexts']:
                            gestures.add_command(label=row['label'] + ('' if row['playable'] else ' — unavailable'),
                                state='normal' if row['playable'] else 'disabled',
                                command=lambda item=row, selected_context=context: self.engine.action('animate', id=item['id'], target=item['target'], context=selected_context, catalogRevision=catalog['revision']))

    def display(self, text):
        self.output.configure(state='normal'); self.output.delete('1.0', 'end')
        self.output.insert('1.0', text); self.output.configure(state='disabled')

    def speak(self):
        self.engine.transcript.delete('1.0', 'end')
        self.engine.transcript.insert('1.0', self.text.get('1.0', 'end-1c'))
        self.engine.device_tts()

    def stop(self):
        self.pending = None; self.busy = False; self.record_requested = False
        self.awaiting_result = False
        self.sharing.close()
        self.engine.stop()
        self.mic_button.configure(text='Test microphone')
        self.heading.set('Stopped. Microphone off. Press a test button when you want to continue.')

    def restart(self):
        self.stop(); self.ready = False
        self.heading.set('Restarting testing…')
        self.engine.start_lab()

    def update_meter(self):
        if not self.engine.closed:
            self.meter['value'] = self.engine.level['value']
            if self.record_requested and not self.engine.recording and not self.pending and not self.busy:
                self.record_requested = False; self.mic_button.configure(text='Test microphone')
            self.meter_timer = self.after(100, self.update_meter)

    def close(self):
        self.sharing.close()
        self.after_cancel(self.start_timer)
        self.after_cancel(self.meter_timer)
        self.engine.close()


def main():
    root = tk.Tk(); root.title('Producer — Buff connection and testing'); root.geometry('1000x850'); root.minsize(850, 750)
    try:
        bundle = Path(__file__).resolve().parents[2]
        settings = bundled_settings(bundle) if (bundle / 'runtime/node/node.exe').is_file() else (ROOT, None, None)
        panel = EasyTesting(root, repo=settings[0], node=settings[1], config=settings[2])
        panel.pack(fill='both', expand=True)
        if '--real' in sys.argv and panel.real_profile.is_file():
            panel.after_cancel(panel.start_timer)
            panel.start_timer = panel.after(100, panel.start_real)
        root.protocol('WM_DELETE_WINDOW', lambda: (panel.close(), root.destroy()))
        root.mainloop()
    except Exception as error:
        messagebox.showerror('Buff Testing needs repair', 'Please open the Buff Testing installer again.\n\n' + str(error), parent=root)
        root.destroy()


if __name__ == '__main__':
    main()

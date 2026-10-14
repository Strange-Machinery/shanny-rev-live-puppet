"""Maintainer acceptance: run using the extracted bundle's python.exe -I.

No recording or audible playback. Uses a caller-provided synthetic WAV.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import tkinter as tk
import subprocess
import base64
import wave
import io
from urllib.request import Request, build_opener, ProxyHandler

parser = argparse.ArgumentParser()
parser.add_argument('--bundle', required=True)
parser.add_argument('--wav', required=True)
args = parser.parse_args()
bundle = Path(args.bundle).resolve()
assert Path(sys.prefix).resolve() == bundle / 'runtime/python', sys.prefix
os.environ['PATH'] = os.path.join(os.environ['SystemRoot'], 'System32')
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
sys.path.insert(0, str(bundle / 'app/python'))
from easy_testing import EasyTesting, bundled_settings

manifest = json.loads((bundle / 'package-manifest.json').read_text())
for relative, expected in manifest['files'].items():
    with (bundle / relative).open('rb') as handle:
        assert hashlib.file_digest(handle, 'sha256').hexdigest() == expected, relative
repo, node, config = bundled_settings(bundle)
root = tk.Tk(); root.withdraw()
errors = []
root.report_callback_exception = lambda *error: errors.append(str(error))
panel = EasyTesting(root, repo=repo, node=node, config=config)
results = []
callback = panel.engine.on_result
panel.engine.on_result = lambda action, result: (results.append((action, result)), callback(action, result))

def until(condition, seconds=15):
    end = time.monotonic() + seconds
    while not condition():
        assert time.monotonic() < end, panel.heading.get()
        root.update(); time.sleep(.02)
    assert not errors, errors

try:
    until(lambda: panel.ready)
    assert not panel.engine.mic_armed
    assert panel.engine.request({'action': 'status'})['mode'] != 'live'
    until(lambda: any(action == 'animations' for action, _ in results))
    catalog = next(result for action, result in results if action == 'animations')
    assert catalog['items'], 'Packaged MotionLab catalog is missing'
    assert {row['target'] for row in catalog['items']} == {'SHANNY', 'REV', 'BOTH'}
    assert not any(row['playable'] for row in catalog['items']), 'Unconnected player must stay disabled'
    assert panel.animation_menu.index('end') == 2
    panel.animation_catalog(catalog)  # Reopening replaces menus without stale commands.
    panel.begin('donate')
    until(lambda: any(action == 'donate' for action, _ in results))
    until(lambda: not panel.busy)
    panel.stop()
    until(lambda: panel.engine.request({'action': 'status'})['mode'] != 'live')
    # Exercise the remote boundary locally, with all inference on the producer.
    remote_key = 'temporary-verification-key-' + 'a' * 40
    remote_config = repo / 'work/remote-check.local.json'
    remote_config.parent.mkdir(parents=True, exist_ok=True)
    remote_config.write_text(json.dumps({'endpoint': panel.engine.endpoint, 'upstreamToken': panel.engine.token,
        'publicOrigin': 'https://producer.example', 'token': remote_key, 'scratch': str(repo / 'work/remote-check-audio')}))
    remote = subprocess.Popen([node, str(repo / 'src/remote-panel.mjs'), str(remote_config)],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        line = remote.stdout.readline()
        assert line, 'Remote panel failed to start'
        remote_port = json.loads(line)['port']
        with wave.open(args.wav, 'rb') as source:
            assert source.getnchannels() == 1 and source.getsampwidth() == 2
            rate = source.getframerate(); pcm = source.readframes(source.getnframes())
        if rate == 16000:
            pcm = b''.join(pcm[i:i+2] * 3 for i in range(0, len(pcm), 2))
        else:
            assert rate == 48000
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(48000); output.writeframes(pcm)
        request = Request('http://127.0.0.1:' + str(remote_port) + '/api/action',
            data=json.dumps({'action': 'microphone', 'audio': base64.b64encode(stream.getvalue()).decode()}).encode(),
            headers={'Authorization': 'Bearer ' + remote_key, 'Content-Type': 'application/json'})
        with build_opener(ProxyHandler({})).open(request, timeout=75) as response:
            remote_result = json.load(response)
        assert 'Buff' in remote_result['transcript'] and 'Rev' in remote_result['transcript'], remote_result
    finally:
        remote.stdin.close(); remote.wait(timeout=10)
        remote_config.unlink(missing_ok=True)
    panel.begin('transcript')
    until(lambda: any(action == 'transcript' for action, _ in results))
    until(lambda: not panel.busy)
    results.clear()
    panel.engine.action('transcript', audioPath=str(Path(args.wav).resolve()))
    until(lambda: any('transcript' in result and result.get('transcription_kind') == 'LOCAL_WHISPER' for _, result in results), 90)
    result = next(result for _, result in results if result.get('transcription_kind') == 'LOCAL_WHISPER')
    assert 'Buff' in result['transcript'] and 'Rev' in result['transcript'], result
    assert not panel.engine.mic_armed
    panel.stop()
    until(lambda: panel.engine.request({'action': 'status'})['mode'] != 'live')
    print(json.dumps({'bundle_integrity_files': len(manifest['files']), 'automatic_start_muted': True,
                      'donation_button': True, 'typed_response_button': True, 'stop': True,
                      'animation_entries': len(catalog['items']), 'animation_playback_enabled': False,
                      'whisper': result, 'microphone_recorded': False,
                      'external_runtimes_on_path': False, 'tk_errors': errors}, indent=2))
    print(json.dumps({'remote_upload_to_producer_whisper': remote_result, 'public_https_enabled': False}, indent=2))
finally:
    process = panel.engine.process
    panel.close(); root.update_idletasks(); root.destroy()
    if process:
        process.wait(timeout=10)

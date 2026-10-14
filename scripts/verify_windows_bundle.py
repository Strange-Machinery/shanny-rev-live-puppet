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
    panel.begin('donate')
    until(lambda: any(action == 'donate' for action, _ in results))
    until(lambda: not panel.busy)
    panel.stop()
    until(lambda: panel.engine.request({'action': 'status'})['mode'] != 'live')
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
                      'whisper': result, 'microphone_recorded': False,
                      'external_runtimes_on_path': False, 'tk_errors': errors}, indent=2))
finally:
    process = panel.engine.process
    panel.close(); root.update_idletasks(); root.destroy()
    if process:
        process.wait(timeout=10)

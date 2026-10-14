"""Installer's offline readiness gate, with no microphone/output admission."""
import json
from pathlib import Path
import subprocess
import sys
import tkinter as tk

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from faster_whisper import WhisperModel
from easy_testing import bundled_settings

repo, node, config = bundled_settings(root)
version = subprocess.check_output([node, '--version'], text=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).strip()
if int(version.lstrip('v').split('.')[0]) < 22:
    raise RuntimeError('Bundled Node version is too old')
window = tk.Tk(); window.withdraw(); window.update(); window.destroy()
model = WhisperModel(str(root / 'models/whisper-small.en'), device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
print(json.dumps({'ready': True, 'node': version, 'whisper': 'local CPU small.en', 'microphone_recorded': False}))

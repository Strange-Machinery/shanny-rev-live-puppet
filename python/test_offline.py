import importlib.util
from pathlib import Path
import struct
import tempfile
import tkinter as tk
import unittest
from unittest.mock import MagicMock, patch
import io
import wave
from microphone import EnergyVAD
from testing_tab import install_testing
import desktop_audio

class OfflineTests(unittest.TestCase):
    def audio(self):
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(48000); audio.writeframes(b'\0' * 960)
        return stream.getvalue()
    def fake_output(self):
        dll = MagicMock()
        def opened(pointer, *_):
            pointer._obj.value = 123
            return 0
        def written(_handle, pointer, _size):
            pointer._obj.dwFlags = 1
            return 0
        dll.waveOutOpen.side_effect = opened
        dll.waveOutPrepareHeader.return_value = 0
        dll.waveOutWrite.side_effect = written
        return dll
    def test_desktop_buffer_completion_and_stop_use_owned_audio_handle(self):
        dll = self.fake_output(); player = desktop_audio.DesktopAudio(); receipts = []
        with patch.object(desktop_audio.os, 'name', 'nt'), patch.object(desktop_audio.c, 'WinDLL', return_value=dll, create=True):
            self.assertTrue(player.play(self.audio(), lambda: True, lambda: receipts.append('submitted')))
            self.assertEqual(receipts, ['submitted'])
            self.assertIsNone(player.handle)
            dll.waveOutReset.assert_called_once()
            dll.waveOutClose.assert_called_once()
    def test_desktop_stale_generation_cannot_start_and_stop_wins_pending_playback(self):
        dll = self.fake_output(); player = desktop_audio.DesktopAudio()
        with patch.object(desktop_audio.os, 'name', 'nt'), patch.object(desktop_audio.c, 'WinDLL', return_value=dll, create=True):
            self.assertFalse(player.play(self.audio(), lambda: False, lambda: self.fail('stale audio started')))
            dll.waveOutOpen.assert_not_called()
            self.assertFalse(player.play(self.audio(), lambda: True, player.stop))
            self.assertIsNone(player.handle)
    def test_vad_silence_never_emits_an_utterance(self):
        vad = EnergyVAD()
        for _ in range(20):
            self.assertFalse(vad.feed(b'\0' * 3200)[1])
        self.assertEqual(vad.result(), b'')
    def test_vad_speech_end_and_short_noise(self):
        voice = struct.pack('<1600h', *([1000] * 1600))
        vad = EnergyVAD()
        vad.feed(voice)
        self.assertEqual(vad.result(), b'')
        vad.feed(voice)
        for _ in range(6):
            self.assertFalse(vad.feed(b'\0' * 3200)[1])
        self.assertTrue(vad.feed(b'\0' * 3200)[1])
        self.assertTrue(vad.result())
    def test_testing_tab_installs_without_changing_existing_widgets_or_arming_mic(self):
        root = tk.Tk(); root.withdraw()
        try:
            main = tk.Frame(root); main.pack(); existing = tk.Button(main, text='Episode production')
            existing.pack(); panel = install_testing(root, main); root.update()
            self.assertEqual(existing.cget('text'), 'Episode production')
            self.assertFalse(panel.mic_armed)
            panel.mic_armed = True; panel.stop_local(); self.assertFalse(panel.mic_armed)
            panel.close()
        finally:
            root.destroy()
    def test_reversible_installer_only_adds_ui_hook(self):
        spec = importlib.util.spec_from_file_location('installer', Path(__file__).resolve().parents[1] / 'scripts/install_testing_tab.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'demo.py'; original = 'class Demo:\n    def setup(self):\n        install(self,main)\n        episode_production()\n'
            file.write_text(original)
            module.install(folder, Path(__file__).resolve().parents[1]); module.install(folder, Path(__file__).resolve().parents[1])
            modified = file.read_text()
            self.assertEqual(modified.count('install_testing(self,main)'), 1)
            self.assertIn('        episode_production()\n', modified)
            self.assertEqual(len(list(Path(folder).glob('demo.testing-backup-*'))), 1)

if __name__ == '__main__':
    unittest.main()

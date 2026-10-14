import importlib.util
from pathlib import Path
import struct
import tempfile
import tkinter as tk
import unittest
from microphone import EnergyVAD
from testing_tab import install_testing

class OfflineTests(unittest.TestCase):
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

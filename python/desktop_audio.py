"""Owned WinMM desktop WAV playback, with synchronous stop and actual DONE receipt."""
import ctypes as c
import io
import os
import threading
import time
import wave
from microphone import WAVEFORMATEX, WAVEHDR

class DesktopAudio:
    def __init__(self):
        self.lock = threading.Lock()
        self.handle = None
        self.header = None
        self.buffer = None
        self.dll = None
    def _close(self):
        if self.handle:
            self.dll.waveOutReset(self.handle)
            self.dll.waveOutUnprepareHeader(self.handle, c.byref(self.header), c.sizeof(self.header))
            self.dll.waveOutClose(self.handle)
            self.handle = None; self.header = None; self.buffer = None
    def stop(self):
        with self.lock:
            self._close()
    def play(self, wav, current, started):
        if os.name != 'nt':
            raise RuntimeError('Desktop character audio testing requires Windows')
        with wave.open(io.BytesIO(wav), 'rb') as audio:
            if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 48000:
                raise ValueError('Character test audio must be PCM16 mono 48 kHz')
            duration = audio.getnframes() / 48000
            data = audio.readframes(audio.getnframes())
        dll = c.WinDLL('winmm')
        dll.waveOutOpen.argtypes = [c.POINTER(c.c_void_p), c.c_uint, c.POINTER(WAVEFORMATEX), c.c_size_t, c.c_size_t, c.c_uint]
        for name in ('waveOutPrepareHeader', 'waveOutWrite', 'waveOutUnprepareHeader'):
            getattr(dll, name).argtypes = [c.c_void_p, c.POINTER(WAVEHDR), c.c_uint]
        for name in ('waveOutReset', 'waveOutClose'):
            getattr(dll, name).argtypes = [c.c_void_p]
        with self.lock:
            if not current():
                return False
            self._close(); self.dll = dll
            handle = c.c_void_p()
            fmt = WAVEFORMATEX(1, 1, 48000, 96000, 2, 16, 0)
            if dll.waveOutOpen(c.byref(handle), 0xffffffff, c.byref(fmt), 0, 0, 0):
                raise RuntimeError('Desktop output device unavailable')
            self.buffer = c.create_string_buffer(data)
            self.header = WAVEHDR(c.cast(self.buffer, c.c_void_p), len(data), 0, 0, 0, 0, None, 0)
            self.handle = handle
            if dll.waveOutPrepareHeader(handle, c.byref(self.header), c.sizeof(self.header)) or dll.waveOutWrite(handle, c.byref(self.header), c.sizeof(self.header)):
                self._close(); raise RuntimeError('Desktop audio admission failed')
        try:
            started()  # API submission acknowledgement, not physical speaker-onset measurement.
            deadline = time.monotonic() + duration + 10
            while time.monotonic() < deadline:
                with self.lock:
                    if self.handle != handle or not current():
                        return False
                    if self.header.dwFlags & 1:
                        self._close(); return True
                time.sleep(.01)
            raise RuntimeError('Desktop playback completion timed out')
        finally:
            with self.lock:
                if self.handle == handle:
                    self._close()

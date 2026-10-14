"""Explicit WinMM input-device capture. No loopback, network, or auto-arming."""
import ctypes as c
import io
import math
import os
import struct
import time
import wave
from collections import deque
from ctypes import wintypes as w

class WAVEINCAPS(c.Structure):
    _fields_ = [('wMid', w.WORD), ('wPid', w.WORD), ('vDriverVersion', w.DWORD),
                ('szPname', w.WCHAR * 32), ('dwFormats', w.DWORD),
                ('wChannels', w.WORD), ('wReserved1', w.WORD)]

class WAVEFORMATEX(c.Structure):
    _fields_ = [('wFormatTag', w.WORD), ('nChannels', w.WORD), ('nSamplesPerSec', w.DWORD),
                ('nAvgBytesPerSec', w.DWORD), ('nBlockAlign', w.WORD),
                ('wBitsPerSample', w.WORD), ('cbSize', w.WORD)]

class WAVEHDR(c.Structure):
    _fields_ = [('lpData', c.c_void_p), ('dwBufferLength', w.DWORD), ('dwBytesRecorded', w.DWORD),
                ('dwUser', c.c_size_t), ('dwFlags', w.DWORD), ('dwLoops', w.DWORD),
                ('lpNext', c.c_void_p), ('reserved', c.c_size_t)]

def api():
    if os.name != 'nt':
        raise RuntimeError('The test microphone adapter requires Windows')
    dll = c.WinDLL('winmm')
    dll.waveInGetNumDevs.restype = w.UINT
    dll.waveInGetDevCapsW.argtypes = [c.c_size_t, c.POINTER(WAVEINCAPS), w.UINT]
    dll.waveInOpen.argtypes = [c.POINTER(c.c_void_p), w.UINT, c.POINTER(WAVEFORMATEX), c.c_size_t, c.c_size_t, w.DWORD]
    for name in ('waveInPrepareHeader', 'waveInAddBuffer', 'waveInUnprepareHeader'):
        getattr(dll, name).argtypes = [c.c_void_p, c.POINTER(WAVEHDR), w.UINT]
    for name in ('waveInStart', 'waveInStop', 'waveInReset', 'waveInClose'):
        getattr(dll, name).argtypes = [c.c_void_p]
    return dll

def devices():
    dll = api()
    result = []
    for index in range(dll.waveInGetNumDevs()):
        caps = WAVEINCAPS()
        if dll.waveInGetDevCapsW(index, c.byref(caps), c.sizeof(caps)) == 0:
            name = caps.szPname
            mixed = any(token in name.casefold() for token in ('stereo mix', 'what u hear', 'loopback', 'obs'))
            result.append(dict(id=index, name=name, isolated_candidate=not mixed))
    return result

class EnergyVAD:
    """Simple test VAD, separate from Whisper's model VAD. 100 ms PCM chunks."""
    def __init__(self, threshold=500, silence_chunks=7):
        self.threshold = threshold
        self.silence_chunks = silence_chunks
        self.voice_chunks = 0
        self.silence = 0
        self.chunks = []
        self.peak = 0
    def feed(self, data):
        samples = struct.unpack('<' + 'h' * (len(data) // 2), data)
        rms = math.sqrt(sum(v * v for v in samples) / max(1, len(samples)))
        self.peak = max(self.peak, rms)
        self.chunks.append(data)
        if rms >= self.threshold:
            self.voice_chunks += 1
            self.silence = 0
        elif self.voice_chunks:
            self.silence += 1
        return rms, self.voice_chunks >= 2 and self.silence >= self.silence_chunks
    def result(self):
        return b''.join(self.chunks) if self.voice_chunks >= 2 else b''

def capture(device_id, stop, *, auto_vad=False, level=lambda rms: None, max_seconds=30):
    options = {row['id']: row for row in devices()}
    if device_id not in options or not options[device_id]['isolated_candidate']:
        raise ValueError('Select an actual isolated input; mixed/loopback devices are blocked')
    dll = api()
    handle = c.c_void_p()
    fmt = WAVEFORMATEX(1, 1, 16000, 32000, 2, 16, 0)
    code = dll.waveInOpen(c.byref(handle), device_id, c.byref(fmt), 0, 0, 0)
    if code:
        raise RuntimeError(f'Microphone open failed ({code}); check Windows input permissions/device')
    buffers = []
    vad = EnergyVAD()
    try:
        for _ in range(6):
            data = c.create_string_buffer(3200)
            header = WAVEHDR(c.cast(data, c.c_void_p), 3200, 0, 0, 0, 0, None, 0)
            if dll.waveInPrepareHeader(handle, c.byref(header), c.sizeof(header)):
                raise RuntimeError('Microphone buffer preparation failed')
            buffers.append((data, header))
            if dll.waveInAddBuffer(handle, c.byref(header), c.sizeof(header)):
                raise RuntimeError('Microphone buffering failed')
        if dll.waveInStart(handle):
            raise RuntimeError('Microphone start failed')
        start = time.monotonic()
        ended = False
        pending = deque(buffers)
        while not stop.is_set() and not ended and time.monotonic() - start < max_seconds:
            for _ in range(len(buffers)):
                data, header = pending[0]
                if header.dwFlags & 1:
                    pending.popleft()
                    raw = data.raw[:header.dwBytesRecorded]
                    if raw:
                        rms, speech_ended = vad.feed(raw)
                        ended = auto_vad and speech_ended
                        level(rms)
                    header.dwBytesRecorded = 0
                    if dll.waveInAddBuffer(handle, c.byref(header), c.sizeof(header)):
                        raise RuntimeError('Microphone device was lost')
                    pending.append((data, header))
                else:
                    break
            time.sleep(.01)
    finally:
        dll.waveInStop(handle)
        dll.waveInReset(handle)
        for _, header in buffers:
            dll.waveInUnprepareHeader(handle, c.byref(header), c.sizeof(header))
        dll.waveInClose(handle)
    pcm = vad.result()
    if not pcm:
        return b'', dict(speech_detected=False, peak_rms=round(vad.peak))
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(16000); output.writeframes(pcm)
    return stream.getvalue(), dict(speech_detected=True, duration_ms=len(pcm) / 32, peak_rms=round(vad.peak))

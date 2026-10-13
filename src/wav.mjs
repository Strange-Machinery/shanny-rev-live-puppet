import { Buffer } from 'node:buffer';

export const SAMPLE_RATE = 48_000;
const MAX_WAV_BYTES = 24 * 1024 * 1024;

/** Strict PCM16/mono/48 kHz validation; never trust an arbitrary returned file. */
export function inspectWav(input) {
  const wav = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (wav.length < 44 || wav.length > MAX_WAV_BYTES ||
      wav.toString('ascii', 0, 4) !== 'RIFF' ||
      wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Expected a bounded RIFF/WAVE buffer');
  }
  const declaredSize = wav.readUInt32LE(4) + 8;
  if (declaredSize !== wav.length) throw new Error('WAV RIFF length mismatch');
  let fmt = null;
  let dataBytes = null;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const kind = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (size > wav.length - start) throw new Error('Truncated WAV chunk');
    if (kind === 'fmt ') {
      if (size < 16 || fmt) throw new Error('Malformed WAV fmt chunk');
      fmt = {
        format: wav.readUInt16LE(start),
        channels: wav.readUInt16LE(start + 2),
        rate: wav.readUInt32LE(start + 4),
        bytesPerSec: wav.readUInt32LE(start + 8),
        blockAlign: wav.readUInt16LE(start + 12),
        bits: wav.readUInt16LE(start + 14)
      };
    }
    if (kind === 'data') {
      if (dataBytes !== null) throw new Error('Multiple WAV data chunks');
      dataBytes = size;
    }
    offset = start + size + (size & 1);
  }
  if (!fmt || fmt.format !== 1 || fmt.channels !== 1 ||
      fmt.rate !== SAMPLE_RATE || fmt.bits !== 16 ||
      fmt.blockAlign !== 2 || fmt.bytesPerSec !== SAMPLE_RATE * 2 ||
      !dataBytes || dataBytes % 2 !== 0) {
    throw new Error('Expected PCM16 mono 48 kHz WAV with audio data');
  }
  return { sample_rate_hz: SAMPLE_RATE, frames: dataBytes / 2,
    duration_ms: (dataBytes / 2 / SAMPLE_RATE) * 1000 };
}

/** Short audible synthetic placeholder, not a voice clone or actual TTS. */
export function mockSpeechWav(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const durationSeconds = Math.min(6, Math.max(0.35, words * 0.16));
  const frames = Math.round(SAMPLE_RATE * durationSeconds);
  const bytes = 44 + frames * 2;
  const wav = Buffer.alloc(bytes);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(bytes - 8, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) {
    const t = i / SAMPLE_RATE;
    const fade = Math.min(1, t * 14, (durationSeconds - t) * 14);
    const pulse = 0.28 + 0.72 * Math.max(0, Math.sin(2 * Math.PI * 4.8 * t));
    const sample = Math.round(6000 * Math.max(0, fade) * pulse *
      Math.sin(2 * Math.PI * (196 + 36 * Math.sin(t * 3.5)) * t));
    wav.writeInt16LE(sample, 44 + 2 * i);
  }
  return wav;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectWav, mockSpeechWav, SAMPLE_RATE } from '../src/wav.mjs';

test('mock WAV is playable PCM16 mono 48 kHz', () => {
  const wav = mockSpeechWav('Shanny, please stop interrupting Rev!');
  const meta = inspectWav(wav);
  assert.equal(meta.sample_rate_hz, SAMPLE_RATE);
  assert.ok(meta.duration_ms >= 300 && meta.duration_ms <= 6000);
  assert.ok(meta.frames > 0);
});

test('malformed and contradictory audio fails closed', () => {
  assert.throws(() => inspectWav(Buffer.from('hello')));
  const wav = mockSpeechWav('test');
  const wrongRate = Buffer.from(wav);
  wrongRate.writeUInt32LE(16_000, 24);
  assert.throws(() => inspectWav(wrongRate), /Expected PCM16/);
  const truncated = wav.subarray(0, wav.length - 10);
  assert.throws(() => inspectWav(truncated));
  const broken = Buffer.from(wav);
  broken.write('NOTW', 8, 'ascii');
  assert.throws(() => inspectWav(broken));
});

test('trailing incomplete RIFF chunk is rejected', () => {
 const original=mockSpeechWav('test');const wav=Buffer.concat([original,Buffer.from([1,2,3])]);
 wav.writeUInt32LE(wav.length-8,4);assert.throws(()=>inspectWav(wav),/Incomplete/);
});

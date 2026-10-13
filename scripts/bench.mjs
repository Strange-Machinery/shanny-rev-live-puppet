/**
 * Local HTTP mock/real timing probe. Requires the running server and token.
 * Reports request-to-ready, not text-to-first-streaming-audio or speaker start.
 */
const base = process.env.LIVE_PUPPET_URL || 'http://127.0.0.1:8770';
const token = process.env.LIVE_PUPPET_TOKEN;
if (!token) throw new Error('Set LIVE_PUPPET_TOKEN before running bench');
const headers = { Authorization: 'Bearer ' + token };
const samples = [];
const prompts = [
  ['SHANNY', 'What do you mean by that?'],
  ['REV', 'I was trying to explain it.'],
  ['SHANNY', 'No, you are not going to interrupt me again!'],
  ['REV', 'But you just interrupted me.'],
  ['SHANNY', 'Buff, do you hear what he is saying?'],
  ['REV', 'That was not what I said.']
];
const status = await (await fetch(base + '/v1/status', { headers })).json();
let cursor = status.cursor;
for (const [actor, text] of prompts) {
  const start = performance.now();
  const response = await fetch(base + '/v1/speak', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor, text })
  });
  if (response.status !== 202) throw new Error('Speak failed: ' + await response.text());
  const { request_id: id } = await response.json();
  let ready;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && !ready) {
    await new Promise(resolve => setTimeout(resolve, 50));
    const poll = await fetch(base + '/v1/events?after=' + cursor, { headers });
    if (!poll.ok) throw new Error('Event poll failed: ' + poll.status);
    const page = await poll.json();
    cursor = page.cursor;
    for (const event of page.events) {
      if (event.id === id && event.type === 'speech.failed') {
        throw new Error('Voice synthesis failed: ' + event.reason);
      }
      if (event.id === id && event.type === 'speech.ready') ready = event;
    }
  }
  if (!ready) throw new Error('Timeout waiting for ' + id);
  const audio = await fetch(base + ready.audio_path, { headers });
  if (!audio.ok) throw new Error('Audio not retrievable');
  const downloadStart = performance.now();
  await audio.arrayBuffer();
  samples.push({ actor, audio_transport_ms: performance.now() - downloadStart, provider_timings: ready.provider_timings, request_to_ready_ms: ready.request_to_ready_ms,
    client_roundtrip_ms: Math.round(performance.now() - start),
    audio_duration_ms: ready.duration_ms });
}
const sorted = samples.map(s => s.request_to_ready_ms).sort((a, b) => a - b);
const pick = q => sorted[Math.ceil(q * sorted.length) - 1];
console.log(JSON.stringify({ schema_version: 'shanny-rev-live-puppet/benchmark/v1',
  note: 'Complete WAV ready; excludes Unity download/decode/playback and microphone ASR.',
  p50_ms: pick(0.5), p95_ms: pick(0.95), samples }, null, 2));

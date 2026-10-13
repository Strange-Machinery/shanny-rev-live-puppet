import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveServer } from '../src/live-server.mjs';
import { MockVoiceProvider } from '../src/providers/mock.mjs';
import { inspectWav } from '../src/wav.mjs';

const token = 'testing-only-not-a-secret';

async function harness(provider = new MockVoiceProvider()) {
  const server = createLiveServer({ provider, token, port: 0 });
  const { port } = await server.start();
  const base = 'http://127.0.0.1:' + port;
  const headers = { Authorization: 'Bearer ' + token };
  const get = (p) => fetch(base + p, { headers });
  const post = (p, body) => fetch(base + p, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  return { server, get, post, base };
}

async function waitFor(get, type, after = 0) {
  for (let i = 0; i < 60; i++) {
    const res = await get('/v1/events?after=' + after);
    assert.equal(res.status, 200);
    const body = await res.json();
    const event = body.events.find(e => e.type === type);
    if (event) return event;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for ' + type);
}

test('authorization and input validation reject bad traffic', async () => {
  const { server, base, post } = await harness();
  try {
    assert.equal((await fetch(base + '/v1/status')).status, 401);
    assert.equal((await post('/v1/speak', { actor: 'BUFF', text: 'hi' })).status, 400);
    assert.equal((await post('/v1/speak', { actor: 'REV', text: '' })).status, 400);
    assert.equal((await post('/v1/speak', { actor: 'REV', text: 'hi',
      delivery: 'arbitrary' })).status, 400);
    assert.equal((await post('/v1/speak', { actor: 'REV', text: 'a'.repeat(1001) })).status, 400);
  } finally { await server.close(); }
});

test('mock voice -> event -> fetch playable WAV -> metrics', async () => {
  const { server, get, post } = await harness();
  try {
    const queued = await post('/v1/speak', {
      actor: 'SHANNY', text: 'I did not eat the crust!', delivery: 'interrupt'
    });
    assert.equal(queued.status, 202);
    const { request_id } = await queued.json();
    const event = await waitFor(get, 'speech.ready');
    assert.equal(event.id, request_id);
    assert.equal(event.actor, 'SHANNY');
    assert.equal(event.delivery, 'interrupt');
    assert.ok(event.request_to_ready_ms >= 0);
    const audio = await get(event.audio_path);
    assert.equal(audio.status, 200);
    inspectWav(Buffer.from(await audio.arrayBuffer()));
    const metrics = await (await get('/v1/metrics')).json();
    assert.equal(metrics.ready, 1);
    assert.equal(metrics.failed, 0);
    assert.ok(metrics.ready_p95_ms >= 0);
  } finally { await server.close(); }
});

test('panic drops prepared audio and discards in-flight synthesis', async () => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const mock = new MockVoiceProvider();
  const provider = { name: 'delayed-mock',
    generate: async (req) => { await gate; return mock.generate(req); },
    close: async () => { finish(); } };
  const { server, get, post } = await harness(provider);
  try {
    const p = await post('/v1/speak', { actor: 'REV', text: 'I am speaking.' });
    assert.equal(p.status, 202);
    const panic = await post('/v1/panic');
    assert.equal(panic.status, 200);
    const panicEvent = await waitFor(get, 'panic');
    assert.equal(panicEvent.type, 'panic');
    finish();
    await new Promise(resolve => setTimeout(resolve, 30));
    const events = await (await get('/v1/events?after=' + panicEvent.seq)).json();
    assert.equal(events.events.filter(e => e.type === 'speech.ready').length, 0);
    const metrics = await (await get('/v1/metrics')).json();
    assert.equal(metrics.panic, 1);
  } finally { finish(); await server.close(); }
});

test('bounded queue backpressure', async () => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const mock = new MockVoiceProvider();
  const provider = { name: 'slow', generate: async req => {
    await gate; return mock.generate(req);
  }, close: async () => { finish(); } };
  const server = createLiveServer({ provider, token, port: 0, maxPending: 1 });
  const { port } = await server.start();
  const send = body => fetch('http://127.0.0.1:' + port + '/v1/speak', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  try {
    assert.equal((await send({ actor: 'REV', text: 'one' })).status, 202);
    assert.equal((await send({ actor: 'REV', text: 'two' })).status, 429);
  } finally { finish(); await server.close(); }
});

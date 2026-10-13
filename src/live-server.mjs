import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { inspectWav } from './wav.mjs';

export const SCHEMA = 'shanny-rev-live-puppet/v1';

const MAX_BODY = 4096;
const MAX_CLIPS = 20;
const MAX_AUDIO_MEMORY = 32 * 1024 * 1024;
const CLIP_TTL_MS = 120_000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

async function parseBody(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large');
    parts.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Object required');
    }
    return data;
  } catch {
    throw new HttpError(400, 'Invalid JSON object');
  }
}

function quantile(samples, q) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(q * sorted.length) - 1] * 100) / 100;
}

/**
 * Loopback-only stage gateway. No dialogue generator, ASR, or Unity capture.
 * Queued speech is serialized for one GPU worker. Audio is bounded in memory.
 */
export function createLiveServer({ provider, token, host = '127.0.0.1', port = 8770,
  maxPending = 4 } = {}) {
  if (!provider || typeof provider.generate !== 'function') {
    throw new Error('A voice provider is required');
  }
  if (typeof token !== 'string' || token.length < 12) {
    throw new Error('Use a random API token with at least 12 characters');
  }
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new Error('MVP only supports loopback host');
  }

  let cursor = 0;
  let epoch = 0;
  let running = false;
  let closed = false;
  let active = null;
  const queue = [];
  const events = [];
  const clips = new Map();
  const latencySamples = [];
  const counters = { accepted: 0, ready: 0, failed: 0, cancelled: 0, panic: 0 };

  function emit(type, fields = {}) {
    const event = { schema_version: SCHEMA, seq: ++cursor, type,
      timestamp_unix_ms: Date.now(), ...fields };
    events.push(event);
    if (events.length > 256) events.shift();
    return event;
  }

  function purgeClips() {
    for (const [id, entry] of clips) {
      if (entry.expires < Date.now()) clips.delete(id);
    }
  }

  function storeClip(id, wav) {
    purgeClips();
    if (wav.length > MAX_AUDIO_MEMORY) throw new Error('Audio memory limit exceeded');
    let currentBytes = () => [...clips.values()].reduce((sum, value) => sum + value.wav.length, 0);
    while (clips.size >= MAX_CLIPS || currentBytes() + wav.length > MAX_AUDIO_MEMORY) {
      const first = clips.keys().next().value;
      if (first === undefined) break;
      clips.delete(first);
    }
    clips.set(id, { wav, expires: Date.now() + CLIP_TTL_MS });
  }

  function pump() {
    if (running || closed) return;
    const job = queue.shift();
    if (!job) return;
    if (job.epoch !== epoch) { counters.cancelled++; pump(); return; }
    running = true;
    active = job;
    void (async () => {
      try {
        const wav = Buffer.from(await provider.generate({
          id: job.id, actor: job.actor, text: job.text
        }));
        const meta = inspectWav(wav);
        if (job.epoch !== epoch || closed) {
          counters.cancelled++;
          return;
        }
        storeClip(job.id, wav);
        const latency = performance.now() - job.submittedAt;
        latencySamples.push(latency);
        if (latencySamples.length > 200) latencySamples.shift();
        counters.ready++;
        emit('speech.ready', { id: job.id, actor: job.actor,
          delivery: job.delivery, audio_path: '/v1/audio/' + job.id,
          duration_ms: Math.round(meta.duration_ms),
          request_to_ready_ms: Math.round(latency * 100) / 100 });
      } catch (error) {
        if (job.epoch !== epoch || closed) {
          counters.cancelled++;
          return;
        }
        counters.failed++;
        emit('speech.failed', { id: job.id, actor: job.actor,
          reason: error instanceof Error ? error.message.slice(0, 240) : 'Unknown voice failure' });
      } finally {
        active = null;
        running = false;
        pump();
      }
    })();
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      if (res.headersSent) { res.end(); return; }
      json(res, error instanceof HttpError ? error.status : 500, {
        schema_version: SCHEMA,
        error: error instanceof HttpError ? error.message : 'Internal error'
      });
    });
  });

  async function handle(req, res) {
    const expected = Buffer.from('Bearer ' + token);
    const supplied = Buffer.from(String(req.headers.authorization || ''));
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      json(res, 401, { error: 'Unauthorized' }); return;
    }
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/v1/status') {
      json(res, 200, { schema_version: SCHEMA, cursor,
        provider: provider.name || 'custom',
        pending: queue.length + Number(running), epoch,
        events_retained: events.length }); return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/events') {
      const raw = url.searchParams.get('after') ?? '0';
      if (!/^(0|[1-9]\d{0,14})$/.test(raw)) throw new HttpError(400, 'Bad event cursor');
      const after = Number(raw);
      if (!Number.isSafeInteger(after) || after > cursor) {
        throw new HttpError(400, 'Bad event cursor');
      }
      if (events.length && after < events[0].seq - 1) {
        json(res, 409, { schema_version: SCHEMA, error: 'history_gap',
          latest_cursor: cursor }); return;
      }
      const page = events.filter(event => event.seq > after).slice(0, 32);
      json(res, 200, { schema_version: SCHEMA,
        cursor: page.length ? page[page.length - 1].seq : after,
        events: page }); return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/metrics') {
      json(res, 200, { schema_version: SCHEMA,
        ...counters, pending: queue.length + Number(running),
        ready_p50_ms: quantile(latencySamples, 0.5),
        ready_p95_ms: quantile(latencySamples, 0.95),
        sample_count: latencySamples.length }); return;
    }
    if (req.method === 'GET' && /^\/v1\/audio\/[a-f0-9-]{36}$/.test(url.pathname)) {
      purgeClips();
      const id = url.pathname.substring('/v1/audio/'.length);
      const clip = clips.get(id);
      if (!clip) throw new HttpError(404, 'Audio expired or unavailable');
      res.writeHead(200, { 'Content-Type': 'audio/wav',
        'Content-Length': clip.wav.length, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff' });
      res.end(clip.wav); return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/speak') {
      const body = await parseBody(req);
      if (!['SHANNY', 'REV'].includes(body.actor)) {
        throw new HttpError(400, 'actor must be SHANNY or REV');
      }
      if (typeof body.text !== 'string' || !body.text.trim() ||
          body.text.length > 1000) {
        throw new HttpError(400, 'text must be 1-1000 characters');
      }
      if (body.delivery !== undefined && !['queue', 'interrupt'].includes(body.delivery)) {
        throw new HttpError(400, 'delivery must be queue or interrupt');
      }
      if (queue.length + Number(running) >= maxPending) {
        throw new HttpError(429, 'Voice worker queue is full');
      }
      const id = randomUUID();
      queue.push({ id, actor: body.actor, text: body.text.trim(),
        delivery: body.delivery || 'queue', epoch, submittedAt: performance.now() });
      counters.accepted++;
      json(res, 202, { schema_version: SCHEMA, request_id: id, status: 'queued' });
      pump(); return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/panic') {
      epoch++;
      counters.panic++;
      counters.cancelled += queue.length;
      queue.length = 0;
      clips.clear();
      emit('panic', { epoch });
      json(res, 200, { schema_version: SCHEMA, status: 'muted', epoch }); return;
    }
    throw new HttpError(404, 'Unknown route');
  }

  return {
    async start() {
      if (closed) throw new Error('Server already closed');
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      const address = server.address();
      return { host, port: address.port };
    },
    async close() {
      closed = true;
      epoch++;
      queue.length = 0;
      clips.clear();
      await new Promise(resolve => server.close(resolve));
      await provider.close?.();
    },
    get cursor() { return cursor; },
    get activeRequestId() { return active?.id || null; }
  };
}

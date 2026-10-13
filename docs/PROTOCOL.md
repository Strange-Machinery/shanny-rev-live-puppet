# Live Puppet v1 — localhost HTTP contract

The gateway listens at http://127.0.0.1:8770 by default. **Every** request
requires Authorization: Bearer [operator token]. The API is only reachable
over loopback; CORS and remote binding are not enabled.

All envelope payloads use schema_version: shanny-rev-live-puppet/v1.

| Method | Route | Description |
|---|---|---|
| GET | /v1/status | Current sequence cursor, voice provider, pending count |
| POST | /v1/speak | Queue one utterance; 202 means accepted only |
| GET | /v1/events?after=N | Retrieve next stage events (up to 32 per page) |
| GET | /v1/audio/UUID | Fetch expiring complete PCM16 mono 48k WAV |
| POST | /v1/panic | Clear queue/cache, invalidate stale work, mute stage |
| GET | /v1/metrics | Rolling request-to-ready p50/p95 and counts |

### Speak request

~~~json
{"actor":"SHANNY","text":"Buff, what was that?","delivery":"interrupt"}
~~~

Actor is exactly SHANNY or REV. Text must be 1–1000 characters. Delivery
is queue (default) or interrupt. Full worker backlog returns 429. This
is **not** a Qwen prompt; a separate validated Director adapter will call
the gateway only after generating a safe structured result.

### Events

Bootstrap from GET /v1/status to get the latest cursor, then poll
/v1/events?after=N every 100 ms. Advance only to returned cursor. If
history has expired, HTTP 409 history_gap **requires stage mute and cursor
re-bootstrap**, never silent skip.

~~~json
{
  "schema_version": "shanny-rev-live-puppet/v1",
  "seq": 1,
  "type": "speech.ready",
  "timestamp_unix_ms": 0,
  "id": "a2bdfdc2-e42a-4dcc-8a05-f9af9dbc7286",
  "actor": "SHANNY",
  "delivery": "queue",
  "audio_path": "/v1/audio/a2bdfdc2-e42a-4dcc-8a05-f9af9dbc7286",
  "duration_ms": 800,
  "request_to_ready_ms": 1200
}
~~~

Numbers above are examples, **not performance measurements**. Other
events: speech.failed with id, actor, reason; panic with epoch. The
audio_path is created by the trusted server, never a URL from the AI.

The clip cache is bounded to 20 items / 32 MiB, TTL 120s. It is not a
recording archive.

### Panic / cancellation

Panic immediately invalidates waiting jobs and completed audio, increments
the generation epoch and emits a panic event. In-flight GPU voice synthesis
might still finish: its stale WAV will be discarded. Unity's Panic() method
stops local audio before posting to the server. **Mute is immediate locally;
GPU cancellation is not guaranteed.**

### Deferred versions

The v1 protocol has no streaming PCM or synchronized dyad
timeline, Whisper microphone capture or Qwen Director. Those require
explicit versioned additions, not overload of audio_path.

## Implemented control and telemetry additions

Status and event pages include `session_id`, `epoch` and `muted`. Pollers should send `session` alongside `after`. A session mismatch returns 409. Unity mutes and re-baselines after any poll failure, including a restart with a lower cursor; it never resumes old queued audio. Audio URLs are exact local UUID routes, with redirects disabled.

`delivery: interrupt` invalidates both actors' queued/prepared speech immediately, emits `interrupt`, and admits the new job ahead of the old backlog, even when full. This is the explicit cross-character interruption policy: Shanny can cut Rev off. In-flight GPU work is allowed to finish and is discarded; the persistent worker is not killed on each interrupt. New audio waits for that worker. Normal queued speech remains independent per actor in Unity.

Panic is now latched. `/v1/panic` invalidates all work and rejects speak with 423 until POST `/v1/resume`. Both routes require the same bearer token. A local Unity panic sets a local latch before making any network request. Automatic reconnect cannot clear that latch.

POST `/v1/playback` records authenticated `started`, `finished`, `stopped` observations for a known job in the current epoch/session. Metrics include a bounded receipt list with transport+decode time, enqueue-to-Play time, request-to-ACK time, audio sample progress, peak jaw weight, idle jaw weight, average FPS and maximum frame interval. These are client observations, not physical microphone measurements. Transport and Unity decode are a combined UnityWebRequest measurement; they are not falsely split into estimated components.

POST `/v1/stage` carries a bounded heartbeat: instance ID, session, epoch, both playing flags, both current jaw weights and local mute state. Metrics expose its server receipt time; callers must reject stale heartbeats. The heartbeat is observational and grants no control authority.

Ready events include optional provider timings: worker spawn-to-READY cold startup, worker-reported model generation, and GENERATE-to-complete-WAV-read. Complete WAV measurement includes conversion and file I/O; gateway request-to-ready also includes queue wait. Warm samples have null cold startup. Quantiles use nearest-rank actual samples.

Playback ACK and explicit resume are additive v1 routes. PCM streaming, Whisper and Qwen remain deferred.

## Feature branch: held speech for donation reactions

POST /v1/speak now accepts optional prepare_only:true, which MUST use delivery:"queue".
On synthesis completion it emits speech.prepared with audio_path:null, duration_ms
from the verified WAV, the existing session_id/epoch and speech id.
Unity ignores speech.prepared and does not play it.

POST /v1/release and POST /v1/discard accept JSON:
{"id":"<speak request_id>","session_id":"<current gateway session>","epoch":0}
Release emits one speech.ready with prepared_release:true and the existing
authenticated clip URL. A repeated release returns already_released.
Discard rejects an already released clip. Both require the current session
and epoch. A missing/expired clip cannot be released. Panic and interrupt
invalidate prepared audio, including late worker completions.

POST /v1/playback emits playback.started / playback.finished / playback.stopped
only for valid state transitions. Duplicated receipts are idempotent.
Downstream controllers MUST authorize release only on playback.finished.
The new source-only coordinator also checks WAV duration and mode lifetime.

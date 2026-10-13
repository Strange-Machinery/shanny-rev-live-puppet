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

The v1 protocol has no streaming PCM, playout ACK, synchronized dyad
timeline, Whisper microphone capture or Qwen Director. Those require
explicit versioned additions, not overload of audio_path.

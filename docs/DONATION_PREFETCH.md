# Donation pre-generation and hold/release — GitHub-side prototype

This feature branch adds source-level, fixture-testable donation reactions.
It is **NOT** installed into Buff's donation platform, Qwen runtime or live
launcher, and no private episode media is included.

## Why holding audio matters

The already verified Unity stage starts playing any delivered speech.ready
clip. When a donation is still being read, Qwen can choose a reaction and
OmniVoice can synthesize it, but the reaction MUST NOT be sent to Unity
until the donation completes. Otherwise its speech will overlap the
donation or steal the turn.

This branch keeps the existing speak API backwards compatible and adds:

- POST /v1/speak with prepare_only:true, delivery:"queue" creates a held WAV.
- speech.prepared with measured duration_ms is emitted when synthesis finishes.
  It **does not** authorize Unity to start playback.
- POST /v1/release with {id,session_id,epoch} emits speech.ready for that
  completed WAV, exactly once. Repeating release is idempotent.
- POST /v1/discard with the same shape discards pending/held audio safely.
- POST /v1/playback now emits playback.started, playback.finished and
  playback.stopped for accepted nonduplicate Unity receipts, in addition
  to retaining bounded measurement receipts.

Prepared WAVs have a 60-second release TTL and remain subject to the
same bounded 20-clip/32-MiB cache as normal speech. On panic/interrupt,
the server advances epoch and rejects stale releases. No new untrusted
network endpoint is opened.

## Component responsibilities

- src/donations/parse.mjs: leading (rev)/(shanny) reader override,
  SHANNY default, duplicate donation ID and rate-limit admission.
- src/donations/reaction.mjs: private persona notes stay external; bounded
  structured prompt and strict output validator (actor/text/emotion/intensity).
  Audience donation text is always quoted and treated as untrusted.
- src/donations/coordinator.mjs: one donation read -> playback.started ->
  Qwen reaction -> prepare_only speech -> await both speech.prepared and
  playback.finished -> validate actual WAV duration -> release.
  Unknown epochs, panic, interruption, stale Qwen and bad durations cannot
  release old speech.
- src/donations/gateway-client.mjs: authenticated loopback-only gateway client.

## Data and safety conditions

The experimental coordinator verifies the actual generated WAV duration
from speech.prepared, not words-per-second estimates. Its acceptance window
is strictly 8,000–12,000 ms; responses outside are discarded. Future versions
may propose a bounded rewrite/retry without delaying a live broadcast.

The upstream donation platform must authenticate the donation event, provide
a durable donation ID, and reconcile IDs across restarts. The in-memory
idempotency cache is only session protection, not durable payment accounting.

Never transmit private voice reference prompts or likeness files to a
remote LLM. Structured model text is not an executable instruction, and
only deterministic code controls Unity and the mode switch.

## Not yet connected / must remain disabled

- No real Qwen endpoint is attached; createReactionDirector expects a tested
  complete callback. The default samples use deterministic fixtures.
- No existing Buff donation platform or launcher API was present in the two
  GitHub repositories accessible for this task. Its authenticated adapter
  must be discovered in the actual Buff environment.
- No OBS coexistence measurement was rerun.
- No episode pause/playhead/resume adapter has been created.
- No microphone, VAD, Whisper or auto-conversation source is enabled.
- No automatic LIVE mode toggle should be shown as working.

## Codex / Work handoff

1. Verify this feature branch against all Node test jobs.
2. Integrate the real donation source and existing episode launcher only
   after inspecting their installed API, idempotency and authentication.
3. Add a bounded local/off-device Qwen HTTP client; evaluate non-thinking
   model latency and hold/release orchestration on 10–15-second donations.
4. Validate actual scene behavior and OBS + OmniVoice + Qwen coexistence.
5. Implement an explicit operator-owned mode transition:
   episode.pause -> live.resume -> mic opt-in (once installed), then
   local stop -> epoch invalidate -> remote panic receipt -> episode.resume.
   Fail closed on timeout or unavailable stage.
6. Add robust end-to-end integration tests for instant/delayed/dropped Qwen,
   duplicate donations, stale epochs, panic and episode player handoff.

This module is a source-level engineering prototype with CI tests only, not
proof of an end-to-end live show.

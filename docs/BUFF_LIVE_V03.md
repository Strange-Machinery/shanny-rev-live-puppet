# Buff live-show integration v0.3

Deployment clarification: Buff has no existing launcher. The producer hosts the
models and services; Buff receives a thin HTTPS launcher. The new remote testing
panel implements this split for tests and producer-side Whisper. It does not yet
serve production character audio/video or episode delivery. See
[button-only deployment](EASY_DEPLOYMENT.md). Older discovery findings below describe
the inspected producer Studio, not a deployed Buff client.

The executable controller is `node src/show-cli.mjs <private show.local.json>`.
Start the existing OmniVoice gateway separately. It now boots muted. The controller
also panics on startup, keeps microphone admission disabled, and never resumes from
a reconnect. Set three distinct environment credentials: `LIVE_PUPPET_TOKEN`,
`SHOW_OPERATOR_TOKEN`, `SHOW_DONATION_TOKEN`; optional `QWEN_API_KEY` stays external.
Create the private ledger parent directory before starting. No token is logged.

## Donation flow and hardening

Authenticated loopback ingress `/donations` requires durable `donation_id`, `text`,
`session_id`, `mode_epoch`, and `received_unix_ms`. Use `/status` for current scopes.
Text expires after 30 seconds; future timestamps beyond 1 second are rejected.
Leading standalone `(rev)` / `(shanny)` select the actor; default is Shanny.
All text remains quoted audience input. Model output is exactly actor/text/emotion/
intensity; deterministic code owns every stage command.

The runner admits one donation turn at a time through reaction completion. It
reserves the ID in an exclusive, fsynced SHA-256 journal before sending speech.
Restart never replays reserved IDs. This chooses at-most-once admission: a crash or
voice failure after reservation may lose a read. Reconcile lost reads with the
payment platform rather than automatically replaying them. Journal capacity fails
closed at 100,000 IDs. A crash leaves `.lock`; verify the old process is dead and
reconcile a torn final line before manually removing a stale lock. Never blindly
delete a live lock. No payment accounting or auto-refund behavior is claimed.

Actual `playback.started` starts Qwen. Its valid output is synthesized with
`prepare_only:true`. The generated PCM WAV's actual duration must be 8,000–12,000 ms.
Held WAVs cannot be fetched or acknowledge playback. Both actual read completion
and prepared audio are required for release, including a gateway-side atomic
`after_read_id` check. Release never regenerates audio. The default late grace is
1,500 ms after donation finish, capped by 45 seconds per turn; later drafts/WAVs
are discarded. Overlapping stage speech cancels that reaction. Interrupt/panic
epochs invalidate it, including work that completes after cancellation.

Fast events are buffered only while requests await acknowledgement, bounded at
256; replay happens after the returned ID is registered. Gateway prepared metadata
and clip eviction now share the 20-clip/32-MiB bounds and purge on every request.
Playback receipts reject held/discarded jobs and terminal-state replay. New speak
and resume calls can carry session/epoch preconditions. Legacy empty resume remains
compatible. Ambiguous release failure stops admission and panics; it is never
blindly retried. Event history/session errors also fail closed.

## Qwen configuration and benchmark

Configure an already provisioned OpenAI-compatible `/v1/chat/completions` endpoint.
Remote connections require HTTPS; local connections accept loopback HTTP. No model
is loaded or downloaded by this repository. Declare `cpu`, `off-device`, or
`local-gpu`; the latter requires explicit verified-headroom configuration.
Use external JSON persona instructions with SHANNY and REV string keys (at most
4,000 characters each). No source lore or persona evidence is invented here.

Requests disable thinking with `chat_template_kwargs.enable_thinking:false`, ask
for JSON, allow 192 tokens by default (maximum 512), time out at 6 seconds by
default, and permit one concurrent completion. Streaming response allocation is
bounded. Truncation, tool calls, thinking text, unknown keys and actor mismatches
are rejected. Endpoint errors never echo private prompts. Endpoint implementations
must honor the non-thinking field; no automatic fallback changes its behavior.
See the official [4B model card](https://huggingface.co/Qwen/Qwen3.5-4B) and
[2B model card](https://huggingface.co/Qwen/Qwen3.5-2B).

`/status.reaction_metrics` reports nearest-rank completion p50/p95, read-start-to-
ready-WAV p50/p95, outcome counts, and prepared-before-end percentage. Counts include
failed/cancelled reactions in the percentage denominator. These are bounded rolling
samples (200), not fabricated word-rate estimates. Run `scripts/benchmark-reactions.mjs`
against a fresh accepted controller separately for an installed quantized Qwen3.5-4B
and non-thinking Qwen3.5-2B; retain the model/quantization/runtime label with results.
Do not infer model quality or real GPU performance from fixture measurements.

## Existing launcher discovery and adapter boundary

Inspected local Studio source: `outputs/app/demo.py`, `studio_ui.py`, `controller.py`
in the existing Shanny/Rev Studio tree. `ChatAdapter.receive(..., emulated=False)`
explicitly rejects live bot connections. Generation uses the existing Controller
and private episode files. Playback launches the episode's saved P5Demo executable
with `-alphaOutput`; progress is in `state.json`. `stop.request` stops/exits it.
There is no deployed authenticated generation-job/download API in this inspected
launcher. The legacy local Qwen episode writer is retired; it was not re-enabled.

The existing Unity `ShannyRevDemo.EpisodePlaybackController` already exposes
`Pause()`, `Resume()`, `EpisodeSample`, and state, while CandidatePlayback's external
file transport exposes stop only. No new guessed bot endpoints, download URLs, or
process-suspension playheads have been substituted. No episode production code was
changed. Buff's deployed launcher/service identity and callable player transport
are still needed to connect the real show.

`adapterModule` is a trusted local module exporting `createAdapters({gateway,config})`.
It returns accepted `player`, `stage`, and optional `episodes` objects. Production
live stays unavailable without accepted player/stage adapters. Their contracts:

- `player.pause({transition_id,signal})` returns `{playback_id,position_ms}` from the
  actual player and must settle or acknowledge cancellation. A late pause keeps
  the controller unresolved until the actual playhead arrives.
- `player.resume({playback_id,position_ms,transition_id,...})` returns the same IDs/
  position and `resumed:true`; persistently dedupe transition IDs even after a lost
  response or process restart. Do not restart the episode at zero.
- `stage.stopNow()` synchronously stops both local AudioSources; `stage.resume(scope)`
  explicitly resumes the local latch; `stage.confirmStopped(scope)` checks a fresh,
  current-session/current-epoch stage observation and returns true only for both stopped.
- `episodes.request(input,{request_id})`, `status(jobId)`, `retry(jobId,{request_id})`,
  and `verifyDelivery(row)` call the existing service. A ready link is exposed only
  with configured HTTPS origin, checksum, private provenance, unexpired timestamp,
  and successful delivery verification. Unknown outcomes retain the request ID.

Controller routes are authenticated loopback `/live`, `/stop`, `/status`,
`/episodes/request`, `/episodes/status`, `/episodes/retry`. Stop invalidates mode,
aborts Qwen/ASR, stops local audio, confirms gateway mute and stage stop, then resumes
the retained episode exactly once. Failed acknowledgements leave `stop_pending`.
The stage and episode fixture demonstrates this contract; it does not prove Buff's
deployed player adapter.

## Offline Testing tab

**No YouTube connection, livestream, OBS, or internet is needed for testing.**
`python python/testing_tab.py` opens the standalone panel. `scripts/install_testing_tab.py`
adds an Episodes/Testing notebook to the inspected Tk Studio and backs up `demo.py`.
Its loader keeps implementation in this standalone repository. Restore that backup
and remove `live_testing_tab.py` to undo the UI hook; episode callbacks are untouched.

Start offline lab → Arm test stage. Exercise normal/overridden donations, duplicate
IDs, delayed/late/timed-out Qwen, invalid WAV duration, voice failure, synthesis panic,
typed gateway speech, cross-character interruption and repeated stop/resume. The
status/event log distinguishes silent PCM, simulated playback, fixture Qwen and
configured local Qwen. `npm run demo:offline` is a terminal demonstration.

Whisper/live testing supports typed final-transcript replay and local WAV input.
Select a private offline config to attach an existing local faster-whisper model
and optional local Qwen with approved external personas. The provided Whisper
worker is CPU/int8, local-files-only and model-VAD enabled; no GPU model/download
is started. All sample audio is limited to PCM16 mono 16/48 kHz and 30 seconds.
The one-shot worker reloads Whisper per turn; sustained low-latency conversation
will need a resident worker after acceptance.

The Windows microphone test adapter uses native WinMM. Select an input, confirm it
is Buff's isolated microphone, explicitly arm, hold-to-talk, then release. Stop
disarms capture, cancels old transcription/reactions, and prevents re-arming from a
reconnect. Obvious OBS/mixed/loopback input names are blocked. A selected device name
is not proof of physical isolation; verify using headphones and input meter tests.
The test-only energy VAD can be exercised after explicit arming. Temporary capture
WAVs are private scratch and removed after the turn. It never grants production mic
admission. Windows device TTS is a generic audible offline voice and is identified
as such; fixture puppet WAVs are silent and are not real OmniVoice playback.

For the complete offline **audio** path, use `offline-testing-full.example.json`
with existing local Whisper/Qwen, external approved personas, and the existing
private OmniVoice worker/references. Confirm resource headroom first; this mode owns
one persistent OmniVoice worker. Do not start a duplicate worker beside another
active voice session. The panel plays its real WAVs through Windows waveOut and
reports playback submission and actual buffer completion to the same gateway API.
Stop synchronously resets its owned output handle under a lock, clears queued
playback, disarms capture and invalidates model jobs. Test auto VAD waits while the
response pipeline or local audio is busy. These are desktop audio observations,
separate from Unity receipts and physical speaker-onset measurements. Private
full-model mode is implemented but not hardware-qualified in this pass.

**Current limits:** Qwen fixture/real local Qwen can be tested with simulated stage
responses. Actual Shanny/Rev voices and Unity can still be exercised through the
existing private puppet launcher; this Testing tab does not yet drive a verified
real-Unity microphone-conversation adapter. Hardware acceptance is required before
advertising that full path as working.

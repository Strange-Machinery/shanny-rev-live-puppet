# Acceptance and test matrix

## GitHub / Node tests

npm test checks WAV validation, authentication, invalid request handling,
bounded worker backlog, voice-ready event plus playable WAV, and panic
cancelling queued/in-flight work. Tests use **mock** audio only, so passing
CI is not evidence that Unity or real voices work.

## Operator mock smoke

- Run continuous Unity scene with both actors and real face morph names.
- Run one mock SHANNY and one mock REV line; observe correct actor, audible
  clip, corresponding jaw and return to idle. No Timeline/Recorder/Rhubarb.
- Run 10 consecutive requests; check queue ordering, memory and FPS.
- Trigger panic during audio; both sources must stop without scene reload.
- Kill/restart Node; stage reconnects safely and handles cursor gap without
  replay of stale speech.

## Real OmniVoice / Unity acceptance

Six short lines: 5, 10 and 20 words for each voice. Collect:
worker cold startup, request->ready p50/p95, audio GET/decode timing,
AudioSource Play, first audible output, frame hitches, peak GPU memory.
Verify identity, one deliberate worker failure/recovery, and no leaked
voice source assets. Record actual stage facial performance and failure
cases; current waveform-driven mouth is intentionally approximate.

**Do not declare production-ready** until playback works in the actual
Unity rig, operator panic is reliable, and per-voice latency is
measured on the Buff/production hardware under realistic GPU load.

# v0.3 verification — 2026-10-13, America/Chicago

## Passed

- Exact starting commit `cc3f66b6b9229025c1fd467061f063e098bbfa38`: all original 29 Node tests.
- Expanded local suite: **69 Node tests and 6 Python tests**, no skips or failures.
- First source revision `d88f3d7`: all four GitHub Actions configurations passed,
  including the 68 Node / 4 Python tests present at that revision:
  [run 38491860822](https://github.com/Strange-Machinery/shanny-rev-live-puppet/actions/runs/38491860822).
  The final desktop-audio revision is verified separately before delivery.
- Deterministic HTTP demonstration: donation read started → Qwen fixture completion
  → 10-second actual PCM duration prepared → donation finished → same held WAV
  released → response finished. Repeated stop resumed the retained fixture episode once.
- Tests cover speaker overrides, duplicates, concurrent admissions, early receipts,
  delayed/expired Qwen, new panic epochs, lost release acknowledgement, held-fetch
  rejection, cache/TTL bounds, overlapping actor speech, cross-character interrupt,
  synthesis panic, stale ASR/Qwen, partial transcripts, playhead retention and resume retry.
- Testing tab installed in the inspected local Studio via an additive two-line UI
  hook and loader. Existing episode widgets/callbacks are preserved. The real Demo
  window was instantiated, its TestingPanel verified, then closed without starting jobs.
- Native WinMM device enumeration found two input devices. Neither was armed or recorded.
- Real local faster-whisper small.en, CPU/int8, local-files-only: a Windows-generated
  WAV transcribed exactly as “Buff, tell Rev he needs to wait his turn.” VAD returned
  0–2,800 ms. First standalone process elapsed 6,381 ms including model startup;
  a second real-Whisper-to-fixture-response test measured transcription 2,344 ms.
  The latter used fixture Qwen/TTS/stage; it is not a real-character end-to-end result.
- Actual Windows waveOut silent 250-ms WAV: submission call observed at 86.20 ms,
  completed at 355.27 ms including device setup. Separate 1-second silent-WAV stop:
  stop/reset/close call 41.27 ms; playback worker returned cancelled. These single
  API observations are not physical speaker measurements or statistical guarantees.
- No real livestream, publishing, merge, model download, or production episode job
  was initiated. Private runtime config, WAVs, journals, weights and voice assets
  were excluded from the source commit and archive.

## Fixed during verification

The sandbox initially denied loopback connections and fixture realpaths; the same
baseline passed with the required local-test permissions. Later deterministic tests
caught a stale panic page aborting a newly armed offline conversation; explicit
baseline cursors fixed it. The stop-order assertion was corrected to check local
stop precedes gateway panic. Those failures are resolved in the passing suite.

## Genuine remaining acceptance boundaries

1. Buff's deployed bot/service and player transport were not present. Inspected local
   ChatAdapter rejects non-emulated bot ingress. CandidatePlayback externally exposes
   stop, while the existing Unity controller has Pause/Resume/sample internally.
   Connect its real transport and private verified download service through the
   supplied adapter module before enabling production live mode.
2. Requested Qwen3.5-4B quantized and Qwen3.5-2B endpoints were not provisioned here.
   The installed local LM Studio model is a different 24B model; the existing writer
   pin points off-device to a different 27B model. Neither was substituted or loaded.
   Supply the two target endpoints/model IDs and approved external character notes,
   then run the supplied benchmark for real completion / WAV p50/p95 and readiness rate.
3. Operator microphone isolation, push-to-talk, VAD thresholds and device-loss behavior
   require hands-on recording acceptance. The input adapter, UI and cancellation tests
   exist; no microphone capture was silently initiated during implementation.
4. Full private local Whisper → Qwen → OmniVoice → Windows output is implemented,
   but not model/hardware-qualified. Test it with explicit resource headroom using
   the full private config. Desktop output and Unity playback are separate modes.
5. Unity + real OmniVoice + target Qwen + OBS coexistence, physical audible onset,
   frame hitches, VRAM peak, drop/overlap soak, real panic timing and real episode
   resume timing were not rerun. GPU samples during inspection were 7,781/8,188 MiB
   at 100%, later 5,018 MiB at 96%; this did not establish spare inference headroom.

## Minimal local acceptance sequence

1. Open Testing. Start the offline lab → Arm test stage. Verify normal donation,
   both overrides, duplicate, each failure scenario and repeated Stop. Re-arm explicitly.
2. Keep OBS/YouTube disconnected. Select Buff's isolated input, confirm the source,
   arm the test microphone, hold to talk, release. With the supplied local Whisper
   configuration, verify the transcript. Stop during capture/transcription; neither
   mic nor speech may restart until explicit arming.
3. Configure approved private personas and local target Qwen. Repeat transcript replay
   and actual microphone tests. Partials, stale epochs and interrupted turns cannot speak.
4. After resource verification, attach private OmniVoice through the full offline
   config. Confirm actual character speech, real output completion and stop during
   every model phase. Use headphones to verify that response output is not recaptured.
5. Connect the real Unity stage and existing player adapter. Pause at a nonzero sample,
   run donation read/reaction, then Stop. Confirm both AudioSources stopped and gateway
   muted before the actual player resumes exactly once at the retained sample.
6. Repeat under OBS with both Qwen target models, record FPS/max frame interval and
   GPU memory over time. Measure acoustic onset separately; Play/waveOut acknowledgements
   alone do not prove physical speaker onset. Do not start a public stream for these tests.

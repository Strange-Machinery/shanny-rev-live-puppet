# Real character testing and latency

The producer's private `producer.local.json` selects `mode: "real-characters"`.
`python/easy_testing.py --real` opens the same button-only testing launcher with
actual local Qwen, saved OmniVoice voices, the existing Unity player and resident
CPU Whisper. Missing services fail visibly; this mode does not fall back to fixtures.
The machine-specific double-click launcher is delivered separately. The existing
portable installer still contains the earlier fixture-based application.

On a donation, Shanny reads the text verbatim. Actual `playback.started` admits
one Qwen writing pass. Its first reply is synthesized while the read plays and
released only after the actual read-finished receipt. Both characters participate
in the short argument. Microphone replies contain 2–3 sentences total; the prompt
prefers two Shanny sentences and a relevant Rev contribution when warranted.
That writing preference still needs content acceptance: current small-model
outputs can be generic, invert the premise or over-allocate Rev's lines.

The live path favors speed: non-thinking Qwen3.5-2B on CPU, 240-token/12-second
completion budgets, schema-constrained short sentences, one writing pass without
an automatic rewrite, four recent played lines of context, startup voice warmup,
resident Whisper and one voice line prepared ahead during playback. Held clips
remain subject to epoch/Stop gates and actual playback receipts. Only played
dialogue enters history. No generated text becomes a Unity command.

## Measured local results

Hardware: RTX 4060 Laptop, 8 GB. Existing OmniVoice pipeline and Unity player;
Whisper small.en, CPU int8, beam size 1; Qwen3.5-2B Q4_K_M on six CPU threads.

| Path | ASR | Qwen | First reply starts | Whole exchange finishes |
| --- | ---: | ---: | ---: | ---: |
| Typed microphone replay, one earlier observation | n/a | 4.30 s | 8.31 s | 17.90 s |
| Resident Whisper WAV, first observation | 3.58 s | 3.90 s | 11.43 s | 16.81 s |
| Resident Whisper WAV, second observation | 3.31 s | 5.42 s | 13.48 s | 30.25 s |

The prior file-per-process recognizer took 10.70 seconds for ASR and 22.63 seconds
to first reply. Keeping it loaded removes that recurring startup cost. The final
two observations have nearest-rank p50 11.43 s and p95 13.48 s, **n=2, same synthetic
WAV**; these are smoke measurements, not statistical reliability estimates.
Donation-end to reply-start gap was 0.268 s in one earlier optimized-path observation.

First reply means the authenticated Unity AudioSource-start receipt, measured from
backend submission; it is not physical acoustic onset, microphone-button release,
or a remote browser measurement. Full spoken exchanges naturally take longer.
Playback receipts show advancing samples, nonzero jaw movement and idle jaws after
completion. Sanitized timing evidence is in
[`evidence/live-latency-2026-10-13.json`](../evidence/live-latency-2026-10-13.json).

Earlier competing-GPU-load runs took 37 seconds for voice or hit the 120-second
worker timeout. Resident services and short replies improve the tested path but
do not establish performance under every rendering load. Qwen4B was also measured:
11.68 seconds cold and 6.89 seconds with a cached prompt, excluding voice/ASR;
2B remains the speed-first local default. No extra GPU language model was loaded.

## Validation and boundaries

87 Node tests and 8 Python tests pass locally. New tests exercise one-pass failure,
donation read/reply ordering, held next-line synthesis, Stop during prefetch,
resident recognizer reuse, cancellation/recovery and partial-transcript rejection.
The Tk launcher was constructed with its actual private profile and microphone off.
Real hardware tests used synthetic WAVs and typed input, never live microphone capture.

Blackout Shanny's private treatment is supplied externally. No fine-tuning or
producer approval of generated dialogue is claimed. Private assets, notes, model
weights, local paths and raw dialogue evidence stay outside version control.

The remote testing controls can call this real producer backend and display played
dialogue, but remote audio/video for Buff's OBS is not connected. Production episode
handoff, accepted MotionLab playback, physical microphone testing, OBS coexistence,
network timing and sustained performance remain open. No public sharing, stream,
merge or deployment occurred.

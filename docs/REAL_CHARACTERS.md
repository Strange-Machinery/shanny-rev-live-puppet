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
resident Whisper, first-sentence voice preparation during Qwen text streaming,
and one voice line prepared ahead during playback. The complete plan must validate
and match the prepared sentence before release. Held clips
remain subject to epoch/Stop gates and actual playback receipts. Only played
dialogue enters history. No generated text becomes a Unity command.

## Measured local results

Latest speed pass, MSI i7-14650HX / RTX 4060 Laptop on mains power:
four complete synthetic-WAV microphone-path tests reached first reply in
**7.520, 6.810, 8.907 and 8.880 seconds** (mean **8.029 seconds**).
Whole spoken exchanges took 12.3–24.1 seconds. The donation test read first and
started its argument 1.172 seconds after the read finished. This is a small smoke
sample with varying generated dialogue, not a reliability distribution or guarantee.
See [`evidence/live-speed-2026-10-13.json`](../evidence/live-speed-2026-10-13.json).

The private profile and example use `performanceMode: "show"`: Windows applies
AboveNormal priority to this host's current owned process tree at startup. No
unrelated process priorities, global power plans or GPU clocks are changed.
`omnivoice.cpuThreads: 2` bounds this worker's OMP/MKL/OpenBLAS CPU parallelism;
saved references, model weights and the pinned 32-step voice settings are unchanged.
The laptop must be plugged into its main adapter for comparable performance.
Battery runs before text/voice overlap took 21.4–24.4 seconds; an AC-only baseline
without overlap took 12.0 seconds in its successful full turn. These settings were
not independently isolated, so individual speedups are not attributed to priority
or thread count. Microphone timing now reports an 8-second target honestly.

Earlier measurements before this speed pass:

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

Launcher repair: Restart and Stop now occupy the top row, tested at 900x600.
Startup displays individual loading phases and preserves the actual failure cause.
A temporary shortage of GPU memory triggers automatic polling for up to 90 seconds,
requiring two consecutive checks with at least 4 GB free. Sustained pressure remains
a visible resource error; no other job is stopped. The silent Qwen warmup now primes
the persona prefix with a fixed readiness object instead of a generated scene.
Sentence grammar excludes raw quote/backslash tokens that previously produced
invalid JSON and a local Qwen HTTP 500. The repaired real GUI reached Ready with
top controls mapped and the microphone off. Latest regression suite: 105 Node and
10 Python tests.

Tests exercise bounded/split SSE, truncation, cancellation, speculative voice held
until validation, Stop during early synthesis, worker-only thread configuration,
and waiting for a manual stage clip before the next guarded release, plus one-pass failure,
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

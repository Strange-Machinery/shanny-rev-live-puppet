# Shanny / Rev V620 27B latency R&D — 2026-10-15

Status: **unmerged experiment** on `rd/qwen-latency-rnd-20261015`, stacked on
`rd/buff-natural-voice-qwen-audit-20261014`. Existing source remains default-safe.
Hardware topology is NOT changed: V620 LM Studio 27B over producer Tailscale,
MSI persistent CPU 2B fallback, resident OmniVoice + Unity + OBS on MSI.

## Findings from source inspection (not new live benchmarks)

- Normal successful V620 turn: **one Qwen model generation**, 512-token maximum,
  30-second deadline, with a 1.5-second **read-only** loaded-instance probe.
  The 10-second cooldown applies only after a V620 failure.
- The current V620 adapter is **non-streaming**, by design. It validates a
  complete JSON reply before sending any text to the speculative voice
  preparation callback; an invalid/timeout remote completion uses **one** MSI
  backup. The live fallback guard MUST NOT be bypassed for a timing win.
- Local llama.cpp can already stream text into held first-voice synthesis. It
  checks the first role, topic and approved episode delivery, then still
  requires the complete Qwen plan to validate before the clip is released.
- The existing ordinary seated OBS path requires **all held voice WAVs** ready
  before stage reveal; this is an intentional reliability policy. Rain starts
  first and runs its full approved choreography; its receipt gating is unchanged.
- Longer, more substantive dialogue was deliberately adopted earlier
  (16–32 target words per line, 320 characters maximum). Do NOT secretly
  shorten it or lower the output cap to claim an artificial speedup.
- The producer reports ~20s current perceived delay. This is one observation,
  not a distribution, and the source alone cannot attribute it to model,
  transport, OmniVoice, OBS visibility or spoken-audio duration.

## Changes on this experimental branch

1. **Private diagnostics**. The producer-only status adds
   `microdirector.latency_rnd.provider_timings.v620` and `.msi`: completion
   wall duration, response-header duration, any provided prompt/completion
   token counts, and status (ok, timeout, error, cancelled). Neither model
   text nor private prompts are logged. Header timing is **not** first-token
   time on a nonstreaming request.
2. **Timestamp split in voice preparation**. Baseline seated runs now report
   `latency.all_audio_ready_ms`, measured from turn start until all held
   WAV receipts arrive. Experimental first-WAV runs report
   `latency.first_audio_ready_ms`. Compare these to
   `latency.model_ms`, `latency.first_reply_ms` and
   `latency.total_ms` (the last includes the performed spoken audio).
3. **Optional, synthetic-only first-WAV seated playback**.
   `-FastSeatedPlayback` selects `fastSeatedPlayback=true` in the private
   trial config. On operator test donations or hotmic only, the show waits
   for a fully validated Qwen plan, first ready WAV and visible stage receipt,
   then plays that line while preparing at most one subsequent voice.
   Donation reader first, actor roles, speech receipts, single active
   conversation, STOP/panic, approved voice references and final text
   validation stay in place. **Real paid donations, rain, and the default
   mode continue to preflight the entire audio sequence.**
4. **Separate V620 benchmark**. Diagnostic SSE is permitted ONLY with an
   explicit `diagnosticRemoteSse` option on an off-device LM Studio provider.
   The real failover adapter still suppresses remote `onText`; it cannot
   feed partial remote text to OmniVoice. The benchmark consumes SSE into
   a no-op and tests the complete result with the real current Microdirector
   JSON, role and topic validator.

## How to run, on the MSI only when the show is idle

Obtain the isolated draft source (not production):
```powershell
$repo = 'https://github.com/Strange-Machinery/shanny-rev-live-puppet.git'
$lab = Join-Path $env:TEMP 'buff-qwen-latency-rnd'
git clone --single-branch --branch rd/qwen-latency-rnd-20261015 $repo $lab
if ($LASTEXITCODE -ne 0) { throw 'Cannot clone the isolated R&D branch' }
```

First run the source gate (parses both PowerShell launchers, Node tests,
Python reference routing and lore benchmark):
```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $lab 'scripts/Invoke-BuffMicrodirectorGate.ps1')
if ($LASTEXITCODE -ne 0) { throw 'R&D gate failed: do not start the trial' }
```

Only if there is **no live broadcast, paid provider, or other V620 generation
in progress**, run synthetic inference comparisons:
```powershell
node (Join-Path $lab 'scripts/Benchmark-V620Qwen.mjs') --host 100.79.20.28 --model qwen3.8-27b --samples 3 --tokens 512 --mode both --idle-confirmed
```

The `both` mode performs **six sequential model generations**: three
ordinary complete replies and three diagnostic SSE replies, interleaved on
five preset fake viewer topics. This can take a while; it does not produce
speech or feed Unity. No actual donation or private notes are sent.
`--samples 1` reduces this to one each. `--mode normal` or
`--mode streaming` runs only one mode; `--tokens 384` is an alternative
*ceiling*, not an instruction for shorter dialogue. Compare quality and
truncation failure rates before claiming 384 tokens is faster.

The output is JSON with anonymous per-sample `wall_ms`,
`response_headers_ms`, optionally `first_content_ms` (SSE only),
backend token counts when provided, and validity. `first_content_ms` is
first **text** arrival, not audible onset. Token-per-second claims need a
backend decode metric rather than dividing by entire request time.

The existing isolated private trial can be launched for A/B voice timing,
**only after its Windows/source gates pass and the previous test is closed**:
```powershell
# Baseline: existing fully prepared seated path, V620 still preferred
pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $lab 'scripts/Start-BuffMicrodirectorTrial.ps1') -QwenBackend v620 -Launch

# Fast synthetic/hotmic trial: close the previous host cleanly first
pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $lab 'scripts/Start-BuffMicrodirectorTrial.ps1') -QwenBackend v620 -FastSeatedPlayback -Launch
```
Each command creates an isolated checkout and producer-local private profile,
preserving approved art, voices and source. Do **not** run both simultaneously.
The launcher refuses an existing live player/llama-server process or an
active host lock; never kill or erase it blindly. Real paid intake is OFF
in these trial profiles.

## Acceptance: what should be measured

Use 5–10 **same** fake chat topics in each profile, including Shanny-addressed,
Rev-addressed, both and an unrelated-topic change. Record elapsed time for:
- start to Qwen generation complete (`model_ms`);
- generation to all WAVs held (`all_audio_ready_ms`, normal);
- start to first WAV ready (`first_audio_ready_ms`, fast);
- first Unity playback.started (`first_reply_ms`);
- end of all spoken audio (`total_ms`, not interchangeable with response latency).

For paid-style test messages that are genuinely synthetic, verify the reader
finishes before Shanny/Rev start. The first speaker's actor/voice must match
the viewer addressee, and Rev must wait for completion receipts. Confirm
the second line is queued only after first playback starts in fast mode;
STOP must prevent late releases and no OBS popup remains visible.
No new generation, voice quality, subtitles, visual latency or paid event
capability is claimed until a real two-rig audition confirms it.

## Next optimization once measured

If model generation dominates, investigate shortening **repeated prompt
instructions** without sacrificing the first-person identity, lore focus,
voice categories or JSON validator. The useful A/B is prompt token count,
valid outputs, quality and completion time, not just raw token ceiling.

If synthetic `first_audio_ready_ms` shows an appreciable difference from
`all_audio_ready_ms`, the hold/release optimization can be considered for
additional rehearsals. **Do not enable it for paid donations** until queued
event durability, abort cleanup and mid-playback voice failures are proved.

If model generation is fast but `first_reply_ms` is slow, inspect
OmniVoice receipt timings, Unity playback receipt and OBS visibility
rather than changing Qwen or adding hardware. LM Studio loaded-instance
inventory also exposes context, Flash Attention and KV-cache settings,
but inspect these read-only first and never reload/change the live model
during a show.

## Rollback

Close the experimental host normally. Relaunch without
`-FastSeatedPlayback` to restore the original fully-held seated path,
or use `-QwenBackend msi` to force the known warm local writer. Neither
selection changes the original active production profile or the model on
V620. The R&D branch remains unmerged.

## Limits

No real V620 request, 27B benchmark, Windows PowerShell parser, OmniVoice
render, native Unity player or OBS hardware test has been executed by the
author of this draft. GitHub source/mock regression checks must pass on
MSI, and machine measurements are mandatory before a live deployment.

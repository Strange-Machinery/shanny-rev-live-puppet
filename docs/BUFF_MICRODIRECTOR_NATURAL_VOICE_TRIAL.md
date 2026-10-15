# Buff Blackout Microdirector / natural voice reference trial

**Status: opt-in research branch, NOT merged and NOT qualified on the MSI.**
Source: `rd/buff-natural-voice-qwen-audit-20261014`, forked from the already-working offline smoke lab branch.
The existing verified $100 rain/OBS receipt gate, old Qwen director, voice models, character rigs and private profile remain untouched.

## Why

The episode authoring engine makes causal dyad decisions and selects approved
OmniVoice reference samples from an expanded library (S01–S20 for Shanny,
R01–R23 for Rev). The initial Buff live stack instead used only broad mood
labels. The live experiment now reuses the exact speaker-specific,
auditioned **saved prompts** rather than synthesizing pitch, accent or
imagined styles. The producer's existing `voice.py`, `expanded_voices.py`
and `expanded/catalog.json` remain the qualification authority.

## Execution contract

- ONE Qwen3.5-2B completion: a short non-spoken `hinge` for what caused the
  offense, then 2–3 short spoken lines with a per-line `delivery` code
  and existing `mood` face label.
- The experimental Qwen call now has a **16-second bounded deadline** after the fixed speaker-slot schema change (legacy remains 12 seconds). Token ceiling
  becomes 320 in opt-in Microdirector mode; actual latency and schema
  acceptance on local Qwen must be measured, not assumed. No second LLM
  request, no training and no episodic LoreGraph runtime.
- The resident OmniVoice worker loads its approved samples at **startup**,
  checks every saved-prompt checksum, and advertises only qualifying
  actor-specific codes. A missing code is **not** silently replaced by an
  invented equivalent.
- Each line routes by `voice_code` through the existing gateway. The
  gateway's separate `delivery: queue/interrupt` field is untouched.
  Weighted choice within a category favors higher-ranked approved
  samples and continuity of source family, without forcing the same sample
  repeatedly when alternatives are qualified.
- Qwen receives a **small, deterministic topical voice menu**, never a giant
  list of all samples. All 43 episode codes are accessible through relevant
  contexts. The worker retains its entire qualified catalog in memory.
- Source lore hooks are input-evidence-gated, with minimal grievance context:
  the bucket, Ezzie, Baby Carrot and congealed. Unrelated comments don't
  automatically trigger these callbacks. Congealed's unverified backstory
  must never be fabricated.
- Legacy one-shot examples are intentionally excluded from Microdirector
  prompting unless explicitly marked/revalidated. Private notes are never
  uploaded or copied into the GitHub branch. The status endpoint reports
  **booleans** for source phrase contamination (bread / refusal clichés),
  not the actual notes, donor IDs, tokens, or reference audio.
- Microdirector is off unless BOTH
  `microdirector.enabled=true` and `omnivoice.approvedDelivery=true`.
  The existing playable branch is the rollback.

## PowerShell-only local source preflight

```powershell
$trialBootstrap = Join-Path $env:TEMP ('buff-micro-source-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
git clone --depth 1 --single-branch --branch rd/buff-natural-voice-qwen-audit-20261014 https://github.com/Strange-Machinery/shanny-rev-live-puppet.git $trialBootstrap
if ($LASTEXITCODE -ne 0) { throw 'Private clone failed' }
& (Join-Path $trialBootstrap 'scripts/Invoke-BuffMicrodirectorGate.ps1')
```

The gate clones a separate Temp checkout, runs `node --check`, focused
Qwen/voice Node tests, the complete Node regression, Python deterministic
reference selection, and existing Python tests. It writes a local JSON
report with exact source SHA. **Do not launch the model if this gate fails.**

## Isolated hardware trial, only after the source gate passes

```powershell
& (Join-Path $trialBootstrap 'scripts/Start-BuffMicrodirectorTrial.ps1')
# If all tests pass and the existing producer session has been stopped:
& (Join-Path $trialBootstrap 'scripts/Start-BuffMicrodirectorTrial.ps1') -Launch
```

The trial copies only the private profile to an isolated Temp folder and
overrides the scratch, voice-output and trial worker paths. It removes
donation-provider configuration, keeps the same already-working native
BuffStankTank player, and installs the approved **five-asset ZIP** into
the isolated source. It never modifies the original profile or model,
takes money, starts external provider feeds, publishes a stream, merges a
branch or sends secrets to GitHub.

When ready, use the producer window's private StankTank preview to COPY
the separate view-only **OBS Browser Source link**; add as a temporary
1920×1080 Browser Source. The producer preview and native Unity player
do **not** start rain music themselves. The approved `rain-intro.mp3`
plays in the *OBS Browser Source* after an acknowledged visible H.264
frame. The operator status now shows connected OBS viewers and the rain
music state. Keep browser preview sound muted when OBS audio is active.

## Local qualification to record

1. Boot time and RAM/VRAM while all qualified saved prompts are loaded.
2. Number of available Shanny/Rev codes, approved sample count per code,
   and which exact reference IDs produced representative live lines.
3. First speech latency, completion p50/p95, and rejected/timeout rate for
   ordinary donations, compared to baseline. Inspect 20–30 varied comments.
4. Content fit: does each line directly challenge the actual audience
   comment; does Rev add a second point; are grievances causally connected;
   are bread and refusal slogans absent when irrelevant?
5. $100 rain: actual H.264/OBS visible acknowledgment, browser audio
   `playing` then `ended` receipt, native seated response and exact
   TTS afterward. No rain audio overlap or duplicate monitoring audio.
6. Operator STOP, Shut up, stale prefetch, worker failure, and recovered
   playback in the presence of an interrupted Qwen stream.

**No automatic promotion**: if this local performance is substantially
slower, the library or JSON schema fails, or the spoken dialogue still
sounds unnatural, stay on the original real-character profile while
tuning the isolated branch. The first launch is qualification, not a
production replacement.

### October 15 reader / response-role correction

A superchat starting `Rev, ...` is read aloud by Rev (unless an explicit
standalone `(SHANNY)` local reader override precedes the message). Shanny reads
her own addressed superchats and general donations. Qwen no longer authors
per-line actor/recipient labels: the fixed first/second response slots are
mapped deterministically according to the viewer addressee, preserving actor
voice references and stopping the `recipient mismatch: first reply must address
viewer` failure. The Microdirector's 16-second CPU timeout and compact JSON
output require new Windows tests and real-Qwen listening review.

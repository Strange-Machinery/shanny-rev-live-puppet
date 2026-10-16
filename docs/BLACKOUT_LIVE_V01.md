# BLACKOUT_LIVE v0.1 — opt-in V620 microcontroller trial

**Status:** Experimental draft, stacked on PR #9 at 48af29a. Not merged, deployed, or qualified on real V620 voice/stage. Keep paid donation intake OFF.

## Why this is deliberately small

The existing Blackout heat selector already chooses Shanny's emotional lane and objective. The Microdirector already locks speaker, addressee, permitted natural voice references, topical lore and Qwen response schema.

v0.1 appends ONE compact causal arc to the already prepared V620 prompt:
1. First named actor answers the actual viewer remark and makes one contestable point.
2. The other actor reacts to that specific claim with independent agency.
3. An **optional** first-actor return occurs only if the preceding response changes emotional stakes. The suggested pivot is based on the preselected Shanny lane.

No new classifier, history buffer, model pass, runtime loop, memory, RNG, voice effect, animation command, model weights, or lore retrieval. No invented personal incidents. One remote Qwen request remains one remote request.

The new adapter in src/blackout-live-v01.mjs decorates the **remote V620** request only. It leaves the original prompt untouched for the **warm MSI Qwen3.5-2B backup**, including when V620 fails. Direct MSI mode is never decorated. The existing full-plan validator, role/recipient and topic checks, 30s/512-token V620 and 24s/384-token MSI limits, STOP and single fallback remain.

## Safe PowerShell 7 rehearsal

Use a new isolated research checkout rather than the original PR #9 bootstrap. The prior character test should be closed normally. Run on your MSI:

~~~powershell
$branch = 'rd/blackout-live-v01-v620-20261015'
$repo = 'https://github.com/Strange-Machinery/shanny-rev-live-puppet.git'
$trial = Join-Path $env:TEMP ('blackout-live-v01-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
git clone --depth 1 --single-branch --branch $branch $repo $trial
if ($LASTEXITCODE -ne 0) { throw 'Private experimental checkout failed' }

pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $trial 'scripts\Invoke-BuffMicrodirectorGate.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Source gate failed; do not launch' }

# V620 with BLACKOUT_LIVE v0.1 only; original MSI fallback stays unchanged.
pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $trial 'scripts\Start-BuffMicrodirectorTrial.ps1') -QwenBackend v620 -BlackoutLiveV01 -Launch
~~~

The launcher verifies native player, approved art/music, original profile and process ownership, and uses a separate TEMP scratch/private config with real paid-provider credentials removed. Synthetic messages only. The panel labels the active V620 performance profile. The switch -BlackoutLiveV01 is explicitly rejected with -QwenBackend msi.

**A/B baseline:** stop the above normally and run the same launcher with -QwenBackend v620 -Launch **without** -BlackoutLiveV01. To roll back to the original CPU writer, stop normally and run -QwenBackend msi -Launch (without v0.1). Never start both simultaneously.

## Acceptance

Compare five Shanny-addressed, five Rev-addressed, and five neutral synthetic comments, with the same inputs in both V620 modes. Record who speaks first, whether the line answers the actual viewer, whether the other actor's reply genuinely changes the argument, any earned third beat, first-person character identity, emotion/voice quality, model route and completion/first-audible latency.

Simulate V620 unloaded and confirm exactly one **unchanged** MSI generation; STOP during remote inference must not produce fallback speech or stale TTS. Source tests verify isolation but do NOT prove real LM Studio compatibility, quality, Unity/OBS timing, or paid-intake readiness. Keep this branch draft and paid events OFF until qualified.


## October 15 producer failure — Buff / repeated words

Producer audition failed on: **“buff, tell rev to let shanny finish her sentence.”** The characters reportedly looped on “sentence” and “you’re a Buff” instead of acting on the request. That is not acceptable acting; the original v0.1 must not be used.

**Source weaknesses:** The existing audience router assigns BUFF as the explicitly addressed offstage host while the named-role system defaults to SHANNY first. There was no deterministic representation of a message forwarded through Buff to Rev. The older topic-focus keywords could elevate the literal words buff/finish/sentence, and the spoken-output validator did not reject repeated n-grams or Buff identity confusion. Without a captured model completion, we cannot prove whether the original looping came from LM Studio output or voice playback.

**Small V620-only repair:** For an unambiguous host relay such as “Buff, tell/ask/remind Rev/Shanny…”, v0.1 now identifies the targeted onstage character and, where applicable, the practical goal of giving the other character room to finish speaking. It replaces the generic Buff route and literal focus keywords with the onstage action ONLY in the remote V620 prompt copy. The source donation text, actual stage reader, actor slots, and untouched warm MSI fallback prompt remain unchanged. Buff never becomes an onstage speaker.

A deterministic V620 response gate now rejects repeated significant words, repeated multiword phrases, duplicated spoken lines, and host-identity confusion, including repetition spread across multiple character turns. A rejected complete remote answer is blocked before voice prefetch and uses the EXISTING one-attempt MSI fallback. No new AI pass or autonomous behavioral machinery was added; STOP still cancels without fallback.

Regression tests include the producer's exact message, host-directed messages that are not relays, role preservation, meaningful normal speech, cross-line repetition, stream prefetch, fallback isolation, and cancellation. A standalone Node 22 local harness passed **19/19** focused checks. **The complete MSI Node/Python source gate and real V620/OmniVoice/Unity/OBS audition are NOT YET QUALIFIED for the repaired head.** Keep PR #11 unmerged and paid donation intake OFF.

Create a FRESH research-branch checkout before retesting: earlier temporary trials contain the old broken v0.1. Use the full isolated MSI gate before launching. Test with -QwenBackend v620 -BlackoutLiveV01 -Launch, then close normally and compare to -QwenBackend v620 -Launch without the profile. If the baseline V620 also produces loops, examine LM Studio generation/model settings. If voice repeats while validated model text is clean, investigate the audio/player pipeline instead of prompt tuning.

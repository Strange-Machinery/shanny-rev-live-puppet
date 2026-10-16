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

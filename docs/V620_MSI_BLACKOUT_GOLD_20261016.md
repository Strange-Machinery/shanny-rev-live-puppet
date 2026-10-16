# V620 — original MSI BLACKOUT GOLD (v0.1 source transplant)

**Scope: original creative behavior ONLY.** Independent DRAFT research branch stacked on PR #9 at 48af29a. This does NOT include the failed BLACKOUT_LIVE v0.1 beat planner from PR #11 and does not change that PR.

## Exact original source preserved

The existing src/conversation-director.mjs file is UNMODIFIED from the successful MSI BLACKOUT treatment (blob SHA c8b3826fbe7d5f6c92a8d9650aaf0c69751a9cba). The private MSI character treatment is read from the same existing producer.local.json-referenced file at runtime and included in the system prompt, never copied into GitHub. Up to THREE existing approved examples, if configured in that private profile, are used unchanged. No generated examples or lore jokes are substituted.

**Private-network data boundary:** GOLD intentionally sends the full private character treatment and any approved example text within each generation request from your MSI to **your V620 LM Studio over the pinned private Tailscale peer**. The notes/examples are not committed to GitHub, published in OBS, or put in the operator status response. LM Studio may keep its own request logs if configured; review its logging before using sensitive private material. This is a private opt-in trial, not a public hosted-model upload.

The old creative rules, output schema and validator remain:
- BLACKOUT audience antagonism, Shanny's combustible grievance, Rev's independent surly response, hostility specific to the viewer.
- Short one-sentence 8–16-word target per performed line, rather than the newer Microdirector's 16–32 words.
- JSON lines of SHANNY/REV with optional original face mood, plus rev_reason.
- No hash-based emotional lane selection, new lore lookup, causal hinge, three-beat profile, LLM rewriting, retraining or extra generation pass.
- The same original 2B sampling defaults (temperature=1, top_p=1, local output 240 tokens, 12-second deadline) when this GOLD profile is explicitly enabled. These are not claims of optimal settings for the 27B.

## Minimal required V620 integration

The V620 still uses the existing PINNED Tailscale/LM Studio OpenAI-compatible endpoint and response-format adapter. Its original creative prompt is the same as the local 2B's. Unlike MSI's streaming partial text, V620 already uses nonstreaming whole-plan validation before releasing any speculative voice.

The new src/msi-blackout-gold.mjs is a small transport-level validator. It runs the ORIGINAL validateExchange or original silent-warmup check on the complete 27B JSON BEFORE the existing failover is allowed to prepare speech. Wrong actor, invalid JSON, overlong/multi-sentence or unsupported mood rejects V620 and allows the existing one-time MSI fallback with the SAME original prompt. STOP never initiates fallback.

On V620 Gold, temperature/top-p and 240 maximum tokens intentionally mirror the original MSI director; V620 has a longer 30-second remote deadline to accommodate different hardware. Local MSI remains 240 tokens / 12 seconds. Do not change sampling, token limits, voice model, model weights, stage or paid-event settings in this first parity experiment.

## Producer A/B and rollback

Close any previous Buff trial normally. In PowerShell 7 on the MSI, with the V620 Qwen model already loaded and the private player/profile/art bundle available:

~~~powershell
$branch = 'rd/v620-msi-blackout-gold-v01-20261016'
$repo = 'https://github.com/Strange-Machinery/shanny-rev-live-puppet.git'
$trial = Join-Path $env:TEMP ('v620-msi-gold-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
git clone --depth 1 --single-branch --branch $branch $repo $trial
if ($LASTEXITCODE -ne 0) { throw 'Private GOLD source checkout failed' }

pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $trial 'scripts\Invoke-BuffMicrodirectorGate.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Source gate FAILED: do not launch' }

# Same original MSI BLACKOUT writer, V620 as the primary Qwen.
pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $trial 'scripts\Start-BuffMicrodirectorTrial.ps1') -QwenBackend v620 -OriginalMSIBlackout -Launch
~~~

First audition 5–10 ordinary synthetic audience comments WITHOUT BLACKOUT_LIVE. Verify the producer panel explicitly says MSI BLACKOUT GOLD, last writer v620, and reports the original private character treatment and optional approved example count. If last writer msi appears, you are listening to the local fallback, not a successful 27B performance.

For a controlled same-director local comparison, close the trial normally and run the launcher with -QwenBackend msi -OriginalMSIBlackout -Launch. Without -OriginalMSIBlackout, the same branch uses its existing Microdirector; close the previous trial normally first. DO NOT start two trials simultaneously. The launcher clones a new temporary working tree and creates a separate private profile/scratch directory, leaving the original producer profile, live player files and voice assets unchanged.

## Acceptance, not production

Record the actual last writer, latency, coherent dialogue, one-sentence timing, character identity, comedic quality and a few examples you personally find genuinely funny. The local gate validates source and fake responses, not real LM Studio compatibility or listening quality. LM Studio may reject the original small-model JSON schema (with regex/anyOf); do not silently loosen that schema or tune the model before recording what fails.

If the original private example file is not present, it will use zero examples, just as the original director specifies. A successful startup does not establish that the private treatment matches the historically funniest MSI trial; the file must be the original private version, not an unrelated later edit.

No paid providers, real donations, model changes, production OBS deployment, merge or Buff rollout are authorized by this research branch.

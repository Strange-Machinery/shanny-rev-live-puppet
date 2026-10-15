# V620 27B-first Qwen Microdirector, with warm MSI CPU fallback

Status: DRAFT, unmerged, not yet qualified on V620 hardware. Branch rd/buff-natural-voice-qwen-audit-20261014, PR #9.

## Historical integration recovered

The original writer used the producer-owned V620 LM Studio over Tailscale at http://100.79.20.28:1234/v1, before the remote generation capability was deliberately isolated. Old model labels included qwen3.8-27b@q4_k_xl and qwen3.8-27b-uncensored-hauhaucs-aggressive-mtp. The producer's read-only October 15 inventory returned CURRENT key qwen3.8-27b, parameters 27B, quantization Q4_K_XL, with one loaded instance. Do not substitute the old model labels in the new request without validating the current inventory.

## Trial behavior

- The MSI retains its working local CPU Qwen3.5-2B and starts it warm, even when the V620 is healthy. Unity, OmniVoice, stage, donor reader and approved voices do not move.
- The V620 is the preferred writer ONLY when the private trial profile selects qwenPriority = v620-preferred. No production profile or backend is changed.
- The remote OpenAI-compatible chat-completions request uses LM Studio's JSON-schema response format, unlike llama.cpp's existing json_object schema. The remote URL is pinned to an explicit Tailscale IPv4 peer, port 1234, with no URL passwords, public HTTP host or redirects.
- Every request first checks the READ-ONLY native LM Studio /api/v1/models endpoint (1.5-second budget), requiring the exact current model key and at least one loaded instance. Downloaded but unloaded models never qualify. No auto load/download/unload endpoint is called.
- Remote 27B: maximum 512 output tokens and 30 seconds. Local backup 2B: maximum 384 output tokens and 24 seconds. These are ceilings, not latency targets.
- Remote responses do NOT forward partial text to the speech prefetcher. Complete remote JSON must pass the actual Microdirector role/voice/topic validator BEFORE preparing any voice. If the remote model is unavailable, times out, produces malformed JSON or fails semantic validation, the adapter tries the warm MSI model ONCE.
- Failed primary checks enter a 10-second cooldown; the next request after cooldown checks V620 again and automatically restores preferred routing when healthy. STOP/cancel never attempts fallback. A failed local backup is terminal and cannot trigger repeated model attempts.
- A normal successful turn has one model generation. A failover turn may have one failed remote attempt plus one local attempt. NEVER two released dialogues.
- The producer panel shows the preferred writer, last actual writer (v620/msi), remote health, failover count and reason, and timing without private donor text, character notes, tokens or the V620 address.

## Producer control on MSI PowerShell 7

The existing trial launcher now defaults to V620 when selecting the model route. Explicit primary mode:

~~~
$trial = Join-Path $env:TEMP 'buff-micro-bootstrap-20261014-212619'
git -C $trial pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'Git update failed' }
pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $trial 'scripts\Invoke-BuffMicrodirectorGate.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Source gate failed' }
# Close any previously running Buff trial normally before launching.
pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $trial 'scripts\Start-BuffMicrodirectorTrial.ps1') -QwenBackend v620 -Launch
~~~

To roll back to MSI-only 2B within the same isolated experiment:

~~~
pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $trial 'scripts\Start-BuffMicrodirectorTrial.ps1') -QwenBackend msi -Launch
~~~

Do not run both trials simultaneously. The isolated launcher copies a private producer profile, strips paid provider configuration and leaves production/player/voice assets untouched.

## Required acceptance on the actual machines

1. Source gate and Windows PowerShell parser pass before launching. Run only synthetic donations with paid intake OFF.
2. Check V620 LM Studio /api/v1/models confirms CURRENT loaded key qwen3.8-27b. Verify a live answer shows last writer v620 rather than assuming from server reachability.
3. Test Shanny-first, Rev-first, and non-addressed donations with natural emotions and multi-sentence lines. Verify exact first-person character identity, dialogue grounded in each question and no wrong-speaker audio.
4. Compare the same input in MSI-only mode. Record completion latency, first audible reply, model failures, remote reasoning leakage, and character quality.
5. To simulate outage, deliberately stop LM Studio or disconnect Tailscale only when safe. Verify exactly ONE local backup generation, no V620 partial voice playback, and recovery after cooldown when service returns. Never terminate unrelated processes.
6. STOP in the middle of a remote generation and verify no backup line or stale late audio is released.
7. Keep native OmniVoice and real Qwen listening separate from the green source gate: passing tests does not prove real LM Studio compatibility.

## Known caveats and rollback

Some LM Studio model versions may ignore enable_thinking=false via the OpenAI-compatible route and return reasoning content or tags. The adapter rejects that text and may fail over to local. If the V620 appears loaded but repeatedly fails, inspect real LM Studio JSON-schema/served model compatibility before increasing timeouts or changing the user's model. No model is downloaded, retrained, modified, or swapped at the V620.

To use only the previous local writer, close the current trial normally and launch with -QwenBackend msi. The production character profile remains unchanged. Draft PR stays unmerged pending real acceptance.

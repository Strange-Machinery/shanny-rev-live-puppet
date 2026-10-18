# Voice-dyad-lite

GOLD writes the dialogue once. Voice-dyad-lite consumes GOLD's existing actor and mood, selects an approved episode voice category locally, and passes the original words to the resident OmniVoice worker. There is no second language-model call, dyad prompt, lore lookup, emotional classifier, text rewrite or added sentence.

## What actually controls the voices

The previous full dyad was a dialogue writer: its response contained `actor`, `text` and `mood`, not a rich voice-performance plan. Its full behavioral references went to Qwen, not OmniVoice. The provider passes text plus a saved-reference choice to the worker; the worker uses the selected recording's saved voice-clone prompt with its existing generation settings.

The installed sample-led Shanny adapter already converts rage to S06, uses the full-intensity recordings for rage and medium for ordinary anger, and lowercases only the speech input. Voice-dyad-lite keeps that behavior and supplies a small explicit mapping for the other GOLD moods. The existing worker still handles qualified source selection, rank weighting, continuity and variation. No voice assets, pitch settings or model parameters are changed.

```text
Audience input -> unchanged GOLD writer -> authored dialogue + mood
                                         |                 |
                                   caption/history    voice-dyad-lite
                                                           |
                                                 approved saved reference
                                                           |
                                                 resident OmniVoice worker
                                                           |
                                                 existing held audio queue
```

## Default voice choices

| Actor | Existing mood | Saved category | Delivery |
| --- | --- | --- | --- |
| Shanny | anger | S06 | Medium intensity |
| Shanny | rage | S06 | Full intensity |
| Shanny | crying | S04 | Defensive crying |
| Shanny | smug | S10 | Smug cutting |
| Shanny | surprised | S12 | Disbelief/surprise |
| Rev | pacifying | R03 | Reassurance |
| Rev | irritated | R10 | Ordinary irritation |
| Rev | rage | R13 | Loud anger |
| Rev | skeptical | R09 | Guarded defensive argument |
| Rev | surprised | R23 | Surprise/disbelief |

These are deterministic defaults for GOLD's ten mood labels. The six-line audition covered Shanny anger/rage and Rev irritation, not every category. The adapter cannot fix a mistaken mood chosen by GOLD. It never promotes a line to rage based on capitals, profanity or keywords, and never inserts WARTZ. Existing explicit qualified delivery codes remain available for more specific direction; a rage mood requires S06 for Shanny or R13 for Rev. No new cue is added to the GOLD schema.

The resident worker's actual advertised catalog is authoritative. Missing required categories fail before synthesis instead of substituting a different voice. S06 intensity is checked against real source metadata by the unchanged Python selector. Untagged direct provider warmup keeps its configured saved reference; ordinary gateway requests keep the gateway's existing default mood behavior. Authored dialogue, captions, history, line counts and ordering remain intact. Shanny's TTS string is lowercased; Rev's casing is preserved.

## Provider and producer-panel integration

`src/voice-dyad-lite.mjs` is a synchronous voice-input adapter. `src/providers/omnivoice.mjs` accepts either the explicit `voiceDyadLite: true` opt-in or a `getVoiceDyadLite()` callback from the producer control; both require `approvedDelivery: true`. The default provider behavior remains unchanged. The provider acquires its existing busy gate before waiting for a cold worker's catalog, so simultaneous requests cannot overlap during startup.

The branch's host continues to use its existing GOLD director. No wrapper or additional completion is inserted. The four frozen GOLD source files and their verified hashes remain unchanged. The older full/compact writer implementations and raw 80-call comparison remain research evidence; they are not on the lite execution path.

The producer approved the fixed-line audition and requested installation as the existing **Dyad** option for Live Show. The seven-file [installed overlay](../../integrations/voice-dyad-lite/README.md) replaces that installation's full-dyad writer switch with a saved-voice switch. ON uses lite; OFF retains its prior sample-led Shanny and configured standard Rev references. GOLD/chat/money and the existing ARGUE writer run in both positions. The original host and queue still own STOP, presentation readiness and audio release.

`createVoiceDyadControl` persists the existing `dyadEnabled` flag, defaults it on, validates the resident worker's catalog, rejects busy/concurrent changes, and restores the previous selection if saving fails. A response admitted during asynchronous persistence retains its first voice choice for all its rows. Toggling does not reload the voice worker. The installed panel shows voice status separately from the unchanged GOLD writer.

This repository is based on frozen GOLD, whereas the current installation has newer host/panel features. The overlay records the exact installed integration without replacing that newer host with the older repository host. Its manifest binds the seven before/after files and four frozen GOLD files. Deployment was authorized and completed; the PR remains draft and unmerged. Private configuration, voice assets and rollback backups are not published.

## Measured cost and validation

The offline routing benchmark processed 2,000,000 synthetic lines across all ten mood routes in 200 timed batches, after warmup. On Node 24.20.0 / Windows x64, median batch-average routing cost was **0.000091 ms per line**; p95 batch-average was **0.000117 ms per line**. These are warm local lookup costs, not per-request tail-latency or an end-to-end speech measurement. Raw sorted batch averages and normalized source hashes are in `experiments/dyad/evidence/voice-lite-routing.json`.

The earlier full-dyad comparison measured 36.94 seconds median with fresh prefixes and 5.17 seconds on immediate repeats; compact was 9.68 / 3.33 seconds, with shorter generated outputs contributing. That writer work is absent from the lite voice path. GOLD's own completion, worker startup when needed, voice synthesis and presentation latency remain. No new live V620 or audio measurement was needed to establish the zero-extra-completion design.

Validation: **302 repository Node tests and 331 staged-installation Node tests passed**, plus a final 13-test targeted run after adapting the incomplete-catalog case to both fixtures. The unchanged Python selector previously passed all eight tests. Tests exercise the real provider protocol with a fake speech worker: one GOLD completion, preserved authored rows, lowercase Shanny speech only, both actors' saved categories, explicit-code qualification, missing catalog rejection, opt-in behavior, cold-start concurrency, held audio and stale-release rejection after STOP. New tests cover OFF/ON persistence, rollback, concurrent saves, per-response consistency, and worker reuse. The frozen GOLD hash check passes without editing GOLD.

Separately, an isolated audition rendered the same six archived GOLD lines in both modes with matching seeds and request IDs, fresh worker state per arm, and unchanged generation settings. Current synthesis totaled 8.398 seconds; lite totaled 9.352 seconds. Four pairs were byte-identical; two Rev lines selected different approved R10 recordings and added 0.261 and 0.554 seconds respectively. This small sample is not a general latency guarantee. The producer listened and approved the tradeoff.

The installed Live Show then passed authenticated OFF/ON checks: both choices persisted, GOLD's profile/schema and all four file hashes stayed unchanged, no writer calls occurred during toggles, and the same voice-worker/player processes remained. The final state is Dyad ON, browser output, muted and idle with chat/paid intake off. Startup required backing up a verified stale empty ledger lock; the donation ledger itself was unchanged. See the sanitized [runtime verification](../../integrations/voice-dyad-lite/runtime-verification.json).

Reproduce without live services:

```powershell
npm test
python -m unittest discover -s python -p test_live_episode_delivery.py
node experiments/dyad/voice-lite-benchmark.mjs
```

The Node suite uses loopback fixture servers and requires local test networking. It uses no real model or voice service. The benchmark itself performs no network request and produces no audio.

# Voice-dyad-lite

GOLD writes the dialogue once. Voice-dyad-lite consumes GOLD's existing actor and mood, selects an approved episode voice category locally, and passes the original words to the resident OmniVoice worker. There is no second language-model call, dyad prompt, lore lookup, emotional classifier, text rewrite or added sentence.

## What actually controls the voices

The installed full dyad is a dialogue writer: its response contains `actor`, `text` and `mood`, not a rich voice-performance plan. Its full behavioral references go to Qwen. They do not go to OmniVoice. The provider passes text plus a saved-reference choice to the worker; the worker uses the selected recording's saved voice-clone prompt with its existing generation settings.

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

These are deterministic defaults for GOLD's ten mood labels, not newly auditioned artistic choices. The adapter cannot fix a mistaken mood chosen by GOLD. It never promotes a line to rage based on capitals, profanity or keywords, and never inserts WARTZ. Existing explicit qualified delivery codes remain available for more specific direction; a rage mood requires S06 for Shanny or R13 for Rev. No new cue is added to the GOLD schema.

The resident worker's actual advertised catalog is authoritative. Missing required categories fail before synthesis instead of substituting a different voice. S06 intensity is checked against real source metadata by the unchanged Python selector. Untagged direct provider warmup keeps its configured saved reference; ordinary gateway requests keep the gateway's existing default mood behavior. Authored dialogue, captions, history, line counts and ordering remain intact. Shanny's TTS string is lowercased; Rev's casing is preserved.

## Isolated implementation

`src/voice-dyad-lite.mjs` is a synchronous voice-input adapter. `src/providers/omnivoice.mjs` applies it only when `voiceDyadLite: true` and `approvedDelivery: true` are explicitly supplied. The default provider behavior remains unchanged. The provider acquires its existing busy gate before waiting for a cold worker's catalog, so simultaneous requests cannot overlap during startup.

The branch's host continues to use its existing GOLD director. No wrapper or additional completion is inserted. The four frozen GOLD source files and their verified hashes remain unchanged. The older full/compact writer implementations and raw 80-call comparison remain research evidence; they are not on the lite execution path.

For a later isolated installation, keep GOLD selected and enable `omnivoice.voiceDyadLite` on its existing voice provider. In the newer installed host, leave the full-dyad dialogue route off when testing this voice-only route. This PR does not edit private configuration, start another host/worker/player, change the checkbox, deploy files, or alter the live installation. The existing host and queue still own STOP, presentation readiness and audio release.

## Measured cost and validation

The offline routing benchmark processed 2,000,000 synthetic lines across all ten mood routes in 200 timed batches, after warmup. On Node 24.20.0 / Windows x64, median batch-average routing cost was **0.000091 ms per line**; p95 batch-average was **0.000117 ms per line**. These are warm local lookup costs, not per-request tail-latency or an end-to-end speech measurement. Raw sorted batch averages and normalized source hashes are in `experiments/dyad/evidence/voice-lite-routing.json`.

The earlier full-dyad comparison measured 36.94 seconds median with fresh prefixes and 5.17 seconds on immediate repeats; compact was 9.68 / 3.33 seconds, with shorter generated outputs contributing. That writer work is absent from the lite voice path. GOLD's own completion, worker startup when needed, voice synthesis and presentation latency remain. No new live V620 or audio measurement was needed to establish the zero-extra-completion design.

Validation: **296 Node tests and 8 Python voice-selector tests passed**. The added tests exercise the real provider protocol with a fake speech worker: one GOLD completion, preserved authored rows, lowercase Shanny speech only, both actors' saved categories, explicit-code qualification, missing catalog rejection, opt-in behavior, cold-start concurrency, held audio and stale-release rejection after STOP. Existing Python tests verify selection of real full/medium source variants. The frozen GOLD hash check passes without editing GOLD.

The tests do not constitute a listening audition or a production deployment. The adapter retains the existing resident worker and saved-reference mechanism; the new default mappings beyond Shanny's existing S06 behavior should be judged by listening in a separately authorized integration test.

Reproduce without live services:

```powershell
npm test
python -m unittest discover -s python -p test_live_episode_delivery.py
node experiments/dyad/voice-lite-benchmark.mjs
```

The Node suite uses loopback fixture servers and requires local test networking. It uses no real model or voice service. The benchmark itself performs no network request and produces no audio.

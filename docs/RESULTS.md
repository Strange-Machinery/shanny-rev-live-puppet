# v0.3 integration results

The subsequent real-character launcher and low-latency conversation measurements
are documented in [REAL_CHARACTERS.md](REAL_CHARACTERS.md). Two resident-Whisper
synthetic WAV tests reached actual Unity AudioSource start in 11.4 and 13.5 seconds.
These small local tests do not establish remote/OBS readiness or accepted character writing.

See [ACCEPTANCE_V03.md](ACCEPTANCE_V03.md) for the donation runner, Qwen client,
offline Testing tab, real CPU Whisper checks, passing tests and remaining hardware/
deployed-service acceptance. The earlier real-voice evidence below is historical;
it is not a claim that v0.3 has passed Unity/OBS/Qwen coexistence.

# Hardware acceptance — 2026-10-13

## Outcome

**PASS: the primary real-voice AudioSource/face acceptance goal for both Shanny and Rev.** Each completed three actual OmniVoice utterances in the same continuously running Unity scene. Recorded AudioSource sample positions advanced, the actual face renderer's jaw weight became nonzero, and the jaw returned to zero after playback. The player and stage instance IDs stayed unchanged. The final front-facing scene was visually inspected using diagnostic stills. This is a lightweight functional fixture, not a finished broadcast set or phoneme-accurate lipsync system.

No production episode code was changed or merged. No public stream was launched. Private character assets, approved reference prompts, model weights and generated WAVs remain outside the repository. The new GitHub repository is private.

## Source-control evidence

- Fresh root: `42a86e0374c7e96dfcf3dd4bba0a8bb29f6d0cfd`.
- Source snapshot: engine commit `e1d8986477986cd2e710baa531ac111dcf43d464`.
- Verified **17 source blobs = 17 root blobs, zero SHA mismatches, no root parent**. No production history was copied.
- Gateway/worker/Unity hardening: `f59b9a78f5b4e8cab6a9df16b573f09052cf3544`.
- Verified demo, operator launcher and raw hardware evidence: `a52a7dc`.

## Tests

| Check | Result |
|---|---|
| Local Node tests | PASS, 15/15 |
| Unity 6000.3.23f1 / URP 17.3.0 build | PASS |
| Exact live morph inventory | Shanny_Body: Jaw_Open; CC_Base_Body: jawOpen |
| Synthetic AudioSource/face/idle, each actor | PASS |
| Independent overlapping Shanny and Rev playback | PASS |
| Shanny interrupt stops Rev | PASS |
| Gateway panic stops both AudioSources and zeroes both jaws | PASS |
| Panic latch and explicit resume | PASS |
| Same stage instance across synthetic and six real utterances | PASS |
| Real SHANNY playback/face/idle | PASS, 3/3 |
| Real REV playback/face/idle | PASS, 3/3 |
| One-command launcher startup and close/cleanup | PASS, mock smoke |
| Worker timeout/crash/path validation/recovery | PASS with protocol fixture worker |
| Actual worker crash/recovery under GPU load | Not tested |
| OBS coexistence / mixed model load / long soak | Not tested |
| Whisper, Qwen, microphone and episode-player handoff | Prepared contracts only |

GitHub Actions tests Node 22 and 24 on both Ubuntu and Windows. Final code commit a52a7dc passed all four jobs: [run 38479641633](https://github.com/Strange-Machinery/shanny-rev-live-puppet/actions/runs/38479641633). CI uses a fixture worker and cannot substitute for local Unity/real-voice measurements.

## Measured latency

Final run: RTX 4060 Laptop GPU, 8,188 MiB total; Unity at 1280×720 with a 30 FPS target. Persistent existing OmniVoice worker, one shared model, approved external references. Warm means the process/model was already ready; the first SHANNY sample is excluded from warm quantiles. Quantiles are nearest-rank, calculated from the actual raw observations in `evidence/acceptance-2026-10-13.json`. These very small samples are a smoke benchmark, not a statistical performance guarantee.

| Measurement, milliseconds | SHANNY warm p50 / p95 (n=2) | REV warm p50 / p95 (n=3) |
|---|---:|---:|
| Model generation, worker reported | 3019.48 / 3269.72 | 1809.88 / 1941.54 |
| GENERATE to complete WAV read | 3170.98 / 3442.80 | 1896.70 / 1995.94 |
| Unity transport + decode | 33.16 / 33.26 | 33.24 / 33.29 |
| Decoded-clip enqueue to AudioSource.Play | 0.14 / 0.19 | 0.19 / 0.20 |
| Gateway request to Play acknowledgement | 3359.20 / 3613.03 | 2074.10 / 2115.98 |

Worker spawn-to-READY in the final run was **11,440.09 ms**. The first attempt in this session measured **65,101.12 ms**; subsequent process starts benefited from already-warmed filesystem/runtime caches. Neither number is a reboot-cold guarantee. The delivered CLI/launcher now warms the worker before presenting a ready gateway.

The final first SHANNY request took 14,632.49 ms until WAV readiness, including worker startup; Play acknowledgement arrived at 14,716.62 ms. The acknowledgement includes the return HTTP path and is an upper-bound observation of when Play was invoked, not an exact physical speaker-onset measurement. Unity transport and decode are measured together by UnityWebRequest, not separately inferred. **First physical audible output was not measured**: no calibrated loopback/microphone capture was used.

Remote gateway panic to a fresh heartbeat showing both actors stopped and both jaws zero: **289.14 ms** in one test, including polling/heartbeat delay. The local Panic() method stops AudioSources synchronously before HTTP; its button-to-acoustic-stop latency was not measured.

## Resource measurements

During the six final real utterances, measured average frame rates ranged **29.989–29.997 FPS**; the largest measured frame interval was **34.03 ms**. Whole-device NVIDIA samples were collected about once per second: initial memory **2,033 MiB**, peak **5,701 MiB**, GPU utilization p50 **42%**, p95 **99%**. Those figures include the desktop and other processes; they are not isolated per-process VRAM measurements. Short spikes may fall between samples. This run did not include OBS, Qwen or Whisper.

The earlier hidden-player pass produced blank stills and misleadingly high update rates, so its rendering/FPS results were rejected. Subsequent visual inspection found omitted shader includes; copying the existing private HLSL/CGINC dependencies repaired the materials without changing production shaders. The final scene reuses the existing standing-hold clips and authored facing angles.

## Delivery and next work

The local Start-Live-Puppet shortcut opens the real-voice fixture after warming OmniVoice. Type a line, choose Shanny or Rev, optionally interrupt, and use SHUT UP — STOP PUPPETS for immediate local stop. Closing the player cleans up the launcher-owned gateway and worker. A mock mode is also available. No MSI installer or global machine changes are required. Exact setup is in LOCAL_SETUP.md.

The next-work packet is NEXT_WORK.md, with versioned contracts in contracts/next-stage.v1.schema.json. Highest priority: wire Buff's existing episode launcher to private generation-job/download delivery, then implement its explicit Live response / isolated microphone mode and one-action stop-and-resume-show transition. The current puppet stop button does not yet resume an external episode player. Preserve session/mode epochs so stale Whisper/Qwen results cannot speak after returning to the show.

True incremental synthesis is not implemented. The installed worker/API emit complete WAVs; see STREAMING.md. Optional head/eye expression behaviour, facial tuning, OBS load testing, longer soak, native emergency hotkey wiring, and human voice/visual quality approval remain.

# Buff donation integration — ZIP-free offline smoke lab

This is a **producer-only** PowerShell route. It requires **no Codex/Work, real donation, YouTube login, Streamlabs login, or StreamElements login**. It never changes production Unity, the local Qwen model, Buff's OBS, or provider accounts. No approved art ZIP is required to run the protocol tests.

Source branch: `rd/buff-offline-smokelab-20261014`, forked from `rd/buff-pre-msi-gate-20261014`. The existing pre-MSI branch remains untouched.

## One-time PowerShell bootstrap (MSI, PowerShell 7.6+)

Run from any folder:

```powershell
$ErrorActionPreference = 'Stop'
$bootstrap = Join-Path $env:TEMP ("buff-smoke-bootstrap-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
git clone --depth 1 --single-branch --branch rd/buff-offline-smokelab-20261014 https://github.com/Strange-Machinery/shanny-rev-live-puppet.git $bootstrap
if ($LASTEXITCODE -ne 0) { throw 'Could not authenticate the private GitHub checkout' }
& (Join-Path $bootstrap 'scripts/Invoke-BuffSmokeLab.ps1') -Preview
```

The runner performs its own **additional isolated throwaway clone**; it never stashes, resets or cleans either existing checkout. Requires Git, Node.js 22+, npm, and optional Python 3. Its 2 GiB free-space guard intentionally refuses disk cleanup. `-Preview` starts a local-only static 1920x1080 Browser Source inspection on port 18786 and opens the long-message example. Run without `-Preview` for CLI-only. Add `-SkipPython` if Python isn't installed (that gate will be marked SKIPPED).

Output: `%TEMP%\buff-smokelab-...\BUFF_SMOKELAB_RESULTS.json`, with all individual logs and the exact Git commit. The preview PID and URL are recorded in that JSON; stop the preview later with `Stop-Process -Id <preview_pid>`. Never share live provider tokens or a private OBS viewer URL in a bug report.

## What actually runs

- New three-way adapter smoke suite: the REAL Streamlabs Socket.IO adapter with a fake connected EventEmitter, REAL StreamElements Astro adapter with a fake authenticated WebSocket, and REAL YouTube poll/cursor adapter with local fake API responses. Every synthetic payment goes through production normalization, the 32-item durable queue, and the one-at-a-time host dispatcher.
- Negative protocol paths: no emission before socket/subscription authentication, non-donation alert, unauthorized mirror, unrelated StreamElements activity, pending moderation, wrong room, duplicate IDs, initial YouTube history suppression, failed YouTube cursor admission/replay and restart-safe deduplication.
- Money mode: $5 seated, $99.99 seated, USD $100 automatic rain on all three providers. One serial queue, STOP sticky, simulated OBS viewer absence blocks dispatch, overflow is a hard failure and accepted unstarted work persists.
- Complete repository Node regression suite, including the existing virtual OBS receipt/timing tests; optional offline Python UI suite.
- Existing native executable SHA-256 and Unity project version inventory only. No unsafe injection of new files into a compiled native player.
- Optional painted popup preview using the real HTML/CSS/scroll component. **If the approved WebP/MP3 bundle is absent, the report explicitly says so and uses a visual fallback.**

## What the results CANNOT prove

This is *adapter-level simulation*, **not a network-level mock Socket.IO/Astro server**. It validates the real adapter callbacks, normalization, durable queue, and simulated viewer guard. GitHub tests or a Chrome static preview do not prove OBS's Chromium Embedded Framework, autoplay, H.264 decoding, live Unity scene, OmniVoice output, actual music-ended callback in a real browser, real websocket authorization or payments.

The runner reports separate labels for `provider_three_way`, `full_node_regression`, `offline_python`, `approved_art_files`, `native_build`, `visual_preview`, `obs_video_audio`, `real_provider_authentication`, `real_provider_paid_events`, and `real_youtube_live_chat`. Only genuinely exercised tests may say PASS.

## Next local gate after green offline tests

Open the preview URL in your own OBS as a temporary Browser Source, 1920x1080. Verify the upper-left boxed position, transparency, long donor scroll and hotmic privacy by recording a few seconds. This validates **only static browser source rendering**, not the native 3D/video/audio path. Do not add a permanent OBS scene/source automatically.

The separate, later native acceptance must run the actual Bundled Stank Tank player + real host and demonstrate verified WebRTC presentation, song playback ended acknowledgment, seating, OmniVoice speech and return to idle. Buff's real account/remote OBS test remains the final acceptance gate.

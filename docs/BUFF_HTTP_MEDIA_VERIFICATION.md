# Buff HTTP media candidate: verification record

Date: 2026-10-21. This records repository validation, not a deployed Windows or
remote OBS result.

## Source and scope

- Repository: `Strange-Machinery/shanny-rev-live-puppet`.
- Candidate branch: `rd/buff-http-media-20261021`.
- Exact upstream commit: `6b532677055d73c7120bae17fd848f8805559c09`.
- Exact upstream tree: `7f2b56aedb6a5e555c8006be032908211521abf0`.
- The hydrated local baseline tree matched that upstream tree exactly.
- HTTP transport is disabled unless `media.http.enabled` is explicitly true.
- No Windows runtime, provider connection, live audience, broadcast, account,
  subscription, network policy or GitHub merge was changed by this preparation.

The installed MSI host is newer than that source. The committed historical
overlay patches do not contain complete preimages for the newer host/panel
files. The candidate therefore includes a read-only inventory and conflict
report helper, plus the narrow integration patch. It is not a whole-runtime
installer. See [the deployment guide](BUFF_HTTP_MEDIA_DEPLOYMENT.md).

## Results

| Verification | Result | What it establishes |
| --- | --- | --- |
| Unchanged upstream Node suite | 309 passed, 0 failed, 0 skipped | Baseline repository behavior. |
| Complete candidate Node suite | **366 passed, 0 failed, 0 skipped** | Existing regressions plus all 57 added HTTP checks. |
| HTTP server/parser/FFmpeg tests | 10 passed | Ordered ingest, bounded parser/ring, media timing, trusted timeline, STOP and local route boundary. |
| Browser logic tests | 16 passed | Recorder ownership, audio gain, bounded startup/queues, MSE lifecycle, playback counters and cancellation races. |
| Presentation adapter tests | 10 passed | Actual program receiver required, same receiver/generation for rain, interruption and deadline handling. |
| Stage page tests | 5 passed | One soundtrack, explicit restart after STOP, source replacement and cleanup serialization. |
| Host/panel integration tests | 6 passed | View-only isolation, direct-local publisher boundary, ingest role isolation and native STOP wiring. |
| Receiver proxy tests | 5 passed | Fixed upstream/routes/credentials, bounded bytes/concurrency and disconnect cleanup. |
| Overlay preparation tests | 5 passed | Installed files unchanged, exact-base/new-file selection, conflicts and path safety. |
| Synthetic smoke fixture `--self-check` | Passed | Local authenticated endpoints and actual `/watch` assets; **does not test decoding**. |
| Source whitespace and helper syntax checks | Passed | No whitespace errors or helper parse errors. |

The complete passing command was:

```sh
node --test --test-concurrency=4 --test-reporter=tap test/*.test.mjs
```

The final uninterrupted run completed in approximately 10.5 seconds, using
Node v24.19.0 and FFmpeg 6.1.1 on Linux. Local loopback test servers required the
execution environment's approved sandbox permission. No external media service
or model API was called by these tests.

An earlier unrestricted-parallel run passed all new HTTP checks but failed the
existing pending-pause test's 40 ms acknowledgement deadline (365/366 overall).
During an execution-service interruption, another attempt did not complete;
a subsequent run observed several subprocess/time-limit failures while the
environment was stalling. The final uninterrupted run above passed every test.
No production timeout or unrelated test assertion was relaxed to obtain that
result. The initial failures remain relevant if CI or a deployment host is
similarly overloaded.

## Real codec exercise

The automated test creates a three-second synthetic moving picture with audio
intentionally delayed by about 400 ms, passes it through the actual fixed FFmpeg
pipeline, and inspects packets/streams with ffprobe. It covers browser-style
WebM ingress and fragmented MP4 ingress, H.264/AAC output, complete independent
fragments, and live output before the publisher closes stdin.

The fixture measured a 394 ms source audio offset and 379 ms encoded audio offset.
Using `delay_moov` preserved that offset; the initially considered `empty_moov`
reset it. This is a synthetic codec regression, not a measurement of Windows
capture-clock alignment, browser startup latency or physical speaker timing.

STOP tests verify a new media epoch, cleared fragments/metadata and rejection of
old uploads. Ordinary presentation end stays on the media timeline so buffered
speech can finish. The producer's native control epoch also latches an explicit
manual restart, including when source loss occurs before an upload receives 409.

## Remaining acceptance

| Area | Status |
| --- | --- |
| Real browser MediaRecorder to MSE picture/sound | Pending. This environment had no usable browser binary; attempted Chromium installation failed. Mocked browser tests are not a substitute. |
| Newer installed Windows host/panel merge | Pending installed-source comparison and narrow staged merge. |
| Actual Edge/Chrome background capture and playback | Pending. |
| Actual OBS CEF decode and mixer output | Pending. |
| Buff's own-network picture, voices, rain and STOP delay | Pending. |
| Existing tunnel route permission and sustained capacity at $0 | Pending route-specific check. |
| End-to-end delay, recorder clock alignment and physical audibility | Pending measurement/listening. |

The three-minute local smoke fixture and the exact acceptance steps are in the
deployment guide. Its status intentionally distinguishes program-role receipts
from proof of an actual OBS process or physical audio output.

## GitHub validation policy for this draft

The publication commit includes `[skip ci]` to avoid automatically launching the
repository's Windows/Linux Actions matrix while preserving the $0 constraint.
No workflow, required check or branch protection is disabled. This draft records
the local results above; it does not claim green GitHub CI. Required CI and actual
deployment acceptance remain necessary before any later merge/release decision.

GitHub documents this commit-message behavior for `push` and `pull_request` runs
in [Skipping workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs).

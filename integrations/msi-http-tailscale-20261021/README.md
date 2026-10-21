# Buff's permanent private HTTP receiver

This is a receiver integration reference, not a complete show distribution. The existing producer serves the actual stage, approved assets and complete receiver. Buff needs Tailscale and one OBS Browser Source, not producer models or an additional relay.

The private handoff contains `Buff Controls.url`, `Open Show.url` and `OBS Browser Source.txt`. Read these locally. Their fragment keys are credentials; never commit them. The control key and view-only key have different capabilities.

## Correct URLs and overlay behavior

| Purpose | URL shape | Behavior |
|---|---|---|
| OBS program overlay | `http://HOST:17862/stage#transport=http&key=VIEW_KEY` | Transparent idle; timed picture/captions during speech/rain; one audio stream; no diagnostic UI. |
| Interactive watch | `http://HOST:17862/watch#transport=http&key=VIEW_KEY` | Reconnect/sound controls; diagnostic behavior differs from the program overlay. |
| Manual controls | `http://HOST:17862/#key=OPERATOR_KEY` | Existing producer controls. Remote publishing, ingest/admin and enabling paid/chat intake are denied. |

Use the entire `/stage` document as the OBS Browser Source. It is not a raw MP4 URL. Do not feed the manifest or page URL into a video element. Set 1920x1080, 30 fps and Control audio via OBS ON. Preserve the scene's crop, stacking and audio monitoring; avoid duplicate desktop/program audio. An HTTPS wrapper embedding private HTTP will encounter mixed-content restrictions; a cross-origin hand-rolled client will also hit exact-origin checks. Prefer the complete receiver directly.

## Transport contract

The silent MSI publisher takes the native picture and voices and mixes rain once. Its Edge recorder prefers WebM VP8/Opus input. Existing FFmpeg emits H.264/AAC fragmented MP4. All receiver requests use the private origin, `Authorization: Bearer VIEW_KEY`, no-cache behavior and bounded buffers.

Fixed receiver routes are under `/api/http-stage`: POST `receiver/open`, GET `manifest`, GET `init`, GET `fragment`, POST `receiver/receipt`, POST `receiver/close`. Exact schemas and query parameters are defined by the included `http-stage-player.js` and `http-stage-protocol.js`; reuse them rather than inventing a new protocol. Native ingest and preview receipts do not establish program playback.

The receiver reports actual decoded progress, visibility, muting, the active epoch and presentation timeline. Speech/rain gates depend on genuine program playback. Ordinary completion follows the media timeline so final speech can finish; STOP immediately revokes the epoch, mutes/hides and discards stale buffers. Reconnect cannot override STOP. MSI's Start Buff feed explicitly resumes publishing.

## Network and acceptance

Tailscale Serve maps private HTTP port 17862 to the loopback-only receiver gateway on 17863. HTTP runs within the encrypted Tailscale connection. It has no temporary tunnel renewal timer; the machine, show, Tailscale login and existing access permission must remain available. No Funnel, exit-node or subnet route is needed. Use the existing permitted access rules; report denials instead of changing policy. Tailscale's free Personal offering is for non-commercial use; the producer identifies this show as non-commercial.

A producer-side browser check does not establish Buff acceptance. Buff must observe picture/audio from his own network in his actual OBS Browser Source, both voices, a complete rain track, final speech, idle transparency, Shut up/STOP and reconnect without stale audio, with OBS off air and paid/chat intake off. Record the exact limitation if OBS cannot be observed.

The original private candidate is PR14 at commit `1ab071425b43f0c216e8789fbfd9f6ad3f3b2bd1`. The deployed MSI integration includes newer installed behavior, the first-frame Edge retry, WebM ingress preference, launcher changes and a Tailscale-only gateway. Never copy the baseline wholesale over an existing production installation.

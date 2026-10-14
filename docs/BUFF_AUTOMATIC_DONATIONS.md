# Buff: automatic donations → prepared OBS popup

**Status, October 14, 2026: fixture-tested integration; NOT real paid-event or Buff OBS acceptance.**

This integration branch builds on the accepted native Buff PR #3 and does not
change Unity animations, rigging or DSP. Automatic paid feeds are opt-in.

## Buff's eventual workflow

1. Open the private Buff launcher. Click Copy OBS link. Add the link as a
   1920×1080 Browser source in his already running OBS, once.
2. See connection statuses for YouTube, Streamlabs and StreamElements. The
   producer handles first-time account authorization, keys and API setup.
3. Check Make it rain only when wanted, then click Enable donation reactions.
   New paid events arrive automatically and play sequentially without
   Test donation. Changes to the checkbox affect only future admitted events.
4. Shut up immediately cancels the current popup, discards stale replies,
   hides OBS and leaves the queue waiting for the next TTS. STOP / Disable
   donations makes automatic reactions OFF until explicitly re-enabled.

Shut up is currently a dedicated operator button or exact trusted typed
transcript; continuous hands-free voice wake-word detection is not installed.
Incoming donor text NEVER triggers an operator control.

## Private producer configuration

The accepted real host accepts a donations credentialsFile path and needs
media.enabled=true. Example launcher configuration:

~~~json
{
  "media": {"enabled": true, "iceServers": []},
  "donations": {
    "credentialsFile": "C:\\private\\buff-donations.local.json"
  }
}
~~~

The producer may also simply save donations.local.json under the real host's
private scratch folder; the host discovers it automatically without a launcher
configuration edit. Buff does not need to edit any JSON.

Producer-owned credentials file schema, with placeholders only:

~~~json
{
  "authority": {
    "superchat": "youtube",
    "streamlabs_tip": "streamlabs",
    "streamelements_tip": "streamelements"
  },
  "youtube": {
    "accessToken": "PRIVATE_OAUTH_ACCESS_TOKEN",
    "liveChatId": "ACTIVE_LIVE_CHAT_ID"
  },
  "streamlabs": {
    "accessToken": "PRIVATE_OAUTH_ACCESS_TOKEN"
  },
  "streamelements": {
    "room": "PRIVATE_CHANNEL_ID",
    "token": "PRIVATE_JWT_OR_OAUTH",
    "tokenType": "jwt"
  }
}
~~~

Never commit a populated file. The private work directory and *.local.json
are gitignored. Missing credentials show needs connection. No provider feed
opens at startup or merely by connecting OBS; the operator must press Enable,
and native stage media must first be ready.

### Providers and authentication

- YouTube: obtain channel OAuth and the current broadcast's liveChatId.
  The implementation uses the documented liveChatMessages.list fallback,
  honors pollingIntervalMillis, and persists nextPageToken AFTER the
  corresponding donation admission. Google's lower-latency streamList method
  is preferable later but not implemented here. First connection bookmarks
  recent events without replaying past purchases. STOP deliberately starts a
  fresh baseline upon re-enable. OAuth access-token refresh must be provided
  by the producer integration; an expired token fails closed.
- Streamlabs: OAuth2 socket.token permission; either provide socketToken or
  authorize an accessToken and use the v2 Bearer /socket/token endpoint. The
  official Socket API uses Socket.IO v2, with pinned client dependency
  socket.io-client@2.5.0. Install Node dependencies in the producer bundle.
  Only paid donation events or explicitly authoritative Super Chat mirrors
  are eligible; subscriptions and follows are excluded.
- StreamElements: private JWT, overlay key or OAuth2 with tips:read. Subscribe
  specifically to Astro channel.tips, not the general channel.activities
  alerts. Accept only authenticated room, status success and approved allowed.
  Reconnect tokens restore authenticated subscriptions when possible;
  unexpected disconnections require backoff/re-subscribe.

Only one source may own Super Chats: YouTube by default, or Streamlabs by
explicit configuration. This prevents mirrored events playing twice. Distinct
payments are NEVER deduped merely because text or amount is the same.

## Persistence, control and limits

Existing DonationLedger stores canonical provider IDs across restarts.
A private 32-item bounded queue saves admitted events and their frozen
seated/rain mode, serializing the existing one-turn ConversationSession.
The queue marks a turn started before requesting host speech. A crash can
lose that uncertain turn but cannot replay it: at-most-once, not exactly-once.
A full queue refuses further admission and displays an error; Socket.IO
providers might not replay refused events. Preserve ledger and queue together.

On restart, reactions are disabled until Buff explicitly presses Enable.
STOP disconnects providers and cancels current playback. Shut up hides the
current popup and invalidates its generation/voice scope without disarming
later paid events. Donor content is quoted untrusted input, not an instruction.

## Variant A boxed Stank Tank popup and hotmic subtitles

- The 1920×1080 OBS Browser Source remains transparent outside a roughly
  780px-wide **upper-left** boxed Stank Tank window. The Unity H.264 camera is
  opaque INSIDE that box; we do not claim unsupported character alpha or
  green-screen keying.
- Dark tar/moss framing, toxic-green bevel, restrained static slime drips,
  a strong STANK TANK header and readable donor/amount/message plaques.
  The display font uses local fallback fonts with CSS gradients and outlines;
  no web-font dependency or binary artwork is shipped.
- Actual paid provider events carry canonical transaction ID only in the
  private queue; only sanitized donor, amount/currency, and speech message are
  released to the viewer. Test donations are visibly marked TEST.
- Hotmic responses use the same frame with LIVE RESPONSE in the header and
  **NO** donor plaque, amount, message, or Buff/Whisper transcription.
  Shanny/Rev dialogue is captioned inside the video pane using actual Unity
  playback-start/finish receipts. This requires no new Unity build, but is a
  browser compositing equivalent—not the authored episode subtitle component.
- Seated donations/hotmic hide immediately after final spoken-line receipt
  and paired presentation end acknowledgment (typically sub-second beyond the
  final word). Rain retains its full native return plus speech.
- The public OBS page mutes while hidden, clears old metadata/captions and
  retries WebRTC after transient producer outages. On reveal it acknowledges
  browser playback readiness before first speech; server falls back to a
  short bounded preroll if no OBS viewer is connected. A remote browser with
  blocked autoplay can still fail; Buff's real OBS sound test is mandatory.
- To inspect this skin without running Unity or accounts, run
  `node scripts/preview-stank-popup.mjs` and open the displayed loopback
  /donation or /hotmic URL. This is visual-only, NOT a full-stack acceptance.

## Stable private OBS and remaining network checks

Remote sharing uses the producer's opt-in Tailscale Funnel HTTPS, NOT
127.0.0.1 on Buff's computer. The saved, separate work/obs-viewer-key.local.json
keeps the read-only Browser-source URL stable across producer restarts,
provided the Tailscale DNS hostname stays the same. Operator and viewer
tokens have different privileges. Keep the OBS #key= fragment private; rotate
it intentionally if exposed.

The stage page is transparent until the native player acknowledges a prepared
performance; video is H.264 1920×1080/30fps with audio. No ICE/TURN relay
account is provisioned by this PR. Remote NAT/firewalls may require an
authenticated TURN service configured under media.iceServers. A successful
local preview or HTTPS request does NOT prove Buff's remote WebRTC works.
OBS Browser Source autoplay, monitoring, sound duplication and transparency
need acceptance on his computer.

## Pre-live acceptance gate

- Owner-approved provider authorizations and visible connected statuses.
- Fixture tests: paid-only detection, mirrors, reconnect, restart, STOP, queue
  capacity and non-disarming Shut up.
- One authorized local end-to-end event using the real host and speech receipts;
  do not spend money or publicly stream as part of the fixture run.
- Buff checks the remote OBS URL, transparency, audio, return-to-idle, NAT/TURN
  needs and link survival over a producer restart.
- Real account-origin paid donation acceptance only after explicit approval.

Official docs:
https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list
https://developers.google.com/youtube/v3/live/docs/liveChatMessages/streamList
https://dev.streamlabs.com/docs/socket-api
https://dev.streamlabs.com/docs/scopes
https://docs.streamelements.com/websockets
https://docs.streamelements.com/websockets/topics/channel-tips

# STANK TANK AI — Streamlabs / StreamElements account test gate

**Status: source-tested only. No connected accounts, payments, remote OBS,
or actual Unity/MSI hardware have been tested by this GitHub branch.**

We can use producer-owned (or explicitly authorized) Streamlabs and
StreamElements accounts. No YouTube account or livestream is needed to
complete art, music, donor text, or offline provider emulation.

## Three different verification levels

| Level | Procedure | What it proves |
| --- | --- | --- |
| 1. Painted preview | Install the approved asset ZIP in an isolated checkout; open /donation?backdrop=1&long=1, /hotmic, and /celebration | Frame, 16:9 cutout, donor plaque, full-message scrolling, painted animation and privacy. No actual OBS/player/provider. |
| 2. Provider emulation | Run the included Node tests (real Socket.IO/Astro adapter classes wired to in-process fake authenticated sockets, their event normalizers, and the actual durable queue). | $5/$99.99 seated; $100 USD rain; duplicate IDs ignored; unrelated subscriber/activity/moderation events ignored; STOP sticky. No login, actual payment or external event. |
| 3. Authorized test account | Producer personally connects to Streamlabs/StreamElements using private authorized credentials, then watches Buff launcher diagnostics and their own local OBS. | A real service token/connection. A real provider-published paid event is proven ONLY if the paid-event intake counters increase, not merely if the dashboard overlay animates. |

## Dashboard mock alerts are NOT authenticated donations

**Streamlabs** has a Dashboard Test Alert button. Our show actually
listens to the **Socket API**, with the authorized Socket.IO token and
event type "donation", including an event/message ID. A dashboard test
can animate the provider's Alert Box without publishing a compatible
paid event to that socket. The Buff launcher then correctly shows
"Streamlabs: connected" with "Provider packets: 0".

**StreamElements** has a standalone overlay emulator and Activity Feed
mock events. Our producer instead subscribes to Astro topic
"channel.tips" (scope "tips:read") and accepts ONLY an authorized
matching room, "status=success", "approved=allowed", and unique tip ID.
The emulator's activity events need not appear on "channel.tips" at all.
Do not treat a pretty emulator animation as proof of a paid event.

Official references:
- https://dev.streamlabs.com/docs/socket-api
- https://support.streamlabs.com/hc/en-us/articles/52499995174299-Setting-up-Your-Streamlabs-Alerts
- https://docs.streamelements.com/websockets
- https://docs.streamelements.com/websockets/topics/channel-tips
- https://github.com/StreamElements/standalone_emulator

## Verified provider wire-format notes

As of this review, Streamlabs' published Socket API uses the
`sockets.streamlabs.com` Socket.IO endpoint, authenticated by a producer's
private socket token, with live `event` packets for native `donation`.
Only the event adapter's real socket connection is evidence of paid-event
delivery; a dashboard Test Alert alone is not. StreamElements' current
Astro documentation requires `channel.tips`, scope `tips:read`, a
`subscribe` request including `data.token` and `data.token_type`, and
a successful subscription response. The response's canonical `data.room`
may differ from the requested channel value; the adapter binds events to
that authenticated canonical room. A tip counts only when the event says
`status=success` and `approved=allowed`, with an immutable tip ID.

The synthetic socket/Astro tests intentionally exercise those **documented
message shapes**. They still cannot prove that a particular user's
account/permissions or provider dashboard mock sends actual traffic.
Do not request, paste or export real tokens into the assistant or GitHub.

## Credentials stay PRIVATE to the producer

Never paste passwords, OAuth access tokens, socket tokens, JWTs,
private URLs or screenshots showing them into ChatGPT, GitHub,
Discord or OBS properties. Obtain them in the provider's own dashboard
only when testing is authorized. No account is connected by these tests.

The real host supports a private gitignored file at:

    <producer-scratch>\donations.local.json

For approved later MSI use, its minimal schema is:

~~~json
{
  "streamlabs": {"socketToken": "REPLACE_ONLY_ON_PRODUCER_PC"},
  "streamelements": {
    "room": "PRIVATE_AUTHORIZED_CHANNEL_ID",
    "token": "REPLACE_ONLY_ON_PRODUCER_PC",
    "tokenType": "jwt"
  }
}
~~~

One provider alone is sufficient. Omit YouTube until later. Protect
the file with local Windows user-only permissions, and never commit it.
The producer must first connect the ACTUAL authenticated OBS Browser Source,
then intentionally press "Enable donation reactions". The app refuses to arm
automatic paid feeds if no OBS viewer is attached. If that viewer later drops,
queued paid events wait for reconnection instead of silently playing to
nowhere. The wait is **bounded (currently three minutes)**: a prolonged
outage disables the queue and reports an error, while undelivered queued
records remain stored. After fixing OBS, the producer must explicitly
press Enable again rather than relying on silent auto-arming.
Connecting a socket or opening a preview does not authorize the queue.
Buff's manual MAKE IT RAIN NOW celebration yields to already accepted
paid donations while the automatic queue is armed, so it cannot race
a payment that was just dequeued.

## How to interpret the NEW Buff launcher diagnostics

The private launcher shows:
- Per-provider: not_configured / connecting / connected / retrying / error
- Per-process: Provider packets N / accepted N / ignored N

Interpretation:
- **Connected, zero packets** after provider Dashboard Test Alert:
  the test did not reach OUR subscribed paid-event socket. This is
  not an OBS or painted-frame failure.
- **Observed but ignored**: provider events did arrive but didn't
  satisfy allowed/paid conditions; no donor information is exposed.
- **Accepted**: an authenticated-source **payment-shaped record**
  was queued. It does NOT independently prove money settled.
- The counters contain NO donor names, transaction IDs, amounts,
  raw messages or tokens.

## Producer self-test matrix (not Buff's accounts)

1. Visual preview: painted border, transparent idle, 16:9 camera,
   donor name/amount/message, long scroll, hotmic privacy.
2. Offline receipt simulation: native rain starts before Qwen,
   the approved final 23.902s MP3 waits for authenticated
   HTML audio "ended"; stage returns to the desk before TTS.
   Failed/stale/disconnected audio must NOT overlap donor speech.
3. Source adapters: a $5 Streamlabs event, $100 Streamlabs,
   $99.99 StreamElements and $100 StreamElements, independently
   admitted from authorized-looking mock sockets; duplicate ID,
   same-text distinct purchases, moderation rejection, chat,
   STOP and source reconnect.
4. The actual account login: check private provider connection
   and scope/channel status. Dashboard visual tests are welcome;
   do not simulate an actual payment unless the account owner
   separately approves it.
5. Later MSI-only native+OBS test: Stage returns to both chairs,
   the BLACKOUT camera middle finger faces viewers and relaxes,
   no audio doubling, no late speech, STOP/Shut up immediate,
   full donor message scroll, high-value rain choreography,
   real WebRTC / CEF CPU and framing.

## Important YouTube qualification

The same painted Browser Source and TTS rendering work for every
provider. Success with Streamlabs or StreamElements should be enough
to qualify the SHARED visual/live character pipeline.

Real YouTube OAuth, active liveChatId, polling/page cursor and
actual paid Super Chat delivery remain a separate provider-specific
acceptance gate. A mock YouTube fixture is not live API evidence.

## Isolated source/art preflight before Codex touches the MSI

Once ready, use PowerShell 7 with an approved ZIP path:

~~~powershell
./scripts/Review-BuffPreMSI.ps1 -BundlePath 'C:\Private\STANK_TANK_AI_Approved_Make_It_Rain_Bundle.zip'
~~~

This clones the approved branch to a fresh Temp folder, validates
all five art/audio SHA256 files, runs the Node tests and offline Python
suite without external provider traffic. Optional -OpenPreview opens
the isolated local visual preview on port 18785.

Do not mistake passing GitHub/localhost tests for approved live
Unity/OBS or account-connected production.

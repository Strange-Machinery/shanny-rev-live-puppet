# Buff HTTP video and audio: Windows deployment handoff

## Scope and current status

This change carries the existing show picture, character voices, and rain
soundtrack to Buff through authenticated HTTP. The producer keeps the native
Unity stage and the existing voice services. A local browser records its received
stage stream, FFmpeg packages H.264/AAC fragments in memory, and Buff's browser or
OBS Browser Source plays those fragments through the same application origin.
Buff's controls continue to use the existing operator panel.

The transport requires **no TURN account, YouTube relay, hosted video account, or
new subscription**. Its spending limit is **$0 additional service charges**. It
still uses the producer's CPU and network upload, and its route must already be
permitted to carry video. One remote receiver requires one copy of the encoded
stream; opening additional previews adds traffic.

Source branch: `rd/buff-http-media-20261021` in
[Strange-Machinery/shanny-rev-live-puppet](https://github.com/Strange-Machinery/shanny-rev-live-puppet).
The exact upstream base is
`6b532677055d73c7120bae17fd848f8805559c09` (the PR13 source).
Record the published branch head actually fetched for deployment. The base SHA
identifies the comparison source; it is not the new implementation's head.

**Windows integration, actual OBS decoding, physical audio output, and Buff's
own-network acceptance remain pending.** Automated tests and the synthetic
FFmpeg fixture exercise the code; they do not establish that the installed MSI
runtime or Buff's browser has passed. The older runtime receipts under
`integrations/background-rain/` verify earlier controls and local playback, not
this HTTP media path.

## Preserve the newer installed runtime

The installed Windows runtime is newer than the repository base. Read
[the background-rain integration notes](../integrations/background-rain/README.md)
and [the voice-dyad-lite integration notes](../integrations/voice-dyad-lite/README.md)
before preparing its overlay. Their manifests record the relevant historical
Windows hashes; compare against the files that are installed now.

Use a fresh review checkout and a separate staging directory. Leave the existing
checkout, private profile, native player, models, voice references, donor ledger,
approved art/music, and launchers in place while preparing the candidate. Do not
run a reset, clean, stash, checkout, or whole-tree copy over the installed source.
Back up the exact files and private settings selected for replacement outside
Git before any runtime change.

The preparation helper performs a read-only inventory of the installed files:

```powershell
node scripts/prepare-http-stage-overlay.mjs --installed 'C:\Actual\Installed\Runtime' --output 'C:\Fresh\HTTP-Stage-Review'
```

Replace both example paths with identified local paths. The output directory
must be fresh. The helper prepares files that are absent or match the exact
upstream baseline, and reports conflicts for touched files with newer contents.
It also provides candidate files for a narrow manual merge. **It does not apply
or install the overlay, launch services, or replace runtime configuration.** A
reported conflict means preserve the installed behavior and merge the relevant
HTTP changes in the staging copy; it does not mean overwrite the conflict.
Review `report.json`, `overlay/`, `review/` and `integration.patch` together.
Exit status 2 means conflicts or missing integration files need review, while
the installed files remain unchanged. Do not install only the conflict-free
portion: validate the combined staging tree before copying any runtime files.

The integration boundary is small enough to review explicitly:

| Files | Purpose in the staged runtime |
| --- | --- |
| `src/http-stage-media.mjs`, `src/http-stage-routes.mjs` | One local publisher, fixed FFmpeg pipeline, bounded media buffers, authenticated receiver routes and playback receipts. |
| `src/http-stage-presentation.mjs` | Visible-frame and rain-completion gates for actual HTTP program receivers. |
| `src/http-stage-proxy.mjs` | Receiver-only hop from the separate remote panel to the existing authenticated loopback host. |
| `src/remote-web/http-stage-player.js`, `http-stage-protocol.js`, `local-media-publisher.js` | Browser recording, HTTP playback, presentation timeline and lifecycle cleanup. |
| `src/real-host.mjs`, `src/stage-media.mjs` | Opt-in initialization, HTTP wait adapters, explicit local ingest role and immediate STOP epoch revocation. |
| `src/remote-panel.mjs` | Static modules, private watch/source links, exact local publisher boundary and receiver routing. |
| `src/remote-web/stage-page.js`, `stage-player.js`, `stage.css`, `panel.js`, `index.html` | Source/watch controls, stream selection and one program audio route. |

In particular, preserve the installed `/live` page, output-owner selection,
background playback readiness, dynamic public origin and Buff link renewal,
Dyad controls, GOLD writer routing, chat controls, singing and STOP behavior.
The new local `ingest` role must remain separate from the installed `browser`
and `obs` output owners. It must never count as Buff seeing a presentation or
hearing the rain soundtrack. When HTTP is disabled, the installed output-owner
behavior must continue to work as before.

## Check the existing route before remote media

A working HTTPS control page proves that authenticated requests can reach the
producer. It does not establish entitlement or capacity for continuous video.
Use the existing allowed route and retain its authentication; no tunnel, account,
firewall, router, subscription, or tailnet policy change is included here.

Cloudflare's [video delivery policy](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/delivering-videos-with-cloudflare/)
explicitly includes Tunnel **public hostname** traffic on Free, Pro and Business
plans, while excluding private-network routes from that restriction. A private
application password or a `trycloudflare.com` address does not by itself turn a
public hostname into a private-network route. Check the actual route and its
current permission before sending show video; this guide does not assume that
the existing public Quick Tunnel is entitled. Policy checked 2026-10-21.

If the already available route cannot carry video within the $0 limit, finish
the local integration and report that precise routing blocker. Do not sign up
for a paid relay or change network policies as an automatic workaround.

## Private configuration and prerequisites

Locate the runtime from its existing launcher and private profile. Keep the same
Node 22+ runtime and an existing FFmpeg executable that has the `libx264` and
`aac` encoders and the WebM/MP4 demuxers. The synthetic codec regression also uses
`ffprobe`, `libvpx`, and `libopus`. Missing tools are a named prerequisite, not a
reason to download models or change the voice environment.

In a **private staging profile**, merge only these fields into the existing
media settings:

```json
{
  "media": {
    "enabled": true,
    "http": {
      "enabled": true,
      "ffmpegPath": "C:/Actual/Existing/Tools/ffmpeg.exe"
    }
  }
}
```

This is a fragment, not a replacement profile. Preserve the current ICE/native
settings and use an absolute verified executable path. HTTP is off by default
when `media.http.enabled` is absent or false. The FFmpeg command is fixed by the
server; no viewer can choose a command, executable, input URL or file path.

Use a separate private scratch/output location for the staged trial. Set the
trial's `donations` to an empty object so it does not load the installed provider
credentials, and keep paid intake and the installed live-chat bridge disabled.
Preserve the private source profile and its credential files. Keep microphone
capture off for these typed/manual tests.
Start at most one actual native player and one voice worker; shut down the
existing owned host cleanly before a staged real-host trial would duplicate it.

The implementation currently targets H.264/AAC at up to 1920 × 1080 and 30 fps,
with a 4 Mbit/s video target and 6 Mbit/s maximum plus 128 kbit/s audio. The media
ring is bounded at 24 fragments / 24 MiB, each receiver aims near the live edge,
and its forward buffer is limited to 6 seconds. These are configured bounds,
not a measured end-to-end latency promise. FFmpeg uses two encoding threads;
measure its effect alongside the real native stage and voice worker on the MSI.

## Pages and receiver roles

| Page or session | Intended use | Can satisfy the HTTP speech/rain gate? |
| --- | --- | --- |
| Local **Start Buff feed** source page (`/stage#source=http&key=…`) | Silent local native receiver and record-only publisher, using the producer operator key. | No. Native role `ingest` never substitutes for remote playback. |
| Panel **Connect preview** | Optional diagnostic picture/sound. HTTP role `preview`. | No. It is excluded from `ready_obs_receivers`. |
| **Open show** (`/watch#transport=http&key=…`) | Buff's ordinary browser view with sound/reconnect controls. | Yes, when its current program receipt proves actual playback of the active nonce. |
| **Copy OBS link** (`/stage#transport=http&key=…`) | Reactive OBS Browser Source, 1920 × 1080, with the view-only key. | Yes, under the same strict playback conditions. |

Both program pages use the protocol role `obs`; that role identifies the selected
program receiver, not proof that an OBS application is running. Receipt checks
still require advancing video/playhead, a present audio track, an unmuted element
with nonzero volume, and the active visible presentation nonce. A successful
download or source upload is insufficient. Physical speaker or OBS-mixer
audibility requires the listening check below.

Use the public/private-network watch or OBS link generated by the remote panel
for Buff. A producer-local `127.0.0.1` URL only opens on that producer computer.
Keep the source page local; publisher ingress rejects remote/tunnel requests
even if they carry an operator key. Fragment keys are credentials, so retain
them privately and do not paste them into evidence, screenshots, GitHub or logs.

The source page receives the native show through the existing StagePlayer path
and records that page's stream; it does not start a second Unity producer. Close
redundant native previews before opening it because the baseline native viewer
limit is two. The source monitor can stay muted while its recorded voice/rain
mix remains active. The HTTP receiver plays the muxed soundtrack and must not
also start a second rain audio element. Use one audible program receiver during
the trial, with any other preview silent.

STOP changes the native control epoch and invalidates the HTTP media epoch.
The source page then requires **Start Buff feed** to be clicked again, even if
a new presentation arrives. A normal presentation end leaves the stream alive
so queued final speech and its hide event can reach the receiver in order.

## One bounded off-air acceptance pass

### 1. Verify the prepared source

Record the fetched branch head, installed-file hashes, candidate overlay and
private rollback location. Review every conflict against the newer installation.
Compare the frozen GOLD files before and after; transport work must not alter
them. In the staging checkout run the HTTP tests once with the existing Node:

```powershell
$httpMediaTests = (Get-ChildItem -LiteralPath ./test -Filter 'http-stage-*.test.mjs').FullName
node --test @httpMediaTests
```

Run the installed output-owner/background-rain/STOP regression tests for the
touched adapters as well. Record any skipped FFmpeg test explicitly. Do not
replace a skipped codec test with a claimed pass or repeat unrelated full model
auditions to validate a transport change.

### 2. Exercise real browser encoding and decoding without the show

The bounded fixture generates a moving test card and quiet alternating tones.
It uses no model, native player, payment source or external service, and writes
no media recording to disk:

```powershell
node scripts/http-stage-browser-smoke.mjs --ffmpeg 'C:\Actual\Existing\Tools\ffmpeg.exe' --duration-seconds 180
```

Open its printed producer URL locally, click **Start synthetic feed**, and open
the separate receiver URL in the intended browser. Enable receiver sound if
prompted. Keep the synthetic producer tab visible, since its animation uses
browser paint callbacks. Observe moving frames, alternating tones and matching
captions. Press **STOP and revoke stream** while playback is active: the receiver
must hide and fall silent, and the status must show a changed epoch with zero
old buffered bytes. Start again and verify fresh media, then let the script's
three-minute deadline close it.

The optional `--self-check` flag verifies only local HTTP boundaries and exits;
it does not exercise a browser decoder. The fixture's status also deliberately
does not claim physical-audio or actual-OBS verification automatically.

### 3. Verify the staged real show locally, with OBS off air

Keep paid intake and chat off. Use a temporary test scene/source in the user's
existing OBS when authorized; leave streaming and recording off. In the local
producer panel click **Start Buff feed**, then open the program watch page or
the HTTP OBS source. Keep the local source monitor and diagnostic previews
silent. For OBS, enable its Browser Source **Control audio via OBS** and verify
the source's mixer/output route through the user's intended monitoring device.

Use manual, non-paid controls for this sequence:

1. **Ordinary synthetic donation/typed response:** the remote presentation must
   be visible and audible before the first voice is released. Observe both
   character voices and captions. The final speech must finish before the
   delayed presentation end hides/mutes the receiver.
2. **Full manual MAKE IT RAIN:** hear one complete approved local soundtrack,
   see the paired choreography, and observe a clean seated return. Repeat with
   the synthetic test's rain option if needed to verify that the first held
   voice waits for the same receiver to play through the source's actual ended
   timestamp. Nominal duration and a producer ended event alone must not release
   speech.
3. **STOP and Shut up during rain/speech:** old queued fragments, captions and
   audio must not reappear. Reloading a viewer must not resume the interrupted
   presentation. Start a fresh feed/presentation explicitly to test recovery.
4. **Receiver failure:** close or disconnect the program receiver during a
   synthetic turn. The host must report interruption/failure; a source page or
   preview must not satisfy its gate. A reloaded receiver or a jump to the live
   edge must not count as finishing the interrupted rain.

Use the actual intended background/covered-window setup for one check. Retain
the installed dedicated browser profile and its existing background playback
settings. Explicitly minimized playback remains a separate observation unless
it is tested. Do not infer Windows browser behavior from mocked DOM tests.

### 4. Verify Buff on his own network through the allowed route

After the route check, Buff opens the generated watch link in his normal browser,
enables sound if requested, and confirms moving picture plus both character
voices and the single rain soundtrack. Keep any OBS broadcast off air. Reuse the
same small manual test set; do not send payments, start real chat intake, or
publish a test stream.

Record the approximate source-to-receiver delay, sustained frame progress,
buffer range, visible/audio synchronization, receipt-confirmed rain completion,
seated-before-TTS ordering and observed STOP delay. The recorder's elapsed clock
timestamps source events. The synthetic FFmpeg test checks preservation of a
delayed audio track, but Windows capture startup, AAC delay and output-device
latency still need this actual comparison. Do not report exact synchronization
or speaker-onset numbers that were not measured.

If Buff is unavailable, mark this step **PENDING BUFF**, while preserving the
completed local results. If the route is not permitted or cannot sustain the
feed, record **BLOCKED ROUTE** without buying or enabling another service.

## Rollback

Press STOP, close the local publisher and trial receivers, and shut down only
the owned staged host. Restore the backed-up private profile or set
`media.http.enabled` to false, then restore the exact reviewed installed-file
set if rolling back the code. Remove only new transport files recorded in that
overlay, after restoring the imports that referenced them. Leave existing
assets, credentials, voice/model files, ledgers and unrelated work untouched.

Restart using the original launcher and verify its original selected output
owner, idle/muted state and disabled chat/paid intake. With HTTP disabled, newly
generated legacy links use the installed WebRTC path; close or replace any old
HTTP-only receiver URL. Do not restore a stale public hostname over a newer
valid one or delete an active ledger/process lock as part of rollback.

## Evidence to return

Return one concise report with the actual branch SHA, installed/staged hashes,
files narrowly merged, test results and skipped tests, browser/OBS/FFmpeg
versions, the route type checked, and PASS/FAIL/PENDING for the four acceptance
steps. Include observed audio ownership, moving frames, rain completion,
seating, final-syllable preservation, STOP/reconnect, and measured delay. State
whether any runtime files were deployed and give the private rollback location
without exposing its contents. No tokens, real donor details, private settings,
model prompts or full credential-bearing URLs belong in the report.

## Bounded prompt for Work

```text
Continue the $0 Buff HTTP video/audio transport from GitHub branch
rd/buff-http-media-20261021 of Strange-Machinery/shanny-rev-live-puppet.
Upstream base: 6b532677055d73c7120bae17fd848f8805559c09. Record the actual fetched
implementation head. Read docs/BUFF_HTTP_MEDIA_DEPLOYMENT.md and the installed
background-rain/voice-dyad-lite overlay notes first.

Do one read-only installed inventory with scripts/prepare-http-stage-overlay.mjs
--installed <identified-runtime> --output <fresh-review-directory>. Preserve the
newer MSI source and private settings. Narrowly merge conflicting host/panel/
stage adapters in a staging copy; preserve GOLD, Dyad, output ownership, /live,
background playback, chat controls, singing and dynamic Buff-link renewal.
Do not reset or wholesale replace the installed checkout or rebuild Unity.

Use an existing FFmpeg, the current native player/voice runtime, a private trial
profile with HTTP opt-in and paid intake/chat disabled, and the existing route
only after verifying it permits video at $0. No TURN/YouTube/paid service signup,
network-policy change, provider reconnect, payment or public broadcast.

Complete one focused regression pass, one bounded 180-second synthetic browser
smoke, and one short off-air real-show pass covering voices, full rain, delayed
final speech, STOP and receiver loss. Deploy only the reviewed narrow overlay
with an exact local backup and rollback set. Keep one audible program receiver;
the local ingest and panel preview must never satisfy the program gate.

If Buff can join, verify the generated private watch link from his own network.
Otherwise report PENDING BUFF. Stop further deployment attempts on a missing
runtime prerequisite, unsafe merge or unavailable $0 route; preserve completed
work and report the precise blocker. Do not spend credits repeating unrelated
model auditions or optional test loops. Return one concise evidence report and
the rollback location; do not claim Windows, OBS or remote acceptance without
observing it.
```

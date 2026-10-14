# STANK TANK AI — live OBS popup and rain-first soundtrack

The upper-left OBS Browser Source is a private view-only webpage at 1920 × 1080.
The producer hosts Unity, Qwen, OmniVoice and Whisper; Buff does not run those
models. The camera is an **opaque 16:9 H.264 stage inside the painted frame**,
not a keyable cutout. The surrounding OBS source remains transparent while
no popup is visible.

## Approved painted artwork and soundtrack

The design is the producer-approved **12-frame painted flipbook** made from
the ImageGen master, with a separate hotmic frame and reduced-motion stills.
All original SVG/CSS fake slime strands have been retired. The branding
reads **STRANGE MACHINERY PRESENTS / STANK TANK AI** and the little
camera bug remains **THE STANK TANK**. The frame is nine-sliced to preserve
the title, donor plates and native 16:9 camera proportions.

The sound is the **user-provided FINAL edited** `Make_it_rain_theme.wav`:
44,100 Hz, stereo PCM16, 23.862426 seconds. The privately delivered local
`rain-intro.mp3` is transcoded at 192 kbps, duration **23.902041 seconds**
including its encoder framing. **No further trimming, fade, or echo was
added to the user's edit.** SHA-256 of the MP3 is:

`edf7c81f86f6ce446066a1d06274a72d7b3e00746c0578d8ad3ed4b143f57cec`

The audio and painted WebP binaries are **not in GitHub**. They are packaged
in the approved offline art+cue ZIP, alongside `RAIN_CUE_MANIFEST.json`.
Install into a *clean isolated review checkout* from PowerShell 7:

```powershell
./scripts/Install-StankPopupArt.ps1 -BundlePath 'C:\Path\To\STANK_TANK_AI_Approved_Make_It_Rain_Bundle.zip'
```

The installer checks all five exact asset SHA-256 values before copying
anything into `src/remote-web/`. An old clip fails integrity checks. Restart
the local preview/producer after installing the assets. The real private
producer server and loopback-only preview both serve the song locally;
no YouTube/player iframe or external audio CDN is used. A missing art asset
falls back to the plain HUD; **the live rain soundtrack still requires
the correctly installed music file**. Browser media autoplay and OBS
"Control Audio via OBS" remain hardware acceptance gates.

## Presentation choreography and speech

### Paid donations of USD $100 or more, checked rain donations

1. Verified payment is accepted once through the durable queue. **USD $100+**
   forces rain at queue admission, even if Buff's usual checkbox is off.
   Amounts in other currencies are not silently treated as USD.
2. **Immediately** send `make_it_rain` to the paired native M16 Unity
   choreography, reveal the popup, and play the song on the browser source.
   No donor TTS is released during the dance/music prelude.
3. While the music/dance runs, Qwen plans the response and OmniVoice
   prepares every held donor-reading/reaction clip. Those are never played
   before actual stage and camera readiness.
4. Wait until **both** the native choreography duration and the **23.903 s**
   MP3 music window have ended, with a small 250 ms boundary guard. Request
   native `seated_response` to put both actors at the desk and rotate the
   camera state; await the Unity command receipt and OBS visible/unmute gate.
   This seated command also stops the rain song. If voice preparation takes
   longer than the music, remain at the desk until preparation is ready.
5. Shanny reads the authentic donation (or Rev when explicitly selected by
   prefix). They deliver the actual validated back-and-forth response.
   Character subtitles appear from actual playback-start/finish receipts;
   Buff's Whisper transcript is **never publicly displayed**.
6. After the final `playback.finished`, send `presentation_end`. The
   browser source hides and mutes, leaving the system idle and ready for
   hotmic or the next donor.

If the native animation is longer than the song, animation safety wins:
speech waits for actual native completion/seat receipt rather than interrupting
the body pose. The known raw local Unity checks are not acceptance of
the finished OBS/streamer setup.

### Ordinary paid donations below USD $100 (checkbox off), hotmic

Prepare the *complete* Qwen and OmniVoice exchange while the popup is hidden.
Once all held clips are ready, show the seated native stage, read genuine
donor TTS (or hotmic reply), react, then hide immediately after final speech.
There is no arbitrary 20-second linger. The optional rain checkbox still
forces rain for smaller donations when Buff intentionally selects it.

### Buff's manual `MAKE IT RAIN NOW!` button

This is a trusted operator-only **non-payment celebration** useful for a
membership bomb. It starts the real paired rain choreography/music when
the stage is armed/available/idle, returns both characters to their seats,
then hides. It does **not** invent a donation, amount, or TTS. STOP/silence
immediately cancels it; STOP remains sticky for automatic provider intake.
The view-only OBS link has no control permission.

## Long donation messages

Paid donor name, amount/currency and message remain text supplied via
`textContent`, not interpolated HTML. The painted donor plaque and message
well are separately composited on top of the artwork. The message well uses
an overflow-clipped viewport that smoothly scrolls **downward** for long
messages; `↓ current/total` shows progress. Frequent WebRTC media-poll
updates do not rewind the scroll. Reduced-motion viewers get discrete
page-position changes instead of smooth animation. STOP, Shut up,
reconnect/hide and replacement by a new donor cancel the scroller and
clear stale text immediately. The browser never deliberately prolongs
a completed presentation merely to finish cosmetic scrolling.

## Safety and acceptance

YouTube authenticated Super Chats, Streamlabs native tips and StreamElements
approved tips all flow through one bounded durable queue with verified
transaction IDs and mirror suppression. STOP disables automatic donations,
while Shut up stops just the current response without disabling already
authorized future alerts. Do not invent provider metadata for membership
events. No credentials are checked into this repo.

The media view-only private link is hosted by the producer's approved
Tailscale Funnel path; a producer-local `127.0.0.1` link does not work
on Buff's remote computer. A TURN relay may be necessary for cross-NAT
WebRTC. The remote OBS audio playback, transparency, stage-camera chair
position, final music end timing and provider-connected tests remain **pending
real hardware/account acceptance**. No changes are required in shared
Unity production engine, DSP or MotionLab to install the browser assets.

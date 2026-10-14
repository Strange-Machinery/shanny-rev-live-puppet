# STANK TANK AI / Buff live — single bounded MSI acceptance packet

**Status: source and synthetic-provider tests only; NOT deployed and NOT
hardware approved.** Source branch: rd/buff-pre-msi-gate-20261014.
This branch stacks on #7 BLACKOUT_MODE, #6 approved soundtrack, #5 painted
HUD, #2 authenticated provider intake, and #3 native stage. All draft;
no separate merger, producer source reset or environment migration.

## Stop rules and preservation

- The producer's existing checkout may contain uncommitted work. NEVER
  stash, reset, clean, checkout or merge inside that source directory.
- Use a new shallow *isolated* checkout under Temp, with the approved
  SHA-pinned painted WebP / edited MP3 ZIP provided locally by the producer.
- Do NOT inspect/store private provider credentials in Codex transcripts
  or GitHub commits. Tokens remain under private local scratch only.
- Do not rebuild/shared-edit the production show engine, MotionLab, DSP,
  episode rendering, assets, likenesses, OmniVoice models or accounts.
- Do not merge PRs, deploy to Buff, start a public stream, send actual
  money, reconnect paid feeds, or create paid events without specific
  separate owner authorization.
- If local disk is too full, STOP and report usage; don't delete caches,
  Unity projects or files as an automatic repair.

## Phase A: source+art dry-run (no accounts, no Unity)

PowerShell 7, producer supplies the existing art/audio ZIP path:

~~~powershell
./scripts/Review-BuffPreMSI.ps1 -BundlePath 'C:\Private\STANK_TANK_AI_Approved_Make_It_Rain_Bundle.zip'
~~~

Review-BuffPreMSI clones a new branch, pins/checks the exact five
approved asset hashes before copying, runs all Node 22+ regression
tests plus offline Python tests, and leaves the producer's work
unmodified. Optional -OpenPreview starts a loopback 1920x1080
visual-only source on port 18785; keep the command window open.
Open the printed localhost URL in Chrome/Edge ON THE MSI.

## Phase B: inspect Unity host and native abilities (isolated project)

- Unity baseline: 6000.3.23f1 / URP 17.3 / Cinemachine 3.1.7.
- Verify the isolated native stage has both approved rigs and the M16
  paired rain, native seated_response chair/camera return,
  conversation banks, face/blink, actual OmniVoice lips/jaw and
  final hand/finger body owner.
- Verify distinct SHANNY and REV middle-finger camera gestures from
  the draft BUFF_M16 source. Inspect shoulder, elbow, wrist, extended
  middle/curl of other fingers, camera-facing palm, seating/feet,
  face/eye expression and clean timed rest. Do NOT claim complete
  from source tests alone.
- Verify the actor speaks, then the gesture enters; it must not
  steal the voice or overlap paired rain. In a rage situation
  the physical gesture is earned, not automatically triggered by
  profanity in quoted raw donor TTS.
- Record screenshots and exact source/player builds if rendering
  actual native preview. Prefer no full Unity rebuild unless required
  for the isolated source changes; never build into producer runtime.

## Phase C: actual LOCAL OBS acceptance (no paid accounts)

- Use user's own OBS Browser Source, 1920x1080, upper-left,
  transparent outside painted boxed frame, embedded 16:9 H.264 stage.
- Ensure one audio route, correct Browser Source "Control Audio via
  OBS", no doubled monitor/preview music. Inspect full 23.862-second
  user-edited clip (23.902-second delivery MP3 with framing).
- Manual Test donation under $100: FULL held Qwen and OmniVoice
  preparation while hidden; reveal seated, TTS read, angry rebuttal,
  exact final speech receipt hides/mutes.
- Authenticated real $5 paid event: if OBS video has not acknowledged
  a visible/unmuted frame, held TTS must NOT release; the producer
  sees a failure instead of claiming the unseen donation was played.
- Paid-threshold synthetic $100: native rain appears FIRST,
  OBS media-presented receipt → actual audio.play() start receipt →
  exact audio.ended receipt. Qwen and all OmniVoice clips prepare
  DURING the dance. No first TTS until actual audio-ended,
  native seated_response command receipt, and renewed OBS visual
  acknowledgment. Then TTS, SHANNY/REV replies and hide.
- Test 1000-character message: stay at top during dance, scroll
  downward in readable clipped message plaque after seating,
  without covering subtitles or losing donor identity.
- Manual MAKE IT RAIN NOW: celebration has no fabricated donation,
  no donor amount or fake TTS, plays full song/dance, seats and
  returns idle.
- Test STOP or "Shut up" mid-music: stop audio, reset browser
  state, clear captions, prevent late music promise/nonce or
  stale Qwen/audio generation. STOP sticky; Shut up preserves
  next-donation feed only when previously authorized.
- Drop remote receiver during rain: NO fallback to timer-only
  overlapping TTS. Check reconnect and known failure status.
- Automatic paid-feed Enable must reject a missing authenticated OBS
  viewer. After a temporary viewer outage, accepted queued payments
  must wait for reconnection instead of being silently consumed.

## Phase D: optional authorized Streamlabs/StreamElements accounts

The producer has access to some test logins. **ASK FOR EXPLICIT
AUTHORIZATION BEFORE USING THEM**, then use only the personally
approved account in the private scratch config. Show scopes,
connected state, and the operator's NON-PII provider packet counters
while using normal dashboard Test Alert/emulator features.

An overlay alert that appears in Streamlabs/StreamElements need
not reach their Socket API or Astro channel.tips. Treat visually
successful dashboard-only mocks as Level-1 evidence, not a
Level-3 verified paid event. Never make a charge on behalf of
a user or streamer in the name of a smoke test without approval.
YouTube remains provider-specific UNVERIFIED; its rendering path
is shared but OAuth/live chat is not.

See docs/BUFF_ACCOUNT_TEST_READINESS.md for exact distinction,
private config and action matrix.

## Acceptance evidence

Return a **single concise report** with:

1. Exact isolated checkout commit, native Unity build identity,
   art/audio hashes and which tests were actually executed.
2. Measured OBS/WebRTC frame-rate/quality, audio start/end delay
   from accepted media receipts, Qwen preparation time, duration
   from rain start to seated, delay from seated to audible TTS.
3. Four local screenshots/captures: normal donation, rain,
   seated+long TTS scroll, approved camera flip for each actor.
4. PASS/FAIL/BLOCKED for music ended-before-TTS, body pose/gesture
   release, STOP/interruption, long text, browser autoplay,
   provider mocked vs authenticated status, remote OBS (if used).
5. Non-sensitive logs and precise remediation for blockers.
   No access tokens, passwords or real donor private details.

**End gate:** Only an isolated local production-quality acceptance can
justify reviewing the stacked draft PRs for integration; never
merge/deploy based on Node/Python tests alone.

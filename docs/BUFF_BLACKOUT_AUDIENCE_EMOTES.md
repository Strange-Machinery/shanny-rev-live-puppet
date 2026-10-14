# Buff live BLACKOUT_MODE: arguing with chat and camera-middle-finger reaction

## Contract

This isolated Buff live prototype stages the **fictional adult** SHANNY
in BLACKOUT_MODE. Both Shanny and Rev are **surly, ungrateful, combative
and reluctant to entertain chat**. They argue with the actual premise of a
comment, and often bicker with one another, rather than politely thanking
donors. Rev is not forced to appease Shanny whenever she rages. The
producer's private character treatment is still authoritative.

The **authentic donor/TTS message is always read verbatim** by its selected
actor. The Qwen-generated reply follows; its text and speaker mood are
validated under the existing one-sentence-per-line JSON contract. No
additional or invisible stage-direction text is read aloud. The actor's
spoken line, not a quoted audience comment, may motivate physical escalation.

Strong anger can be expressed through a look, a restrained objection or
stillness. **A middle finger is earned rather than constant.** When a
played SHANNY or REV line directly attacks the audience ("fuck you,
chat", "screw you, audience", or rage directed at a viewer's accusation),
the camera flip gate may ask the native stage for the flip_camera action:
one speaker, at most once per response, at most every 20 seconds.

No gesture is inferred from the raw donor text, amount, the microphone
transcript, Qwen thought text, or an out-of-context profanity. Insults
clearly aimed at Rev/Shanny are not treated as camera address. Mood
must be the final validated angry/rage/irritated speaker state. No
audience request can send a gesture command by embedding it in TTS.

## Native owner and timing

The live camera gesture is an **isolated extension of the existing
EpisodeBodyActionPlayer**, behind the BUFF_M16 define. It calls the
engine's **pre-existing calibrated SampleHands middle-finger pose**;
the other fingers curl as the middle stays extended. There is no
duplicate skeleton, independent animator, new downloaded clip or
modification to the shared production engine.

The live stage takes this action only while the corresponding character
is visibly seated **and audibly speaking**. The palm is biased toward
the native stage camera while the right arm raises briefly. The 2.3125
second hand cue includes a smooth entry, peak hold and natural release.
It yields to full-body make_it_rain, to STOP, to scene reset and to a
subsequent M16 bank. Finger rest is explicitly restored at gesture end.

The host waits for the optional native command receipt before advancing
the response/end-of-stage sequence; **the voice has already started**,
so the gesture handshake never holds initial TTS. If the local MSI Unity
player has not been rebuilt with the isolated source extension, the
gesture is skipped without corrupting the donation or interrupting speech.

The OBS WebRTC view-only link cannot request arbitrary stage motions;
only the producer's trusted selected reply may originate this command.
The action is not a payment, does not arm provider intake, and never
changes the visible donor/money-rain mode.

## Verification boundary

Node tests verify director instructions, actual-spoken-line classifier
eligibility, partner-directed and unmotivated profanity denials, cooldown,
speaker-locked native signaling, rain exclusion, donation preservation
and interruption behavior.

**Native Unity validation remains pending** on the producer's isolated
Unity/MSI test player: first check SHANNY and REV independently in their
actual fitted seated rig, with 30 fingers each, see that the raised right
hand is visible and camera-facing, then check elbow/wrist contact, no
shoulder penetration, leg/seat support, head/eye gaze, speech lip sync,
return to idle, STOP during gesture, rain takeover, and actual OBS frame
composition/FPS. No Unity build, scene, shared engine source or real
producer install is modified by this GitHub-only review.

This is a draft capability, **not already proven in the native player**.

# Architecture and R&D plan

## Minimal vertical slice implemented in source

~~~text
Authenticated POST /v1/speak
 -> bounded one-worker queue / panic epoch
 -> mock voice OR persistent OmniVoice complete WAV
 -> strict WAV validation / bounded in-memory cache
 -> speech.ready event / authenticated audio GET
 -> Unity LivePuppetClient + character-specific AudioSource
 -> direct waveform/spectrum driven face + operator OBS capture
~~~

The existing private engine's LIVE subproject contains much broader
show logic. This prototype intentionally does not copy that chat scheduler,
Rhubarb stage protocol or episode Timeline.

## Donation read + reaction (next)

- Ingest trusted donation text and recognize an optional leading (shanny)
  or (rev) tag, with SHANNY default.
- Start the selected voice reading donation text. While it is audible,
  ask Qwen for a bounded 8–12-second response to the donation.
- Validate explicit actor, text, emotion tags and delivery mode. Never
  permit arbitrary C# commands or scene hierarchy paths from Qwen.
- Prepare the reaction while the reading is playing, then play it when
  the donation ends, subject to expiry and current operator override.
- Use playout acknowledgments to observe AudioSource start and keep
  dialog synchronized; current event readiness does **not** imply playout.

## Buff speaks / Whisper listens (later)

- Only ingest Buff's isolated microphone channel, not the mixed
  OBS output containing Shanny and Rev.
- Use voice activity detection to mark utterance boundaries before
  Whisper/faster-whisper; debounce partial transcripts.
- Qwen receives a limited recent dialogue window and outputs a validated
  actor turn; output goes through the exact same voice/stage gateway.
- Support manual mute, interruption and stopping stale text; do not
  self-trigger the characters from their own TTS.

## Blackout Shanny personality R&D

Keep character modeling separate from playout. Start with curated
speaker-attributed, authorized dialogue; prompt/few-shot test first,
fine-tuning only if held-out cases demonstrate failures. Evaluate
grievance loops, defensiveness, digressions, interrupt patterns and
distinctive language without treating alleged real incidents as fact.
Neither weights nor private reference recordings live in this repo.

## Hardware and latency

Complete-WAV worker stays warm; the current protocol cannot provide audio
before synthesis is complete. Optimize short utterances and prepare during
earlier TTS playout. Real PCM chunk streaming is a later research lane.
Capture request-to-ready, download/decode, Unity audio-start, first audible
output and total spoken duration as separate timestamps. Stress the actual
GPU configuration before co-locating Qwen, Whisper, Unity, OmniVoice and OBS.
Never expose the local HTTP host on the internet; remote Buff playback
needs a purpose-built authenticated, encrypted relay.

# Next work: Buff's isolated microphone and sustained offline conversation

Start in the installed Testing tab; no YouTube session is involved. Local Whisper
small.en CPU configuration is prepared privately on this machine. The default
response and WAV path stays a clearly labelled fixture until private services are selected.

1. **Qualify the actual selected input.** Use push-to-talk first, headphones, the
   input meter and final transcript. Check quiet speech, clipping, keyboard noise,
   physical output echo, device removal, Windows permission denial, repeated arming
   and Stop while holding the button. Stop must disarm and release the device; a
   reconnect cannot arm it. Name filtering is only a guard, not isolation proof.
2. **Qualify VAD offline.** Current test energy VAD uses 100-ms chunks, RMS 500,
   two speech chunks and seven trailing-silence chunks; Whisper also applies its
   own model VAD. Tune against Buff's microphone instead of treating those defaults
   as acceptance. Auto VAD waits for pending response/audio completion. Preserve the
   distinction between test file/replay/microphone provenance and production admission.
3. **Make accepted Whisper resident.** The present CPU/int8 file worker loads the
   pinned local model per turn. Retain one worker after acceptance, bound PCM and
   final-text queues, carry utterance IDs/VAD boundaries/session/mode epoch, and
   cancel/discard late completions. Never transcribe OBS mix or let partials trigger TTS.
4. **Qualify the two target Qwen models.** Use external Blackout Shanny/Rev persona
   notes, strict JSON and existing token/time limits. Prefer local CPU or off-device
   inference until real GPU coexistence is proven. Offline mode requires a local
   endpoint. Do not swap the installed unrelated writer model into the experiment.
5. **Sustain a character conversation.** Bound speaker-attributed Buff/character
   history, unresolved topic, emotional state, context revision and interruption.
   Commit history only after successful audible playback, not generation or release.
   Current test context holds up to eight completed character turns and omits fuller
   dyad state. Add context/version acceptance before unattended conversation.
6. **Connect the accepted production adapters.** Implement actual local Unity stop/
   resume and player playhead access using inspected APIs. Test Stop during capture,
   VAD, ASR, Qwen, TTS, download and playback, including lost acknowledgements, restart,
   barge-in and device loss. Do not expose a production microphone control before
   this path passes. Keep the existing episode generator unchanged.

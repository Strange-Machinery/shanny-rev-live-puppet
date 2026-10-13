# Next work: Buff's launcher and Qwen donation reactions

The requested experience is one launcher: request a bot-generated episode, see its job status and a private expiring download link; switch to **Live response** for a conversation with the puppets; press **Shut up — resume show** to cut both puppets off and return to the episode. Keep the existing episode service and delivery pipeline. The standalone live gateway supplies speech and puppet control, not episode rendering.

`contracts/next-stage.v1.schema.json` defines versioned donation, final microphone transcript, reaction, launcher action, and episode delivery messages. These are prepared interfaces, not installed integrations. The present Unity button stops the puppets; controlling Buff's actual episode player remains a launcher adapter task.

## Priority 0: acceptance and stop authority

Qualify both real voices in the real rigs, plus panic during download/playback, independent simultaneous speech, and Shanny interrupting Rev. Keep the stage and worker resident. Measure under OBS load before adding Qwen. The operator always outranks automated responses. A local panic stops AudioSources synchronously; the gateway latches mute until `/v1/resume`. A network failure must never reopen the microphone or unmute by itself.

## Priority 1: launcher adapter

Find Buff's existing launcher and episode job API. Add Episodes and Live response controls there. Episode requests return job IDs; the launcher polls or subscribes to existing delivery status and offers the private download link only when ready. Validate links against the configured delivery service and display expiry/retry states. Do not move assets into the live repository or make a public bucket.

On live enable: explicitly opt into the isolated mic device, pause the episode through its adapter, establish a new session/mode epoch, clear pending reactions, resume the live gateway, then enable VAD. On show resume: stop local AudioSources first, close mic/VAD admission, increment mode epoch, invalidate Whisper/Qwen/TTS results, POST panic and wait for stop acknowledgement, then resume the episode adapter at its retained playhead. If stopping cannot be confirmed, keep the episode resume pending and offer a local force-stop; do not let stale dialogue overlap it. Make this one obvious button plus a configurable operator hotkey. A repeat press is idempotent.

The live enable control must stay unavailable until the microphone/Whisper adapter is actually installed. Do not show a fake working toggle. No capture or stream publishing is triggered by enabling puppets.

## Priority 2: donation read and reaction

Parse only an optional leading `(rev)` or `(shanny)` token, case-insensitively, after leading whitespace. Remove exactly that token; default to SHANNY. Empty remainder is rejected; parentheses elsewhere are spoken text. Dedupe donation_id and enforce size/rate limits. Preserve the donation as untrusted quoted input, never persona instructions.

Submit its read to the voice gateway. On the stage `started` receipt, invoke Qwen while the donation is playing. Ask for one validated 8–12-second reaction, with explicit actor, persona, emotion, intensity and expiry. The duration field is a target: check actual generated WAV duration before delivery. Never invent a measured duration from word count. Keep a short output/token budget and reject unknown fields. Schedule only after the donation's `finished` receipt. Drop late, superseded, interrupted or wrong-epoch output. Avoid running extra model copies on the 8 GB GPU; measure coexistence first and consider CPU/off-device Qwen if GPU pressure harms Unity or OmniVoice.

Tests: default and tagged readers; duplicate donations; overlapping reads; late Qwen; panic during generation; resume-show during ASR; stale model completion; unavailable delivery links; episode resumes once with its playhead intact.

## Priority 3: Buff microphone and persona context

VAD ingests only Buff's isolated microphone, never OBS mixed output. Whisper emits final utterances with VAD boundaries, source ID, session and mode epoch. Partials must not trigger voices. Push-to-talk is a useful initial fallback. Include an operator-visible mic state and device failure state.

Keep Blackout Shanny and Rev persona data private and separate from transport. Persist bounded argument context: speaker-attributed recent turns, unresolved topic, emotional state, last interruption, and revision. Qwen may propose interrupt/queue and emotional performance; the deterministic director validates expiry, actor/persona pairing, current context revision, and operator authority. It cannot execute tools, scene paths or commands. Successful audible turns update context; cancelled drafts do not become spoken history. Recover after restart in muted mode.

Do not implement the complete Whisper/Qwen pipeline before basic real-voice acceptance passes. This packet defines the next implementation boundary and does not claim that pipeline exists.

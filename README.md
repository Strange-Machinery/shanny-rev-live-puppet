# Shanny & Rev Live Puppet

The producer uses **Producer Setup.exe**; models and inference stay on that computer.
Its **Connect Buff** tab starts authenticated HTTPS testing and creates a tiny
**Buff Launcher.url** for Buff's browser. Buff does not install Whisper, Python,
Node or models. Local offline testing stays available without sharing. See
[button-only deployment](docs/EASY_DEPLOYMENT.md) for the current testing scope.

v0.3 adds the executable donation/Qwen runner and an **offline Testing tab** for
donations, microphone push-to-talk/VAD, Whisper, transcript replay and local responses.
Developers can run `python python/easy_testing.py` or `npm run demo:offline`; no YouTube session is
required. See [setup and configuration](docs/BUFF_LIVE_V03.md),
[verification and remaining acceptance](docs/ACCEPTANCE_V03.md), and
[microphone continuation](docs/MICROPHONE_NEXT_WORK.md). Private full-model testing
is explicit opt-in; the default response/stage path is a labelled fixture.

Private standalone live stage: one authenticated localhost Node gateway, one persistent complete-WAV OmniVoice worker, and two continuously loaded Unity puppets. Each face follows its own actual playing AudioSource. No Rhubarb, Timeline, Recorder, episode rendering or per-utterance video is used.

The fresh root commit imports exactly 17 files from engine prototype commit `e1d8986477986cd2e710baa531ac111dcf43d464`; it contains no production Git history. Production assets, model weights and approved voice references remain external.

## Run and test

Requires Node 22+. No npm dependencies to install.

```powershell
npm test
$env:LIVE_PUPPET_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$env:LIVE_PUPPET_PROVIDER = 'mock'
npm start
```

Mock audio is a synthetic tone, not either character voice. Start Unity with the same token environment variable. For real speech, configure the six OV_* runtime values described in [local setup](docs/LOCAL_SETUP.md) and use LIVE_PUPPET_PROVIDER=omnivoice.

Normal requests queue per actor. An explicit interrupt stops both actors' old speech and prioritizes the new request. Panic immediately stops local audio and latches gateway mute until explicit resume. The client rejects stale sessions/epochs, bounds its queues, and refuses non-loopback endpoints and redirects. Tokens are never serialized into the Unity scene.

[Protocol](docs/PROTOCOL.md) · [Local setup and hardware test](docs/LOCAL_SETUP.md) · [Validation](docs/VALIDATION.md) · [Streaming investigation](docs/STREAMING.md) · [Buff launcher and next-work packet](docs/NEXT_WORK.md)

The launcher/Whisper/Qwen interfaces are prepared contracts; their full pipelines and episode-player handoff are not implemented here. Never treat passing mock tests or CI as proof of actual audible or visible Unity playback. Hardware evidence is reported separately.

Measured hardware acceptance and remaining limits: [RESULTS.md](docs/RESULTS.md).

## Experimental donation pre-generation branch

This feature branch includes a backwards-compatible, held-WAV prepare/release path and source-only donation/Qwen reaction coordinator. It is not connected to Buff's donation service, OBS, microphone or episode launcher. See [donation pre-generation](docs/DONATION_PREFETCH.md) and the new fixture tests before deployment.

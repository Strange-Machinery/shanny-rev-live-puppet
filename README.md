# Shanny & Rev Live Puppet

**Independent, stripped-down live stage prototype.** A warm voice worker supplies
speech WAVs to two always-running Unity actors; the actors' AudioSources drive
their mouths in real time. This is **not** the episode renderer.

> **Temporary GitHub staging:** Until a dedicated private repository is created,
> the project is held on an isolated branch of the private Shanny/Rev engine.
> The branch has its own complete project root and must **not** be merged
> wholesale into the production main branch. Transfer this root to a new
> private repository for permanent development.

## Current implementation

- Node.js built-in modules only; no external runtime dependencies.
- Authenticated, loopback-only gateway with bounded speech queue.
- Two voice backends: audible mock tones and the already-existing persistent
  OmniVoice Python worker, which stays loaded between requests.
- Strict PCM16 mono 48 kHz WAV validation; expiring in-memory clip cache.
- Unity 6 MonoBehaviours for continuous scene playback, per-actor ordered
  queues, voice-driven jaw and optional spectral mouth controls.
- Manual panic method, stale-response rejection and measured audio readiness.
- Node tests and six-line latency probe.

**Not yet proven:** actual Unity compilation and rig hookup, Buff's OBS
setup, genuine OmniVoice performance, GPU coexistence, natural-looking
visemes, or live human conversations. The current production OmniVoice
worker returns a **complete WAV**, not incremental streaming audio.

## Start in mock mode

Requires Node.js 22 or newer.

~~~powershell
$env:LIVE_PUPPET_TOKEN = [guid]::NewGuid().ToString("N")
$env:LIVE_PUPPET_PROVIDER = "mock"
npm test
npm start
~~~

The service listens only on 127.0.0.1:8770. In a second PowerShell console
with the same token:

~~~powershell
$h = @{ Authorization = "Bearer $env:LIVE_PUPPET_TOKEN" }
Invoke-RestMethod http://127.0.0.1:8770/v1/status -Headers $h
Invoke-RestMethod http://127.0.0.1:8770/v1/speak -Method Post -Headers $h -ContentType "application/json" -Body '{"actor":"SHANNY","text":"Buff, did you hear what he said?","delivery":"interrupt"}'
npm run bench
~~~

The test voice is an audible synthesizer placeholder, **not Shanny or Rev**.

## Hook up the Unity scene

1. Copy the two C# scripts from
   unity/Assets/ShannyRevLivePuppet/Runtime/ into an isolated folder in the
   existing Unity 6000.3 project. Do not replace EpisodePlaybackController.
2. Attach LivePuppetActor to each character GameObject. Assign a dedicated
   AudioSource, face SkinnedMeshRenderer, and the rig's **actual** jaw
   blendshape name. Wide/pucker are optional and may remain blank.
3. Create an empty GameObject with LivePuppetClient; assign both actors,
   server endpoint, and the runtime-generated token. **Do not commit a
   production token in a Unity scene or prefab.**
4. Leave Unity playing while POST /v1/speak is called. It should fetch the
   WAV, play audio, animate that actor's face, and return to idle.
5. Expose LivePuppetClient.Panic() as an operator UI button and configure a
   secondary hardware/hotkey stop that calls POST /v1/panic.
6. Capture the continuously running Unity scene into OBS; no per-line video
   render or Recorder pass.

The initial jaw movement is amplitude-driven, not phoneme-accurate. The
production rig and real face shape selection require an MSI acceptance pass.

## Real, persistent OmniVoice (complete WAV)

Reuse the private source worker at
LIVE/python/omnivoice_live_worker.py from the production engine. Its
source code, pinned Python runtime, saved-reference IDs and model material
remain under local production control. Configure only with environment
variables; never commit speaker reference assets or absolute private paths.

~~~powershell
$env:LIVE_PUPPET_PROVIDER = "omnivoice"
$env:OV_PYTHON = "C:\path\to\python.exe"
$env:OV_WORKER_SCRIPT = "C:\path\to\omnivoice_live_worker.py"
$env:OV_APP_ROOT = "C:\path\to\production\outputs\app"
$env:OV_OUTPUT_ROOT = "C:\path\to\temporary\live-puppet-audio"
$env:OV_SHANNY_REFERENCE = "approved_local_shanny_reference"
$env:OV_REV_REFERENCE = "approved_local_rev_reference"
npm start
~~~

Warm the worker before going live and measure actual first-audible latency.
There is **no** complete-WAV-to-streaming shortcut; true chunk streaming
requires a real streaming voice source and separate ring-buffer integration.

## Principles

The Unity layer does not run Qwen, Whisper, voice generation or Discord.
Keep all gateways local and authenticated. Do not bind the API to public
interfaces. This repo contains **no** private corpus, character models,
saved voice prompts or model weights.

See docs/PROTOCOL.md, docs/ARCHITECTURE.md and docs/VALIDATION.md.

## Current implementation

See [LOCAL_SETUP.md](docs/LOCAL_SETUP.md) for environment-based token handling, private rig hookup and hardware acceptance, and [NEXT_WORK.md](docs/NEXT_WORK.md) for Buff's unified episode/download/live-response launcher contract. Panic is latched until explicit resume. Interrupt cuts both actors' queued speech. Playback receipts and stage heartbeat now measure the actual Unity path.

The earlier Inspector-token instruction above belongs to the imported prototype: the current client instead reads LIVE_PUPPET_TOKEN from its process environment so tokens are not saved into scenes.

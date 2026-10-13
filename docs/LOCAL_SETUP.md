# Local setup and operator controls

Use Unity **6000.3.23f1**, URP **17.3.0**, and Node 22 or newer. No installer, driver update, model download or production episode edit is required by this repository.

## Gateway

```powershell
Set-Location <private-checkout>
$env:LIVE_PUPPET_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$env:LIVE_PUPPET_PROVIDER = 'mock'
npm start
```

Start the Unity player from a shell carrying the same token environment variable. Tokens are read at runtime and are never serialized into scenes. The server and Unity accept only loopback HTTP. The generated token printed by the standalone CLI is a local convenience; prefer a launcher-provided environment token.

## Private rig hookup

Work in a disposable copy of the project, not the episode project. Copy this repository's `unity/Assets/ShannyRevLivePuppet` folder into its Assets. Keep the approved character meshes, materials and their dependencies outside Git.

For manual setup, create a separate live scene with the existing Shanny and Rev visual hierarchies loaded together. Disable their episode scheduling, mouth/expression writers and animation controllers that write the same face. Give each its own non-looping, playOnAwake-disabled, 2D AudioSource. Add LivePuppetActor to each character and assign the AudioSource, face renderer and an exact verified shape name. The actual inspected source scene used Shanny_Body/Jaw_Open and CC_Base_Body/jawOpen. Inspect again if character assets change. Optional wide/pucker shapes default blank; no names are guessed. Assign both actors to one LivePuppetClient and add LiveOperatorControls.

The editor builder `LivePuppetBuild.Build` automates a minimal isolated fixture from a private copied scene with SHANNY CHARACTER and REV CHARACTER descendants. It strips episode behaviours, retains visual rigs, verifies actual jaw shapes, writes a local full inventory and builds `Build/LivePuppet.exe`. This is a functional fixture, not the final staged broadcast composition. Run only in a disposable project because the builder saves Assets/LivePuppet.unity and sets that project's rendering/build settings.

```powershell
$env:LIVE_SOURCE_SCENE = 'Assets/FullPerformanceCandidate/Scenes/ShowEventStage.unity'
Start-Process '<Unity-6000.3.23f1>\Editor\Unity.exe' -WindowStyle Hidden -Wait -ArgumentList @('-batchmode','-quit','-projectPath','"<isolated-project>"','-executeMethod','LivePuppetBuild.Build','-logFile','"<private-build-log>"')
```

The operator button immediately stops both local AudioSources, then latches gateway mute. `/v1/resume` explicitly re-enables admission. The button does not yet control an external episode player. Wire the same public Panic() method to a launcher/hardware stop; wire the episode handoff described in NEXT_WORK.md before advertising resume-show integration.

## Existing OmniVoice runtime

Set OV_PYTHON, OV_WORKER_SCRIPT, OV_APP_ROOT, OV_OUTPUT_ROOT, OV_SHANNY_REFERENCE and OV_REV_REFERENCE to the existing approved private runtime and reference IDs. OV_OUTPUT_ROOT must be a private writable scratch folder, separate from production outputs. Set LIVE_PUPPET_PROVIDER=omnivoice. No voice asset or model belongs in this repository.

```powershell
$env:LIVE_PUPPET_PROVIDER = 'omnivoice'
# Set the six OV_* values from your existing approved runtime configuration.
$env:LIVE_PLAYER = '<isolated-project>\Build\LivePuppet.exe'
$env:LIVE_EVIDENCE_ROOT = '<private-scratch>\live-evidence'
node scripts/acceptance.mjs
```

The acceptance runner starts a private ephemeral gateway and Unity player, checks synthetic audio first, then runs both real speakers. It closes its own player and worker afterward. Optional LIVE_CAPTURE_ROOT enables diagnostic stills; it does not record videos. First physical audible output requires a separately calibrated audio capture; AudioSource.Play/ACK does not establish that timestamp.

For OBS, capture the continuously running player window or game. No utterance video generation or encoding occurs in the puppet pipeline. OBS capture/coexistence must be tested separately before a live broadcast.

## One-command launcher
Copy docs/demo-config.example.json to an ignored *.local.json file and fill in the approved local paths. Run scripts/start-demo.ps1 -Config <private-config.local.json>. It warms the existing OmniVoice worker before opening the interactive player, generates a session-only token, and stops its own gateway/worker when the player closes. Use -Provider mock for synthetic audio. The demo provides typed speech for either speaker, an interrupt toggle, and an immediate stop button. Microphone capture is not enabled.

The isolated fixture also needs the source shaders' relative HLSL/CGINC includes, the approved standing-hold clips, and the serialized per-actor demoFacingYawDegrees from the source scene. Copy those dependencies with the assets. The builder samples those existing poses once and preserves their authored facing angles; it does not run an episode animation pipeline. The stage targets 30 FPS to leave GPU capacity for speech.

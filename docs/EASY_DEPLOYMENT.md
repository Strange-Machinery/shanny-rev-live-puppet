# Button-only Windows testing

The producer double-clicks **Producer Setup.exe**. Do not send this model bundle
to Buff. All inference stays on the producer's computer.
Setup extracts privately under the current user's LocalAppData, validates its
payload hash, checks its bundled runtimes and CPU Whisper, creates Desktop and
Start Menu **Producer** shortcuts, and opens the app. Python, Node, internet,
model downloads and configuration editing are not required for local testing. Windows x64
and 2.2 GB free disk space are required. This locally built executable is unsigned;
Windows may show an unknown-publisher prompt. It is not an authenticated public
release or an auto-updater.

## Buff's lightweight launcher

In **Connect Buff**, click **Share testing with Buff**. The app uses the producer's
existing signed-in Tailscale installation, checks for an unused sharing setup,
starts a narrow local testing bridge and a foreground HTTPS Funnel, and verifies
the authenticated public connection before writing **Buff Launcher.url**. Click
**Open Buff launcher folder** and send that file to Buff. Buff double-clicks it;
his ordinary browser is the launcher. He does not need Tailscale or any model/runtime.
First-time Funnel authorization, if required, opens Tailscale's own approval page.
Tailscale's [Funnel command](https://tailscale.com/docs/reference/tailscale-cli/funnel)
provides the HTTPS transport. No sharing is enabled by installing or opening the app.

The private launcher carries a random access key in its URL fragment. It is a
credential: share it only with Buff. The browser removes the fragment from visible
history and uses authenticated requests. The key persists locally so the file
works after the host restarts. It is never committed. Closing sharing removes
access; rotating the local key and regenerating the launcher revokes old copies.

Buff's microphone stays off until he presses Test microphone and grants browser
permission. Finished PCM utterances go over HTTPS to producer-side Whisper and are
deleted after processing. Buff receives transcription/test results. The browser
stops capture on Stop, page close, or detected connection loss. The server stops
the testing stage when its active session goes 15 seconds without status polling.
No user-selected server file paths, shell commands, production donations or
arbitrary proxy URLs are accepted by the remote interface.

**Current scope:** remote test controls and microphone-to-producer transcription.
Production episode commissioning/delivery, streamed character audio/video, and
live-show switching are still unconnected and are not presented as working. Local
tests validate the remote boundary, authentication, audio cleanup and stop races;
the public Funnel and Buff's actual browser/microphone still need end-to-end acceptance.

The app starts only the muted, local testing services. Click **Test donation** or
**Test typed response**. For a microphone test, select an input if necessary, click
**Test microphone**, speak, and click **Finish recording**. **STOP** cancels speech,
pending work and capture. Nothing records just because the app opened. Headphones
and an isolated input are recommended directly beside the input selector.

The producer package includes real offline CPU Whisper small.en and Windows generic TTS.
Qwen replies, character WAVs and episode/stage playback remain labelled fixtures.
Real character services and Buff's accepted production-player adapters still need
their private integration and hardware acceptance. This installer does not install
Unity, private voice references, personas, Qwen, OBS or the episode production
pipeline, and does not advertise them as ready. The normal show is not deployed.

Opening the original Studio's Testing tab now shows the same easy home with an
Advanced tests tab. Its source installation uses the existing private config.
The standalone distributable generates its own Whisper paths after extraction;
it contains no author-machine paths or credentials. Advanced test configuration
remains available for engineering acceptance, not required for basic tests.

Reopen the installer to repair or install a newer copy. Each installation uses a
fresh directory, validates before moving the shortcuts, and preserves old versions.
There is no automatic deletion, automatic update download, or production change.
The installed shortcut enforces one app instance per Windows session. Closing
the app closes its owned backend; it never kills unrelated Python/Node processes.

## Animation controls

The producer home and Buff browser panel have **Animations → Shanny / Rev / Both
→ category → context → gesture**. Menus come from the existing MotionLab repertoire;
they do not invent or approve clip names. The source installation reads the current
catalog on each menu request. The portable installer carries a metadata snapshot
selected at packaging time; it does not auto-sync MotionLab changes or include mocap
assets. Rebuild the package when its catalog needs refreshing.

Entries remain unavailable until the catalog declares compatible actors/bindings
and an accepted player adapter confirms support. The current testing package has
no animation player adapter, so browsing works and playback stays disabled. A
runtime-candidate label alone is not evidence of complete-body mocap approval.
The player contract submits Both in one batch with one start time, context,
session and epoch. Catalog changes invalidate old selections; Stop aborts pending
commands and calls the adapter's immediate stop hook. This is control integration,
not a claim of visible Unity/OBS playback. MotionLab M16 still owns clip definition
and qualification.

Set the private `animationCatalog` path to the producer's repertoire for development.
Pass `--catalog REPERTOIRE_JSON` to the package builder to include sanitized menu
metadata. Neither step is part of Buff's setup.

## Package construction

`scripts/build_windows_package.py` uses an existing Python 3.12 environment with
faster-whisper, an existing Node 22+ executable, an existing small.en CTranslate2
model, Microsoft's .NET Framework C# compiler, and official Node/Whisper license
files. It copies only the application allowlist and dependency-distribution files,
includes licenses and a per-file SHA-256 manifest, then appends the archive and
integrity footer to a per-user installer. All build output belongs in ignored
`work/` or an external deliverables directory. Never commit models or the installer.

```text
python scripts/build_windows_package.py --stage work/windows-package --node NODE_EXE --model MODEL_DIRECTORY --licenses LICENSE_DIRECTORY --compiler CSC_EXE --output OUTPUT_EXE
```

`--refresh` reuses the maintainer's staged runtimes/model while rebuilding the app,
manifest, bootstrap and archive. The license directory must contain
`NODE-LICENSE.txt` for the bundled Node version and `WHISPER-LICENSE.txt`.
Whisper conversion: https://huggingface.co/Systran/faster-whisper-small.en.

Acceptance uses the installer's `--verify-install WORKSPACE_DIRECTORY` mode: same
extraction and runtime checks, plus a shortcut created only in that test directory.
It does not install into LocalAppData or record a microphone. Then run the extracted
Python in isolated mode against `scripts/verify_windows_bundle.py --bundle ROOT
--wav SYNTHETIC_WAV`. This verifies every file hash, starts the actual GUI/backend,
tests donation/replay/stop and real CPU transcription, and removes external runtimes
from PATH. This is fresh-directory portability testing on the producer's Windows
machine, not a claim that Buff's machine or a pristine Windows VM has been tested.

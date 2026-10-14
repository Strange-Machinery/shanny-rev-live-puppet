# Button-only Windows testing

Give the producer or Buff the same **Buff Testing Setup.exe**. Double-click it.
Setup extracts privately under the current user's LocalAppData, validates its
payload hash, checks its bundled runtimes and CPU Whisper, creates Desktop and
Start Menu shortcuts, and opens the app. Administrator access, Python, Node,
internet, model downloads and configuration editing are not required. Windows x64
and 2.2 GB free disk space are required. This locally built executable is unsigned;
Windows may show an unknown-publisher prompt. It is not an authenticated public
release or an auto-updater.

The app starts only the muted, local testing services. Click **Test donation** or
**Test typed response**. For a microphone test, select an input if necessary, click
**Test microphone**, speak, and click **Finish recording**. **STOP** cancels speech,
pending work and capture. Nothing records just because the app opened. Headphones
and an isolated input are recommended directly beside the input selector.

The package includes real offline CPU Whisper small.en and Windows generic TTS.
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

## Maintainer packaging

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

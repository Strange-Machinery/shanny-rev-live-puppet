"""Maintainer-only offline packager. Builds one installer from existing runtimes/model.

Run with the existing Whisper Python so dependency metadata resolves correctly.
No packages, assets or models are downloaded. Nothing private is copied.
"""
import argparse
import hashlib
from importlib import metadata
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import zipfile
from packaging.requirements import Requirement


def sha(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def build(args):
    repo = Path(__file__).resolve().parents[1]
    stage = Path(args.stage).resolve()
    if args.refresh:
        payload = stage / 'payload'
        manifest = json.loads((payload / 'package-manifest.json').read_text())
        package(repo, stage, payload, args, manifest['dependencies'])
        return
    stage.mkdir(parents=True, exist_ok=False)
    payload = stage / 'payload'; payload.mkdir()
    runtime = payload / 'runtime/python'; runtime.mkdir(parents=True)
    base = Path(sys.base_prefix)
    for name in ['python.exe', 'pythonw.exe', 'python3.dll', 'python312.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'LICENSE.txt']:
        shutil.copy2(base / name, runtime / name)
    for name in ['DLLs', 'Lib', 'tcl']:
        shutil.copytree(base / name, runtime / name,
                        ignore=shutil.ignore_patterns('site-packages', '__pycache__', '*.pyc', 'test', 'tests', 'ensurepip', 'idlelib'))
    packages = runtime / 'Lib/site-packages'; packages.mkdir()
    todo = ['faster-whisper']; dependencies = {}; copied = set()
    while todo:
        distribution = metadata.distribution(todo.pop())
        name = distribution.metadata['Name'].lower()
        if name in dependencies:
            continue
        dependencies[name] = distribution.version
        for item in distribution.files or []:
            if '..' in item.parts or '__pycache__' in item.parts or item.suffix == '.pyc':
                continue
            source = Path(distribution.locate_file(item)); target = packages / item
            if source.is_file() and str(target) not in copied:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target); copied.add(str(target))
        for dependency in distribution.requires or []:
            requirement = Requirement(dependency)
            if not requirement.marker or requirement.marker.evaluate({'extra': ''}):
                todo.append(requirement.name)
    node = payload / 'runtime/node'; node.mkdir()
    shutil.copy2(args.node, node / 'node.exe')
    licenses = payload / 'licenses'; licenses.mkdir()
    for name in ['NODE-LICENSE.txt', 'WHISPER-LICENSE.txt']:
        shutil.copy2(Path(args.licenses) / name, licenses / name)
    model = payload / 'models/whisper-small.en'; model.mkdir(parents=True)
    for name in ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt']:
        shutil.copy2(Path(args.model) / name, model / name)
    package(repo, stage, payload, args, dependencies)


def package(repo, stage, payload, args, dependencies):
    app = payload / 'app'; app.mkdir(exist_ok=True)
    shutil.copytree(repo / 'src', app / 'src', dirs_exist_ok=True)
    shutil.copytree(repo / 'python', app / 'python', dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', 'test_*.py'))
    shutil.copy2(repo / 'package.json', app / 'package.json')
    (payload / 'READ-ME.txt').write_text(
        'Double-click Buff Testing.exe. No other installation is needed.\n'
        'Real offline Whisper speech recognition is included. Character replies/audio and the show player are simulated.\n'
        'This private test package does not connect to YouTube or change episode production.\n'
        'Use Test microphone to record, Finish recording to transcribe, and STOP to cancel.\n'
        'Third-party notices: licenses/, runtime/python/LICENSE.txt, runtime/python/Lib/site-packages/*.dist-info/.\n'
        'Whisper conversion: https://huggingface.co/Systran/faster-whisper-small.en\n', encoding='utf-8')
    compiler = Path(args.compiler)
    stub = payload / 'Buff Testing.exe'
    subprocess.run([str(compiler), '/nologo', '/target:winexe', '/platform:x64',
                    '/win32manifest:' + str(repo / 'scripts/windows/app.manifest'),
                    '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.IO.Compression.dll',
                    '/r:System.IO.Compression.FileSystem.dll', '/out:' + str(stub), str(repo / 'scripts/windows/Installer.cs')], check=True)
    manifest = {'format': 1, 'platform': 'Windows x64', 'python': sys.version.split()[0],
                'node': subprocess.check_output([args.node, '--version'], text=True).strip(),
                'dependencies': dependencies, 'model': 'Systran/faster-whisper-small.en',
                'files': {file.relative_to(payload).as_posix(): sha(file) for file in sorted(payload.rglob('*')) if file.is_file() and file.name != 'package-manifest.json'}}
    (payload / 'package-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    archive = stage / 'payload.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=1) as package:
        for file in sorted(payload.rglob('*')):
            if file.is_file():
                package.write(file, file.relative_to(payload).as_posix())
    output = Path(args.output).resolve(); output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('wb') as handle:
        with stub.open('rb') as source:
            shutil.copyfileobj(source, handle)
        with archive.open('rb') as source:
            shutil.copyfileobj(source, handle)
        handle.write(struct.pack('<q', archive.stat().st_size))
        handle.write(bytes.fromhex(sha(archive))); handle.write(b'BUFFPK01')
    print(json.dumps({'installer': str(output), 'bytes': output.stat().st_size, 'sha256': sha(output),
                      'files': len(manifest['files']), 'dependencies': dependencies}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true')
    for arg in ['stage', 'node', 'model', 'licenses', 'compiler', 'output']:
        parser.add_argument('--' + arg, required=True)
    build(parser.parse_args())

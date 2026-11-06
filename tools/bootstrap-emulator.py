#!/usr/bin/env python3
"""Install the pinned EmulatorJS experiment without downloading any game data."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / 'emulator.lock.json').read_text())


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify installed files without downloading')
    parser.add_argument('--destination', type=Path, default=ROOT / 'vendor/emulatorjs')
    args = parser.parse_args()
    missing = []
    for name, expected in LOCK['files'].items():
        path = args.destination / name
        if path.exists():
            if digest(path) != expected:
                raise RuntimeError(f'{path}: unexpected contents; refusing to overwrite')
        else:
            missing.append(name)
    if not missing:
        print('Pinned EmulatorJS 4.2.3 and PCSX-ReARMed assets verified.')
        return
    if args.check:
        raise RuntimeError('Missing assets: ' + ', '.join(missing))
    archive = ROOT / '.cache/emulatorjs-4.2.3.7z'
    archive.parent.mkdir(exist_ok=True)
    if not archive.exists():
        partial = archive.with_suffix('.download')
        print('Downloading official EmulatorJS release (about 290 MiB)…', flush=True)
        with urllib.request.urlopen(LOCK['release_url'], timeout=60) as source, partial.open('wb') as target:
            shutil.copyfileobj(source, target)
        if digest(partial) != LOCK['release_sha256']:
            raise RuntimeError(f'{partial}: release checksum mismatch')
        partial.replace(archive)
    if digest(archive) != LOCK['release_sha256']:
        raise RuntimeError(f'{archive}: release checksum mismatch')
    members = {name: name if name == 'LICENSE' else 'data/' + name for name in missing}
    with tempfile.TemporaryDirectory(dir=archive.parent) as temporary:
        # macOS bsdtar/libarchive supports 7z. GNU tar users need bsdtar installed.
        extractor = shutil.which('bsdtar') or shutil.which('tar')
        if not extractor:
            raise RuntimeError('Install bsdtar (libarchive) to extract the official 7z release')
        subprocess.run([extractor, '-xf', str(archive), '-C', temporary, *members.values()], check=True)
        for name, member in members.items():
            source = Path(temporary) / member
            if digest(source) != LOCK['files'][name]:
                raise RuntimeError(f'{member}: asset checksum mismatch')
        for name, member in members.items():
            target = args.destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(Path(temporary) / member, target)
    print('Installed pinned emulator assets. Run: python3 server.py')


if __name__ == '__main__':
    main()

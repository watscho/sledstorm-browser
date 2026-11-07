#!/usr/bin/env python3
"""Generate a private core archive with an audited frame-boundary hook."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile
import argparse
import shutil

ROOT = Path(__file__).resolve().parent.parent


def prepare(native=False, retroarch_lab=False):
    lock = json.loads((ROOT / 'emulator.lock.json').read_text())
    archive = ROOT / 'vendor/emulatorjs/cores/pcsx_rearmed-wasm.data'
    if hashlib.sha256(archive.read_bytes()).hexdigest() != lock['files']['cores/pcsx_rearmed-wasm.data']:
        raise RuntimeError('Core hash differs. Run tools/bootstrap-emulator.py --check.')
    output = ROOT / '.cache' / ('emulator-retroarch-lab.data' if retroarch_lab else 'emulator-network-core.data')
    if retroarch_lab and not native:
        raise RuntimeError('RetroArch Netplay lab requires the native adapter build.')
    extractor = shutil.which('bsdtar') or shutil.which('tar')
    if not extractor:
        raise RuntimeError('Install bsdtar (libarchive) to extract the pinned core.')
    with tempfile.TemporaryDirectory(dir=ROOT / '.cache') as temporary:
        subprocess.run([extractor, '-xf', str(archive), '-C', temporary], check=True)
        if native:
            build = json.loads((ROOT / '.cache/emulator-native-build.json').read_text())
            for name, digest in build.get('patches', {}).items():
                if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest:
                    raise RuntimeError('Native adapter sources changed. Run tools/build-emulator.py again.')
            for name, digest in build['files'].items():
                source = ROOT / '.cache/emulator-retroarch' / name
                if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
                    raise RuntimeError('Native build changed. Run tools/build-emulator.py again.')
                shutil.copyfile(source, Path(temporary) / name)
            (Path(temporary) / 'sled-build.json').write_text(json.dumps(build, indent=2) + '\n')
        source = Path(temporary) / 'pcsx_rearmed_libretro.js'
        text = source.read_text()
        before = 'runIter(func){if(ABORT)return;'
        after = 'for(var post of MainLoop.postMainLoop)post()' if native else 'for(var post of MainLoop.postMainLoop){post()}'
        if text.count(before) != 1 or text.count(after) != 1:
            raise RuntimeError('Pinned core frame-loop anchors changed')
        if text.count('var Module=moduleArg;') != 1:
            raise RuntimeError('Pinned core module anchor changed')
        text = text.replace('var Module=moduleArg;', f'var Module=moduleArg;Module.sledFrameGateVersion={3 if native else 2};')
        text = text.replace(before, before + 'for(var sledRepeat=0;sledRepeat<(Module.sledFrameBudget?Module.sledFrameBudget():1);sledRepeat++){if(Module.sledBeforeFrame&&Module.sledBeforeFrame()===false)return;')
        text = text.replace(after, after + ';if(Module.sledAfterFrame)Module.sledAfterFrame();}')
        if native:
            anchor = 'Module["callMain"]=callMain;'
            if text.count(anchor) != 1:
                raise RuntimeError('Pinned core callMain anchor changed')
            adapter = (ROOT / 'research/emulator' / ('retroarch-lab.js' if retroarch_lab else 'retroarch-socket.js')).read_text()
            text = text.replace(anchor, anchor + '\n' + adapter + '\n')
        source.write_text(text)
        subprocess.run(['node', '--check', str(source)], check=True)
        # Preserve the original code, Wasm and all distribution notices locally.
        with zipfile.ZipFile(output.with_suffix('.tmp'), 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1) as target:
            for path in sorted(Path(temporary).iterdir()):
                entry = zipfile.ZipInfo(path.name, date_time=(1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                target.writestr(entry, path.read_bytes(), compresslevel=1)
        output.with_suffix('.tmp').replace(output)
    return hashlib.sha256(output.read_bytes()).hexdigest()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', action='store_true')
    parser.add_argument('--retroarch-lab', action='store_true')
    args = parser.parse_args()
    print('Prepared frame-gated PCSX-ReARMed core:', prepare(args.native, args.retroarch_lab))

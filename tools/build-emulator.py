#!/usr/bin/env python3
"""Build the pinned emulator with real console-frame hooks. No game data used."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
from bootstrap import checkout, run

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / 'emulator.lock.json').read_text())
CORE = {key: LOCK['core_source'][key] for key in ('url', 'commit')}
CORE['path'] = '.cache/pcsx-sources'
FRONTEND = {**LOCK['frontend_source'], 'path': '.cache/emulator-retroarch'}


def main():
    for tool in ('git', 'bash', 'make', 'node', 'npm'):
        if not shutil.which(tool):
            raise RuntimeError('Required tool is missing: ' + tool)
    run(['npm', 'ci', '--prefix', 'research/network'])
    sdk = json.loads((ROOT / 'upstream.lock.json').read_text())['emsdk']
    sdk = {**sdk, 'path': '.cache/emulator-emsdk'}
    for spec in (CORE, FRONTEND, sdk):
        checkout(spec)
    sdk_path = ROOT / sdk['path']
    run([sys.executable, 'emsdk.py', 'install', sdk['version']], sdk_path)
    run([sys.executable, 'emsdk.py', 'activate', sdk['version']], sdk_path)
    run([sys.executable, ROOT / 'tools/prepare-emulator-native.py'])

    def build(arguments):
        subprocess.run(['bash', '-c', 'source "$1/emsdk_env.sh" >/dev/null 2>&1; shift; exec "$@"',
                        'emulator-build', str(sdk_path), str(sdk_path / 'upstream/emscripten/emmake'),
                        'make', *arguments], cwd=ROOT, check=True)

    build(['-C', str(ROOT / CORE['path']), '-f', 'Makefile.libretro', 'platform=emscripten', 'HAVE_CHD=0', '-j4'])
    frontend = ROOT / FRONTEND['path']
    shutil.copyfile(ROOT / CORE['path'] / 'pcsx_rearmed_libretro_emscripten.bc', frontend / 'libretro_emscripten.bc')
    build(['-C', str(frontend), '-f', 'Makefile.emulatorjs', 'HAVE_7ZIP=0', 'HAVE_CHD=0', 'HAVE_THREADS=0',
           'ASYNC=1', 'HAVE_OPENGLES3=1', 'STACK_SIZE=4194304', 'INITIAL_HEAP=536870912',
           'HAVE_AL=1', 'HAVE_RWEBAUDIO=0', 'TARGET=pcsx_rearmed_libretro.js', '-j4'])
    files = {name: hashlib.sha256((frontend / name).read_bytes()).hexdigest()
             for name in ('pcsx_rearmed_libretro.js', 'pcsx_rearmed_libretro.wasm')}
    (ROOT / '.cache/emulator-native-build.json').write_text(json.dumps({'core': CORE, 'frontend': FRONTEND,
        'sdk': sdk, 'files': files, 'patches': {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in [ROOT / 'tools/prepare-emulator-native.py', ROOT / 'research/emulator/sled-enhanced.c',
                         *sorted((ROOT / 'research/emulator').glob('sled-view.*'))]}}, indent=2) + '\n')
    print('Built native frame hooks. Run python3 server.py.')


if __name__ == '__main__':
    main()

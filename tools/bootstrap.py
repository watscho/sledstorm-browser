#!/usr/bin/env python3
"""Fetch pinned sources and install project-local build tools. Never resets files."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / 'upstream.lock.json').read_text())


def run(args, cwd=ROOT):
    print('+ ' + ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=cwd, check=True)


def checkout(spec, check=False):
    target = ROOT / spec['path']
    initialized = (target / '.git').exists()
    if initialized:
        origin = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], cwd=target, text=True).strip()
        if origin.removesuffix('.git') != spec['url'].removesuffix('.git'):
            raise RuntimeError(f'{target}: unexpected origin; use a fresh clone, not a reset.')
        result = subprocess.run(['git', 'rev-parse', '--verify', 'HEAD'], cwd=target,
                                text=True, capture_output=True)
        if result.returncode == 0:
            head = result.stdout.strip()
            if head != spec['commit']:
                raise RuntimeError(f'{target}: unexpected commit; use a fresh clone, not a reset.')
            print(f"Pinned checkout OK: {spec['path']} @ {head}")
            return
        # A network failure may leave a newly initialized checkout without HEAD.
        if any(p.name != '.git' for p in target.iterdir()):
            raise RuntimeError(f'{target}: unfinished checkout contains files; refusing to overwrite.')
    if not initialized and target.exists() and any(target.iterdir()):
        raise RuntimeError(f'{target}: existing non-Git snapshot; pin cannot be verified. '
                           'Keep it intact and run bootstrap in a fresh clone.')
    if check:
        raise RuntimeError(f"Missing pinned checkout: {spec['path']}")
    target.mkdir(parents=True, exist_ok=True)
    if not initialized:
        run(['git', 'init', str(target)])
        run(['git', 'remote', 'add', 'origin', spec['url']], target)
    run(['git', 'fetch', '--depth', '1', 'origin', spec['commit']], target)
    run(['git', 'checkout', '--detach', 'FETCH_HEAD'], target)
    checkout(spec, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources-only', action='store_true', help='Fetch and patch only port/framework sources')
    parser.add_argument('--check', action='store_true', help='Read-only check; do not download or patch')
    args = parser.parse_args()
    for command in ('git', 'bash'):
        if not shutil.which(command):
            raise RuntimeError(f'Missing command: {command}')
    checkout(LOCK['port'], args.check)
    checkout(LOCK['framework'], args.check)
    if not args.check:
        run(['bash', 'scripts/apply_framework_patches.sh'], ROOT / LOCK['port']['path'])
    if args.sources_only:
        return
    if not shutil.which('node') or not shutil.which('npm'):
        raise RuntimeError('Install Node.js 22+ with npm first. See docs/setup.md.')
    major = int(subprocess.check_output(['node', '-p', 'process.versions.node.split(".")[0]'], text=True))
    if major < 22:
        raise RuntimeError('Node.js 22+ is required.')
    checkout(LOCK['emsdk'], args.check)
    if args.check:
        for path in ('.cache/emsdk/upstream/emscripten/emcc', '.cache/tooling/cmake/data/bin/cmake',
                     '.cache/tooling/bin/ninja', 'research/network/node_modules/ws/package.json'):
            if not (ROOT / path).is_file():
                raise RuntimeError(f'Missing dependency: {path}')
        print('Build tools are present. Run tools/check-port.sh to validate the integration.')
        return
    sdk = ROOT / LOCK['emsdk']['path']
    run([sys.executable, 'emsdk.py', 'install', LOCK['emsdk']['version']], sdk)
    run([sys.executable, 'emsdk.py', 'activate', LOCK['emsdk']['version']], sdk)
    tooling = ROOT / '.cache/tooling'
    run([sys.executable, '-m', 'pip', 'install', '--upgrade', '--target', tooling,
         *[f'{key}=={value}' for key, value in LOCK['python_packages'].items()]])
    run(['npm', 'ci'], ROOT / 'research/network')
    print('Setup complete. Place your disc in game/ and run: sh tools/build-port-web.sh')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Bootstrap stopped: {error}', file=sys.stderr)
        sys.exit(1)

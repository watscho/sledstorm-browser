#!/usr/bin/env python3
"""Run the private gateway through a temporary Cloudflare Quick Tunnel."""
import argparse
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import json

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.cache/online'


def private_file(path):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    return os.fdopen(fd, 'w')


def listening(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.2):
            return True
    except OSError:
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--disc-mode', choices=['local', 'shared'], default='shared',
                        help='shared: read the host disc (default); local: each browser selects files')
    parser.add_argument('--engine', choices=['recompiled', 'emulator'], default='emulator',
                        help='emulator (default), or the retained recompiled runtime')
    room_mode = parser.add_mutually_exclusive_group()
    room_mode.add_argument('--dedicated', action='store_true', help='Use dedicated rooms (default with a shared disc)')
    room_mode.add_argument('--browser-hosted', action='store_true', help='Run the room in the creator’s browser')
    args = parser.parse_args()
    supports_dedicated = args.engine == 'emulator' and args.disc_mode == 'shared'
    if args.dedicated and not supports_dedicated:
        parser.error('--dedicated requires the emulator and shared disc mode')
    dedicated = supports_dedicated and not args.browser_hosted
    node = shutil.which('node')
    cloudflared = os.environ.get('CLOUDFLARED_BIN') or shutil.which('cloudflared')
    if not cloudflared:
        local = ROOT / '.cache/cloudflared/cloudflared'
        if local.is_file() and os.access(local, os.X_OK):
            cloudflared = str(local)
    if not node or not cloudflared:
        raise RuntimeError('Install Node.js and cloudflared first. See docs/multiplayer.md.')
    required = ('vendor/emulatorjs/loader.js', '.cache/emulator-native-build.json', 'research/network/node_modules/ws/package.json') if args.engine == 'emulator' else ('.cache/build-web/port/SledStorm_Recompiled.js',
                 '.cache/build-web/port/SledStorm_Recompiled.wasm',
                 'research/network/node_modules/ws/package.json')
    for path in required:
        if not (ROOT / path).is_file():
            guide = 'docs/browser-emulator.md' if args.engine == 'emulator' else 'docs/setup.md'
            raise RuntimeError(f'Missing {path}. Complete {guide} first.')
    runtime_port, relay_port, gateway_port = (8000, 8004, 8005) if args.engine == 'emulator' else (8001, 8002, 8003)
    netplay_ports = (8006,) if args.engine == 'emulator' else ()
    for port in (runtime_port, relay_port, gateway_port, *netplay_ports):
        if listening(port):
            raise RuntimeError(f'Port {port} is already in use. Stop the existing local stack first.')
    CACHE.mkdir(parents=True, exist_ok=True, mode=0o700)
    link_file = CACHE / 'access-url.txt'
    public_file = CACHE / 'public-launcher.json'
    link_file.unlink(missing_ok=True)
    public_file.unlink(missing_ok=True)
    processes = []
    streams = []

    def start(name, command):
        log_path = CACHE / f'{name}.log'
        output = private_file(log_path)
        streams.append(output)
        process = subprocess.Popen(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        processes.append((name, process, log_path))
        return process

    def check_processes():
        for name, process, path in processes:
            if process.poll() is not None:
                raise RuntimeError(f'{name} exited ({process.returncode}). See {path}')

    def wait_port(port, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            check_processes()
            if listening(port):
                return
            time.sleep(0.2)
        raise RuntimeError(f'Timed out waiting for port {port}. See {CACHE}')

    try:
        print('Preparing local runtime. The first host-disc launch may take longer.', flush=True)
        if args.engine == 'emulator':
            runtime_command = [sys.executable, str(ROOT / 'server.py'), '--disc-mode', args.disc_mode,
                               '--dedicated' if dedicated else '--browser-hosted']
        else:
            runtime_command = [sys.executable, str(ROOT / 'research/serve_port.py')]
        runtime = start('runtime', runtime_command)
        wait_port(runtime_port, 180 if args.engine == 'emulator' else 20)
        wait_port(relay_port)
        for port in netplay_ports:
            wait_port(port)
        gateway_command = [node, str(ROOT / ('research/network/emulator-gateway.mjs' if args.engine == 'emulator' else 'research/network/public-server.mjs')), '--disc-mode', args.disc_mode]
        start('gateway', gateway_command)
        wait_port(gateway_port)
        start('tunnel', [cloudflared, 'tunnel', '--url', f'http://127.0.0.1:{gateway_port}', '--no-autoupdate'])
        print('Starting Cloudflare Quick Tunnel. Runtime assets will be reachable through the private access link.', flush=True)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            check_processes()
            log = (CACHE / 'tunnel.log').read_text(errors='replace')
            match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', log)
            # Print only after the connector is registered, not just when a name is assigned.
            if match and 'Registered tunnel connection' in log:
                access_path = (ROOT / ('.cache/emulator-access.txt' if args.engine == 'emulator' else '.cache/gateway-access.txt')).read_text().strip()
                url = match.group(0) + access_path
                with private_file(link_file) as output:
                    output.write(url + '\n')
                if args.engine == 'emulator':
                    with private_file(public_file) as output:
                        json.dump({'runtimePid': runtime.pid, 'origin': match.group(0), 'path': access_path}, output)
                    print('\nHost launcher: http://127.0.0.1:8000/\nInvitations automatically use the private internet URL.', flush=True)
                print(f'\nPrivate HTTPS launcher:\n{url}\n', flush=True)
                if args.disc_mode == 'shared':
                    print('Host disc mode: browsers read the host disc; no file selection is required.', flush=True)
                else:
                    print('Local files mode: each browser selects its own CUE + all BIN files.', flush=True)
                print('Press Start game, then use Copy invite link to invite friends.\n'
                      'Keep this process running. Ctrl+C stops the tunnel, gateway and runtime.', flush=True)
                break
            time.sleep(0.25)
        else:
            raise RuntimeError(f'Tunnel startup timed out. See {CACHE / "tunnel.log"}')
        while True:
            check_processes()
            time.sleep(0.5)
    finally:
        for _, process, _ in reversed(processes):
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        for _, process, _ in reversed(processes):
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
        for stream in streams:
            stream.close()
        link_file.unlink(missing_ok=True)
        public_file.unlink(missing_ok=True)
        print('Online stack stopped.', flush=True)


def interrupt(_signum, _frame):
    raise KeyboardInterrupt


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupt)
    try:
        main()
    except KeyboardInterrupt:
        pass
    except (OSError, RuntimeError) as error:
        print(f'Online startup failed: {error}', file=sys.stderr)
        sys.exit(1)

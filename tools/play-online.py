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
    room_mode = parser.add_mutually_exclusive_group()
    room_mode.add_argument('--dedicated', action='store_true', help='Use dedicated rooms (default with a shared disc)')
    room_mode.add_argument('--browser-hosted', action='store_true', help='Run the room in the creator’s browser')
    args = parser.parse_args()
    supports_dedicated = args.disc_mode == 'shared'
    if args.dedicated and not supports_dedicated:
        parser.error('--dedicated requires shared disc mode')
    dedicated = supports_dedicated and not args.browser_hosted
    node = shutil.which('node')
    cloudflared = os.environ.get('CLOUDFLARED_BIN') or shutil.which('cloudflared')
    if not cloudflared:
        local = ROOT / '.cache/cloudflared/cloudflared'
        if local.is_file() and os.access(local, os.X_OK):
            cloudflared = str(local)
    if not node or not cloudflared:
        raise RuntimeError('Install Node.js and cloudflared first. See docs/multiplayer.md.')
    required = ('vendor/emulatorjs/loader.js', '.cache/emulator-native-build.json',
                'research/network/node_modules/ws/package.json')
    for path in required:
        if not (ROOT / path).is_file():
            raise RuntimeError(f'Missing {path}. Complete docs/setup.md first.')
    runtime_port, relay_port, gateway_port, netplay_port = 8000, 8004, 8005, 8006
    for port in (runtime_port, relay_port, gateway_port, netplay_port):
        if listening(port):
            raise RuntimeError(f'Port {port} is already in use. Stop the existing local stack first.')
    CACHE.mkdir(parents=True, exist_ok=True, mode=0o700)
    link_file = CACHE / 'access-url.txt'
    public_file = CACHE / 'public-launcher.json'
    mirror_file = CACHE / 'mirror-origin.txt'
    mirror_temp = mirror_file.with_suffix('.tmp')
    link_file.unlink(missing_ok=True)
    public_file.unlink(missing_ok=True)
    mirror_file.unlink(missing_ok=True)
    processes = []

    def start(name, command):
        log_path = CACHE / f'{name}.log'
        with private_file(log_path) as output:
            process = subprocess.Popen(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT,
                                       start_new_session=True)
        processes.append((name, process, log_path))
        return process

    def check_processes():
        for name, process, path in processes:
            if name != 'mirror-tunnel' and process.poll() is not None:
                raise RuntimeError(f'{name} exited ({process.returncode}). See {path}')

    def wait_port(port, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            check_processes()
            if listening(port):
                return
            time.sleep(0.2)
        raise RuntimeError(f'Timed out waiting for port {port}. See {CACHE}')

    def tunnel_origin(name):
        log = (CACHE / f'{name}.log').read_text(errors='replace')
        match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', log)
        if match and log.rfind('Registered tunnel connection') > log.rfind('Unregistered tunnel connection'):
            return match.group(0)
        return None

    mirror_process = None
    mirror_port = None
    mirror_origin = None
    mirror_retry_at = 0
    mirror_retry_delay = 2

    def update_mirror():
        nonlocal mirror_process, mirror_port, mirror_origin, mirror_retry_at, mirror_retry_delay
        if not dedicated:
            return
        if mirror_port is None:
            log = (CACHE / 'gateway.log').read_text(errors='replace')
            match = re.search(r'^Mirror gateway ready on 127\.0\.0\.1:(\d+)\.$', log, re.MULTILINE)
            if not match:
                return
            mirror_port = match.group(1)
        now = time.monotonic()
        if mirror_process is not None and mirror_process.poll() is not None:
            processes[:] = [entry for entry in processes if entry[1] is not mirror_process]
            mirror_process = None
            mirror_retry_at = now + mirror_retry_delay
            mirror_retry_delay = min(30, mirror_retry_delay * 2)
        if mirror_process is None and now >= mirror_retry_at:
            try:
                mirror_process = start('mirror-tunnel', [cloudflared, 'tunnel', '--url',
                                       f'http://127.0.0.1:{mirror_port}', '--protocol', 'http2', '--no-autoupdate'])
            except OSError:
                mirror_retry_at = now + mirror_retry_delay
                mirror_retry_delay = min(30, mirror_retry_delay * 2)
        registered = tunnel_origin('mirror-tunnel') if mirror_process is not None else None
        if registered == mirror_origin:
            return
        mirror_origin = registered
        if mirror_origin:
            mirror_retry_delay = 2
            with private_file(mirror_temp) as output:
                output.write(mirror_origin + '\n')
            mirror_temp.replace(mirror_file)
        else:
            mirror_file.unlink(missing_ok=True)

    try:
        print('Preparing local runtime. The first host-disc launch may take longer.', flush=True)
        runtime_command = [sys.executable, str(ROOT / 'server.py'), '--disc-mode', args.disc_mode,
                           '--dedicated' if dedicated else '--browser-hosted']
        runtime = start('runtime', runtime_command)
        wait_port(runtime_port, 180)
        wait_port(relay_port)
        wait_port(netplay_port)
        gateway_command = [node, str(ROOT / 'research/network/emulator-gateway.mjs'), '--disc-mode', args.disc_mode]
        if dedicated:
            gateway_command.append('--mirror')
        start('gateway', gateway_command)
        wait_port(gateway_port)
        protocol = os.environ.get('TUNNEL_TRANSPORT_PROTOCOL') or 'auto'
        start('tunnel', [cloudflared, 'tunnel', '--url', f'http://127.0.0.1:{gateway_port}',
                         '--protocol', protocol, '--no-autoupdate'])
        print('Starting Cloudflare Quick Tunnel. Runtime assets will be reachable through the private access link.', flush=True)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            check_processes()
            update_mirror()
            origin = tunnel_origin('tunnel')
            # Print only after the connector is registered, not just when a name is assigned.
            if origin:
                access_path = (ROOT / '.cache/emulator-access.txt').read_text().strip()
                url = origin + access_path
                with private_file(link_file) as output:
                    output.write(url + '\n')
                with private_file(public_file) as output:
                    json.dump({'runtimePid': runtime.pid, 'origin': origin, 'path': access_path}, output)
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
            update_mirror()
            time.sleep(0.5)
    finally:
        for name, process, _ in reversed(processes):
            if name == 'mirror-tunnel' and process.poll() is not None:
                continue
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
        link_file.unlink(missing_ok=True)
        public_file.unlink(missing_ok=True)
        mirror_file.unlink(missing_ok=True)
        mirror_temp.unlink(missing_ok=True)
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

#!/usr/bin/env python3
"""Run the private gateway through a temporary Cloudflare Quick Tunnel."""
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import time

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
    node = shutil.which('node')
    cloudflared = os.environ.get('CLOUDFLARED_BIN') or shutil.which('cloudflared')
    if not cloudflared:
        local = ROOT / '.cache/cloudflared/cloudflared'
        if local.is_file() and os.access(local, os.X_OK):
            cloudflared = str(local)
    if not node or not cloudflared:
        raise RuntimeError('Install Node.js and cloudflared first. See docs/multiplayer.md.')
    for path in ('.cache/build-web/port/SledStorm_Recompiled.js',
                 '.cache/build-web/port/SledStorm_Recompiled.wasm',
                 'research/network/node_modules/ws/package.json'):
        if not (ROOT / path).is_file():
            raise RuntimeError(f'Missing {path}. Complete docs/setup.md first.')
    for port in (8001, 8002, 8003):
        if listening(port):
            raise RuntimeError(f'Port {port} is already in use. Stop the existing local stack first.')
    CACHE.mkdir(parents=True, exist_ok=True, mode=0o700)
    link_file = CACHE / 'access-url.txt'
    link_file.unlink(missing_ok=True)
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

    def wait_port(port):
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            check_processes()
            if listening(port):
                return
            time.sleep(0.2)
        raise RuntimeError(f'Timed out waiting for port {port}. See {CACHE}')

    try:
        start('runtime', [sys.executable, str(ROOT / 'research/serve_port.py')])
        wait_port(8001)
        wait_port(8002)
        start('gateway', [node, str(ROOT / 'research/network/public-server.mjs')])
        wait_port(8003)
        start('tunnel', [cloudflared, 'tunnel', '--url', 'http://127.0.0.1:8003', '--no-autoupdate'])
        print('Starting Cloudflare Quick Tunnel. Runtime assets will be reachable through the private access link.', flush=True)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            check_processes()
            log = (CACHE / 'tunnel.log').read_text(errors='replace')
            match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', log)
            # Print only after the connector is registered, not just when a name is assigned.
            if match and 'Registered tunnel connection' in log:
                access_path = (ROOT / '.cache/gateway-access.txt').read_text().strip()
                url = match.group(0) + access_path
                with private_file(link_file) as output:
                    output.write(url + '\n')
                print(f'\nOpen this private launcher URL:\n{url}\n', flush=True)
                print('Select your local CUE + all BIN files, press Start game, then share Invite friends.\n'
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

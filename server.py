"""Loopback-only Sled Storm launcher. Python 3.10+, no packages required."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import re
import zipfile
import hashlib
import subprocess
import shutil
import signal
import sys
import argparse
import os

from tools.runtime_node import require_node

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / '.cache'
IDENTITY = {}
DISC_CHUNK_SIZE = 8 * 1024 * 1024
DISC_MODE = 'shared'
RETROARCH_LAB_TOKEN = None


def stop_launcher(_signum, _frame):
    raise KeyboardInterrupt


def prepare_disc():
    cues = list(ROOT.glob('*/*.cue'))
    if len(cues) != 1:
        raise RuntimeError('Expected exactly one CUE in a game subfolder.')
    cue = cues[0]
    names = re.findall(r'^FILE "([^"]+)" BINARY', cue.read_text(), re.M)
    tracks = [(cue.parent / name).resolve() for name in names]
    if not tracks or any(p.parent != cue.parent.resolve() or not p.is_file() for p in tracks):
        raise RuntimeError('CUE references missing files or files outside the game folder.')
    sources = [cue, *tracks]
    signature = json.dumps({'archive': 'stored-v1', 'sources': [(p.name, p.stat().st_size, p.stat().st_mtime_ns) for p in sources]})
    CACHE.mkdir(exist_ok=True)
    archive, stamp = CACHE / 'disc.zip', CACHE / 'disc.json'
    if not archive.exists() or not stamp.exists() or stamp.read_text() != signature:
        print('Preparing disc archive (all audio tracks included)…', flush=True)
        temporary = CACHE / 'disc.tmp'
        # Let the browser copy tracks directly instead of inflating hundreds of
        # megabytes of CD audio in the JavaScript ZIP decoder on every join.
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_STORED) as output:
            for source in sources:
                output.write(source, source.name)
        temporary.replace(archive)
        stamp.write_text(signature)
    return archive


class LauncherServer(ThreadingHTTPServer):
    # A gateway can fetch assets concurrently for several new browsers.
    request_queue_size = 32


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        # Local diagnostic snapshots only; this endpoint is not gateway-listed.
        from urllib.parse import urlsplit, parse_qs
        route = urlsplit(self.path)
        query = parse_qs(route.query)
        frame, seat = query.get('frame', [''])[0], query.get('seat', [''])[0]
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            self.send_error(400)
            return
        if (self.headers.get('Host') not in ('127.0.0.1:8000', 'localhost:8000') or
            self.headers.get('Origin') not in ('http://127.0.0.1:8000', 'http://localhost:8000') or
            route.path != '/diagnostic-state' or not frame.isdigit() or int(frame) > 1000 or
            seat not in ('0', '1', '2', '3') or not 0 < length <= 16 * 1024 * 1024):
            self.send_error(403)
            return
        data = self.rfile.read(length)
        if len(data) != length:
            self.send_error(400)
            return
        (CACHE / f'emulator-state-{seat}-{frame}.bin').write_bytes(data)
        self.send_response(204)
        self.end_headers()

    def translate_path(self, path):
        from urllib.parse import unquote, urlsplit
        route = unquote(urlsplit(path).path)
        special = {'/network-core.data': CACHE / 'emulator-network-core.data',
                   '/lab-state': CACHE / 'emulator-lab.state'}
        if RETROARCH_LAB_TOKEN:
            special.update({
                '/retroarch-lab': ROOT / 'research/emulator/retroarch-lab.html',
                '/retroarch-lab-client.js': ROOT / 'research/emulator/retroarch-lab-client.js',
                '/retroarch-lab-core.data': CACHE / 'emulator-retroarch-lab.data',
            })
        if route in special:
            return str(special[route])
        if route == '/disc.zip':
            return str(CACHE / 'disc.zip' if DISC_MODE == 'shared' else ROOT / '.not-found')
        if route.startswith('/emulator/'):
            base, relative = ROOT / 'vendor' / 'emulatorjs', route[len('/emulator/'):]
        else:
            base, relative = ROOT / 'web', route.lstrip('/') or 'index.html'
        target = (base / relative).resolve()
        if not target.is_relative_to(base.resolve()):
            return str(ROOT / '.not-found')
        return str(target)

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if self.path == '/session-info':
            self.send_header('Cache-Control', 'no-store')
        elif not self.path.startswith(('/emulator/', '/disc.zip')):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)

    def do_GET(self):
        if self.headers.get('Host') not in ('127.0.0.1:8000', 'localhost:8000'):
            self.send_error(403)
            return
        if self.path == '/retroarch-lab-info' and RETROARCH_LAB_TOKEN:
            data = json.dumps({'token': RETROARCH_LAB_TOKEN}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path == '/session-info':
            data = json.dumps(IDENTITY).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            if (ROOT / 'web/generated/enge-hardware.js').is_file():
                self.send_header('X-Sled-Hardware-Renderer', 'webgl2')
            # The tunnel helper publishes a capability for this exact runtime.
            # Keep hosting local while invitations use the public HTTPS origin.
            try:
                published = json.loads((CACHE / 'online/public-launcher.json').read_text())
                if (isinstance(published, dict) and published.get('runtimePid') == os.getpid() and
                    re.fullmatch(r'https://[a-z0-9-]+\.trycloudflare\.com', published.get('origin', '')) and
                    re.fullmatch(r'/access/[a-f0-9]{48}', published.get('path', ''))):
                    self.send_header('X-Invite-Origin', published['origin'])
                    self.send_header('X-Invite-Path', published['path'])
            except (OSError, ValueError, TypeError):
                pass
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def do_HEAD(self):
        if self.headers.get('Host') not in ('127.0.0.1:8000', 'localhost:8000'):
            self.send_error(403)
            return
        super().do_HEAD()


def shared_identity():
    archive = prepare_disc()
    # Cached separately from disc.zip so steady-state startup avoids hashing 615 MiB.
    signature = (CACHE / 'disc.json').read_text()
    identity_path = CACHE / 'emulator-disc-identity.json'
    previous = json.loads(identity_path.read_text()) if identity_path.exists() else {}
    if previous.get('signature') != signature or 'archive' not in previous:
        sha = hashlib.sha256()
        chunks = []
        with archive.open('rb') as source:
            for block in iter(lambda: source.read(DISC_CHUNK_SIZE), b''):
                sha.update(block)
                chunks.append(hashlib.sha256(block).hexdigest())
        if previous.get('signature') != signature:
            previous = {'signature': signature}
        previous['archive'] = {
            'sha256': sha.hexdigest(), 'size': archive.stat().st_size,
            'chunkSize': DISC_CHUNK_SIZE, 'chunks': chunks,
        }
        identity_path.write_text(json.dumps(previous))
    if 'pal' not in previous:
        cue = next(ROOT.glob('*/*.cue'))
        track = cue.parent / re.findall(r'^FILE "([^"]+)" BINARY', cue.read_text(), re.M)[0]
        sha = hashlib.sha1()
        with track.open('rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                sha.update(block)
        previous['pal'] = sha.hexdigest() == 'c5506c3eb3601d68d11f2c8754e03a6b06be5f2d'
        identity_path.write_text(json.dumps(previous))
    if 'content_sha256' not in previous:
        cue = next(ROOT.glob('*/*.cue'))
        tracks = [cue.parent / name for name in re.findall(r'^FILE "([^"]+)" BINARY', cue.read_text(), re.M)]
        manifest = []
        for path in [cue, *tracks]:
            sha = hashlib.sha256()
            with path.open('rb') as source:
                for block in iter(lambda: source.read(1024 * 1024), b''):
                    sha.update(block)
            manifest.append([path.name, path.stat().st_size, sha.hexdigest()])
        previous['content_sha256'] = hashlib.sha256(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        identity_path.write_text(json.dumps(previous))
    return {'disc': previous['content_sha256'], 'pal': previous['pal'], 'archive': previous['archive']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--disc-mode', choices=['shared', 'local'], default='shared')
    parser.add_argument('--retroarch-lab', action='store_true', help='Enable the loopback RetroArch Netplay lab')
    room_mode = parser.add_mutually_exclusive_group()
    room_mode.add_argument('--dedicated', action='store_true',
                           help='Run rooms in server-owned headless Chrome (default with a shared disc)')
    room_mode.add_argument('--browser-hosted', action='store_true', help='Run rooms in the creator’s browser')
    args = parser.parse_args()
    DISC_MODE = args.disc_mode
    if args.dedicated and DISC_MODE != 'shared':
        parser.error('--dedicated requires shared disc mode')
    chrome = None
    if DISC_MODE == 'shared' and not args.browser_hosted:
        mac_chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        chrome = (os.environ.get('SLED_CHROME_BIN') or shutil.which('google-chrome') or
                  shutil.which('chromium') or (str(mac_chrome) if mac_chrome.is_file() else None))
        if not chrome or not os.access(chrome, os.X_OK):
            parser.error('Install Chrome, set SLED_CHROME_BIN, or use --browser-hosted')
    if args.retroarch_lab and DISC_MODE != 'shared':
        parser.error('--retroarch-lab requires shared disc mode')
    try:
        node = require_node()
    except RuntimeError as error:
        parser.error(str(error))
    CACHE.mkdir(exist_ok=True)
    native_build = CACHE / 'emulator-native-build.json'
    if not native_build.is_file():
        raise RuntimeError('Native frame hooks are required. Run python3 tools/build-emulator.py first.')
    IDENTITY = {**(shared_identity() if DISC_MODE == 'shared' else {'disc': None, 'pal': None}),
                'discMode': DISC_MODE,
                'roomCheck': True,
                'core': json.loads((ROOT / 'emulator.lock.json').read_text())['files']['cores/pcsx_rearmed-wasm.data'],
                'adapter': 'pcsx-frame-gate-v3'}
    IDENTITY['native'] = json.loads(native_build.read_text())['files']
    if chrome:
        IDENTITY['dedicated'] = True
    subprocess.run([sys.executable, str(ROOT / 'tools/prepare-emulator.py'), '--native'], check=True)
    lab = None
    if args.retroarch_lab:
        from secrets import token_hex
        RETROARCH_LAB_TOKEN = token_hex(24)
        subprocess.run([sys.executable, str(ROOT / 'tools/prepare-emulator.py'), '--native', '--retroarch-lab'], check=True)
        lab = subprocess.Popen([node, str(ROOT / 'research/network/retroarch-lab.mjs')], cwd=ROOT,
                               env={**os.environ, 'SLED_RETROARCH_LAB_TOKEN': RETROARCH_LAB_TOKEN})
    relay_env = {key: value for key, value in os.environ.items() if key != 'SLED_DEDICATED_CHROME'}
    if chrome:
        relay_env['SLED_DEDICATED_CHROME'] = chrome
    relay = subprocess.Popen([node, str(ROOT / 'research/network/emulator-relay.mjs')], cwd=ROOT, env=relay_env)
    try:
        signal.signal(signal.SIGTERM, stop_launcher)
        server = LauncherServer(('127.0.0.1', 8000), Handler)
        print('Open http://127.0.0.1:8000 — Ctrl+C to stop.', flush=True)
        if lab:
            print('RetroArch Netplay lab: http://127.0.0.1:8000/retroarch-lab', flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        relay.terminate()
        relay.wait()
        if lab:
            lab.terminate()
            lab.wait()

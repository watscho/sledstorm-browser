"""Isolated loopback-only port experiment on :8001. Original launcher stays on :8000."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
import json
import re
import hashlib
import socket
import subprocess
import shutil
import os

ROOT = Path(__file__).resolve().parent.parent
disc_dir = Path(os.environ.get('SLEDSTORM_DISC_DIR', ROOT / 'game')).expanduser()
# Retain compatibility with existing workspaces whose disc has its own folder.
candidates = sorted(p for p in disc_dir.glob('*') if p.suffix.lower() == '.cue') if disc_dir.is_dir() else []
if not candidates and 'SLEDSTORM_DISC_DIR' not in os.environ:
    candidates = sorted(p for p in ROOT.glob('*/*') if p.suffix.lower() == '.cue')
if len(candidates) != 1:
    raise SystemExit('Expected one CUE with its BIN tracks in game/. '
                     'Alternatively set SLEDSTORM_DISC_DIR to your disc folder. See docs/setup.md.')
CUE = candidates[0]
TRACKS = [CUE.parent / n for n in re.findall(r'^FILE "([^"]+)" BINARY', CUE.read_text(), re.M)]
if any(p.resolve().parent != CUE.parent.resolve() or not p.is_file() for p in TRACKS):
    raise RuntimeError('Invalid CUE track paths')
FILES = [CUE, *TRACKS]
ROUTES = {
    '/': ROOT / 'research/wasm/index.html',
    '/port.js': ROOT / 'research/wasm/port.js',
    '/lobby.js': ROOT / 'research/wasm/lobby.js',
    '/lobby.css': ROOT / 'research/wasm/lobby.css',
    '/launch-settings.js': ROOT / 'research/wasm/launch-settings.js',
    '/race-preview.svg': ROOT / 'research/wasm/assets/race-preview.svg',
    '/network-client.js': ROOT / 'research/wasm/network-client.js',
    '/disc-fs.js': ROOT / 'research/wasm/disc-fs.js',
    '/local-disc.js': ROOT / 'research/wasm/local-disc.js',
    '/game.js': ROOT / '.cache/build-web/port/SledStorm_Recompiled.js',
    '/game.wasm': ROOT / '.cache/build-web/port/SledStorm_Recompiled.wasm',
    '/bios.bin': ROOT / 'research/port/psxrecomp/bios/openbios.bin',
}
ROUTES.update({f'/disc/{i}': p for i, p in enumerate(FILES)})


class Handler(SimpleHTTPRequestHandler):
    identity_cache = None
    def do_POST(self):
        if self.headers.get('Host') not in ('127.0.0.1:8001', 'localhost:8001') or self.path != '/diagnostic':
            self.send_error(403)
            return
        length = int(self.headers.get('Content-Length', '0'))
        if length < 1 or length > 4096:
            self.send_error(400)
            return
        print('BROWSER:', self.rfile.read(length).decode('utf-8', errors='replace'), flush=True)
        self.send_response(204)
        self.end_headers()

    def translate_path(self, path):
        return str(ROUTES.get(urlsplit(path).path, ROOT / '.not-found'))

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if self.headers.get('Host') not in ('127.0.0.1:8001', 'localhost:8001'):
            self.send_error(403)
            return
        route = urlsplit(self.path)
        if route.path.startswith('/disc/') and route.query:
            path = ROUTES.get(route.path)
            query = parse_qs(route.query)
            try:
                offset = int(query['offset'][0])
                length = int(query['length'][0])
                if not path or offset < 0 or length <= 0 or length > 4 * 1024 * 1024 or offset + length > path.stat().st_size:
                    raise ValueError('Invalid extent')
            except (ValueError, KeyError):
                self.send_error(400)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(length))
            self.end_headers()
            with path.open('rb') as stream:
                stream.seek(offset)
                self.wfile.write(stream.read(length))
            return
        if urlsplit(self.path).path == '/manifest':
            payload = json.dumps([{'name': p.name, 'url': f'/disc/{i}', 'size': p.stat().st_size}
                                  for i, p in enumerate(FILES)]).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if urlsplit(self.path).path == '/identity':
            inputs = [*FILES, ROUTES['/bios.bin']]
            signature = [(str(p), p.stat().st_size, p.stat().st_mtime_ns) for p in inputs]
            cached = Handler.identity_cache
            if cached is None or cached[0] != signature:
                digest = hashlib.sha256(b'SledStorm-PAL-disc-and-OpenBIOS-v2')
                for path in inputs:
                    digest.update(path.name.encode())
                    digest.update(path.stat().st_size.to_bytes(8, 'little'))
                    file_digest = hashlib.sha256()
                    with path.open('rb') as stream:
                        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                            file_digest.update(chunk)
                    digest.update(file_digest.digest())
                Handler.identity_cache = (signature, digest.hexdigest())
            payload = json.dumps({'disc_identity': Handler.identity_cache[1]}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()


if __name__ == '__main__':
    with ThreadingHTTPServer(('127.0.0.1', 8001), Handler) as server:
        relay = None
        try:
            try:
                with socket.create_connection(('127.0.0.1', 8002), timeout=0.3):
                    pass
            except OSError:
                node = shutil.which('node')
                if not node:
                    raise RuntimeError('Node.js is required for shared console sessions')
                (ROOT / '.cache').mkdir(exist_ok=True)
                with (ROOT / '.cache/relay.log').open('a') as output:
                    relay = subprocess.Popen([node, str(ROOT / 'research/network/server.mjs')],
                                             cwd=ROOT, stdout=output, stderr=output)
            print('Sled Storm: http://127.0.0.1:8001', flush=True)
            server.serve_forever()
        finally:
            if relay is not None:
                relay.terminate()
                relay.wait(timeout=5)

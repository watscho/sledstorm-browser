"""Loopback-only Sled Storm launcher. Python 3.10+, no packages required."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / '.cache'


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
    signature = json.dumps([(p.name, p.stat().st_size, p.stat().st_mtime_ns) for p in sources])
    CACHE.mkdir(exist_ok=True)
    archive, stamp = CACHE / 'disc.zip', CACHE / 'disc.json'
    if not archive.exists() or not stamp.exists() or stamp.read_text() != signature:
        print('Preparing disc archive (all audio tracks included)…', flush=True)
        temporary = CACHE / 'disc.tmp'
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1) as output:
            for source in sources:
                output.write(source, source.name)
        temporary.replace(archive)
        stamp.write_text(signature)
    return archive


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        from urllib.parse import unquote, urlsplit
        route = unquote(urlsplit(path).path)
        if route == '/disc.zip':
            return str(CACHE / 'disc.zip')
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
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)

    def do_GET(self):
        if self.headers.get('Host') not in ('127.0.0.1:8000', 'localhost:8000'):
            self.send_error(403)
            return
        super().do_GET()


if __name__ == '__main__':
    prepare_disc()
    try:
        server = ThreadingHTTPServer(('127.0.0.1', 8000), Handler)
        print('Open http://127.0.0.1:8000 — Ctrl+C to stop.', flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass

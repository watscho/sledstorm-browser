"""Exercise the real disc HTTP handler with synthetic files, never a game image."""
import http.client
from http.server import ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parent.parent


class DiscServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = tempfile.TemporaryDirectory()
        directory = Path(cls.fixture.name)
        cls.track = bytes(range(256)) * 8
        for i in range(11):
            (directory / f'track{i}.bin').write_bytes(cls.track)
        (directory / 'test.cue').write_text(''.join(f'FILE "track{i}.bin" BINARY\n' for i in range(11)))
        old = os.environ.get('SLEDSTORM_DISC_DIR')
        os.environ['SLEDSTORM_DISC_DIR'] = str(directory)
        try:
            spec = importlib.util.spec_from_file_location('disc_server_fixture', ROOT / 'research/serve_port.py')
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        finally:
            if old is None:
                os.environ.pop('SLEDSTORM_DISC_DIR')
            else:
                os.environ['SLEDSTORM_DISC_DIR'] = old

        class QuietHandler(module.Handler):
            def log_message(self, *_args):
                pass

        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.fixture.cleanup()

    def request(self, path, method='GET', host='127.0.0.1:8001'):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            connection.request(method, path, headers={'Host': host})
            result = connection.getresponse()
            return result.status, dict(result.getheaders()), result.read()
        finally:
            connection.close()

    def test_manifest_and_exact_disc_extent(self):
        status, headers, body = self.request('/manifest')
        self.assertEqual(status, 200)
        self.assertEqual(headers['X-Disc-Mode'], 'shared')
        self.assertEqual(headers['X-Disc-Local-Required'], '0')
        self.assertEqual(len(json.loads(body)), 12)
        for offset, length in [(0, 16), (1000, 200), (2047, 1)]:
            status, headers, body = self.request(f'/disc/1?offset={offset}&length={length}')
            self.assertEqual(status, 200)
            self.assertEqual(int(headers['Content-Length']), length)
            self.assertEqual(body, self.track[offset:offset + length])

    def test_unbounded_malformed_and_out_of_file_reads_are_rejected(self):
        for path in ['/disc/1', '/disc/1?offset=0', '/disc/1?offset=-1&length=1',
                     '/disc/1?offset=0&length=0', '/disc/1?offset=0&length=4194305',
                     '/disc/1?offset=2047&length=2', '/disc/12?offset=0&length=1',
                     '/disc/1?offset=0&offset=1&length=1', '/disc/1?offset=0&length=1&extra=',
                     '/disc/1?offset=1e2&length=1']:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 400)
        self.assertEqual(self.request('/disc/1?offset=0&length=1', method='HEAD')[0], 403)

    def test_host_and_file_allowlist(self):
        self.assertEqual(self.request('/manifest', host='untrusted.example')[0], 403)
        self.assertEqual(self.request('/game.wasm', method='HEAD', host='untrusted.example')[0], 403)
        for path in ['/.git/config', '/.cache/gateway-access.txt', '/README.md', '/%64isc/1']:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)


if __name__ == '__main__':
    unittest.main()

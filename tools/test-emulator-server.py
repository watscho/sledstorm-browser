#!/usr/bin/env python3
"""Exercise launcher routes using synthetic files, never game data."""
import http.client
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import server as launcher


class QuietHandler(launcher.Handler):
    def log_message(self, *args):
        pass


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.original = launcher.CACHE, launcher.IDENTITY, launcher.DISC_MODE
        launcher.CACHE = Path(self.directory.name)
        launcher.IDENTITY = {'discMode': 'local'}
        launcher.DISC_MODE = 'local'
        self.server = launcher.ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.01), daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        launcher.CACHE, launcher.IDENTITY, launcher.DISC_MODE = self.original
        self.directory.cleanup()

    def request(self, path, method='GET', body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        connection.request(method, path, body, {'Host': '127.0.0.1:8000', **(headers or {})})
        response = connection.getresponse()
        result = response.status, dict((key.lower(), value) for key, value in response.getheaders()), response.read()
        connection.close()
        return result

    def test_public_invitation_is_bound_to_the_current_runtime(self):
        directory = launcher.CACHE / 'online'; directory.mkdir()
        metadata = directory / 'public-launcher.json'
        published = {'runtimePid': os.getpid(), 'origin': 'https://synthetic-test.trycloudflare.com', 'path': '/access/' + 'a' * 48}
        metadata.write_text(json.dumps(published))
        status, headers, body = self.request('/session-info')
        self.assertEqual(status, 200)
        self.assertEqual(headers['x-invite-origin'], published['origin'])
        self.assertEqual(headers['x-invite-path'], published['path'])
        self.assertEqual(json.loads(body), {'discMode': 'local'})
        for invalid in [{**published, 'runtimePid': -1}, {**published, 'origin': 'https://foreign.example'},
                        {**published, 'path': '/'}, []]:
            metadata.write_text(json.dumps(invalid))
            self.assertNotIn('x-invite-origin', self.request('/session-info')[1])

    def test_local_mode_blocks_host_disc_even_when_cached(self):
        (launcher.CACHE / 'disc.zip').write_bytes(b'synthetic disc')
        self.assertEqual(self.request('/disc.zip')[0], 404)
        launcher.DISC_MODE = 'shared'
        self.assertEqual(self.request('/disc.zip')[2], b'synthetic disc')
        self.assertEqual(self.request('/', 'HEAD', headers={'Host': 'foreign.example'})[0], 403)

    def test_snapshot_upload_requires_the_local_origin(self):
        path = '/diagnostic-state?frame=1000&seat=3'
        self.assertEqual(self.request(path, 'POST', b'test', {'Origin': 'https://foreign.example'})[0], 403)
        self.assertFalse((launcher.CACHE / 'emulator-state-3-1000.bin').exists())
        self.assertEqual(self.request(path, 'POST', b'test', {'Origin': 'http://127.0.0.1:8000'})[0], 204)
        self.assertEqual((launcher.CACHE / 'emulator-state-3-1000.bin').read_bytes(), b'test')


if __name__ == '__main__':
    unittest.main()

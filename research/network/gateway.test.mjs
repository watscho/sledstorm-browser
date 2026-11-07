import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createRelay } from './server.mjs';
import { createPublicGateway } from './public-server.mjs';

test('tunnel gateway exposes runtime metadata but refuses disc bytes and folder paths', async () => {
  const source = http.createServer((request, response) => response.end(request.url));
  source.listen(0, '127.0.0.1'); await once(source, 'listening');
  const gateway = createPublicGateway({ port: 0, upstream: source.address().port });
  await once(gateway, 'listening');
  const base = `http://127.0.0.1:${gateway.address().port}`;
  try {
    const manifest = await fetch(`${base}/manifest`);
    assert.equal(manifest.headers.get('x-disc-local-required'), '1');
    assert.equal(await manifest.text(), '/manifest');
    for (const path of ['/disc/0', '/disc/1?offset=0&length=2048', '/README.md', '/.git/config', '/%64isc/1'])
      assert.equal((await fetch(base + path)).status, 403, path);
    assert.equal((await fetch(base + '/game.wasm')).status, 200);
    for (const asset of ['/lobby.js','/lobby.css','/launch-settings.js','/race-preview.svg'])
      assert.equal((await fetch(base + asset)).status,200,asset);
  } finally { gateway.close(); source.close(); }
});

test('same-origin WebSocket upgrade forwards room creation; foreign origin is refused', async () => {
  const relay = createRelay({ port: 0 }); await once(relay, 'listening');
  const gateway = createPublicGateway({ port: 0, relay: relay.address().port }); await once(gateway, 'listening');
  const origin = `http://127.0.0.1:${gateway.address().port}`;
  const client = new WebSocket(origin.replace('http:', 'ws:') + '/relay', { origin });
  try {
    await once(client, 'open');
    const reply = once(client, 'message');
    client.send(JSON.stringify({ type: 'create', identity: '1'.repeat(64) }));
    assert.equal(JSON.parse((await reply)[0]).type, 'created');
    const foreign = new WebSocket(origin.replace('http:', 'ws:') + '/relay', { origin: 'https://example.com' });
    const [error] = await once(foreign, 'error');
    assert.match(error.message, /403/);
  } finally { client.terminate(); gateway.close(); relay.close(); }
});

test('private gateway requires its access cookie for assets and WebSocket upgrades', async () => {
  const source = http.createServer((request, response) => response.end('[]'));
  source.listen(0, '127.0.0.1'); await once(source, 'listening');
  const token = 'a'.repeat(48);
  const gateway = createPublicGateway({ port: 0, upstream: source.address().port, accessToken: token });
  await once(gateway, 'listening');
  const base = `http://127.0.0.1:${gateway.address().port}`;
  try {
    assert.equal((await fetch(base + '/game.wasm')).status, 401);
    const access = await fetch(base + '/access/' + token, { redirect: 'manual' });
    assert.equal(access.status, 302);
    assert.match(access.headers.get('set-cookie'), /HttpOnly/);
    const headers = { cookie: `sled_access=${token}` };
    const manifest = await fetch(base + '/manifest', { headers });
    assert.equal(manifest.status, 200);
    assert.equal(manifest.headers.get('x-invite-path'), '/access/' + token);
    assert.equal((await fetch(base + '/disc/1', { headers })).status, 403);
    const client = new WebSocket(base.replace('http:', 'ws:') + '/relay', { origin: base });
    const [error] = await once(client, 'error');
    assert.match(error.message, /403/);
  } finally { gateway.close(); source.close(); }
});

test('shared disc mode requires private access and forwards only bounded reads', async () => {
  assert.throws(() => createPublicGateway({ port: 0, discMode: 'shared' }), /private access token/);
  assert.throws(() => createPublicGateway({ port: 0, discMode: 'invalid' }), /Disc mode/);
  const requests = [];
  const source = http.createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/manifest') {
      response.setHeader('X-Disc-Local-Required', '1');
      response.end('[]'); return;
    }
    const url = new URL(request.url, 'http://localhost');
    const offset = Number(url.searchParams.get('offset')), length = Number(url.searchParams.get('length'));
    if (offset + length > 8192) { response.writeHead(400).end(); return; }
    response.end(Buffer.from(Array.from({ length }, (_, i) => (offset + i) % 256)));
  });
  source.listen(0, '127.0.0.1'); await once(source, 'listening');
  const token = 'b'.repeat(48);
  const gateway = createPublicGateway({ port: 0, upstream: source.address().port, accessToken: token, discMode: 'shared' });
  await once(gateway, 'listening');
  const base = `http://127.0.0.1:${gateway.address().port}`, headers = { cookie: `sled_access=${token}` };
  try {
    assert.equal((await fetch(base + '/disc/1?offset=10&length=16')).status, 401);
    const manifest = await fetch(base + '/manifest', { headers });
    assert.equal(manifest.headers.get('x-disc-mode'), 'shared');
    assert.equal(manifest.headers.get('x-disc-local-required'), '0');
    assert.equal(manifest.headers.get('x-invite-path'), '/access/' + token);
    const extent = await fetch(base + '/disc/1?length=16&offset=10', { headers });
    assert.equal(extent.status, 200);
    assert.deepEqual([...new Uint8Array(await extent.arrayBuffer())], Array.from({ length: 16 }, (_, i) => i + 10));
    assert.equal(requests.at(-1), '/disc/1?offset=10&length=16');
    assert.equal((await fetch(base + '/disc/1?offset=8190&length=16', { headers })).status, 400);
    const count = requests.length;
    for (const path of ['/disc/1', '/disc/1?offset=0', '/disc/1?offset=-1&length=4',
      '/disc/1?offset=0&length=0', '/disc/1?offset=0&length=4194305',
      '/disc/1?offset=9007199254740991&length=1', '/disc/1?offset=1e3&length=4',
      '/disc/1?offset=0&offset=1&length=4', '/disc/1?offset=0&length=4&file=x',
      '/disc/12?offset=0&length=4', '/disc/../.git/config', '/%64isc/1?offset=0&length=4',
      '/.cache/gateway-access.txt', '/README.md']) {
      assert.ok([400, 403].includes((await fetch(base + path, { headers })).status), path);
    }
    assert.equal((await fetch(base + '/disc/1?offset=0&length=4', { headers, method: 'HEAD' })).status, 403);
    assert.equal((await fetch(base + '/disc/1?offset=0&length=4', { headers, method: 'POST' })).status, 403);
    assert.equal(requests.length, count, 'rejected disc requests must not reach the source');
  } finally { gateway.close(); source.close(); }
});

test('emulator gateway protects the archive, preserves reshare access and excludes diagnostics', async () => {
  const { emulatorAssetPaths } = await import('./emulator-assets.mjs');
  const { readFile } = await import('node:fs/promises');
  const lock = JSON.parse(await readFile(new URL('../../emulator.lock.json', import.meta.url)));
  const source = http.createServer((request, response) => response.end(request.url));
  source.listen(0, '127.0.0.1'); await once(source, 'listening');
  const token = 'd'.repeat(48), headers = { cookie: `sled_access=${token}` };
  try {
    for (const discMode of ['local', 'shared']) {
      const gateway = createPublicGateway({ port: 0, upstream: source.address().port, accessToken: token,
        discMode, assetPaths: emulatorAssetPaths(lock, discMode) });
      await once(gateway, 'listening');
      const base = `http://127.0.0.1:${gateway.address().port}`;
      try {
        assert.equal((await fetch(base + '/disc.zip')).status, 401);
        assert.equal((await fetch(base + '/disc.zip', { headers })).status, discMode === 'shared' ? 200 : 403);
        const info = await fetch(base + '/session-info', { headers });
        assert.equal(info.headers.get('x-invite-path'), '/access/' + token);
        for (const path of ['/invitation.js', '/disc-identity.js', '/network-core.data', '/lobby-ui.js', '/sled-storm-pal-cover.jpg'])
          assert.equal((await fetch(base + path, { headers })).status, 200, path);
        for (const path of ['/lab-state', '/diagnostic-state', '/.cache/disc.zip', '/.git/config'])
          assert.equal((await fetch(base + path, { headers })).status, 403, path);
      } finally { gateway.close(); }
    }
  } finally { source.close(); }
});

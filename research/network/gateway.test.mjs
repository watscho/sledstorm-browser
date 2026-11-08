import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { WebSocket } from 'ws';
import { createRelay } from './server.mjs';
import { createPublicGateway } from './public-server.mjs';
import { emulatorAssetPaths } from './emulator-assets.mjs';

const lock = JSON.parse(await readFile(new URL('../../emulator.lock.json', import.meta.url)));

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
  const gateway = createPublicGateway({ port: 0, upstream: source.address().port, accessToken: token,
    assetPaths: emulatorAssetPaths(lock, 'local') });
  await once(gateway, 'listening');
  const base = `http://127.0.0.1:${gateway.address().port}`;
  try {
    assert.equal((await fetch(base + '/network-core.data')).status, 401);
    const access = await fetch(base + '/access/' + token, { redirect: 'manual' });
    assert.equal(access.status, 302);
    assert.match(access.headers.get('set-cookie'), /HttpOnly/);
    const headers = { cookie: `sled_access=${token}` };
    const info = await fetch(base + '/session-info', { headers });
    assert.equal(info.status, 200);
    assert.equal(info.headers.get('x-invite-path'), '/access/' + token);
    assert.equal((await fetch(base + '/disc/1', { headers })).status, 403);
    const client = new WebSocket(base.replace('http:', 'ws:') + '/relay', { origin: base });
    const [error] = await once(client, 'error');
    assert.match(error.message, /403/);
  } finally { gateway.close(); source.close(); }
});

test('emulator gateway protects the archive, preserves reshare access and excludes diagnostics', async () => {
  assert.throws(() => createPublicGateway({ port: 0, discMode: 'shared' }), /private access token/);
  assert.throws(() => createPublicGateway({ port: 0, discMode: 'invalid' }), /Disc mode/);
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
        for (const path of ['/invitation.js', '/session-client.js', '/local-disc.js', '/disc-identity.js', '/game-data-folder.js', '/network-core.data', '/lobby-ui.js', '/sled-storm-pal-cover.jpg', '/sled-storm-logo.png', '/playstation-controller.svg', '/controls.js', '/controls-ui.js', '/lobby-mountains.svg', '/lobby-snow-trail.svg', '/display.js', '/solo-save.js', '/shaders/sharp-bilinear.glsl', '/shaders/crt-lottes.glsl', '/hardware-preview.js', '/generated/enge-hardware.js'])
          assert.equal((await fetch(base + path, { headers })).status, 200, path);
        for (const path of ['/lab-state', '/diagnostic-state', '/.cache/disc.zip', '/.git/config',
          '/game.wasm', '/manifest', '/disc/1?offset=0&length=2048'])
          assert.equal((await fetch(base + path, { headers })).status, 403, path);
      } finally { gateway.close(); }
    }
  } finally { source.close(); }
});

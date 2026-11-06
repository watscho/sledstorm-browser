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

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
  let truncateArchive = false;
  const source = http.createServer((request, response) => {
    response.setHeader('content-length', Buffer.byteLength(request.url));
    if (truncateArchive && request.url === '/disc.zip' && request.method === 'GET') {
      response.write('/disc');
      setImmediate(() => response.destroy());
      return;
    }
    response.end(request.url);
  });
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
        const archive = await fetch(base + '/disc.zip', { headers });
        assert.equal(archive.status, discMode === 'shared' ? 200 : 403);
        if (discMode === 'shared') {
          assert.equal(archive.headers.get('transfer-encoding'), 'chunked');
          assert.equal(archive.headers.get('content-length'), null);
          assert.equal(archive.headers.get('x-sledstorm-disc-size'), String(Buffer.byteLength('/disc.zip')));
          assert.equal(await archive.text(), '/disc.zip');
          const metadata = await fetch(base + '/disc.zip', { headers, method: 'HEAD' });
          assert.equal(metadata.status, 200);
          assert.equal(metadata.headers.get('content-length'), String(Buffer.byteLength('/disc.zip')));
          truncateArchive = true;
          await assert.rejects(async () => (await fetch(base + '/disc.zip', { headers })).arrayBuffer(), TypeError);
        }
        const info = await fetch(base + '/session-info', { headers });
        assert.equal(info.headers.get('x-invite-path'), '/access/' + token);
        // A gateway that refuses the disc tells the page so; the page then asks for the player's own files.
        assert.equal(info.headers.get('x-sled-disc'), discMode === 'local' ? 'local' : null);
        for (const path of ['/invitation.js', '/session-client.js', '/local-disc.js', '/disc-sheet.js', '/disc-zip.js', '/disc-identity.js', '/disc-source.js', '/disc-download.js', '/disc-parts.js', '/game-data-folder.js', '/network-core.data', '/lobby-ui.js', '/graphics-presets.js', '/performance-metrics.js', '/performance-ui.js', '/save-file.js', '/save-storage.js', '/save-manager.js', '/sled-storm-pal-cover.jpg', '/sled-storm-logo.png', '/playstation-controller.svg', '/controls.js', '/controls-ui.js', '/lobby-mountains.svg', '/lobby-snow-trail.svg', '/display.js', '/solo-save.js', '/shaders/sharp-bilinear.glsl', '/shaders/crt-lottes.glsl', '/hardware-preview.js', '/generated/enge-hardware.js'])
          assert.equal((await fetch(base + path, { headers })).status, 200, path);
        for (const path of ['/lab-state', '/diagnostic-state', '/.cache/disc.zip', '/.git/config',
          '/game.wasm', '/manifest', '/disc/1?offset=0&length=2048'])
          assert.equal((await fetch(base + path, { headers })).status, 403, path);
      } finally { gateway.close(); }
    }
  } finally { source.close(); }
});

test('every module the game page imports is served to guests', async () => {
  const { readFile } = await import('node:fs/promises');
  const web = new URL('../../web/', import.meta.url);
  const allowed = emulatorAssetPaths({ files: {} }, 'shared');
  const seen = new Set();
  const queue = ['/app.js'];
  while (queue.length) {
    const path = queue.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    // Built on the host by an optional tool; it is listed, and absent from a plain checkout.
    if (path.startsWith('/generated/')) continue;
    const source = await readFile(new URL('.' + path, web), 'utf8');
    for (const [, specifier] of source.matchAll(/(?:^|[;\n])\s*(?:import|export)\b[^'"\n]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g).map(match => [0, match[1] ?? match[2]]))
      queue.push(new URL(specifier, new URL(path, 'http://page.example')).pathname);
  }
  assert.ok(seen.size > 10, 'the page imports its modules');
  assert.deepEqual([...seen].filter(path => !allowed.has(path)), []);
});

test('the gateway serves the restore module', async () => {
  const source = http.createServer((request, response) => response.end(request.url));
  source.listen(0, '127.0.0.1'); await once(source, 'listening');
  const token = 'e'.repeat(48);
  const gateway = createPublicGateway({ port: 0, upstream: source.address().port, accessToken: token,
    assetPaths: emulatorAssetPaths(lock, 'local') });
  await once(gateway, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${gateway.address().port}/room-restore.js`,
      { headers: { cookie: `sled_access=${token}` } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '/room-restore.js');
  } finally { gateway.close(); source.close(); }
});

test('the gateway marks what it forwards, so the listener limits guests only (D94)', async () => {
  const marks = [];
  const source = http.createServer((request, response) => {
    marks.push([request.url, request.headers['x-sled-gateway']]);
    response.end('x');
  });
  source.listen(0, '127.0.0.1'); await once(source, 'listening');
  const token = 'e'.repeat(48);
  const sha = 'b2'.repeat(32);
  const gateway = createPublicGateway({ port: 0, upstream: source.address().port, accessToken: token,
    discMode: 'shared', assetPaths: emulatorAssetPaths(lock, 'shared') });
  await once(gateway, 'listening');
  const base = `http://127.0.0.1:${gateway.address().port}`;
  try {
    const paths = ['/disc.zip', '/game-data/manifest', `/game-data/${sha}/chunks/0`, '/network-core.data'];
    // A guest cannot take the mark off: the gateway sends its own headers, not the guest's.
    for (const sent of [{}, { 'x-sled-gateway': '0' }]) {
      for (const path of paths) {
        const answer = await fetch(base + path, { headers: { cookie: `sled_access=${token}`, ...sent } });
        assert.equal(answer.status, 200, path);
        await answer.arrayBuffer();
      }
    }
    assert.deepEqual(marks, [...paths, ...paths].map(path => [path, '1']));
  } finally { gateway.close(); source.close(); }
});

test('a shared gateway passes the shapes of the chunk routes and nothing else under /game-data/ (D95)', async () => {
  const seen = [];
  const source = http.createServer((request, response) => {
    seen.push(`${request.method} ${request.url}`);
    response.setHeader('content-length', Buffer.byteLength(request.url));
    response.end(request.method === 'HEAD' ? undefined : request.url);
  });
  source.listen(0, '127.0.0.1'); await once(source, 'listening');
  const token = 'f'.repeat(48), headers = { cookie: `sled_access=${token}` };
  const sha = 'a1'.repeat(32);
  // Asks for the path exactly as written: fetch would settle dot segments before it sends.
  const raw = (port, method, path) => new Promise((resolve, reject) => {
    const asked = http.request({ host: '127.0.0.1', port, method, path, headers }, answer => {
      let text = '';
      answer.setEncoding('utf8');
      answer.on('data', part => { text += part; });
      answer.once('end', () => resolve({ status: answer.statusCode, headers: answer.headers, text }));
    });
    asked.once('error', reject);
    asked.end();
  });
  const passed = [['/game-data/manifest', '/game-data/manifest'], [`/game-data/${sha}/chunks/0`, `/game-data/${sha}/chunks/0`],
    [`/game-data/${sha}/chunks/12?x=1`, `/game-data/${sha}/chunks/12`], [`/game-data/${sha}/chunks/9999999`, `/game-data/${sha}/chunks/9999999`]];
  const refused = [['GET', `/game-data/${sha}/chunks/01`], ['GET', '/%67ame-data/manifest'], ['GET', `/game-data/${sha}/chunks/%30`],
    ['GET', `/game-data/${sha.slice(1)}/chunks/0`], ['GET', `/game-data/${sha.toUpperCase()}/chunks/0`], ['GET', '/game-data/x/../manifest'],
    ['GET', '/game-data/./manifest'], ['GET', `/game-data/${sha}/chunks/x/../0`], ['GET', '/game-data/manifest/'],
    ['GET', `/game-data/${sha}/chunks/`], ['GET', `/game-data/${sha}/chunks/-1`], ['GET', `/game-data/${sha}/chunks/10000000`],
    ['GET', '/game-data/'], ['GET', '/game-data//manifest'], ['POST', '/game-data/manifest'], ['DELETE', `/game-data/${sha}/chunks/0`]];
  try {
    for (const discMode of ['shared', 'local']) {
      const gateway = createPublicGateway({ port: 0, upstream: source.address().port, accessToken: token,
        discMode, assetPaths: emulatorAssetPaths(lock, discMode) });
      await once(gateway, 'listening');
      const port = gateway.address().port;
      try {
        for (const [path, forwarded] of passed) {
          for (const method of ['GET', 'HEAD']) {
            seen.length = 0;
            const answer = await raw(port, method, path);
            if (discMode === 'local') {
              assert.equal(answer.status, 403, `${discMode} ${method} ${path}`);
              assert.deepEqual(seen, [], `${discMode} ${method} ${path} asked the upstream`);
              continue;
            }
            assert.equal(answer.status, 200, `${method} ${path}`);
            assert.deepEqual(seen, [`${method} ${forwarded}`], 'the upstream sees the path without the query');
            assert.equal(answer.headers['cache-control'], 'no-store');
            if (method === 'HEAD') assert.equal(answer.headers['content-length'], String(Buffer.byteLength(forwarded)));
            else assert.equal(answer.text, forwarded);
            // A chunk streams through the tunnel as /disc.zip does: a fixed length is buffered by a Quick Tunnel.
            if (method === 'GET' && forwarded.includes('/chunks/')) {
              assert.equal(answer.headers['content-length'], undefined, path);
              assert.equal(answer.headers['transfer-encoding'], 'chunked', path);
            }
          }
        }
        for (const [method, path] of refused) {
          seen.length = 0;
          assert.equal((await raw(port, method, path)).status, 403, `${discMode} ${method} ${path}`);
          assert.deepEqual(seen, [], `${discMode} ${method} ${path} asked the upstream`);
        }
      } finally { gateway.close(); }
    }
  } finally { source.close(); }
});

test('the host\'s changed-files answer reaches a guest with its mark (D102)', async () => {
  const source = http.createServer((request, response) => {
    response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Sled-Game-Files': 'changed' })
      .end('The game files changed. Start the server again.');
  });
  source.listen(0, '127.0.0.1'); await once(source, 'listening');
  const token = 'f'.repeat(48);
  const sha = 'c3'.repeat(32);
  const gateway = createPublicGateway({ port: 0, upstream: source.address().port, accessToken: token,
    discMode: 'shared', assetPaths: emulatorAssetPaths(lock, 'shared') });
  await once(gateway, 'listening');
  const base = `http://127.0.0.1:${gateway.address().port}`;
  try {
    for (const path of ['/disc.zip', `/game-data/${sha}/chunks/0`]) {
      for (const method of ['GET', 'HEAD']) {
        const answer = await fetch(base + path, { method, headers: { cookie: `sled_access=${token}` } });
        assert.equal(answer.status, 503, `${method} ${path}`);
        assert.equal(answer.headers.get('x-sled-game-files'), 'changed', `${method} ${path}`);
        await answer.arrayBuffer();
      }
    }
  } finally { gateway.close(); source.close(); }
});

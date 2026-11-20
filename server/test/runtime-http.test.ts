// The first four tests are the cases of tools/test-emulator-server.py, ported
// to the TypeScript runtime. Synthetic files only, never game data.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { request, type IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startRuntimeHttp, type RuntimeHttpOptions } from '../src/runtime-http.ts';

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

async function site(t: TestContext, overrides: Partial<RuntimeHttpOptions> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sled web тест ')));
  const web = join(root, 'web');
  const emulator = join(root, 'emulatorjs');
  await mkdir(join(web, 'shaders'), { recursive: true });
  await mkdir(join(emulator, 'cores'), { recursive: true });
  await writeFile(join(web, 'index.html'), '<!doctype html><title>Synthetic</title>');
  await writeFile(join(web, 'app.js'), 'export {};\n');
  await writeFile(join(web, 'style.css'), 'body{}\n');
  await writeFile(join(web, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(web, 'shaders', 'a.glsl'), 'void main(){}\n');
  await writeFile(join(web, '.hidden'), 'hidden');
  await writeFile(join(emulator, 'loader.js'), '// loader\n');
  await writeFile(join(emulator, 'cores', 'core.wasm'), Buffer.from([0, 97, 115, 109]));
  await writeFile(join(root, 'core.data'), 'core');
  await writeFile(join(root, 'secret'), 'secret');
  await symlink(join(root, 'secret'), join(web, 'link.js'));
  const server = await startRuntimeHttp({
    port: 0, webRoot: web, emulatorRoot: emulator, coreData: join(root, 'core.data'), hardwareRenderer: false,
    sessionInfo: { discMode: 'local' }, invitation: () => null, archive: null, ...overrides,
  });
  t.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  const call = (path: string, { method = 'GET', headers = {} }: { method?: string; headers?: Record<string, string> } = {}) =>
    new Promise<Reply>((resolve, reject) => {
      const outgoing = request({ host: '127.0.0.1', port: server.port, method, path,
        headers: { host: `127.0.0.1:${server.port}`, ...headers } }, incoming => {
        const parts: Buffer[] = [];
        incoming.on('data', (part: Buffer) => parts.push(part));
        incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: Buffer.concat(parts) }));
      });
      outgoing.on('error', reject);
      outgoing.end();
    });
  return { root, web, server, port: server.port, call };
}

const disc = (text: string) => ({ size: Buffer.byteLength(text), open: async () => Readable.from([Buffer.from(text)], { objectMode: false }) });

test('the public invitation appears only when it is well formed', async t => {
  const published = { origin: 'https://synthetic-test.trycloudflare.com', path: `/access/${'a'.repeat(48)}` };
  let invitation: { origin: string; path: string } | null = published;
  const { call } = await site(t, { invitation: () => invitation });
  const reply = await call('/session-info');
  assert.equal(reply.status, 200);
  assert.equal(reply.headers['content-type'], 'application/json');
  assert.equal(reply.headers['x-invite-origin'], published.origin);
  assert.equal(reply.headers['x-invite-path'], published.path);
  assert.deepEqual(JSON.parse(reply.body.toString()), { discMode: 'local' });
  for (const invalid of [{ ...published, origin: 'https://foreign.example' }, { ...published, path: '/' },
    { ...published, origin: 'http://synthetic-test.trycloudflare.com' }, { ...published, path: `${published.path}/more` },
    { ...published, origin: `${published.origin}.example` }, null]) {
    invitation = invalid;
    const { headers } = await call('/session-info');
    assert.equal(headers['x-invite-origin'], undefined, JSON.stringify(invalid));
    assert.equal(headers['x-invite-path'], undefined, JSON.stringify(invalid));
  }
});

test('the hardware renderer header follows the flag', async t => {
  assert.equal((await (await site(t)).call('/session-info')).headers['x-sled-hardware-renderer'], undefined);
  const enabled = await site(t, { hardwareRenderer: true });
  assert.equal((await enabled.call('/session-info')).headers['x-sled-hardware-renderer'], 'webgl2');
});

test('a private disc is not served and a foreign host is refused', async t => {
  assert.equal((await (await site(t)).call('/disc.zip')).status, 404);
  const shared = await site(t, { archive: disc('synthetic disc') });
  const reply = await shared.call('/disc.zip');
  assert.equal(reply.status, 200);
  assert.equal(reply.body.toString(), 'synthetic disc');
  assert.equal(reply.headers['content-length'], '14');
  assert.equal(reply.headers['content-type'], 'application/zip');
  assert.equal((await shared.call('/', { method: 'HEAD', headers: { host: 'foreign.example' } })).status, 403);
  assert.equal((await shared.call('/', { headers: { host: `127.0.0.1:${shared.port + 1}` } })).status, 403);
  assert.equal((await shared.call('/', { headers: { host: `localhost:${shared.port}` } })).status, 200);
});

test('uploads are refused', async t => {
  const { call, port } = await site(t);
  const reply = await call('/diagnostic-state?frame=1000&seat=3', { method: 'POST', headers: { origin: `http://127.0.0.1:${port}` } });
  assert.equal(reply.status, 405);
  assert.equal(reply.headers.allow, 'GET, HEAD');
});

test('every reply carries the isolation headers', async t => {
  const { call } = await site(t);
  for (const reply of [await call('/'), await call('/missing.js'), await call('/', { headers: { host: 'foreign.example' } }),
    await call('/', { method: 'DELETE' }), await call('/%zz'), await call('/session-info')]) {
    assert.equal(reply.headers['cross-origin-opener-policy'], 'same-origin', String(reply.status));
    assert.equal(reply.headers['cross-origin-embedder-policy'], 'require-corp', String(reply.status));
    assert.equal(reply.headers['x-content-type-options'], 'nosniff', String(reply.status));
  }
});

test('cache control follows the route', async t => {
  const { call } = await site(t, { archive: disc('synthetic disc') });
  assert.equal((await call('/session-info')).headers['cache-control'], 'no-store');
  assert.equal((await call('/emulator/loader.js')).headers['cache-control'], undefined);
  assert.equal((await call('/disc.zip')).headers['cache-control'], undefined);
  assert.equal((await call('/app.js')).headers['cache-control'], 'no-cache');
  assert.equal((await call('/network-core.data')).headers['cache-control'], 'no-cache');
  assert.equal((await call('/missing.js')).headers['cache-control'], 'no-cache');
});

test('static files have a type, a length and a date', async t => {
  const { call } = await site(t);
  const expected: [string, string, string | Buffer][] = [
    ['/', 'text/html; charset=utf-8', '<!doctype html><title>Synthetic</title>'],
    ['/index.html', 'text/html; charset=utf-8', '<!doctype html><title>Synthetic</title>'],
    ['/app.js?v=1.1.0', 'text/javascript; charset=utf-8', 'export {};\n'],
    ['/style.css', 'text/css; charset=utf-8', 'body{}\n'],
    ['/logo.svg', 'image/svg+xml; charset=utf-8', '<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['/shaders/a.glsl', 'application/octet-stream', 'void main(){}\n'],
    ['/emulator/loader.js', 'text/javascript; charset=utf-8', '// loader\n'],
    ['/emulator/cores/core.wasm', 'application/wasm', Buffer.from([0, 97, 115, 109])],
    ['/network-core.data', 'application/octet-stream', 'core'],
  ];
  for (const [path, type, content] of expected) {
    const reply = await call(path);
    assert.equal(reply.status, 200, path);
    assert.equal(reply.headers['content-type'], type, path);
    assert.ok(reply.body.equals(Buffer.from(content)), path);
    assert.equal(reply.headers['content-length'], String(reply.body.length), path);
    assert.ok(!Number.isNaN(Date.parse(String(reply.headers['last-modified']))), path);
  }
});

test('a conditional request gets 304', async t => {
  const { call, web } = await site(t);
  const modified = new Date('2026-01-02T03:04:05.678Z');
  await utimes(join(web, 'app.js'), modified, modified);
  assert.equal((await call('/app.js')).headers['last-modified'], 'Fri, 02 Jan 2026 03:04:05 GMT');
  const since = (value: string) => call('/app.js', { headers: { 'if-modified-since': value } });
  const unchanged = await since('Fri, 02 Jan 2026 03:04:05 GMT');
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.body.length, 0);
  assert.equal((await since('Sat, 03 Jan 2026 00:00:00 GMT')).status, 304);
  assert.equal((await since('Thu, 01 Jan 2026 00:00:00 GMT')).status, 200);
  assert.equal((await since('not a date')).status, 200);
});

test('HEAD sends no body', async t => {
  const { call } = await site(t, { archive: disc('synthetic disc') });
  for (const [path, length] of [['/app.js', '11'], ['/disc.zip', '14'], ['/session-info', '20']] as const) {
    const reply = await call(path, { method: 'HEAD' });
    assert.equal(reply.status, 200, path);
    assert.equal(reply.headers['content-length'], length, path);
    assert.equal(reply.body.length, 0, path);
  }
});

test('paths cannot leave their root', async t => {
  const { call } = await site(t);
  for (const path of ['/../secret', '/%2e%2e/secret', '/emulator/%2e%2e/%2e%2e/secret', '/emulator/../../secret',
    '/emulator/../core.data', '/a%00b', '/a%5cb', '/.hidden', '/shaders', '/shaders/', '/emulator/', '/emulator/cores',
    '/link.js', '/missing.js', '//secret', '/web/index.html']) {
    const reply = await call(path);
    assert.equal(reply.status, 404, path);
    assert.ok(!reply.body.includes('secret') && !reply.body.includes('hidden'), path);
  }
  assert.equal((await call('/%zz')).status, 400);
});

test('the archive stops when the client goes away', async t => {
  let destroyed = false;
  const endless = () => new Readable({
    read() { setTimeout(() => this.push(Buffer.alloc(64 * 1024, 1)), 5); },
    destroy(error, done) { destroyed = true; done(error); },
  });
  const { call, port } = await site(t, { archive: { size: 1024 ** 3, open: async () => endless() } });
  const socket = connect(port, '127.0.0.1');
  socket.write(`GET /disc.zip HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
  await once(socket, 'data');
  socket.destroy();
  for (let attempt = 0; !destroyed && attempt < 100; attempt++) await delay(20);
  assert.ok(destroyed, 'the archive stream is destroyed once the client is gone');
  assert.equal((await call('/session-info')).status, 200, 'the server keeps serving');
});

test('a changed disc gives 503', async t => {
  const { call } = await site(t, { archive: { size: 14, open: () => Promise.reject(new Error('changed')) } });
  const reply = await call('/disc.zip');
  assert.equal(reply.status, 503);
  assert.notEqual(reply.headers['content-type'], 'application/zip');
  assert.equal((await call('/disc.zip', { method: 'HEAD' })).status, 503, 'HEAD must not promise an archive that GET refuses');
});

test('a closed server stops answering', async t => {
  const { call, server } = await site(t);
  assert.equal((await call('/')).status, 200);
  await server.close();
  await assert.rejects(call('/'));
});

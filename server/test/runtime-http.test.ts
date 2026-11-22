// The first four tests are the cases of tools/test-emulator-server.py, ported
// to the TypeScript runtime. Synthetic files only, never game data.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const stream = (bytes: Buffer) => Readable.from([bytes], { objectMode: false });

/** A stand-in archive of synthetic text in chunks of `chunkSize` bytes, with its manifest. */
function disc(text: string, chunkSize = 4) {
  const bytes = Buffer.from(text);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) chunks.push(sha256(bytes.subarray(offset, offset + chunkSize)));
  const manifest = { disc: 'd'.repeat(64), pal: false, archive: { sha256: sha256(bytes), size: bytes.length, chunkSize, chunks } };
  const chunk = (index: number) => bytes.subarray(index * chunkSize, (index + 1) * chunkSize);
  return { size: bytes.length, manifest, chunk, open: async () => stream(bytes), openChunk: async (index: number) => stream(chunk(index)) };
}

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
  // The emulator's files have the same names in every build, so a kept copy is asked about each time.
  assert.equal((await call('/emulator/loader.js')).headers['cache-control'], 'no-cache');
  assert.equal((await call('/emulator/cores/core.wasm')).headers['cache-control'], 'no-cache');
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

test('a kept copy is confirmed by its tag', async t => {
  const { call, web } = await site(t);
  const modified = new Date('2026-01-02T03:04:05.678Z');
  await utimes(join(web, 'app.js'), modified, modified);
  const first = await call('/app.js');
  assert.equal(first.headers['last-modified'], 'Fri, 02 Jan 2026 03:04:05 GMT');
  const tag = String(first.headers.etag);
  assert.match(tag, /^"[0-9a-f]+-[0-9a-f]+"$/);
  const unchanged = await call('/app.js', { headers: { 'if-none-match': tag } });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.body.length, 0);
  assert.equal(unchanged.headers.etag, tag);
  // A browser sends the date along with the tag, and may send several tags.
  const both = { 'if-none-match': tag, 'if-modified-since': 'Thu, 01 Jan 2026 00:00:00 GMT' };
  assert.equal((await call('/app.js', { headers: both })).status, 304);
  assert.equal((await call('/app.js', { headers: { 'if-none-match': `"1-1", W/${tag}` } })).status, 304);
  assert.equal((await call('/app.js', { headers: { 'if-none-match': '"1-1"' } })).status, 200);
});

test('a date alone confirms nothing', async t => {
  // The Python launcher serves this address too, and so does every other build. A copy kept from one of
  // them carries only a date, and a later date does not make it the file of this build.
  const { call, web } = await site(t);
  const modified = new Date('2026-01-02T03:04:05.678Z');
  await utimes(join(web, 'app.js'), modified, modified);
  for (const date of ['Fri, 02 Jan 2026 03:04:05 GMT', 'Sat, 03 Jan 2026 00:00:00 GMT', 'Thu, 01 Jan 2026 00:00:00 GMT', 'not a date']) {
    const reply = await call('/app.js', { headers: { 'if-modified-since': date } });
    assert.equal(reply.status, 200, date);
    assert.equal(reply.body.toString(), 'export {};\n', date);
  }
});

test('a file that changed has another tag', async t => {
  const { call, web } = await site(t);
  const tagOf = async () => String((await call('/app.js')).headers.etag);
  const early = new Date('2026-01-02T03:04:05.000Z');
  await utimes(join(web, 'app.js'), early, early);
  const first = await tagOf();
  // The same length at another time, as two builds of one file have.
  const later = new Date('2026-01-02T03:04:06.000Z');
  await utimes(join(web, 'app.js'), later, later);
  const second = await tagOf();
  assert.notEqual(second, first);
  await writeFile(join(web, 'app.js'), 'export {}; // longer\n');
  await utimes(join(web, 'app.js'), later, later);
  assert.notEqual(await tagOf(), second);
  assert.equal((await call('/app.js', { headers: { 'if-none-match': first } })).status, 200);
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
  const { call, port } = await site(t, { archive: { ...disc('synthetic disc'), size: 1024 ** 3, open: async () => endless() } });
  const socket = connect(port, '127.0.0.1');
  socket.write(`GET /disc.zip HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
  await once(socket, 'data');
  socket.destroy();
  for (let attempt = 0; !destroyed && attempt < 100; attempt++) await delay(20);
  assert.ok(destroyed, 'the archive stream is destroyed once the client is gone');
  assert.equal((await call('/session-info')).status, 200, 'the server keeps serving');
});

test('a changed disc gives 503', async t => {
  const { call } = await site(t, { archive: { ...disc('synthetic disc'), open: () => Promise.reject(new Error('changed')) } });
  const reply = await call('/disc.zip');
  assert.equal(reply.status, 503);
  assert.notEqual(reply.headers['content-type'], 'application/zip');
  // The page tells the host's changed game files from a proxy's 503 by this mark (D102).
  assert.equal(reply.headers['x-sled-game-files'], 'changed');
  const head = await call('/disc.zip', { method: 'HEAD' });
  assert.equal(head.status, 503, 'HEAD must not promise an archive that GET refuses');
  assert.equal(head.headers['x-sled-game-files'], 'changed', 'HEAD');
});

test('a closed server stops answering', async t => {
  const { call, server } = await site(t);
  assert.equal((await call('/')).status, 200);
  await server.close();
  await assert.rejects(call('/'));
});

const chunkPath = (archive: ReturnType<typeof disc>, index: number | string) =>
  `/game-data/${archive.manifest.archive.sha256}/chunks/${index}`;

/** Whether the promise settles within `ms`. */
const settlesWithin = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then(() => true, () => true), delay(ms).then(() => false)]);

/** What the gateway adds to every request it forwards: the limit is for guests (D94). */
const GUEST = { 'x-sled-gateway': '1' };
const guestRequest = (port: number, path: string) =>
  `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nX-Sled-Gateway: 1\r\n\r\n`;

/** A raw client that asks for `path` through the gateway and has its first bytes. */
async function holder(port: number, path: string) {
  const socket = connect(port, '127.0.0.1');
  socket.write(guestRequest(port, path));
  await once(socket, 'data');
  socket.on('data', () => {});
  return socket;
}

function endlessStream(onDestroy: () => void, size = 64 * 1024) {
  return new Readable({
    read() { setImmediate(() => this.push(Buffer.alloc(size, 1))); },
    destroy(error, done) { onDestroy(); done(error); },
  });
}

test('the manifest names the archive and its chunks', async t => {
  const archive = disc('synthetic disc');
  const { call } = await site(t, { archive });
  const reply = await call('/game-data/manifest');
  assert.equal(reply.status, 200);
  assert.equal(reply.headers['content-type'], 'application/json');
  assert.equal(reply.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(reply.body.toString()), { version: 1, ...archive.manifest });
  assert.equal(archive.manifest.archive.chunks.length, 4);
  const head = await call('/game-data/manifest', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-length'], String(reply.body.length));
  assert.equal(head.body.length, 0);
  assert.equal((await (await site(t)).call('/game-data/manifest')).status, 404, 'a private disc has no manifest');
});

test('a chunk is its bytes', async t => {
  const archive = disc('synthetic disc');
  const { call } = await site(t, { archive });
  for (const index of [0, 1, 2, 3]) {
    const reply = await call(chunkPath(archive, index));
    assert.equal(reply.status, 200, String(index));
    assert.equal(reply.headers['content-type'], 'application/octet-stream');
    assert.equal(reply.headers['cache-control'], 'no-store');
    assert.equal(reply.headers['content-length'], String(archive.chunk(index).length));
    assert.deepEqual(reply.body, archive.chunk(index));
  }
  assert.equal((await call(chunkPath(archive, 3))).body.toString(), 'sc', 'the last chunk is shorter');
  const head = await call(chunkPath(archive, 1), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-length'], '4');
  assert.equal(head.body.length, 0);
  assert.equal((await call(`${chunkPath(archive, 2)}?x=1`)).body.toString(), 'c di', 'the query is ignored');
});

test('a chunk of another archive or a bad index reads nothing', async t => {
  const archive = disc('synthetic disc');
  let opened = 0;
  const { call } = await site(t, { archive: { ...archive, openChunk: async index => { opened += 1; return archive.openChunk(index); } } });
  const { sha256: id } = archive.manifest.archive;
  for (const path of [`/game-data/${'e'.repeat(64)}/chunks/0`, `/game-data/${id.toUpperCase()}/chunks/0`,
    `/game-data/${id}/chunks/4`, `/game-data/${id}/chunks/01`, `/game-data/${id}/chunks/-1`, `/game-data/${id}/chunks/1.0`,
    `/game-data/${id}/chunks/1e1`, `/game-data/${id}/chunks/x`, `/game-data/${id}/chunks/`, `/game-data/${id}/chunks/0/`,
    `/game-data/${id}/chunks/%30`, `/game-data/${id}/chunks/${'9'.repeat(400)}`, `/game-data/${id}/./chunks/0`,
    `/game-data/${id.slice(1)}/chunks/0`, '/game-data/', '/game-data/manifest/x', '/game-data/manifest/', '/%67ame-data/manifest',
    `/%67ame-data/${id}/chunks/0`]) {
    const reply = await call(path);
    assert.equal(reply.status, 404, path);
  }
  assert.equal(opened, 0, 'no chunk was opened');
  assert.equal((await (await site(t)).call(chunkPath(archive, 0))).status, 404, 'a private disc has no chunks');
});

test('a changed disc gives 503 for a chunk', async t => {
  const archive = disc('synthetic disc');
  const { call } = await site(t, { archive: { ...archive, openChunk: () => Promise.reject(new Error('changed')) } });
  for (const method of ['GET', 'HEAD']) {
    const reply = await call(chunkPath(archive, 0), { method });
    assert.equal(reply.status, 503, method);
    assert.notEqual(reply.headers['content-type'], 'application/octet-stream');
    assert.equal(reply.headers['x-sled-game-files'], 'changed', method);
  }
});

test('deliveries beyond the limit wait, and beyond the queue are refused', async t => {
  const archive = disc('synthetic disc');
  let destroyed = 0;
  const { call, port } = await site(t, { delivery: { active: 1, waiting: 1, idleMs: 30_000 }, archive: { ...archive,
    openChunk: async index => index === 0 ? endlessStream(() => { destroyed += 1; }) : archive.openChunk(index) } });
  const first = await holder(port, chunkPath(archive, 0));
  const waiting = call(chunkPath(archive, 1), { headers: GUEST });
  assert.equal(await settlesWithin(waiting, 200), false, 'the second waits for the first');
  for (const path of [chunkPath(archive, 2), '/disc.zip']) {
    const refused = await call(path, { headers: GUEST });
    assert.equal(refused.status, 503, path);
    assert.equal(refused.headers['retry-after'], '2', path);
    assert.equal(refused.headers['x-sled-game-files'], undefined, `the limit's 503 is not the changed files' ${path}`);
    assert.equal(refused.body.toString(), 'The server is busy. Try again shortly.', path);
  }
  assert.equal((await call('/game-data/manifest')).status, 200, 'the manifest is outside the limit');
  assert.equal((await call('/session-info')).status, 200);
  first.destroy();
  const served = await waiting;
  assert.equal(served.status, 200);
  assert.deepEqual(served.body, archive.chunk(1));
  for (let attempt = 0; destroyed === 0 && attempt < 100; attempt++) await delay(20);
  assert.equal(destroyed, 1, 'the first stream stopped with its client');
});

test('a waiting client that goes leaves the queue', async t => {
  const archive = disc('synthetic disc');
  const { call, port } = await site(t, { delivery: { active: 1, waiting: 1, idleMs: 30_000 }, archive: { ...archive,
    openChunk: async index => index === 0 ? endlessStream(() => {}) : archive.openChunk(index) } });
  const first = await holder(port, chunkPath(archive, 0));
  const leaving = connect(port, '127.0.0.1');
  leaving.write(guestRequest(port, chunkPath(archive, 1)));
  await delay(100);
  leaving.destroy();
  await delay(100);
  const next = call(chunkPath(archive, 2), { headers: GUEST });
  assert.equal(await settlesWithin(next, 200), false, 'the next one waits instead of being refused');
  first.destroy();
  const served = await next;
  assert.equal(served.status, 200);
  assert.deepEqual(served.body, archive.chunk(2));
});

test('a delivery on this computer is outside the guests\' limit, and so is a HEAD (D94)', async t => {
  const archive = disc('synthetic disc');
  let reads = 0;
  let closed = 0;
  // A source that counts what is read from it.
  const counted = (bytes: Buffer) => new Readable({
    read() { reads += 1; this.push(bytes); this.push(null); },
    destroy(error, done) { closed += 1; done(error); },
  });
  const { call, port } = await site(t, { delivery: { active: 1, waiting: 1, idleMs: 30_000 }, archive: { ...archive,
    open: async () => counted(Buffer.from('synthetic disc')),
    openChunk: async index => index === 0 ? endlessStream(() => {}) : counted(archive.chunk(index)) } });
  const first = await holder(port, chunkPath(archive, 0));
  t.after(() => first.destroy());
  const waiting = call(chunkPath(archive, 1), { headers: GUEST });
  assert.equal(await settlesWithin(waiting, 200), false, 'the place and the queue are taken');
  for (const path of [chunkPath(archive, 2), '/disc.zip']) {
    reads = 0;
    closed = 0;
    const head = await call(path, { method: 'HEAD', headers: GUEST });
    assert.equal(head.status, 200, `HEAD ${path} does not wait`);
    assert.ok(Number(head.headers['content-length']) > 0, `HEAD ${path}`);
    assert.equal(reads, 0, `HEAD ${path} reads nothing`);
    assert.equal(closed, 1, `HEAD ${path} closes its source`);
  }
  assert.equal((await call(chunkPath(archive, 2), { headers: GUEST })).status, 503, 'a guest is still refused');
  // The room's emulator and the owner's page come over loopback, not through the gateway.
  const local = await call('/disc.zip');
  assert.equal(local.status, 200, 'the disc on this computer does not wait for guests');
  assert.equal(local.body.toString(), 'synthetic disc');
  const chunk = await call(chunkPath(archive, 2));
  assert.equal(chunk.status, 200);
  assert.deepEqual(chunk.body, archive.chunk(2));
  first.destroy();
  assert.equal((await waiting).status, 200);
});

test('a client that stops reading loses its place', async t => {
  const archive = disc('synthetic disc');
  let destroyed = 0;
  const { call, port } = await site(t, { delivery: { active: 1, waiting: 1, idleMs: 300 }, archive: { ...archive,
    openChunk: async index => index === 0 ? endlessStream(() => { destroyed += 1; }, 1024 * 1024) : archive.openChunk(index) } });
  const stalled = connect(port, '127.0.0.1');
  t.after(() => stalled.destroy());
  stalled.pause();
  stalled.write(guestRequest(port, chunkPath(archive, 0)));
  await delay(100);
  const next = call(chunkPath(archive, 1), { headers: GUEST });
  assert.equal(await settlesWithin(next, 5000), true, 'the place is freed');
  const served = await next;
  assert.equal(served.status, 200);
  assert.deepEqual(served.body, archive.chunk(1));
  assert.equal(destroyed, 1, 'the stalled stream was stopped');
});

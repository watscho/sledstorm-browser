import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { memoryPartStore, partLength } from './disc-parts.js';
import { CONCURRENCY, MAX_CHUNK_SIZE, MAX_FAILURES, downloadDisc, downloadWhole } from './disc-download.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const info = { disc: 'a'.repeat(64), pal: true };

/** Synthetic bytes and the manifest's archive for them (server/src/game-data.ts, ArchiveManifest). */
function archiveOf(text, chunkSize = 4) {
  const bytes = Buffer.from(text);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) chunks.push(sha256(bytes.subarray(offset, offset + chunkSize)));
  return { bytes, archive: { sha256: sha256(bytes), size: bytes.length, chunkSize, chunks } };
}
const partOf = ({ bytes, archive }, index) =>
  bytes.subarray(index * archive.chunkSize, index * archive.chunkSize + partLength(archive, index));
const manifestOf = ({ archive }, extra = {}) => ({ version: 1, disc: info.disc, pal: info.pal, archive, ...extra });

const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}

/** A body that a request's abort ends with an error, as the browser's fetch does. */
function bodyOf(bytes, signal, { stall = false, pieces = [bytes] } = {}) {
  return new ReadableStream({
    start(controller) {
      signal?.addEventListener('abort', () => { try { controller.error(abortError()); } catch {} }, { once: true });
      if (stall) return controller.enqueue(new Uint8Array(bytes.subarray(0, 1)));
      setTimeout(() => {
        try {
          for (const piece of pieces) controller.enqueue(new Uint8Array(piece));
          controller.close();
        } catch {}
      }, 1);
    },
  });
}
const ok = (bytes, signal, options) => new Response(bodyOf(bytes, signal, options), { status: 200 });
/** An answer whose bytes come one at a time, `every` ms apart; with `never`, headers and no byte at all. */
function trickle(bytes, signal, { every = 10, never = false } = {}) {
  return new Response(new ReadableStream({
    async start(controller) {
      signal?.addEventListener('abort', () => { try { controller.error(abortError()); } catch {} }, { once: true });
      if (never) return;
      try {
        for (const byte of bytes) {
          await delay(every, signal);
          controller.enqueue(new Uint8Array([byte]));
        }
        controller.close();
      } catch {}
    },
  }), { status: 200 });
}
const status = (code, headers = {}) => new Response(`status ${code}`, { status: code, headers });

const CHUNK = /^\/game-data\/([a-f0-9]{64})\/chunks\/(0|[1-9][0-9]*)$/;

/**
 * A stand-in server. `manifest(attempt, init)` gives the manifest or null for 404; `chunk(sha, index, attempt, init)` and
 * `whole(attempt, init)` give a Response. It records every request and the most requests waiting for an answer.
 */
function fakeServer({ manifest = () => null, chunk, whole }) {
  const state = { requests: [], maxPending: 0 };
  const counts = new Map();
  let pending = 0;
  state.fetch = async (url, init = {}) => {
    state.requests.push(url);
    const attempt = (counts.get(url) ?? 0) + 1;
    counts.set(url, attempt);
    pending++;
    state.maxPending = Math.max(state.maxPending, pending);
    try {
      await delay(2, init.signal);
      if (url === '/game-data/manifest') {
        const value = await manifest(attempt, init);
        return value ? Response.json(value) : status(404);
      }
      const match = CHUNK.exec(url);
      if (match) return await chunk(match[1], Number(match[2]), attempt, init);
      if (url === '/disc.zip' && whole) return await whole(attempt, init);
      return status(404);
    } finally { pending--; }
  };
  state.chunkRequests = () => state.requests.filter(url => CHUNK.test(url));
  return state;
}

/** A server of one archive whose chunks answer as `answer(index, attempt, init)` says, or whole by default. */
function archiveServer(fixture, answer = () => undefined) {
  return fakeServer({
    manifest: () => manifestOf(fixture),
    chunk: async (sha, index, attempt, init) => {
      assert.equal(sha, fixture.archive.sha256);
      return await answer(index, attempt, init) ?? ok(partOf(fixture, index), init.signal);
    },
  });
}

function options(server, extra = {}) {
  const slept = [], reports = [];
  return {
    slept, reports,
    fetch: server.fetch,
    sleep: async ms => { slept.push(ms); },
    report: text => reports.push(text),
    ...extra,
  };
}
const bytesOf = async file => Buffer.from(await file.arrayBuffer());

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const CHANGED = "The server's game data changed. Reload the invitation to try again.";
const HOST_CHANGED = "The host's game files changed. Ask the host to start hosting again, then reload the invitation.";
const STOPPED = 'Game data stopped downloading. Reload the invitation to continue.';
const STOPPED_OVER = 'Game data stopped downloading. Reload the invitation to try again.';
/** A store that keeps its parts on disk, as the private file system's does, over the memory store's behaviour. */
const savedStore = (archive, reason = null) => Object.assign(memoryPartStore(archive), {
  persistent: true, hasSavedParts: true, reason,
});
/** The note on the progress lines for each reason of the store (D101). */
const NOTES = {
  unsupported: ' · this browser does not save it, a reload starts over',
  unavailable: ' · this browser does not save it, a reload starts over',
  quota: ' · too little browser storage to save it, a reload starts over',
  busy: ' · another tab holds the saved download, a reload here starts over',
  full: ' · browser storage is full, a reload fetches the unsaved part again',
};

test('the manifest\'s 404 falls back to the whole /disc.zip', async () => {
  const fixture = archiveOf('abcdefghij');
  const server = fakeServer({ whole: (attempt, init) => ok(fixture.bytes, init.signal) });
  const result = await downloadDisc(info, options(server));
  assert.equal(result.chunked, false);
  assert.deepEqual(await bytesOf(result.file), fixture.bytes);
  assert.deepEqual(server.requests, ['/game-data/manifest', '/disc.zip']);
  await result.discard();
});

test('every chunk is fetched, two at a time, and checked', async () => {
  const fixture = archiveOf('abcdefghijklmnopqrstuvwxyz0123456789', 4);
  assert.equal(fixture.archive.chunks.length, 9);
  const server = archiveServer(fixture);
  const result = await downloadDisc(info, options(server));
  assert.equal(result.chunked, true);
  assert.equal(result.file.name, 'disc.zip');
  assert.deepEqual(await bytesOf(result.file), fixture.bytes);
  assert.equal(server.chunkRequests().length, 9);
  assert.equal(CONCURRENCY, 2);
  assert.equal(server.maxPending, 2);
});

test('checked parts are used again', async () => {
  const fixture = archiveOf('abcdefghij');
  const store = memoryPartStore(fixture.archive);
  await store.put(0, partOf(fixture, 0));
  await store.put(2, partOf(fixture, 2));
  const server = archiveServer(fixture);
  const result = await downloadDisc(info, options(server, { openStore: async () => store }));
  assert.deepEqual(server.chunkRequests(), [`/game-data/${fixture.archive.sha256}/chunks/1`]);
  assert.deepEqual(await bytesOf(result.file), fixture.bytes);
});

test('a corrupt chunk is never stored and is fetched again', async () => {
  const fixture = archiveOf('abcdefghij');
  const store = memoryPartStore(fixture.archive);
  const stored = [];
  const put = store.put;
  store.put = async (index, bytes) => { stored.push([index, Buffer.from(bytes).toString()]); await put(index, bytes); };
  const server = archiveServer(fixture, (index, attempt, init) =>
    index === 1 && attempt === 1 ? ok(Buffer.from('EFGH'), init.signal) : undefined);
  const run = options(server, { openStore: async () => store });
  const result = await downloadDisc(info, run);
  assert.deepEqual(await bytesOf(result.file), fixture.bytes);
  assert.equal(stored.some(([, text]) => text === 'EFGH'), false);
  assert.deepEqual(stored.filter(([index]) => index === 1), [[1, 'efgh']]);
  assert.deepEqual(run.slept, [1000]);
});

test('a chunk of the wrong length is fetched again', async () => {
  const fixture = archiveOf('abcdefghij');
  const server = archiveServer(fixture, (index, attempt, init) => {
    if (index === 0 && attempt === 1) return ok(Buffer.from('abc'), init.signal);
    // The right bytes, then one more: the manifest's length ends the chunk, whatever follows.
    if (index === 0 && attempt === 2) return ok(Buffer.from('abcde'), init.signal, { pieces: [Buffer.from('abcd'), Buffer.from('e')] });
  });
  const run = options(server);
  const result = await downloadDisc(info, run);
  assert.deepEqual(await bytesOf(result.file), fixture.bytes);
  assert.equal(server.requests.filter(url => url.endsWith('/chunks/0')).length, 3);
  assert.deepEqual(run.slept, [1000, 2000]);
});

test('a busy server is a pause, not a failure', async () => {
  const fixture = archiveOf('abcdefghij');
  const server = archiveServer(fixture, index =>
    index === 0 && server.requests.filter(url => url.endsWith('/chunks/0')).length <= 6
      ? status(503, { 'Retry-After': '2' }) : undefined);
  const run = options(server);
  const result = await downloadDisc(info, run);
  assert.deepEqual(await bytesOf(result.file), fixture.bytes);
  assert.ok(6 > MAX_FAILURES);
  assert.deepEqual(run.slept, Array(6).fill(2000));
  assert.ok(run.reports.some(text => text.startsWith('The server is busy · waiting to continue')));
});

test('Retry-After is held between 1 and 30 seconds', async () => {
  const fixture = archiveOf('abcd');
  const waits = ['0', '120', 'soon'];
  const server = archiveServer(fixture, (index, attempt) =>
    attempt <= waits.length ? status(503, { 'Retry-After': waits[attempt - 1] }) : undefined);
  const run = options(server);
  await downloadDisc(info, run);
  assert.deepEqual(run.slept, [1000, 30000, 2000]);
});

test('the time before an answer has no stall deadline', async () => {
  const fixture = archiveOf('abcdefghij');
  const server = archiveServer(fixture, async (index, attempt, init) => {
    if (index === 0 && attempt === 1) {
      await delay(100, init.signal);
      return ok(partOf(fixture, 0), init.signal);
    }
  });
  const run = options(server, { deadlines: { answer: 1000, stall: 30 } });
  const result = await downloadDisc(info, run);
  assert.deepEqual(await bytesOf(result.file), fixture.bytes);
  assert.equal(server.requests.filter(url => url.endsWith('/chunks/0')).length, 1);
  assert.deepEqual(run.slept, []);
});

test('an answer that never comes is asked again after the answer deadline', async () => {
  const fixture = archiveOf('abcd');
  const server = archiveServer(fixture, async (index, attempt, init) => {
    if (attempt === 1) await delay(10_000, init.signal);
  });
  const run = options(server, { deadlines: { answer: 50, stall: 30 } });
  const result = await downloadDisc(info, run);
  assert.deepEqual(await bytesOf(result.file), fixture.bytes);
  assert.deepEqual(run.slept, [1000]);
});

test('a stalled answer is cut and asked again', async () => {
  const fixture = archiveOf('abcdefghij');
  const server = archiveServer(fixture, (index, attempt, init) =>
    index === 0 && attempt === 1 ? ok(partOf(fixture, 0), init.signal, { stall: true }) : undefined);
  const run = options(server, { deadlines: { answer: 1000, stall: 30 } });
  const result = await downloadDisc(info, run);
  assert.deepEqual(await bytesOf(result.file), fixture.bytes);
  assert.equal(server.requests.filter(url => url.endsWith('/chunks/0')).length, 2);
  assert.deepEqual(run.slept, [1000]);
});

const CHANGED_FILES = { 'X-Sled-Game-Files': 'changed' };

test('a 503 marked as the host\'s changed game files stops the download', async () => {
  const fixture = archiveOf('abcdefghij');
  for (const headers of [CHANGED_FILES, { ...CHANGED_FILES, 'Retry-After': '2' }]) {
    // Only the first answer is the 503: a download that read it as a pause or a failure would complete.
    const server = archiveServer(fixture, (index, attempt) => index === 1 && attempt === 1 ? status(503, headers) : undefined);
    const run = options(server);
    await assert.rejects(downloadDisc(info, run), { message: HOST_CHANGED });
    assert.equal(server.requests.filter(url => url.endsWith('/chunks/1')).length, 1, 'it is not asked again');
  }
});

test('a bare 503 is a failure, asked again', async () => {
  // A proxy may answer 503 by itself: without the host's mark or Retry-After it is no reason to stop (D102).
  const fixture = archiveOf('abcdefghij');
  const once = archiveServer(fixture, (index, attempt) => index === 1 && attempt === 1 ? status(503) : undefined);
  const run = options(once);
  assert.deepEqual(await bytesOf((await downloadDisc(info, run)).file), fixture.bytes);
  assert.deepEqual(run.slept, [1000]);
  const always = archiveServer(fixture, index => index === 1 ? status(503) : undefined);
  await assert.rejects(downloadDisc(info, options(always)), { message: STOPPED_OVER });
  assert.equal(always.requests.filter(url => url.endsWith('/chunks/1')).length, MAX_FAILURES);
});

test('the whole download names the host\'s changed game files', async () => {
  const marked = fakeServer({ whole: () => status(503, CHANGED_FILES) });
  await assert.rejects(downloadDisc(info, options(marked)), { message: HOST_CHANGED });
  const bare = fakeServer({ whole: () => status(503) });
  await assert.rejects(downloadDisc(info, options(bare)),
    { message: 'Could not download the game disc. Reload the invitation to try again.' });
});

test('the changed-files header only classifies a 503', async () => {
  const fixture = archiveOf('abcd');
  const chunk = archiveServer(fixture, (index, attempt) => attempt === 1 ? status(500, CHANGED_FILES) : undefined);
  assert.deepEqual(await bytesOf((await downloadDisc(info, options(chunk))).file), fixture.bytes);
  const whole = fakeServer({ whole: () => status(500, CHANGED_FILES) });
  await assert.rejects(downloadDisc(info, options(whole)),
    { message: 'Could not download the game disc. Reload the invitation to try again.' });
});

test('a chunk\'s 404 follows another archive of the same disc', async () => {
  const first = archiveOf('abcdefghij'), second = archiveOf('ABCDEFGHIJK');
  const stores = new Map(), removed = [];
  const openStore = async archive => {
    if (!stores.has(archive.sha256)) {
      const store = memoryPartStore(archive);
      const remove = store.remove;
      store.remove = async () => { removed.push(archive.sha256); await remove(); };
      stores.set(archive.sha256, store);
    }
    return stores.get(archive.sha256);
  };
  const server = fakeServer({
    manifest: attempt => manifestOf(attempt === 1 ? first : second),
    chunk: (sha, index, attempt, init) => {
      if (sha === first.archive.sha256) return index === 0 ? ok(partOf(first, 0), init.signal) : status(404);
      assert.equal(sha, second.archive.sha256);
      return ok(partOf(second, index), init.signal);
    },
  });
  const run = options(server, { openStore });
  const result = await downloadDisc(info, run);
  assert.deepEqual(await bytesOf(result.file), second.bytes);
  assert.deepEqual(removed, [first.archive.sha256]);
  assert.equal(server.chunkRequests().filter(url => url.includes(second.archive.sha256)).length, 3);
});

test('a chunk\'s 404 with the same archive in the manifest is a failure of that chunk', async () => {
  const fixture = archiveOf('abcdefghij');
  const server = archiveServer(fixture, (index, attempt) => index === 2 && attempt === 1 ? status(404) : undefined);
  const run = options(server);
  const result = await downloadDisc(info, run);
  assert.deepEqual(await bytesOf(result.file), fixture.bytes);
  assert.deepEqual(run.slept, [1000]);
  assert.equal(server.requests.filter(url => url === '/game-data/manifest').length, 2);
});

test('a chunk\'s 404 with another disc in the manifest stops the download', async () => {
  const first = archiveOf('abcdefghij'), second = archiveOf('ABCDEFGHIJK');
  for (const next of [manifestOf(second, { disc: 'b'.repeat(64) }), manifestOf(second, { pal: false }), null]) {
    const server = fakeServer({
      manifest: attempt => attempt === 1 ? manifestOf(first) : next,
      chunk: (sha, index, attempt, init) => index === 0 ? ok(partOf(first, 0), init.signal) : status(404),
    });
    await assert.rejects(downloadDisc(info, options(server)), { message: CHANGED });
  }
});

test('a manifest that does not match the session stops the download before any chunk', async () => {
  const fixture = archiveOf('abcdefghij');
  const { archive } = fixture;
  const wrong = [
    manifestOf(fixture, { disc: 'b'.repeat(64) }),
    manifestOf(fixture, { pal: false }),
    manifestOf(fixture, { version: 2 }),
    manifestOf(fixture, { archive: { ...archive, chunks: archive.chunks.slice(1) } }),
    manifestOf(fixture, { archive: { ...archive, chunkSize: 0 } }),
    manifestOf(fixture, { archive: { ...archive, size: 10.5 } }),
    manifestOf(fixture, { archive: { ...archive, sha256: archive.sha256.toUpperCase() } }),
    manifestOf(fixture, { archive: { ...archive, chunks: [[archive.chunks[0]], ...archive.chunks.slice(1)] } }),
    // A chunk larger than 64 MiB would be one buffer of that size in memory, twice at a time.
    manifestOf(fixture, { archive: { ...archive, chunkSize: MAX_CHUNK_SIZE + 1, chunks: [archive.chunks[0]] } }),
    { version: 1, disc: info.disc, pal: info.pal },
  ];
  for (const manifest of wrong) {
    const server = fakeServer({ manifest: () => manifest, chunk: () => assert.fail('no chunk is asked') });
    await assert.rejects(downloadDisc(info, options(server)), { message: CHANGED });
    assert.deepEqual(server.chunkRequests(), []);
  }
});

test('a manifest that cannot be read stops the download', async () => {
  const server = fakeServer({ manifest: () => null });
  server.fetch = async () => status(500);
  await assert.rejects(downloadDisc(info, options(server)),
    { message: 'Could not download the game disc. Reload the invitation to try again.' });
});

test('four failures in a row stop the download and keep the checked parts', async () => {
  const fixture = archiveOf('abcdefghij');
  const store = savedStore(fixture.archive);
  const server = archiveServer(fixture, index => index === 2 ? status(500) : undefined);
  const run = options(server, { openStore: async () => store });
  await assert.rejects(downloadDisc(info, run), { message: STOPPED });
  assert.equal(server.requests.filter(url => url.endsWith('/chunks/2')).length, MAX_FAILURES);
  assert.deepEqual(run.slept, [1000, 2000, 4000]);
  assert.deepEqual(await store.kept(), [0, 1]);
});

test('a part changed after it was counted is fetched again', async () => {
  const fixture = archiveOf('abcdefghij');
  const store = memoryPartStore(fixture.archive);
  await store.put(0, Buffer.from('ABCD'));
  const server = archiveServer(fixture);
  const run = options(server, { openStore: async () => store });
  const result = await downloadDisc(info, run);
  assert.deepEqual(await bytesOf(result.file), fixture.bytes);
  assert.deepEqual(server.chunkRequests().map(url => url.split('/').pop()), ['1', '2', '0']);
  assert.ok(run.reports.includes('Checking game data…'));
});

test('a part that keeps failing the final check stops the download', async () => {
  const fixture = archiveOf('abcdefghij');
  const store = memoryPartStore(fixture.archive);
  const put = store.put;
  // A store that corrupts what it keeps: the final check never passes.
  store.put = async (index, bytes) => put(index, index === 1 ? Buffer.from('EFGX') : bytes);
  const server = archiveServer(fixture);
  await assert.rejects(downloadDisc(info, options(server, { openStore: async () => store })), { message: CHANGED });
});

test('discard removes the parts', async () => {
  const fixture = archiveOf('abcdefghij');
  const store = memoryPartStore(fixture.archive);
  const result = await downloadDisc(info, options(archiveServer(fixture), { openStore: async () => store }));
  assert.deepEqual(await store.kept(), [0, 1, 2]);
  await result.discard();
  assert.deepEqual(await store.kept(), []);
});

test('the whole download has no stall deadline before its answer', async () => {
  const fixture = archiveOf('abcdefghij');
  const server = fakeServer({
    whole: async (attempt, init) => { await delay(100, init.signal); return ok(fixture.bytes, init.signal); },
  });
  const file = await downloadWhole(options(server, { deadlines: { answer: 1000, stall: 30 } }));
  assert.deepEqual(await bytesOf(file), fixture.bytes);
});

test('a stalled whole download stops', async () => {
  const fixture = archiveOf('abcdefghij');
  const server = fakeServer({ whole: (attempt, init) => ok(fixture.bytes, init.signal, { stall: true }) });
  await assert.rejects(downloadWhole(options(server, { deadlines: { answer: 1000, stall: 30 } })),
    { message: 'Game data stopped downloading. Reload the invitation to try again.' });
});

test('a whole download shorter than announced is refused', async () => {
  const fixture = archiveOf('abcdefghij');
  const server = fakeServer({
    whole: () => new Response(fixture.bytes.subarray(0, 9), { headers: { 'X-Sledstorm-Disc-Size': '10' } }),
  });
  await assert.rejects(downloadWhole(options(server)),
    { message: 'The game disc download is incomplete. Reload the invitation to try again.' });
});

// The time in the server's queue (D94, D96): a request cut before its answer begins, by the page's answer deadline or
// by a proxy that gave up waiting for the server (504, 524), is asked again without counting as a failure, until the
// chunk has waited the whole wait budget.

test('a wait in the server\'s queue past the answer deadline is not a failure', async () => {
  const fixture = archiveOf('abcdefghij');
  const server = archiveServer(fixture, async (index, attempt, init) => {
    if (index === 0 && attempt <= 6) await delay(10_000, init.signal);
  });
  const run = options(server, { deadlines: { answer: 20, stall: 1000 } });
  const result = await downloadDisc(info, run);
  assert.deepEqual(await bytesOf(result.file), fixture.bytes);
  assert.ok(6 > MAX_FAILURES);
  assert.equal(server.requests.filter(url => url.endsWith('/chunks/0')).length, 7);
  assert.deepEqual(run.slept, Array(6).fill(1000));
});

test('a proxy that gave up waiting for the server is a wait, not a failure', async () => {
  const fixture = archiveOf('abcd');
  const codes = [524, 504, 524, 504, 524];
  const server = archiveServer(fixture, (index, attempt) => attempt <= codes.length ? status(codes[attempt - 1]) : undefined);
  const run = options(server);
  const result = await downloadDisc(info, run);
  assert.deepEqual(await bytesOf(result.file), fixture.bytes);
  assert.deepEqual(run.slept, Array(5).fill(1000));
});

test('a chunk that has waited the whole wait budget stops the download', async () => {
  const fixture = archiveOf('abcdefghij');
  const store = savedStore(fixture.archive);
  const server = archiveServer(fixture, async (index, attempt, init) => {
    if (index === 2) await delay(10_000, init.signal);
  });
  const run = options(server, { openStore: async () => store, deadlines: { answer: 20, stall: 1000, wait: 150 } });
  await assert.rejects(downloadDisc(info, run), { message: STOPPED });
  assert.ok(server.requests.filter(url => url.endsWith('/chunks/2')).length > MAX_FAILURES);
  assert.deepEqual(await store.kept(), [0, 1]);
});

test('retry delays for fast proxy timeouts count toward the wait budget', async t => {
  const fixture = archiveOf('abcd');
  const server = archiveServer(fixture, (index, attempt) => attempt < 4 ? status(524) : undefined);
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const slept = [];
  const run = options(server, {
    deadlines: { wait: 2250 },
    async sleep(ms) { slept.push(ms); now += ms; },
  });
  await assert.rejects(downloadDisc(info, run), { message: STOPPED_OVER });
  assert.deepEqual(slept, [1000, 1000, 250]);
  assert.equal(server.chunkRequests().length, 3);
});

test('a pause does not end a run of failures', async () => {
  const fixture = archiveOf('abcdefghij');
  const server = archiveServer(fixture, (index, attempt) => {
    if (index !== 2) return undefined;
    return attempt === 4 ? status(503, { 'Retry-After': '1' }) : status(500);
  });
  // Node's default store keeps the parts in memory, so a reload starts over (D101).
  const run = options(server);
  await assert.rejects(downloadDisc(info, run), { message: STOPPED_OVER });
  assert.equal(server.requests.filter(url => url.endsWith('/chunks/2')).length, MAX_FAILURES + 1);
  assert.deepEqual(run.slept, [1000, 2000, 4000, 1000]);
});

test('a slow answer that keeps arriving is never cut', async () => {
  const fixture = archiveOf('abcdefghijklmnop', 8);
  const server = archiveServer(fixture, (index, attempt, init) => trickle(partOf(fixture, index), init.signal, { every: 12 }));
  const run = options(server, { deadlines: { answer: 1000, stall: 40 } });
  const result = await downloadDisc(info, run);
  assert.deepEqual(await bytesOf(result.file), fixture.bytes);
  assert.deepEqual(run.slept, [], 'no request was cut');
});

test('an answer whose first byte never comes is a stall, not a wait', { timeout: 3000 }, async () => {
  const fixture = archiveOf('abcd');
  const server = archiveServer(fixture, (index, attempt, init) =>
    attempt === 1 ? trickle(partOf(fixture, index), init.signal, { never: true }) : undefined);
  const run = options(server, { deadlines: { answer: 60_000, stall: 30 } });
  await downloadDisc(info, run);
  assert.deepEqual(run.slept, [1000]);
});

test('a download that stops asks for no more chunks', async () => {
  const fixture = archiveOf('abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 2);
  const server = archiveServer(fixture, async (index, attempt, init) => {
    if (index === 0) return status(500);
    await delay(20, init.signal);
  });
  await assert.rejects(downloadDisc(info, options(server)), { message: STOPPED_OVER });
  assert.ok(server.chunkRequests().length < 15, `${server.chunkRequests().length} chunk requests`);
});

test('a stop waits for the other worker\'s write, so nothing is written after it', async () => {
  const fixture = archiveOf('abcdefghij');
  const store = memoryPartStore(fixture.archive);
  const put = store.put;
  let started = false, settled = false;
  store.put = async (index, bytes) => {
    if (index !== 1) return put(index, bytes);
    started = true;
    await wait(60);
    await put(index, bytes);
    settled = true;
  };
  const server = archiveServer(fixture, async index => { if (index === 0) { await wait(25); return status(503, CHANGED_FILES); } });
  await assert.rejects(downloadDisc(info, options(server, { openStore: async () => store })), { message: HOST_CHANGED });
  assert.equal(started, true, 'the other worker was writing when the download stopped');
  assert.equal(settled, true, 'its write had settled before the download stopped');
});

test('a stop does not wait for a manifest read in flight', { timeout: 3000 }, async () => {
  const fixture = archiveOf('abcdefghij');
  const server = fakeServer({
    manifest: async (attempt, init) => {
      if (attempt > 1) await delay(10_000, init.signal);
      return manifestOf(fixture);
    },
    chunk: async (sha, index, attempt, init) => {
      if (index === 0) return status(404);
      await wait(30);
      return status(503, CHANGED_FILES);
    },
  });
  const started = Date.now();
  await assert.rejects(downloadDisc(info, options(server)), { message: HOST_CHANGED });
  assert.ok(Date.now() - started < 1000, `stopped after ${Date.now() - started} ms`);
});

test('a third archive stops the download', async () => {
  const archives = ['abcdefghij', 'ABCDEFGHIJ', 'klmnopqrst', 'KLMNOPQRST'].map(text => archiveOf(text));
  const server = fakeServer({
    manifest: attempt => manifestOf(archives[Math.min(attempt - 1, 3)]),
    chunk: () => status(404),
  });
  await assert.rejects(downloadDisc(info, options(server)), { message: CHANGED });
  assert.equal(server.requests.filter(url => url === '/game-data/manifest').length, 4);
});

test('two workers that meet a 404 at once read the manifest once', async () => {
  const fixture = archiveOf('abcdefghij');
  const server = fakeServer({
    manifest: async attempt => { if (attempt > 1) await wait(30); return manifestOf(fixture); },
    chunk: async (sha, index, attempt, init) => attempt === 1 && index < 2 ? status(404) : ok(partOf(fixture, index), init.signal),
  });
  await downloadDisc(info, options(server));
  assert.equal(server.requests.filter(url => url === '/game-data/manifest').length, 2);
});

test('a storage error reaches the player as the stopped message', async () => {
  const fixture = archiveOf('abcdefghij');
  const store = savedStore(fixture.archive);
  store.file = async () => { throw new DOMException('A requested file or directory could not be found.', 'NotFoundError'); };
  const run = options(archiveServer(fixture), { openStore: async () => store });
  await assert.rejects(downloadDisc(info, run), { message: STOPPED });
  assert.deepEqual(await store.kept(), [0, 1, 2], 'the checked parts stay for a reload');
});

test('a file of another size than the archive is never handed over', async () => {
  const fixture = archiveOf('abcdefghij');
  // Only parts on disk can change size behind the page's back.
  const store = savedStore(fixture.archive);
  const file = store.file;
  store.file = async () => new File([await file(), 'XX'], 'disc.zip');
  await assert.rejects(downloadDisc(info, options(archiveServer(fixture), { openStore: async () => store })), { message: STOPPED });
});

test('a worker that wakes after a stop asks for nothing', async () => {
  const fixture = archiveOf('abcdefghij');
  const server = archiveServer(fixture, async (index, attempt) => {
    if (index === 0 && attempt === 1) return status(500);
    if (index === 1) { await wait(10); return status(503, CHANGED_FILES); }
  });
  // A sleep that a stop does not end early, as a timer that has already fired is not.
  const run = options(server, { sleep: () => wait(50) });
  await assert.rejects(downloadDisc(info, run), { message: HOST_CHANGED });
  assert.equal(server.requests.filter(url => url.endsWith('/chunks/0')).length, 1);
});

test('the default sleep leaves no abort listener behind', async () => {
  const fixture = archiveOf('abcdefghij');
  // The downloader's own listeners are its functions named `abort`; the stand-in server's are not.
  const live = new Set();
  const { addEventListener: add, removeEventListener: remove } = AbortSignal.prototype;
  AbortSignal.prototype.addEventListener = function (type, listener, ...rest) {
    if (type === 'abort' && listener?.name === 'abort') live.add(listener);
    return add.call(this, type, listener, ...rest);
  };
  AbortSignal.prototype.removeEventListener = function (type, listener, ...rest) {
    live.delete(listener);
    return remove.call(this, type, listener, ...rest);
  };
  try {
    const server = archiveServer(fixture, (index, attempt) => attempt === 1 ? status(500) : undefined);
    const run = options(server, { retryDelays: [1, 1, 1] });
    delete run.sleep;
    const result = await downloadDisc(info, run);
    assert.deepEqual(await bytesOf(result.file), fixture.bytes);
  } finally {
    delete AbortSignal.prototype.addEventListener;
    delete AbortSignal.prototype.removeEventListener;
  }
  assert.equal(live.size, 0);
});

test('a download kept in memory says a reload starts over', async () => {
  const fixture = archiveOf('abcdefghij');
  const run = options(archiveServer(fixture), { openStore: async archive => memoryPartStore(archive, 'unsupported') });
  await downloadDisc(info, run);
  const downloading = run.reports.filter(text => text.startsWith('Downloading game data'));
  assert.ok(downloading.length >= 2, downloading.join(' | '));
  for (const text of downloading) assert.ok(text.endsWith(NOTES.unsupported), text);
  assert.ok(run.reports.includes('Downloading game data…' + NOTES.unsupported));
  assert.ok(run.reports.includes('Checking game data…'), 'the check carries no note');
});

test('each reason has its own note', async () => {
  const fixture = archiveOf('abcdefghij');
  for (const [reason, store] of [
    ['unsupported', archive => memoryPartStore(archive, 'unsupported')],
    ['unavailable', archive => memoryPartStore(archive, 'unavailable')],
    ['quota', archive => memoryPartStore(archive, 'quota')],
    ['busy', archive => memoryPartStore(archive, 'busy')],
    ['full', archive => savedStore(archive, 'full')],
    [null, archive => savedStore(archive)],
  ]) {
    const run = options(archiveServer(fixture), { openStore: async archive => store(archive) });
    await downloadDisc(info, run);
    assert.ok(run.reports.includes('Downloading game data · 100%' + (reason ? NOTES[reason] : '')), `${reason}: ${run.reports.join(' | ')}`);
  }
});

test('the note follows the store while the download runs', async () => {
  const fixture = archiveOf('abcdefghij');
  const store = savedStore(fixture.archive);
  const put = store.put;
  // The private file system refuses a write halfway: the lines after it say what a reload fetches again.
  store.put = async (index, bytes) => { await put(index, bytes); store.reason = 'full'; };
  const run = options(archiveServer(fixture), { openStore: async () => store });
  await downloadDisc(info, run);
  assert.equal(run.reports[0], 'Downloading game data…');
  assert.ok(run.reports.includes('Downloading game data · 100%' + NOTES.full), run.reports.join(' | '));
});

test('a refused final write updates the note even when progress already reads 100%', async () => {
  const fixture = archiveOf('abcd');
  const store = savedStore(fixture.archive);
  const put = store.put;
  store.put = async (index, bytes) => { await put(index, bytes); store.reason = 'full'; };
  const run = options(archiveServer(fixture), { openStore: async () => store });
  await downloadDisc(info, run);
  assert.deepEqual(run.reports.slice(-3), [
    'Downloading game data · 100%', 'Downloading game data · 100%' + NOTES.full, 'Checking game data…',
  ]);
});

test('the busy server\'s line carries the note', async () => {
  const fixture = archiveOf('abcdefghij');
  const server = archiveServer(fixture, (index, attempt) => index === 0 && attempt === 1 ? status(503, { 'Retry-After': '1' }) : undefined);
  const run = options(server, { openStore: async archive => memoryPartStore(archive, 'quota') });
  await downloadDisc(info, run);
  const busy = run.reports.filter(text => text.startsWith('The server is busy'));
  assert.equal(busy.length, 1, run.reports.join(' | '));
  assert.match(busy[0], new RegExp(`^The server is busy · waiting to continue · \\d+%${NOTES.quota}$`));
});

test('a stopped download in memory says to try again, a saved one to continue', async () => {
  const fixture = archiveOf('abcdefghij');
  for (const [store, sentence] of [[memoryPartStore, STOPPED_OVER], [savedStore, STOPPED]]) {
    const server = archiveServer(fixture, index => index === 2 ? status(500) : undefined);
    await assert.rejects(downloadDisc(info, options(server, { openStore: async archive => store(archive) })), { message: sentence });
  }
});

test('a storage refusal with no saved parts says a reload starts over', async () => {
  const fixture = archiveOf('abcd');
  const store = savedStore(fixture.archive, 'full');
  store.hasSavedParts = false;
  store.file = async () => { throw new DOMException('Gone.', 'NotReadableError'); };
  const run = options(archiveServer(fixture), { openStore: async () => store });
  await assert.rejects(downloadDisc(info, run), { message: STOPPED_OVER });
  assert.ok(run.reports.includes('Downloading game data · 100% · browser storage is full, a reload starts over'));
});

test('a spent wait budget and a storage error in memory say to try again', async () => {
  const fixture = archiveOf('abcdefghij');
  const waiting = archiveServer(fixture, async (index, attempt, init) => { if (index === 2) await delay(10_000, init.signal); });
  await assert.rejects(downloadDisc(info, options(waiting, {
    openStore: async archive => memoryPartStore(archive), deadlines: { answer: 20, stall: 1000, wait: 150 },
  })), { message: STOPPED_OVER });
  const store = memoryPartStore(fixture.archive);
  store.file = async () => { throw new DOMException('Gone.', 'NotFoundError'); };
  await assert.rejects(downloadDisc(info, options(archiveServer(fixture), { openStore: async () => store })), { message: STOPPED_OVER });
});

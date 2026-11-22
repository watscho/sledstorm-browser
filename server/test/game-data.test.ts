import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, open, readFile, realpath, rm, truncate, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { crc32 } from 'node:zlib';
import { identifyDisc } from '../../web/disc-identity.js';
import { findDisc } from '../src/disc-folder.ts';
import { DISC_CHUNK_SIZE, GameFilesChangedError, prepareGameData, type GameData } from '../src/game-data.ts';

const run = promisify(execFile);
const repository = fileURLToPath(new URL('../..', import.meta.url));
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

interface Fixture {
  root: string;
  folder: string;
  cache: string;
  /** CUE first, then the tracks in CUE order. */
  contents: Map<string, Buffer>;
}

const MiB = 1024 * 1024;

async function fixture(t: TestContext, custom?: [string, Buffer][]): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sled game тест ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, 'game folder');
  await mkdir(folder);
  const tracks: [string, Buffer][] = custom ?? [['Track 01.bin', randomBytes(5000)], ['Трек 02.bin', randomBytes(3000)],
    ['Track 03.bin', randomBytes(1)], ['Track 04.bin', Buffer.alloc(0)]];
  const cue = Buffer.from(tracks.map(([name], index) => `FILE "${name}" BINARY\n  TRACK 0${index + 1} AUDIO\n`).join(''));
  const contents = new Map<string, Buffer>([['Game.cue', cue], ...tracks]);
  for (const [name, bytes] of contents) await writeFile(join(folder, name), bytes);
  return { root, folder, cache: join(root, 'cache'), contents };
}

const prepare = async (f: Fixture, options: Parameters<typeof prepareGameData>[2] = {}) =>
  prepareGameData(await findDisc(f.folder), f.cache, { chunkSize: 1024, ...options });

async function collect(data: GameData): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of await data.openArchive()) parts.push(part as Buffer);
  return Buffer.concat(parts);
}

/** A reader written from the ZIP specification, independent of the writer under test. */
function readZip(bytes: Buffer) {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, 'end of central directory');
  const count = bytes.readUInt16LE(end + 10);
  assert.equal(bytes.readUInt16LE(end + 8), count);
  const directory = bytes.readUInt32LE(end + 16);
  assert.equal(directory + bytes.readUInt32LE(end + 12), end, 'the directory ends where the end record starts');
  assert.equal(bytes.readUInt16LE(end + 20), 0, 'no archive comment');
  const entries = [];
  let at = directory;
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50, 'central header');
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const crc = bytes.readUInt32LE(at + 16);
    const packed = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50, 'local header');
    assert.equal(bytes.readUInt16LE(local + 6), flags);
    assert.equal(bytes.readUInt16LE(local + 8), method);
    assert.deepEqual([bytes.readUInt32LE(local + 14), bytes.readUInt32LE(local + 18), bytes.readUInt32LE(local + 22)],
      [crc, packed, size], 'the local header repeats the checksum and sizes');
    const localName = bytes.readUInt16LE(local + 26);
    assert.equal(bytes.toString('utf8', local + 30, local + 30 + localName), name);
    const start = local + 30 + localName + bytes.readUInt16LE(local + 28);
    entries.push({ name, flags, method, crc, packed, size, date: bytes.readUInt32LE(at + 12),
      content: bytes.subarray(start, start + size) });
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  assert.equal(at, end, 'nothing follows the last central header');
  return entries;
}

test('the identity equals the browser\'s', async t => {
  const f = await fixture(t);
  const { identity } = await prepare(f);
  const browser = await identifyDisc(Array.from(f.contents, ([name, bytes]) =>
    ({ name, size: bytes.length, data: new Blob([new Uint8Array(bytes)]) })));
  assert.equal(identity.disc, browser.disc);
  assert.equal(identity.pal, browser.pal);
  assert.equal(identity.disc, sha256(Buffer.from(JSON.stringify(Array.from(f.contents, ([name, bytes]) => [name, bytes.length, sha256(bytes)])))));
});

test('the identity equals the Python launcher\'s', async t => {
  const f = await fixture(t);
  const script = "import json, pathlib, sys\nsys.path.insert(0, sys.argv[1])\nimport server\n"
    + "server.ROOT = pathlib.Path(sys.argv[2])\nserver.CACHE = server.ROOT / 'python-cache'\n"
    + "identity = server.shared_identity()\nprint(json.dumps({'disc': identity['disc'], 'pal': identity['pal']}))\n";
  let output: string;
  try {
    output = (await run('python3', ['-c', script, repository, f.root])).stdout;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return t.skip('python3 is not installed');
    throw error;
  }
  const python = JSON.parse(output.trim().split('\n').at(-1)!) as { disc: string; pal: boolean };
  const { identity } = await prepare(f);
  assert.deepEqual({ disc: identity.disc, pal: identity.pal }, python);
});

test('the archive bytes match the manifest', async t => {
  const f = await fixture(t);
  const data = await prepare(f);
  const bytes = await collect(data);
  const { archive } = data.identity;
  assert.equal(archive.size, bytes.length);
  assert.equal(archive.sha256, sha256(bytes));
  assert.equal(archive.chunkSize, 1024);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 1024) chunks.push(sha256(bytes.subarray(offset, offset + 1024)));
  assert.ok(chunks.length >= 9, 'the fixture spans several chunks');
  assert.deepEqual(archive.chunks, chunks);
});

test('the default chunk size is 8 MiB', async t => {
  const f = await fixture(t);
  const data = await prepareGameData(await findDisc(f.folder), f.cache);
  assert.equal(DISC_CHUNK_SIZE, 8 * 1024 * 1024);
  assert.equal(data.identity.archive.chunkSize, DISC_CHUNK_SIZE);
  assert.deepEqual(data.identity.archive.chunks, [sha256(await collect(data))]);
});

test('an independent reader accepts the archive', async t => {
  const f = await fixture(t);
  const bytes = await collect(await prepare(f));
  const entries = readZip(bytes);
  assert.deepEqual(entries.map(entry => entry.name), [...f.contents.keys()]);
  for (const entry of entries) {
    const original = f.contents.get(entry.name)!;
    assert.equal(entry.method, 0, 'stored, not compressed');
    assert.equal(entry.packed, entry.size);
    assert.equal(entry.crc, crc32(original));
    assert.ok(entry.content.equals(original), entry.name);
    assert.equal(entry.flags, entry.name === 'Трек 02.bin' ? 0x0800 : 0, 'only a non-ASCII name sets the UTF-8 flag');
    assert.equal(entry.date, 0x00210000, 'a fixed date, 1980-01-01 00:00');
  }
  const file = join(f.root, 'check.zip');
  await writeFile(file, bytes);
  for (const [command, args] of [['unzip', ['-tq', file]], ['python3', ['-c',
    'import sys, zipfile\narchive = zipfile.ZipFile(sys.argv[1])\nassert archive.testzip() is None\nprint("\\n".join(archive.namelist()))', file]]] as const) {
    try {
      const { stdout } = await run(command, [...args]);
      if (command === 'python3') assert.deepEqual(stdout.trim().split('\n'), [...f.contents.keys()]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
});

test('the archive does not depend on file times', async t => {
  const f = await fixture(t);
  const first = await prepare(f);
  for (const name of f.contents.keys()) await utimes(join(f.folder, name), new Date(1e12), new Date(1e12));
  const second = await prepare(f);
  assert.equal(second.reused, false, 'new file times mean reading the disc again');
  assert.deepEqual(second.identity, first.identity);
});

test('an unchanged disc reuses the stamp without reading it', async t => {
  const f = await fixture(t);
  const progress: [number, number][] = [];
  const first = await prepare(f, { onProgress: (done, total) => progress.push([done, total]) });
  assert.equal(first.reused, false);
  const last = progress.at(-1)!;
  assert.equal(last[0], last[1], 'progress ends at its total');
  assert.ok(progress.every(([done], index) => index === 0 || done >= progress[index - 1]![0]), 'progress never goes back');
  progress.length = 0;
  const second = await prepare(f, { onProgress: (done, total) => progress.push([done, total]) });
  assert.equal(second.reused, true);
  assert.deepEqual(progress, []);
  assert.deepEqual(second.identity, first.identity);
  assert.ok((await collect(second)).equals(await collect(first)));
});

test('a changed track, another chunk size or a damaged stamp means preparing again', async t => {
  const f = await fixture(t);
  const first = await prepare(f);
  assert.equal((await prepare(f, { chunkSize: 2048 })).reused, false);
  assert.equal((await prepare(f, { chunkSize: 2048 })).identity.archive.chunkSize, 2048);

  const stamp = join(f.cache, 'game-data', 'archive.json');
  await prepare(f);
  await truncate(stamp, Math.floor((await readFile(stamp)).length / 2));
  const repaired = await prepare(f);
  assert.equal(repaired.reused, false);
  assert.deepEqual(repaired.identity, first.identity);

  await writeFile(join(f.folder, 'Track 01.bin'), randomBytes(5000));
  const changed = await prepare(f);
  assert.equal(changed.reused, false);
  assert.notEqual(changed.identity.disc, first.identity.disc);
  assert.notEqual(changed.identity.archive.sha256, first.identity.archive.sha256);
});

test('the archive is refused after a source changes', async t => {
  const f = await fixture(t);
  const data = await prepare(f);
  await appendFile(join(f.folder, 'Трек 02.bin'), 'x');
  await assert.rejects(data.openArchive(), GameFilesChangedError);
  const again = await prepare(f);
  await rm(join(f.folder, 'Track 03.bin'));
  await assert.rejects(again.openArchive(), GameFilesChangedError);
});

test('files too large for the archive format are refused before they are read', async t => {
  const f = await fixture(t);
  await truncate(join(f.folder, 'Track 01.bin'), 4 * 1024 ** 3);
  // The disc's bound refuses them first (D76); the archive keeps its own guard for any other caller.
  await assert.rejects(findDisc(f.folder), /larger than a CD/);
  await truncate(join(f.folder, 'Track 01.bin'), 0);
  const disc = await findDisc(f.folder);
  disc.files[1]!.size = 4 * 1024 ** 3;
  let read = 0;
  await assert.rejects(prepareGameData(disc, f.cache, { onProgress: () => { read += 1; } }), /too large for the archive format/);
  assert.equal(read, 0);
});

/** Reads the stream to its end and runs `change` once, after `afterBytes` have arrived. */
async function drain(stream: Readable, afterBytes: number, change: () => Promise<void>): Promise<number> {
  let received = 0;
  let changed = false;
  for await (const part of stream) {
    received += (part as Buffer).length;
    if (!changed && received >= afterBytes) {
      changed = true;
      await change();
    }
  }
  return received;
}

const large = (): [string, Buffer][] => [['A.bin', randomBytes(2 * MiB)], ['B.bin', randomBytes(6 * MiB)], ['C.bin', randomBytes(300_000)]];

test('a file replaced before the download reaches it cuts the archive short', async t => {
  const f = await fixture(t, large());
  const data = await prepareGameData(await findDisc(f.folder), f.cache);
  await assert.rejects(drain(await data.openArchive(), 1, () => writeFile(join(f.folder, 'C.bin'), randomBytes(300_000))),
    GameFilesChangedError);
});

test('a file rewritten in place while it is being sent cuts the archive short', async t => {
  const f = await fixture(t, large());
  const data = await prepareGameData(await findDisc(f.folder), f.cache);
  // By 3.5 MiB the stream is inside B.bin, which starts after 2 MiB.
  await assert.rejects(drain(await data.openArchive(), 3.5 * MiB, async () => {
    const handle = await open(join(f.folder, 'B.bin'), 'r+');
    await handle.write(Buffer.from([1]), 0, 1, 0);
    await handle.close();
  }), GameFilesChangedError);
});

test('an abandoned archive stream closes its files', async t => {
  const f = await fixture(t, large());
  const data = await prepareGameData(await findDisc(f.folder), f.cache);
  const descriptors = () => readdirSync('/dev/fd').length;
  const before = descriptors();
  for (let round = 0; round < 5; round++) {
    let received = 0;
    for await (const part of await data.openArchive()) {
      received += (part as Buffer).length;
      if (received > 3 * MiB) break;
    }
  }
  for (let attempt = 0; descriptors() !== before && attempt < 50; attempt++) await delay(10);
  assert.equal(descriptors(), before);
});

test('a hand-edited stamp is not trusted', async t => {
  const f = await fixture(t);
  const first = await prepare(f);
  const stamp = join(f.cache, 'game-data', 'archive.json');
  const text = await readFile(stamp, 'utf8');
  const edited = text.replace(/pal(\\?":)false/, 'pal$1true');
  assert.notEqual(edited, text, 'the fixture found the flag to edit');
  await writeFile(stamp, edited);
  const again = await prepare(f);
  assert.equal(again.reused, false);
  assert.deepEqual(again.identity, first.identity);
});

test('preparation stops when it is aborted', async t => {
  const f = await fixture(t);
  await truncate(join(f.folder, 'Track 01.bin'), 512 * MiB);
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(prepareGameData(await findDisc(f.folder), f.cache, {
    signal: controller.signal,
    onProgress: () => { if (++calls === 3) controller.abort(); },
  }), { name: 'AbortError' });
  assert.ok(calls < 20, `reading went on for ${calls} chunks after the abort`);
  await assert.rejects(readFile(join(f.cache, 'game-data', 'archive.json')));
});

async function collectStream(stream: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(part as Buffer);
  return Buffer.concat(parts);
}

test('every chunk is its slice of the archive', async t => {
  for (const [custom, chunkSize] of [[undefined, 1024], [large(), 3 * MiB]] as const) {
    const f = await fixture(t, custom ? [...custom] : undefined);
    const data = await prepare(f, { chunkSize });
    const whole = await collect(data);
    const { archive } = data.identity;
    assert.ok(archive.chunks.length >= 3, 'the fixture spans several chunks');
    const pieces: Buffer[] = [];
    for (const [index, expected] of archive.chunks.entries()) {
      const chunk = await collectStream(await data.openChunk(index));
      assert.deepEqual(chunk, whole.subarray(index * chunkSize, (index + 1) * chunkSize), `chunk ${index}`);
      assert.equal(sha256(chunk), expected, `chunk ${index}`);
      pieces.push(chunk);
    }
    assert.deepEqual(Buffer.concat(pieces), whole);
  }
});

test('a chunk outside the archive is refused before any file is opened', async t => {
  const f = await fixture(t);
  const data = await prepare(f);
  const count = data.identity.archive.chunks.length;
  // With a track gone, a bad index that looked at the files first would be refused as a change instead.
  await rm(join(f.folder, 'Track 01.bin'));
  for (const index of [-1, count, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, Infinity])
    await assert.rejects(data.openChunk(index), RangeError, String(index));
  await assert.rejects(data.openChunk(0), GameFilesChangedError, 'a good index sees the change');
});

test('a chunk after a source changed is refused', async t => {
  const f = await fixture(t, large());
  const data = await prepareGameData(await findDisc(f.folder), f.cache, { chunkSize: MiB });
  await writeFile(join(f.folder, 'C.bin'), randomBytes(300_001));
  // The last chunk holds the end of C.bin and the directory.
  await assert.rejects(data.openChunk(data.identity.archive.chunks.length - 1), GameFilesChangedError);
});

test('a track rewritten in place while its chunk is sent cuts the chunk short', async t => {
  const f = await fixture(t, large());
  const data = await prepareGameData(await findDisc(f.folder), f.cache, { chunkSize: 4 * MiB });
  // Chunk 1 covers 4 to 8 MiB of the archive, inside B.bin, which starts after 2 MiB.
  let received = 0;
  let changed = false;
  await assert.rejects(async () => {
    for await (const part of await data.openChunk(1)) {
      received += (part as Buffer).length;
      if (changed) continue;
      changed = true;
      const handle = await open(join(f.folder, 'B.bin'), 'r+');
      await handle.write(Buffer.from([1]), 0, 1, 0);
      await handle.close();
    }
  }, GameFilesChangedError);
  assert.ok(received < 4 * MiB, 'the chunk never arrives whole');
});

test('an abandoned chunk closes its files', async t => {
  const f = await fixture(t, large());
  const data = await prepareGameData(await findDisc(f.folder), f.cache);
  const descriptors = () => readdirSync('/dev/fd').length;
  const before = descriptors();
  for (let round = 0; round < 5; round++) {
    for await (const part of await data.openChunk(0)) if ((part as Buffer).length > 0) break;
  }
  for (let attempt = 0; descriptors() !== before && attempt < 50; attempt++) await delay(10);
  assert.equal(descriptors(), before);
});

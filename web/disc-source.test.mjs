import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  checkRoomDisc, copyDisc, heldBytes, initialSource, offeredSources, rememberCopy, reopenCopy, restoreCopy,
} from './disc-source.js';

// The discs and archives of server/scripts/disc-fixtures.py (synthetic bytes, D78, D84).
const fixtures = JSON.parse(await readFile(new URL('./disc-identity.fixtures.json', import.meta.url), 'utf8'));
const [ascii, unicode] = fixtures.discs;
const bytesOf = fixture => Buffer.from(fixture.base64, 'base64');
const filesOf = disc => disc.files.map(file => new File([bytesOf(file)], file.name));
const archive = name => fixtures.archives.find(fixture => fixture.name === name);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The manifest that the server announces for its archive (server/src/game-data.ts, ArchiveManifest). */
function manifestOf(bytes, chunkSize = 256) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) chunks.push(sha256(bytes.subarray(offset, offset + chunkSize)));
  return { sha256: sha256(bytes), size: bytes.length, chunkSize, chunks };
}

const OTHER_DISC = 'These game files are not the disc this room plays. Use the host\'s CUE and BIN files under the same names, or a ZIP of them.';

test('the sources a session offers', () => {
  assert.deepEqual(offeredSources({ discMode: 'shared' }), ['files', 'zip', 'download']);
  assert.deepEqual(offeredSources({ discMode: 'local' }), ['files', 'zip']);
});

test('the preselected source never offers what the session does not', () => {
  assert.equal(initialSource(['files', 'zip'], 'download'), 'files');
  assert.equal(initialSource(['files', 'zip', 'download'], 'zip'), 'zip');
  assert.equal(initialSource(['files', 'zip', 'download'], undefined), 'download');
  assert.equal(initialSource(['files', 'zip'], 'nonsense'), 'files');
});

test('the choice made last comes before a remembered copy', () => {
  // D87: the player chose their files once (remembered), then the download: the download stays chosen.
  assert.equal(initialSource(['files', 'zip', 'download'], 'download', 'files'), 'download');
  // No choice made yet on this address (wrapper 1.0's saved ZIP), or the last one not offered: the copy.
  assert.equal(initialSource(['files', 'zip', 'download'], undefined, 'zip'), 'zip');
  assert.equal(initialSource(['files', 'zip'], 'download', 'zip'), 'zip');
  assert.equal(initialSource(['files', 'zip', 'download'], 'nonsense', 'nonsense'), 'download');
});

test('three sources of one disc give the room\'s identity', async () => {
  const canonical = bytesOf(archive(`the server's canonical archive: ${unicode.name}`));
  const info = { discMode: 'shared', disc: unicode.disc, pal: unicode.pal, archive: manifestOf(canonical) };

  const own = await copyDisc(filesOf(unicode), info);
  assert.deepEqual(Object.keys(own).sort(), ['disc', 'files', 'held', 'pal']);
  assert.deepEqual([own.disc, own.pal, own.held], [unicode.disc, unicode.pal, 0]);

  const zip = await copyDisc([new File([bytesOf(archive('zip -r: deflated, names in UTF-8 without the flag, the CUE in a folder'))], 'saved.zip')], info);
  assert.equal(zip.disc, unicode.disc);
  assert.ok(zip.held > 0, 'a deflated ZIP keeps its entries in the blob store');

  const copy = new File([canonical], 'sled-storm.zip');
  assert.deepEqual(await copyDisc([copy], info), { archive: copy, disc: unicode.disc, pal: unicode.pal });

  assert.equal(await copyDisc([], info), null);
});

test('another disc is refused before joining', async () => {
  const info = { discMode: 'local', disc: unicode.disc, pal: unicode.pal, archive: null };
  await assert.rejects(copyDisc(filesOf(ascii), info), { message: OTHER_DISC });
  assert.throws(() => checkRoomDisc(info, ascii.disc), { message: OTHER_DISC });
  checkRoomDisc(info, unicode.disc);
  // The Python launcher's local mode names no disc: the room compares the players' identities.
  const alone = await copyDisc(filesOf(ascii), { discMode: 'local', disc: null, pal: null });
  assert.equal(alone.disc, ascii.disc);
});

test('heldBytes adds what each item keeps and counts a missing one as nothing', () => {
  assert.equal(heldBytes([{ held: 3 }, {}, { held: 0 }, { held: 4 }]), 7);
  assert.equal(heldBytes([]), 0);
});

// Stand-ins for what the File System Access API gives: a handle whose read access holds, must be asked
// again, or was refused, and an IndexedDB store kept in a Map.
function handle(name, bytes, permission = 'granted', answer = 'granted') {
  return {
    name, permission, asked: 0,
    async getFile() { return new File([bytes], name); },
    async queryPermission({ mode }) { assert.equal(mode, 'read'); return this.permission; },
    async requestPermission({ mode }) { assert.equal(mode, 'read'); this.asked++; this.permission = answer; return answer; },
  };
}
function memory() {
  const map = new Map();
  return { map, get: async key => map.get(key), put: async (key, value) => { map.set(key, value); }, delete: async key => { map.delete(key); } };
}
const room = { discMode: 'local', disc: unicode.disc, pal: unicode.pal, archive: null };
const handlesOf = (disc, ...permissions) =>
  disc.files.map((file, index) => handle(file.name, bytesOf(file), permissions[index] ?? 'granted'));

test('a remembered copy comes back without a picker while access holds', async () => {
  const store = memory();
  const handles = handlesOf(unicode);
  await rememberCopy(store, { kind: 'files', handles, disc: unicode.disc });
  const copy = await restoreCopy(store, room);
  assert.equal(copy.kind, 'files');
  assert.equal(copy.handles.length, handles.length);
  assert.deepEqual(copy.files.map(file => file.name), unicode.files.map(file => file.name));
  assert.equal((await copyDisc(copy.files, room)).disc, unicode.disc);
  assert.ok(handles.every(item => item.asked === 0), 'nothing asked');
});

test('a copy whose access must be asked again waits for Join', async () => {
  const store = memory();
  const handles = handlesOf(unicode, 'granted', 'prompt');
  await rememberCopy(store, { kind: 'files', handles, disc: unicode.disc });
  const copy = await restoreCopy(store, room);
  assert.deepEqual(Object.keys(copy).sort(), ['handles', 'kind']);
  const files = await reopenCopy(copy);
  assert.deepEqual(files.map(file => file.name), unicode.files.map(file => file.name));
  assert.equal(handles[0].asked, 0, 'a handle whose access holds is not asked again');
  assert.equal(handles[1].asked, 1);

  const refused = handlesOf(unicode, 'prompt');
  refused[0].requestPermission = async () => 'denied';
  await rememberCopy(store, { kind: 'zip', handles: refused.slice(0, 1), disc: unicode.disc });
  await assert.rejects(reopenCopy(await restoreCopy(store, room)),
    { message: 'Allow access to your saved ZIP to play. You can retry with Join game.' });
  assert.equal(store.map.get('source').handles[0], refused[0], 'the record stays');
  // The host's own page starts a game; its button says so.
  const own = handlesOf(unicode, 'prompt');
  own[0].requestPermission = async () => 'denied';
  await assert.rejects(reopenCopy({ kind: 'files', handles: own }, 'Start game'),
    { message: 'Allow access to your game files to play. You can retry with Start game.' });
});

test('a remembered copy moved or deleted since is told as such, not as a browser error', async () => {
  const handles = handlesOf(unicode, 'prompt');
  handles[1].getFile = async () => { throw new DOMException('A requested file or directory could not be found at the time an operation was processed.', 'NotFoundError'); };
  await assert.rejects(reopenCopy({ kind: 'files', handles }), {
    message: 'Your game files were moved, renamed or deleted since you chose them. Choose them again.', gone: true,
  });
  const zip = handlesOf(unicode, 'prompt').slice(0, 1);
  zip[0].getFile = async () => { throw new DOMException('The file could not be read.', 'NotReadableError'); };
  await assert.rejects(reopenCopy({ kind: 'zip', handles: zip }), {
    message: 'Your saved ZIP was moved, renamed or deleted since you chose it. Choose it again.', gone: true,
  });
  // A refusal of access is not that: the player may allow it on the next try.
  const refused = handlesOf(unicode, 'prompt');
  refused[0].requestPermission = async () => 'denied';
  await assert.rejects(reopenCopy({ kind: 'files', handles: refused }), error => error.gone === undefined);
});

test('a remembered copy changed since is refused when it is checked', async () => {
  const store = memory();
  const handles = handlesOf(unicode);
  await rememberCopy(store, { kind: 'files', handles, disc: unicode.disc });
  const track = unicode.files.findIndex(file => /\.bin$/i.test(file.name));
  const changed = Buffer.from(bytesOf(unicode.files[track]));
  changed[Math.floor(changed.length / 2)] ^= 0xff;
  handles[track].getFile = async () => new File([changed], unicode.files[track].name);
  const copy = await restoreCopy(store, room);
  assert.equal(copy.files.length, handles.length, 'restored: its content is not read until it is checked');
  await assert.rejects(copyDisc(copy.files, room), { message: OTHER_DISC });
});

test('a refused, missing or foreign copy is not restored', async () => {
  const store = memory();
  assert.equal(await restoreCopy(store, room), null);
  await rememberCopy(store, { kind: 'files', handles: handlesOf(unicode, 'granted', 'denied'), disc: unicode.disc });
  assert.equal(await restoreCopy(store, room), null);
  const gone = handlesOf(unicode);
  gone[1].getFile = async () => { throw new DOMException('A requested file could not be found.', 'NotFoundError'); };
  await rememberCopy(store, { kind: 'files', handles: gone, disc: unicode.disc });
  assert.equal(await restoreCopy(store, room), null);
  await rememberCopy(store, { kind: 'files', handles: handlesOf(ascii), disc: ascii.disc });
  assert.equal(await restoreCopy(store, room), null);
  // A room that names no disc (the Python launcher's local mode) takes the copy; the room compares.
  assert.equal((await restoreCopy(store, { discMode: 'local', disc: null })).kind, 'files');
  const broken = { get: async () => { throw new Error('storage is unavailable'); } };
  assert.equal(await restoreCopy(broken, room), null);
});

test('the saved ZIP of wrapper 1.0 is read as a saved ZIP', async () => {
  const canonical = bytesOf(archive(`the server's canonical archive: ${unicode.name}`));
  const info = { discMode: 'shared', disc: unicode.disc, pal: unicode.pal, archive: manifestOf(canonical) };
  const store = memory();
  const saved = handle('sled-storm.zip', canonical);
  store.map.set('selected', { sha256: info.archive.sha256, handle: saved });
  const copy = await restoreCopy(store, info);
  assert.equal(copy.kind, 'zip');
  assert.deepEqual(copy.handles, [saved]);
  assert.equal(copy.files[0].size, canonical.length);
  store.map.set('selected', { sha256: 'f'.repeat(64), handle: saved });
  assert.equal(await restoreCopy(store, info), null);
});

test('remembering survives a store that refuses', async () => {
  await rememberCopy({ put: async () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); } },
    { kind: 'files', handles: [], disc: unicode.disc });
});

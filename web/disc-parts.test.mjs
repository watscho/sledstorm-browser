import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { memoryPartStore, openPartStore, partLength, QUOTA_MARGIN } from './disc-parts.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The manifest's archive for synthetic bytes (server/src/game-data.ts, ArchiveManifest). */
function archiveOf(text, chunkSize = 4) {
  const bytes = Buffer.from(text);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) chunks.push(sha256(bytes.subarray(offset, offset + chunkSize)));
  return { bytes, archive: { sha256: sha256(bytes), size: bytes.length, chunkSize, chunks } };
}
const partOf = (bytes, archive, index) => bytes.subarray(index * archive.chunkSize, index * archive.chunkSize + partLength(archive, index));

const notFound = name => new DOMException(`${name} was not found.`, 'NotFoundError');

/**
 * A stand-in for the origin private file system: a writable's bytes appear only when it is closed. `onClose(name)`
 * may throw to refuse a write (a full disk, a quota); `onAbort(name)` sees a writable given up.
 */
function fakeDirectory(hooks = {}) {
  const entries = new Map();
  const fileHandle = (name, entry) => ({
    kind: 'file', name,
    async getFile() { return new File([entry.bytes], name); },
    async createWritable() {
      const pending = [];
      return {
        async write(data) { pending.push(Buffer.from(data)); },
        async close() {
          hooks.onClose?.(name);
          entry.bytes = Buffer.concat(pending);
        },
        async abort() { hooks.onAbort?.(name); },
      };
    },
  });
  return {
    kind: 'directory', entries,
    async getDirectoryHandle(name, { create = false } = {}) {
      if (!entries.has(name)) {
        if (!create) throw notFound(name);
        entries.set(name, { kind: 'directory', directory: fakeDirectory(hooks) });
      }
      const entry = entries.get(name);
      if (entry.kind !== 'directory') throw new DOMException('Not a directory.', 'TypeMismatchError');
      return entry.directory;
    },
    async getFileHandle(name, { create = false } = {}) {
      if (!entries.has(name)) {
        if (!create) throw notFound(name);
        entries.set(name, { kind: 'file', bytes: Buffer.alloc(0) });
      }
      const entry = entries.get(name);
      if (entry.kind !== 'file') throw new DOMException('Not a file.', 'TypeMismatchError');
      return fileHandle(name, entry);
    },
    async removeEntry(name, { recursive = false } = {}) {
      const entry = entries.get(name);
      if (!entry) throw notFound(name);
      if (entry.kind === 'directory' && entry.directory.entries.size && !recursive)
        throw new DOMException('The directory is not empty.', 'InvalidModificationError');
      entries.delete(name);
    },
    async *keys() { yield* [...entries.keys()]; },
  };
}

/** A stand-in for the IndexedDB record store: values are copied in and out, as structured cloning does. */
function fakeRecords() {
  const map = new Map();
  return {
    map,
    get: async key => structuredClone(map.get(key)),
    put: async (key, value) => { map.set(key, structuredClone(value)); },
    delete: async key => { map.delete(key); },
    keys: async () => [...map.keys()],
  };
}

const partsOf = (root, archive) => root.entries.get('sledstorm-parts')?.directory.entries.get(archive.sha256)?.directory;

/** A stand-in for the browser's Web Locks: a lock asked with `ifAvailable` while another page holds it is null. */
function fakeLocks() {
  const held = new Set();
  return {
    held,
    async request(name, options, callback) {
      assert.equal(options.ifAvailable, true);
      if (held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({ name, mode: 'exclusive' }); } finally { held.delete(name); }
    },
  };
}

test('a part counts after a reload only once it was written and listed', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords();
  const store = await openPartStore(archive, { root, records });
  assert.equal(store.persistent, true);
  assert.deepEqual(await store.kept(), []);
  await store.put(1, partOf(bytes, archive, 1));
  assert.deepEqual(await store.kept(), [1]);
  const reloaded = await openPartStore(archive, { root, records });
  assert.deepEqual(await reloaded.kept(), [1]);
});

test('a part file the record does not list is not counted', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords();
  await openPartStore(archive, { root, records });
  // A reload between the committed file and the record's write leaves the file unlisted.
  const directory = partsOf(root, archive);
  const writable = await (await directory.getFileHandle('2', { create: true })).createWritable();
  await writable.write(partOf(bytes, archive, 2));
  await writable.close();
  const reloaded = await openPartStore(archive, { root, records });
  assert.deepEqual(await reloaded.kept(), []);
});

test('a listed part of another length is dropped when the store opens', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords();
  const store = await openPartStore(archive, { root, records });
  await store.put(0, partOf(bytes, archive, 0));
  partsOf(root, archive).entries.get('0').bytes = Buffer.from('abc');
  const reloaded = await openPartStore(archive, { root, records });
  assert.deepEqual(await reloaded.kept(), []);
  assert.deepEqual(records.map.get(archive.sha256).done, []);
});

test('a listed part whose file is gone is dropped when the store opens', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords();
  const store = await openPartStore(archive, { root, records });
  await store.put(0, partOf(bytes, archive, 0));
  await store.put(2, partOf(bytes, archive, 2));
  partsOf(root, archive).entries.delete('0');
  const reloaded = await openPartStore(archive, { root, records });
  assert.deepEqual(await reloaded.kept(), [2]);
  assert.deepEqual(records.map.get(archive.sha256).done, [2]);
});

test('two parts finished at once are both listed', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords();
  const store = await openPartStore(archive, { root, records });
  await Promise.all([store.put(0, partOf(bytes, archive, 0)), store.put(2, partOf(bytes, archive, 2))]);
  const reloaded = await openPartStore(archive, { root, records });
  assert.deepEqual(await reloaded.kept(), [0, 2]);
});

test('record writes land in order even where the record store would reorder them', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords();
  const store = await openPartStore(archive, { root, records });
  // The first write of the two takes longer than the second: unordered, the older list would land last.
  const delays = [20, 1];
  let firstWrite;
  const writing = new Promise(resolve => { firstWrite = resolve; });
  const put = records.put;
  records.put = async (key, value) => {
    firstWrite();
    await new Promise(resolve => setTimeout(resolve, delays.shift() ?? 0));
    await put(key, value);
  };
  const first = store.put(0, partOf(bytes, archive, 0));
  await writing;
  await Promise.all([first, store.put(2, partOf(bytes, archive, 2))]);
  assert.deepEqual(records.map.get(archive.sha256).done, [0, 2]);
});

test('opening another archive removes the first one\'s parts and record', async () => {
  const first = archiveOf('abcdefghij'), second = archiveOf('klmnopqrst');
  const root = fakeDirectory(), records = fakeRecords();
  const store = await openPartStore(first.archive, { root, records });
  await store.put(0, partOf(first.bytes, first.archive, 0));
  const other = await openPartStore(second.archive, { root, records });
  assert.deepEqual(await other.kept(), []);
  assert.deepEqual([...root.entries.get('sledstorm-parts').directory.entries.keys()], [second.archive.sha256]);
  assert.deepEqual(await records.keys(), [second.archive.sha256]);
  const back = await openPartStore(first.archive, { root, records });
  assert.deepEqual(await back.kept(), [], 'the first archive starts over');
});

test('a record of another shape under the same key is not trusted', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords();
  const store = await openPartStore(archive, { root, records });
  await store.put(0, partOf(bytes, archive, 0));
  records.map.set(archive.sha256, { ...records.map.get(archive.sha256), chunkSize: 8 });
  const reloaded = await openPartStore(archive, { root, records });
  assert.deepEqual(await reloaded.kept(), []);
});

test('the file is every part in order', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const store = await openPartStore(archive, { root: fakeDirectory(), records: fakeRecords() });
  for (const index of [2, 0, 1]) await store.put(index, partOf(bytes, archive, index));
  const file = await store.file();
  assert.equal(file.name, 'disc.zip');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
});

test('the file rejects while a part is missing', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const store = await openPartStore(archive, { root: fakeDirectory(), records: fakeRecords() });
  await store.put(0, partOf(bytes, archive, 0));
  await store.put(2, partOf(bytes, archive, 2));
  await assert.rejects(store.file(), /incomplete/);
});

test('drop forgets a part', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords();
  const store = await openPartStore(archive, { root, records });
  await store.put(1, partOf(bytes, archive, 1));
  await store.drop(1);
  assert.deepEqual(await store.kept(), []);
  assert.deepEqual(records.map.get(archive.sha256).done, [], 'the record forgets it before its file goes');
  assert.equal(partsOf(root, archive).entries.has('1'), false);
  assert.deepEqual(await (await openPartStore(archive, { root, records })).kept(), []);
});

test('remove deletes the archive\'s directory and record', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords();
  const store = await openPartStore(archive, { root, records });
  // A part written while the store is removed is refused, never listed again.
  const [put] = await Promise.allSettled([store.put(0, partOf(bytes, archive, 0)), store.remove()]);
  assert.equal(put.status, 'rejected');
  assert.equal(partsOf(root, archive), undefined);
  assert.deepEqual(await records.keys(), []);
  await assert.rejects(store.put(1, partOf(bytes, archive, 1)), /removed/);
});

test('a record write in flight does not bring a removed record back', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords();
  const store = await openPartStore(archive, { root, records });
  let release, started;
  const writing = new Promise(resolve => { started = resolve; });
  const put = records.put;
  records.put = async (key, value) => { started(); await new Promise(resolve => { release = resolve; }); await put(key, value); };
  const written = store.put(0, partOf(bytes, archive, 0));
  await writing;
  const removing = store.remove();
  release();
  await Promise.allSettled([written, removing]);
  assert.deepEqual(await records.keys(), []);
});

test('without a private file system the parts stay in memory', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const refusing = { async getDirectoryHandle() { throw new DOMException('Refused.', 'SecurityError'); } };
  for (const store of [
    await openPartStore(archive, { root: null }),
    await openPartStore(archive, { root: refusing, records: fakeRecords() }),
    memoryPartStore(archive),
  ]) {
    assert.equal(store.persistent, false);
    for (const index of [1, 0, 2]) await store.put(index, partOf(bytes, archive, index));
    assert.deepEqual(await store.kept(), [0, 1, 2]);
    assert.deepEqual(Buffer.from(await (await store.file()).arrayBuffer()), bytes);
    await store.drop(1);
    await assert.rejects(store.file(), /incomplete/);
    await store.remove();
    assert.deepEqual(await store.kept(), []);
  }
});

test('a part the private file system refuses to keep stays in memory and is never listed', async t => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const aborted = [];
  const root = fakeDirectory({
    onClose: name => { if (name === '1') throw new DOMException('The quota was exceeded.', 'QuotaExceededError'); },
    onAbort: name => aborted.push(name),
  });
  const records = fakeRecords();
  const store = await openPartStore(archive, { root, records });
  // Every record written lists only parts whose files are committed with their bytes.
  const put = records.put;
  const listedWithoutFile = [];
  records.put = async (key, value) => {
    for (const index of value.done) {
      const entry = partsOf(root, archive)?.entries.get(String(index));
      if (!entry || !partOf(bytes, archive, index).equals(entry.bytes)) listedWithoutFile.push(index);
    }
    await put(key, value);
  };
  for (const index of [0, 1, 2]) await store.put(index, partOf(bytes, archive, index));
  assert.deepEqual(await store.kept(), [0, 1, 2]);
  const blob = t.mock.method(Response.prototype, 'blob');
  assert.deepEqual(Buffer.from(await (await store.file()).arrayBuffer()), bytes);
  assert.equal(blob.mock.callCount(), 1, 'memory and disk parts stream into one completed blob');
  assert.deepEqual(records.map.get(archive.sha256).done, [0, 2]);
  assert.deepEqual(listedWithoutFile, []);
  assert.deepEqual(aborted, ['1'], 'the refused writable is given up');
  assert.deepEqual(await (await openPartStore(archive, { root, records })).kept(), [0, 2], 'a reload fetches it again');
  await store.drop(1);
  await assert.rejects(store.file(), /incomplete/);
});

test('an IndexedDB refusal keeps the part for this page without listing it in later records', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords();
  const store = await openPartStore(archive, { root, records });
  const put = records.put;
  records.put = async (key, value) => {
    if (value.done.includes(1)) throw new DOMException('The quota was exceeded.', 'QuotaExceededError');
    await put(key, value);
  };
  await Promise.all([1, 0, 2].map(index => store.put(index, partOf(bytes, archive, index))));
  assert.deepEqual(await store.kept(), [0, 1, 2]);
  assert.equal(store.reason, 'full');
  assert.deepEqual(Buffer.from(await (await store.file()).arrayBuffer()), bytes);
  assert.deepEqual(records.map.get(archive.sha256).done, [0, 2]);
  assert.deepEqual(await (await openPartStore(archive, { root, records })).kept(), [0, 2]);
});

test('a part of another length than the manifest says is refused', async () => {
  const { archive } = archiveOf('abcdefghij');
  for (const store of [memoryPartStore(archive), await openPartStore(archive, { root: fakeDirectory(), records: fakeRecords() })]) {
    await assert.rejects(store.put(2, Buffer.from('ijXX')), /length/);
    await assert.rejects(store.put(0, Buffer.from('abc')), /length/);
    assert.deepEqual(await store.kept(), []);
  }
});

test('a second page of the origin keeps its parts in memory while the first holds the store', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords(), locks = fakeLocks();
  const first = await openPartStore(archive, { root, records, locks });
  assert.equal(first.persistent, true);
  await first.put(0, partOf(bytes, archive, 0));
  const second = await openPartStore(archive, { root, records, locks });
  assert.equal(second.persistent, false);
  await second.put(1, partOf(bytes, archive, 1));
  assert.deepEqual(records.map.get(archive.sha256).done, [0], 'the second page writes nothing');
  // Another archive in the second page does not remove the first page's parts either.
  const other = archiveOf('klmnopqrst');
  assert.equal((await openPartStore(other.archive, { root, records, locks })).persistent, false);
  assert.deepEqual(await records.keys(), [archive.sha256]);
  await first.remove();
  assert.equal(locks.held.size, 0, 'removing the store lets another page take it');
  assert.equal((await openPartStore(archive, { root, records, locks })).persistent, true);
});

test('the default store needs the private file system and IndexedDB of a browser', async () => {
  // Node has neither: the default open keeps the parts in memory instead of failing.
  const { archive } = archiveOf('abcdefghij');
  const store = await openPartStore(archive);
  assert.equal(store.persistent, false);
});

test('a part\'s length is the manifest\'s', () => {
  const { archive } = archiveOf('abcdefghij');
  assert.deepEqual([0, 1, 2].map(index => partLength(archive, index)), [4, 4, 2]);
});

/** A stand-in for `navigator.storage`: `estimate()` answers `answer` (or what `answer()` gives) and counts its calls. */
function fakeStorage(answer) {
  const storage = { asked: 0 };
  storage.estimate = async () => {
    storage.asked += 1;
    return typeof answer === 'function' ? answer() : answer;
  };
  return storage;
}

test('the parts are kept in memory when the quota is too small for what is missing', async () => {
  const { archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords();
  const small = await openPartStore(archive, { root, records, storage: fakeStorage({ quota: QUOTA_MARGIN + 9, usage: 0 }) });
  assert.equal(small.persistent, false);
  assert.equal(small.reason, 'quota');
  assert.equal(partsOf(root, archive)?.entries.size ?? 0, 0, 'no part file is written');
  assert.equal(records.map.has(archive.sha256), false, 'no record is written');
  const enough = await openPartStore(archive, { root, records, storage: fakeStorage({ quota: QUOTA_MARGIN + 10, usage: 0 }) });
  assert.equal(enough.persistent, true);
  assert.equal(enough.reason, null);
  const used = await openPartStore(archive, { root, records, storage: fakeStorage({ quota: QUOTA_MARGIN + 20, usage: 11 }) });
  assert.equal(used.reason, 'quota', 'what the origin already uses counts');
});

test('the estimate counts only the parts still missing', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords();
  const store = await openPartStore(archive, { root, records });
  await store.put(0, partOf(bytes, archive, 0));
  await store.put(1, partOf(bytes, archive, 1));
  const reloaded = await openPartStore(archive, { root, records, storage: fakeStorage({ quota: QUOTA_MARGIN + 2, usage: 0 }) });
  assert.equal(reloaded.persistent, true);
  assert.deepEqual(await reloaded.kept(), [0, 1]);
});

test('a complete set of parts is used without asking for the quota', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords();
  const store = await openPartStore(archive, { root, records });
  for (const index of [0, 1, 2]) await store.put(index, partOf(bytes, archive, index));
  const storage = fakeStorage(() => { throw new Error('The quota is not needed.'); });
  const reloaded = await openPartStore(archive, { root, records, storage });
  assert.equal(reloaded.persistent, true);
  assert.deepEqual(await reloaded.kept(), [0, 1, 2]);
  assert.equal(storage.asked, 0);
});

test('an estimate that cannot be read does not stop parts being kept', async () => {
  const { archive } = archiveOf('abcdefghij');
  for (const storage of [{}, fakeStorage(() => { throw new Error('No estimate.'); }), fakeStorage({}),
    fakeStorage({ quota: 'a lot', usage: 0 }), fakeStorage(undefined)]) {
    const store = await openPartStore(archive, { root: fakeDirectory(), records: fakeRecords(), storage });
    assert.equal(store.persistent, true);
    assert.equal(store.reason, null);
  }
});

test('a store that falls back for the quota leaves the parts, the record and the lock', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory(), records = fakeRecords(), locks = fakeLocks();
  const writer = await openPartStore(archive, { root, records });
  await writer.put(0, partOf(bytes, archive, 0));
  const small = await openPartStore(archive, { root, records, locks, storage: fakeStorage({ quota: QUOTA_MARGIN, usage: 0 }) });
  assert.equal(small.reason, 'quota');
  assert.equal(locks.held.size, 0, 'the fallback lets another page take the store');
  assert.deepEqual(records.map.get(archive.sha256).done, [0]);
  const roomy = await openPartStore(archive, { root, records, locks, storage: fakeStorage({ quota: 2 ** 40, usage: 0 }) });
  assert.equal(roomy.persistent, true);
  assert.deepEqual(await roomy.kept(), [0]);
});

test('every store in memory says why', async () => {
  const { archive } = archiveOf('abcdefghij');
  const refusing = { async getDirectoryHandle() { throw new DOMException('Refused.', 'SecurityError'); } };
  assert.equal((await openPartStore(archive, { root: null })).reason, 'unsupported');
  assert.equal((await openPartStore(archive, { root: refusing, records: fakeRecords() })).reason, 'unavailable');
  assert.equal((await openPartStore(archive)).reason, 'unsupported', 'Node has no private file system');
  assert.equal(memoryPartStore(archive).reason, 'unsupported');
  assert.equal(memoryPartStore(archive, 'busy').reason, 'busy');
  const root = fakeDirectory(), records = fakeRecords(), locks = fakeLocks();
  const first = await openPartStore(archive, { root, records, locks });
  assert.equal(first.reason, null);
  assert.equal((await openPartStore(archive, { root, records, locks })).reason, 'busy');
});

test('a refused write marks the persistent store full', async () => {
  const { bytes, archive } = archiveOf('abcdefghij');
  const root = fakeDirectory({ onClose: name => { if (name === '2') throw new DOMException('Full.', 'QuotaExceededError'); } });
  const store = await openPartStore(archive, { root, records: fakeRecords() });
  await store.put(0, partOf(bytes, archive, 0));
  assert.equal(store.reason, null);
  await store.put(2, partOf(bytes, archive, 2));
  assert.equal(store.reason, 'full');
  assert.equal(store.persistent, true);
});

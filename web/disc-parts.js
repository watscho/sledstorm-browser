// The checked chunks of one server archive while it downloads (D97). Each chunk is a file of the origin private file
// system, `sledstorm-parts/<archiveSha256>/<index>`, written whole and committed before the archive's progress record
// in IndexedDB lists it, so a reload between the two leaves the chunk unlisted and it is fetched again. An origin
// keeps the parts of one archive: opening the store for another archive removes them, so two archives never mix.
// One page at a time holds the stored parts (a Web Lock); another page of the origin keeps its parts in memory.
// Every store says why it keeps parts in memory (`reason`), so the player can be told that a reload starts over.

const PARTS = 'sledstorm-parts';
/** Room left free beyond the missing parts: the saves library and the estimate's error (D100). */
export const QUOTA_MARGIN = 64 * 1024 * 1024;
const LOCK = 'sledstorm-disc-parts';

/** The length of chunk `index` of the manifest's archive: `chunkSize`, or what is left of the archive. */
export function partLength(archive, index) {
  return Math.min(archive.chunkSize, archive.size - index * archive.chunkSize);
}

const ascending = (a, b) => a - b;
const removedError = () => new Error('The game data parts were removed.');
const incompleteError = () => new Error('The game data is incomplete.');
const allIndices = archive => archive.chunks.map((_, index) => index);
/** A part is kept only at its manifest length, so the parts together are always the archive's size. */
function checkLength(archive, index, bytes) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= archive.chunks.length
    || bytes.byteLength !== partLength(archive, index)) throw new Error('The game data part has the wrong length.');
}

/**
 * The parts in memory: checked as on disk, but gone with the page. `reason` says why (D100): 'unsupported' (no private
 * file system, `createWritable` or IndexedDB), 'unavailable' (storage refused when the store opened), 'busy' (another
 * page of the origin holds the stored parts) or 'quota' (too little room for what is missing).
 */
export function memoryPartStore(archive, reason = 'unsupported') {
  const parts = new Map();
  return {
    persistent: false,
    reason,
    async kept() { return [...parts.keys()].sort(ascending); },
    async put(index, bytes) {
      checkLength(archive, index, bytes);
      parts.set(index, new Blob([bytes]));
    },
    async drop(index) { parts.delete(index); },
    async file() {
      if (parts.size !== archive.chunks.length) throw incompleteError();
      return new File(allIndices(archive).map(index => parts.get(index)), 'disc.zip');
    },
    async remove() { parts.clear(); },
  };
}

function openRecordDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sledstorm-disc-parts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('progress');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Game data storage is unavailable.'));
  });
}

async function inRecords(mode, act) {
  const db = await openRecordDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('progress', mode);
      const request = act(transaction.objectStore('progress'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

/** One progress record per archive, keyed by its SHA-256; each call is one transaction. */
const indexedRecords = {
  get: key => inRecords('readonly', store => store.get(key)),
  put: (key, value) => inRecords('readwrite', store => store.put(value, key)),
  delete: key => inRecords('readwrite', store => store.delete(key)),
  keys: () => inRecords('readonly', store => store.getAllKeys()),
};

const sameShape = (record, archive) => record && record.size === archive.size && record.chunkSize === archive.chunkSize
  && Array.isArray(record.chunks) && record.chunks.length === archive.chunks.length
  && record.chunks.every((hash, index) => hash === archive.chunks[index]) && Array.isArray(record.done);

/** Whether the origin has room for `bytes` more, by `storage.estimate()`; an answer that cannot be read is room. */
async function hasRoom(storage, bytes) {
  if (typeof storage?.estimate !== 'function') return true;
  try {
    const { quota, usage } = await storage.estimate() ?? {};
    if (!Number.isFinite(quota) || !Number.isFinite(usage)) return true;
    return quota - usage >= bytes + QUOTA_MARGIN;
  } catch { return true; }
}

/** The store in the private file system, or null when the quota leaves too little room for the missing parts. */
async function persistentPartStore(archive, root, records, release, storage) {
  const key = archive.sha256;
  const parts = await root.getDirectoryHandle(PARTS, { create: true });
  for (const other of await records.keys()) if (other !== key) await records.delete(other);
  const others = [];
  for await (const name of parts.keys()) if (name !== key) others.push(name);
  for (const name of others) await parts.removeEntry(name, { recursive: true });
  const directory = await parts.getDirectoryHandle(key, { create: true });

  // A listed part counts only while its file is there with the manifest's length; its bytes are checked again
  // when the archive is complete (D98).
  const saved = await records.get(key);
  const done = new Set();
  if (sameShape(saved, archive)) for (const index of saved.done) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= archive.chunks.length) continue;
    try {
      const file = await (await directory.getFileHandle(String(index))).getFile();
      if (file.size === partLength(archive, index)) done.add(index);
    } catch { /* A missing part is fetched again. */ }
  }
  // The quota is asked only for what is still missing, before anything is written (D100).
  let missing = 0;
  for (const index of allIndices(archive)) if (!done.has(index)) missing += partLength(archive, index);
  if (missing && !await hasRoom(storage, missing)) return null;

  // Record writes go one after another, each with the parts listed at its turn, so none is lost.
  let removed = false;
  let writes = Promise.resolve();
  const record = () => {
    const write = writes.catch(() => {}).then(() => removed ? undefined : records.put(key, {
      size: archive.size, chunkSize: archive.chunkSize, chunks: archive.chunks, done: [...done].sort(ascending),
    }));
    writes = write;
    return write;
  };
  if (!saved || !sameShape(saved, archive) || saved.done.length !== done.size) await record();

  // A checked part that the private file system refuses to keep (its quota, a full disk) stays in memory for this
  // page, never listed: the download goes on, and a reload fetches it again.
  const held = new Map();
  let full = false;
  const counted = () => new Set([...done, ...held.keys()]);

  return {
    persistent: true,
    get reason() { return full ? 'full' : null; },
    async kept() { return [...counted()].sort(ascending); },
    async put(index, bytes) {
      checkLength(archive, index, bytes);
      if (removed) throw removedError();
      let writable;
      try {
        writable = await (await directory.getFileHandle(String(index), { create: true })).createWritable();
        await writable.write(bytes);
        await writable.close();
      } catch {
        try { await writable?.abort?.(); } catch { /* The write is given up either way. */ }
        if (removed) throw removedError();
        full = true;
        held.set(index, new Blob([bytes]));
        return;
      }
      if (removed) throw removedError();
      held.delete(index);
      done.add(index);
      await record();
    },
    async drop(index) {
      if (removed) throw removedError();
      held.delete(index);
      if (!done.delete(index)) return;
      await record();
      await directory.removeEntry(String(index)).catch(() => {});
    },
    async file() {
      if (removed) throw removedError();
      if (counted().size !== archive.chunks.length) throw incompleteError();
      const files = [];
      for (const index of allIndices(archive)) {
        files.push(held.get(index) ?? await (await directory.getFileHandle(String(index))).getFile());
      }
      return new File(files, 'disc.zip');
    },
    async remove() {
      removed = true;
      done.clear();
      held.clear();
      try {
        await writes.catch(() => {});
        await records.delete(key);
        await parts.removeEntry(key, { recursive: true }).catch(() => {});
      } finally { release(); }
    },
  };
}

/** This page's hold on the stored parts: null while another page of the origin has it. Without Web Locks, every
 *  page has it, as before. */
async function holdParts(locks) {
  if (typeof locks?.request !== 'function') return () => {};
  return new Promise((resolve, reject) => {
    locks.request(LOCK, { ifAvailable: true }, lock => {
      if (!lock) return resolve(null);
      return new Promise(release => resolve(release));
    }).catch(reject);
  });
}

const browserStorage = () => typeof globalThis.FileSystemFileHandle?.prototype?.createWritable === 'function'
  && typeof globalThis.navigator?.storage?.getDirectory === 'function' && typeof globalThis.indexedDB === 'object';

/**
 * The store of `archive`'s parts (the manifest's `{ sha256, size, chunkSize, chunks }`). `root`, `records`, `locks`
 * and `storage` stand in for the origin private file system, the IndexedDB record store, `navigator.locks` and
 * `navigator.storage` in tests. Where storage is missing or refuses, another page of the origin holds the stored
 * parts, or the quota leaves too little room, the parts are kept in memory (`persistent: false`, with a `reason`).
 */
export async function openPartStore(archive, { root, records, locks, storage } = {}) {
  let release;
  try {
    if (root === undefined) {
      if (!browserStorage()) return memoryPartStore(archive, 'unsupported');
      root = await navigator.storage.getDirectory();
      records ??= indexedRecords;
      locks ??= navigator.locks;
      storage ??= navigator.storage;
    }
    if (!root || !records) return memoryPartStore(archive, 'unsupported');
    release = await holdParts(locks);
    if (!release) return memoryPartStore(archive, 'busy');
    const store = await persistentPartStore(archive, root, records, release, storage);
    if (store) return store;
    release();
    return memoryPartStore(archive, 'quota');
  } catch {
    release?.();
    return memoryPartStore(archive, 'unavailable');
  }
}

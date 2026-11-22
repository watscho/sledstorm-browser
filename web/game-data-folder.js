export const canChooseGameArchive = typeof globalThis.showOpenFilePicker === 'function'
  && typeof globalThis.showSaveFilePicker === 'function';

const zipTypes = [{ description: 'Sled Storm ZIP archive', accept: { 'application/zip': ['.zip'] } }];
const archiveFilename = archive => `sled-storm-${archive.sha256}.zip`;

// Keep the user's file handles, rather than copying a disc into each temporary tunnel's browser
// storage. A reload can reuse them while read access is granted (web/disc-source.js, D88).
function openGameDataDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sledstorm-game-data', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Game data storage is unavailable.'));
  });
}

async function inGameData(mode, act) {
  const db = await openGameDataDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('handles', mode);
      const request = act(transaction.objectStore('handles'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

/** The store of web/disc-source.js: one record per key in this address's IndexedDB. */
export const gameDataStore = {
  get: key => inGameData('readonly', store => store.get(key)),
  put: (key, value) => inGameData('readwrite', store => store.put(value, key)),
  delete: key => inGameData('readwrite', store => store.delete(key)),
};

/** Whether copies are chosen through the browser's picker, whose handles a later visit can use again. */
export const canKeepCopies = typeof globalThis.showOpenFilePicker === 'function';

const copyTypes = {
  files: [{ description: 'CUE sheet and BIN tracks', accept: { 'application/x-cue': ['.cue'], 'application/octet-stream': ['.bin'] } }],
  zip: zipTypes,
};

/** The browser's picker for a copy: several files for `files`, one ZIP for `zip`. A cancel rejects with an AbortError. */
export async function pickCopy(kind) {
  const handles = await showOpenFilePicker({ multiple: kind === 'files', startIn: 'downloads', types: copyTypes[kind] });
  return { handles, files: await Promise.all(handles.map(handle => handle.getFile())) };
}

export function chooseGameArchiveDestination(archive) {
  return showSaveFilePicker({ startIn: 'downloads', types: zipTypes, suggestedName: archiveFilename(archive) });
}

export async function saveGameArchive(entry, blob) {
  const writable = await entry.createWritable();
  await blob.stream().pipeTo(writable);
}

/**
 * Asks the browser to keep this address's storage where something is meant to stay (D103): `persisted()` first,
 * `persist()` only when it answered false. A refusal changes nothing visible, so the caller does not wait for it. A
 * missing API counts as a refusal: every call runs inside the chain, whose promise never rejects.
 */
export function askToKeepStorage(storage = globalThis.navigator?.storage) {
  return Promise.resolve()
    .then(() => storage.persisted())
    .then(persisted => { if (persisted === false) return storage.persist(); })
    .then(() => {}, () => {});
}

/** What the player is told once the game runs when the game data could not be kept (D104). */
export function unsavedGameDataNotice(where, error) {
  if (where === 'zip') return 'The game data ZIP could not be saved. The game runs without it.';
  return error?.name === 'QuotaExceededError'
    ? 'Game data was not kept in this browser: there is not enough storage. It downloads again next time.'
    : 'Game data was not kept in this browser. It downloads again next time.';
}

export async function matchingGameArchive(file, archive) {
  if (file.size !== archive.size) return null;
  for (const [index, expected] of archive.chunks.entries()) {
    const offset = index * archive.chunkSize;
    const bytes = await file.slice(offset, offset + archive.chunkSize).arrayBuffer();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const actual = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== expected) return null;
  }
  return file;
}

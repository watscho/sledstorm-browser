export const canChooseGameArchive = typeof globalThis.showOpenFilePicker === 'function'
  && typeof globalThis.showSaveFilePicker === 'function';

const zipTypes = [{ description: 'Sled Storm ZIP archive', accept: { 'application/zip': ['.zip'] } }];
const archiveFilename = archive => `sled-storm-${archive.sha256}.zip`;

export async function openGameArchive() {
  const [entry] = await showOpenFilePicker({ startIn: 'downloads', types: zipTypes });
  return { file: await entry.getFile(), handle: entry };
}

// Keep the user's file handle, rather than copying a disc into each temporary
// tunnel's browser storage. A reload can reuse it while read access is granted.
async function archiveHandle(archive, handle) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('sledstorm-game-data', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Game data storage is unavailable.'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('handles', handle ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('handles');
      const request = handle ? store.put({ sha256: archive.sha256, handle }, 'selected') : store.get('selected');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function rememberGameArchive(archive, handle) {
  try { await archiveHandle(archive, handle); }
  catch { /* A denied storage request must not prevent playing this time. */ }
}

export async function restoreGameArchive(archive, read = () => archiveHandle(archive)) {
  try {
    const saved = await read();
    if (saved?.sha256 !== archive.sha256) return null;
    const permission = await saved.handle.queryPermission({ mode: 'read' });
    // A page reload can reset access to "prompt". Keep the selected source;
    // Join can renew access with user activation, without reopening a picker.
    if (permission === 'prompt') return { handle: saved.handle };
    if (permission !== 'granted') return null;
    return await readGameArchive(saved.handle, archive);
  } catch { return null; }
}

async function readGameArchive(handle, archive) {
  const file = await handle.getFile();
  if (!await matchingGameArchive(file, archive))
    throw new Error('The selected ZIP no longer matches this room. Use Change game data to choose another ZIP.');
  return { file, handle };
}

export async function reopenGameArchive(handle, archive) {
  // Call directly from Join, before network or hashing work uses up activation.
  if (await handle.requestPermission({ mode: 'read' }) !== 'granted')
    throw new Error('Allow access to the selected ZIP to join. You can retry with Join game.');
  return readGameArchive(handle, archive);
}

export function chooseGameArchiveDestination(archive) {
  return showSaveFilePicker({ startIn: 'downloads', types: zipTypes, suggestedName: archiveFilename(archive) });
}

export async function saveGameArchive(entry, blob) {
  const writable = await entry.createWritable();
  await blob.stream().pipeTo(writable);
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

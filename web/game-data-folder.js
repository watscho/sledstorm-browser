export const canChooseGameArchive = typeof globalThis.showOpenFilePicker === 'function'
  && typeof globalThis.showSaveFilePicker === 'function';

const zipTypes = [{ description: 'Sled Storm ZIP archive', accept: { 'application/zip': ['.zip'] } }];
const archiveFilename = archive => `sled-storm-${archive.sha256}.zip`;

export async function openGameArchive() {
  const [entry] = await showOpenFilePicker({ startIn: 'downloads', types: zipTypes });
  return entry.getFile();
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

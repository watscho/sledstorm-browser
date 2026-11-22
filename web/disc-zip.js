// A player's own ZIP of a disc, read in the page (DATA-03, DATA-04). The reader takes the same discs as
// a folder holding them (web/disc-sheet.js) and hands them over as the player's own CUE and BIN files
// are handed over: separate files, the CUE first, then its tracks in CUE order as it spells them, so
// that the disc identity is the same whatever the source. It writes no file, never passes an archive to
// the emulator's own extractor, and reads only what the archive's central directory places inside the
// file: one CUE, and the tracks beside it. Each entry is read once and checked against its CRC-32 and
// its declared size; an entry that grows past its declared size is stopped at once.
import { DiscSheetError, checkDiscSize, cueTrackNames, nameKey } from './disc-sheet.js';
import { matchingGameArchive } from './game-data-folder.js';

/** Entries in one archive: a disc of 99 tracks with its folders and Finder's extras is far below it. */
export const ENTRY_LIMIT = 1000;
/** The central directory's size: a thousand entries with long names take a small part of it. */
export const DIRECTORY_LIMIT = 1024 * 1024;
/** The inflated bytes of an entry that the page holds before it hands them to the browser's blob store
 *  (D86): a whole track held to its end would stay in the page's memory long after it is handed over. */
export const HELD_LIMIT = 16 * 1024 * 1024;

const END_SIGNATURE = 0x06054b50;
const END_SIZE = 22;
const ZIP64_LOCATOR = 0x07064b50;
const LOCATOR_SIZE = 20;
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_SIZE = 46;
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_SIZE = 30;
// Sizes and CRC-32 follow the data instead of the local record.
const DESCRIPTOR_FLAG = 0x0008;
// Encrypted, strongly encrypted, and an encrypted central directory.
const ENCRYPTED_FLAGS = 0x0001 | 0x0040 | 0x2000;
const STORED = 0;
const DEFLATED = 8;

export class DiscZipError extends Error {
  /** `code` names the refusal: damaged, unsupported, too-large, unsafe-name, bad-name, duplicate-name,
   *  no-cue, cue-count, sheet, missing-track or corrupt. */
  constructor(code, message) {
    super(message);
    this.name = 'DiscZipError';
    this.code = code;
  }
}

const REPLACEMENT = String.fromCharCode(0xfffd);
/** A name from the archive as a message may show it: no control characters, and not too long. */
const shown = name => {
  const clean = name.replace(/[\x00-\x1f\x7f-\x9f]/g, REPLACEMENT);
  return clean.length > 120 ? `${clean.slice(0, 120)}...` : clean;
};

const INSTEAD = 'or choose your CUE and BIN files instead.';
const damaged = () => new DiscZipError('damaged', `The ZIP file is damaged or incomplete. Copy or download it again, ${INSTEAD}`);
const unsupported = feature => new DiscZipError('unsupported',
  `The ZIP file uses ${feature}, which this page does not read. Make a plain ZIP of your CUE and BIN files, ${INSTEAD}`);
const corrupt = name => new DiscZipError('corrupt',
  `A file in the ZIP is damaged: ${shown(name)}. Copy or download the ZIP again, ${INSTEAD}`);
const tooLarge = message => new DiscZipError('too-large', message);

// CRC-32 as ZIP computes it (the reflected polynomial 0xedb88320), eight bytes a step.
const CRC_TABLES = (() => {
  const tables = Array.from({ length: 8 }, () => new Int32Array(256));
  for (let byte = 0; byte < 256; byte++) {
    let value = byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    tables[0][byte] = value;
  }
  for (let table = 1; table < 8; table++)
    for (let byte = 0; byte < 256; byte++)
      tables[table][byte] = tables[0][tables[table - 1][byte] & 0xff] ^ (tables[table - 1][byte] >>> 8);
  return tables;
})();

/** The CRC-32 of `bytes`, continuing from `previous` when the data comes in parts. */
export function crc32(bytes, previous = 0) {
  const [t0, t1, t2, t3, t4, t5, t6, t7] = CRC_TABLES;
  let crc = ~previous;
  let index = 0;
  for (const last = bytes.length - 8; index <= last; index += 8) {
    const low = crc ^ (bytes[index] | bytes[index + 1] << 8 | bytes[index + 2] << 16 | bytes[index + 3] << 24);
    crc = t7[low & 0xff] ^ t6[low >>> 8 & 0xff] ^ t5[low >>> 16 & 0xff] ^ t4[low >>> 24]
      ^ t3[bytes[index + 4]] ^ t2[bytes[index + 5]] ^ t1[bytes[index + 6]] ^ t0[bytes[index + 7]];
  }
  for (; index < bytes.length; index++) crc = t0[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

const bytesAt = async (file, start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer());
const viewOf = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** The end record, which must be the last thing in the file: only its own comment may follow it. */
async function endRecord(file) {
  const from = Math.max(0, file.size - END_SIZE - 0xffff - LOCATOR_SIZE);
  const tail = await bytesAt(file, from, file.size);
  const view = viewOf(tail);
  for (let at = tail.length - END_SIZE; at >= 0; at--) {
    if (view.getUint32(at, true) !== END_SIGNATURE) continue;
    if (at + END_SIZE + view.getUint16(at + 20, true) !== tail.length) continue;
    return {
      position: from + at,
      locator: at >= LOCATOR_SIZE && view.getUint32(at - LOCATOR_SIZE, true) === ZIP64_LOCATOR,
      disk: view.getUint16(at + 4, true),
      directoryDisk: view.getUint16(at + 6, true),
      diskEntries: view.getUint16(at + 8, true),
      entries: view.getUint16(at + 10, true),
      size: view.getUint32(at + 12, true),
      offset: view.getUint32(at + 16, true),
    };
  }
  throw damaged();
}

const names = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** A name is UTF-8, flagged or not (Finder and Info-ZIP write it without the flag); nothing else is read. */
function decodeName(raw) {
  try {
    return names.decode(raw);
  } catch {
    throw new DiscZipError('bad-name', 'The ZIP file holds a file name that is not UTF-8, which this page does not read. '
      + `Make the ZIP with a tool that writes UTF-8 names, such as Finder's Compress, ${INSTEAD}`);
  }
}

const CONTROL = /[\x00-\x1f\x7f-\x9f]/;

/** Whether a name could leave the archive's folder anywhere it was written out. A folder ends with `/`;
 *  a name from the root has an empty first segment. */
function unsafe(name) {
  if (/\\/.test(name) || /^[A-Za-z]:/.test(name)) return true;
  const segments = name.split('/');
  if (name.endsWith('/')) segments.pop();
  return segments.some(segment => segment === '' || segment === '.' || segment === '..');
}

/** Finder's resource forks and extended attributes, never part of a disc. */
const ignored = name => name.startsWith('__MACOSX/') || name.slice(name.lastIndexOf('/') + 1).startsWith('._');

async function centralDirectory(file, end) {
  if (end.locator || end.entries === 0xffff || end.diskEntries === 0xffff || end.size === 0xffffffff || end.offset === 0xffffffff)
    throw unsupported('ZIP64');
  if (end.disk !== 0 || end.directoryDisk !== 0 || end.diskEntries !== end.entries)
    throw unsupported('several parts');
  // The directory ends where the end record begins: nothing lies between them, and no data precedes
  // the archive that its offsets do not count.
  if (end.offset + end.size !== end.position) throw damaged();
  if (end.entries > ENTRY_LIMIT)
    throw tooLarge(`The ZIP file holds more than ${ENTRY_LIMIT} files. Choose a ZIP that holds only your disc.`);
  if (end.size > DIRECTORY_LIMIT)
    throw tooLarge('The ZIP file\'s list of contents is larger than 1 MiB. Choose a ZIP that holds only your disc.');

  const directory = await bytesAt(file, end.offset, end.position);
  const view = viewOf(directory);
  const entries = [];
  let at = 0;
  for (let index = 0; index < end.entries; index++) {
    if (at + CENTRAL_SIZE > directory.length || view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw damaged();
    const nameLength = view.getUint16(at + 28, true);
    const next = at + CENTRAL_SIZE + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (next > directory.length) throw damaged();
    const entry = {
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      packed: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
      rawName: directory.subarray(at + CENTRAL_SIZE, at + CENTRAL_SIZE + nameLength),
    };
    if (entry.packed === 0xffffffff || entry.size === 0xffffffff || entry.offset === 0xffffffff) throw unsupported('ZIP64');
    if (view.getUint16(at + 34, true) !== 0) throw unsupported('several parts');
    entry.name = decodeName(entry.rawName);
    entries.push(entry);
    at = next;
  }
  if (at !== directory.length) throw damaged();
  return entries;
}

/** A rule of web/disc-sheet.js, its refusal under the reader's code. */
function sheetRule(rule, code) {
  try {
    return rule();
  } catch (error) {
    if (error instanceof DiscSheetError) throw new DiscZipError(code, error.message);
    throw error;
  }
}

/** Whether this browser inflates raw deflate (Chrome 103, Firefox 113, Safari 16.4 and later). */
function canInflate() {
  try {
    new DecompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

function readable(entry) {
  if (entry.flags & ENCRYPTED_FLAGS) throw unsupported('encryption');
  if (entry.method !== STORED && entry.method !== DEFLATED) throw unsupported(`compression method ${entry.method}`);
  if (entry.method === DEFLATED && !canInflate()) throw new DiscZipError('unsupported',
    `This browser cannot read a compressed ZIP. Make a ZIP without compression, ${INSTEAD}`);
  if (entry.method === STORED && entry.packed !== entry.size) throw damaged();
}

const sameBytes = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

/** Where the entry's data lies: its local record must name it as the directory does, and the data must
 *  end before the directory begins. */
async function locate(file, entry, directoryOffset) {
  const head = await bytesAt(file, entry.offset, entry.offset + LOCAL_SIZE);
  if (head.length < LOCAL_SIZE) throw damaged();
  const view = viewOf(head);
  const flags = view.getUint16(6, true);
  const nameLength = view.getUint16(26, true);
  const start = entry.offset + LOCAL_SIZE + nameLength + view.getUint16(28, true);
  const end = start + entry.packed;
  if (view.getUint32(0, true) !== LOCAL_SIGNATURE || end > directoryOffset) throw damaged();
  if (view.getUint16(8, true) !== entry.method || (flags & ENCRYPTED_FLAGS) !== (entry.flags & ENCRYPTED_FLAGS)) throw damaged();
  if (!(flags & DESCRIPTOR_FLAG) && (view.getUint32(14, true) !== entry.crc || view.getUint32(18, true) !== entry.packed
    || view.getUint32(22, true) !== entry.size)) throw damaged();
  const localName = await bytesAt(file, entry.offset + LOCAL_SIZE, entry.offset + LOCAL_SIZE + nameLength);
  if (!sameBytes(localName, entry.rawName)) throw damaged();
  return { from: entry.offset, start, end };
}

/** The entry's bytes as a file named `name`, read once and checked. A stored entry stays a slice of the
 *  archive; a deflated one is inflated into memory, and no more than its declared size is ever kept. */
async function readEntry(file, entry, range, name) {
  const packed = file.slice(range.start, range.end);
  const source = entry.method === DEFLATED ? packed.stream().pipeThrough(new DecompressionStream('deflate-raw')) : packed.stream();
  const reader = source.getReader();
  // A deflated entry's bytes: the part already handed to the blob store, then at most HELD_LIMIT more.
  let parts = [];
  let held = 0;
  let length = 0;
  let crc = 0;
  try {
    for (;;) {
      let step;
      try {
        step = await reader.read();
      } catch {
        throw corrupt(entry.name);
      }
      if (step.done) break;
      length += step.value.length;
      if (length > entry.size) throw corrupt(entry.name);
      crc = crc32(step.value, crc);
      if (entry.method !== DEFLATED) continue;
      parts.push(step.value);
      held += step.value.length;
      if (held >= HELD_LIMIT) [parts, held] = [[new Blob(parts)], 0];
    }
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  }
  if (length !== entry.size || crc !== entry.crc) throw corrupt(entry.name);
  return new File(entry.method === DEFLATED ? parts : [packed], name);
}

/**
 * The disc in a player's ZIP: `[{ name, size, data, held }]`, the CUE under its file's name, then its tracks
 * in CUE order under the names the CUE spells, as `selectedDisc` gives the player's own files. Rejects
 * with a DiscZipError that tells the player what to do.
 */
export async function readDiscZip(file, report = () => {}) {
  const end = await endRecord(file);
  const entries = await centralDirectory(file, end);
  for (const entry of entries) {
    if (CONTROL.test(entry.name)) throw new DiscZipError('unsafe-name',
      `The ZIP file holds a file whose name has a control character: ${shown(entry.name)}. Choose another ZIP, ${INSTEAD}`);
    if (unsafe(entry.name))
      throw new DiscZipError('unsafe-name', `The ZIP file holds a file whose name leaves its folder: ${shown(entry.name)}. Choose another ZIP.`);
  }

  const files = new Map();
  for (const entry of entries) {
    if (entry.name.endsWith('/') || ignored(entry.name)) continue;
    const key = nameKey(entry.name);
    if (files.has(key))
      throw new DiscZipError('duplicate-name', `The ZIP file holds two files named ${shown(entry.name)}. Keep one of them and make the ZIP again.`);
    files.set(key, entry);
  }
  const cues = [...files.values()].filter(entry => /\.cue$/i.test(entry.name));
  if (!cues.length) throw new DiscZipError('no-cue', 'The ZIP file holds no CUE file. Choose a ZIP that holds your CUE and all its BIN tracks.');
  if (cues.length > 1) throw new DiscZipError('cue-count', 'The ZIP file holds more than one CUE file. Choose a ZIP that holds one disc.');

  const [cue] = cues;
  const folder = cue.name.slice(0, cue.name.lastIndexOf('/') + 1);
  readable(cue);
  sheetRule(() => checkDiscSize([cue.size]), 'too-large');
  const cueRange = await locate(file, cue, end.offset);
  const cueFile = await readEntry(file, cue, cueRange, cue.name.slice(folder.length));
  // Read as the page reads a chosen CUE (Blob.text) and the server a CUE in a folder: UTF-8.
  const text = await cueFile.text();

  // The tracks sit beside the CUE, as in a folder; other files are not part of the disc.
  const tracks = sheetRule(() => cueTrackNames(text, cueFile.name), 'sheet').map(spelling => {
    const entry = files.get(nameKey(folder + spelling));
    if (!entry)
      throw new DiscZipError('missing-track', `The ZIP file lacks a track that its CUE lists: ${shown(spelling)}. The tracks must sit beside the CUE.`);
    readable(entry);
    return { spelling, entry };
  });
  sheetRule(() => checkDiscSize([cue.size, ...tracks.map(track => track.entry.size)]), 'too-large');

  // Every entry used lies apart from the others: no entry's data holds another one.
  const ranges = [cueRange];
  for (const track of tracks) ranges.push(track.range = await locate(file, track.entry, end.offset));
  ranges.sort((a, b) => a.from - b.from);
  for (let index = 1; index < ranges.length; index++)
    if (ranges[index].from < ranges[index - 1].end) throw damaged();

  // `held`: what an entry's data keeps in the browser's blob store, the disc's size for a deflated one (D86, D90).
  const held = entry => (entry.method === DEFLATED ? entry.size : 0);
  const disc = [{ name: cueFile.name, size: cue.size, data: cueFile, held: held(cue) }];
  for (const [index, track] of tracks.entries()) {
    report(`Checking the ZIP: track ${index + 1}/${tracks.length}: ${track.spelling}`);
    const data = await readEntry(file, track.entry, track.range, track.spelling);
    disc.push({ name: track.spelling, size: track.entry.size, data, held: held(track.entry) });
  }
  return disc;
}

/**
 * A player's ZIP. The exact copy of the server's archive (`archive`: its size and every chunk's SHA-256,
 * D74) keeps its fast path: `{ archive: file }`, passed to the emulator as `/disc.zip` is and identified
 * by the session's info. Any other ZIP, or any ZIP when the room announces no archive, is read and
 * checked: `{ files }`, as `readDiscZip` gives them; its refusal is final, and no other source is tried.
 */
export async function discFromZip(file, archive, report = () => {}) {
  if (archive) {
    report('Comparing the ZIP with the room\'s archive...');
    if (await matchingGameArchive(file, archive)) return { archive: file };
  }
  return { files: await readDiscZip(file, report) };
}

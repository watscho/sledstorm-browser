// Prepares the user's disc for the emulator: its identity, and a canonical
// uncompressed ZIP archive that is never written to disk. The archive is
// streamed as small headers around the user's own files, so its bytes depend
// only on the file names, their contents and their order.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { GameFolderError, type DiscFile, type DiscFolder } from './disc-folder.ts';

export const DISC_CHUNK_SIZE = 8 * 1024 * 1024;

export interface ArchiveManifest {
  sha256: string;
  size: number;
  chunkSize: number;
  /** SHA-256 of each `chunkSize` slice of the archive, in order. */
  chunks: string[];
}

export interface DiscIdentity {
  /** The existing disc identity: it must match the browser's `identifyDisc`. */
  disc: string;
  pal: boolean;
  archive: ArchiveManifest;
}

export interface GameData {
  identity: DiscIdentity;
  /** True when an earlier stamp was reused and no disc file was read. */
  reused: boolean;
  /** Streams the canonical archive; rejects with GameFilesChangedError when a source differs from the stamp. */
  openArchive(): Promise<Readable>;
}

export class GameFilesChangedError extends Error {}

const FORMAT = 'stored-v2';
const PAL_FIRST_TRACK_SHA1 = 'c5506c3eb3601d68d11f2c8754e03a6b06be5f2d';
// A classic ZIP field holds 32 bits, and the all-ones value is reserved.
const ZIP_LIMIT = 0xffff_ffff;
// 1980-01-01, the earliest date the format can express. A fixed date keeps
// the archive independent of file times and time zones.
const DOS_DATE = 0x0021;
const READ_SIZE = 1024 * 1024;

interface Entry {
  name: string;
  size: number;
  crc32: number;
  sha256: string;
}

type Source = [name: string, size: number, mtimeNs: string];

interface Stamp {
  format: string;
  chunkSize: number;
  sources: Source[];
  entries: Entry[];
  firstTrackSha1: string;
  identity: DiscIdentity;
}

const nameFlags = (name: string) => /^[\x00-\x7f]*$/.test(name) ? 0 : 0x0800;

function localHeader(entry: Entry): Buffer {
  const name = Buffer.from(entry.name, 'utf8');
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(nameFlags(entry.name), 6);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(entry.crc32, 14);
  header.writeUInt32LE(entry.size, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(name.length, 26);
  name.copy(header, 30);
  return header;
}

/** The central directory followed by the end record. */
function directory(entries: Entry[]): Buffer {
  const headers: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const header = Buffer.alloc(46 + name.length);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(0x0314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(nameFlags(entry.name), 8);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(entry.crc32, 16);
    header.writeUInt32LE(entry.size, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(0x81a40000, 38);
    header.writeUInt32LE(offset, 42);
    name.copy(header, 46);
    headers.push(header);
    offset += 30 + name.length + entry.size;
  }
  const central = Buffer.concat(headers);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([central, end]);
}

function archiveSize(files: DiscFile[]): number {
  return files.reduce((size, file) => size + 76 + 2 * Buffer.byteLength(file.name, 'utf8') + file.size, 22);
}

const CHANGED = 'The game files changed after they were prepared.';

async function expectSame(handle: FileHandle, file: DiscFile): Promise<void> {
  const status = await handle.stat({ bigint: true });
  if (!status.isFile() || Number(status.size) !== file.size || String(status.mtimeNs) !== file.mtimeNs)
    throw new GameFilesChangedError(CHANGED);
}

/**
 * The archive, piece by piece. Each file is read through one open handle and
 * compared with its prepared state before and after: a file that is replaced
 * or rewritten while a slow download is under way ends the stream early, so a
 * mix of two versions never arrives as a complete archive.
 */
async function* archiveParts(files: DiscFile[], entries: Entry[], signal?: AbortSignal): AsyncGenerator<Buffer> {
  for (const [index, entry] of entries.entries()) {
    yield localHeader(entry);
    const file = files[index]!;
    const handle = await open(file.path, 'r').catch(() => { throw new GameFilesChangedError(CHANGED); });
    try {
      await expectSame(handle, file);
      let sent = 0;
      if (entry.size > 0) {
        const source = handle.createReadStream({ start: 0, end: entry.size - 1, highWaterMark: READ_SIZE, autoClose: false });
        for await (const part of source as AsyncIterable<Buffer>) {
          signal?.throwIfAborted();
          sent += part.length;
          yield part;
        }
      }
      if (sent !== entry.size) throw new GameFilesChangedError(CHANGED);
      await expectSame(handle, file);
    } finally {
      await handle.close();
    }
  }
  yield directory(entries);
}

async function expectUnchanged(files: DiscFile[], message: string): Promise<void> {
  for (const file of files) {
    const status = await stat(file.path, { bigint: true }).catch(() => null);
    if (!status?.isFile() || Number(status.size) !== file.size || String(status.mtimeNs) !== file.mtimeNs)
      throw new GameFilesChangedError(message);
  }
}

const sha256Of = (text: string) => createHash('sha256').update(text).digest('hex');

/** The stamp travels with a checksum of its own text, so a cut or edited file is never trusted. */
const sealStamp = (stamp: Stamp) => {
  const body = JSON.stringify(stamp);
  return JSON.stringify({ sha256: sha256Of(body), body });
};

async function readStamp(path: string, chunkSize: number, sources: Source[], size: number): Promise<Stamp | null> {
  try {
    const { sha256, body } = JSON.parse(await readFile(path, 'utf8')) as { sha256?: unknown; body?: unknown };
    if (typeof body !== 'string' || sha256Of(body) !== sha256) return null;
    const stamp = JSON.parse(body) as Stamp;
    if (stamp.format !== FORMAT || stamp.chunkSize !== chunkSize) return null;
    if (JSON.stringify(stamp.sources) !== JSON.stringify(sources)) return null;
    const { archive } = stamp.identity;
    const complete = stamp.entries.length === sources.length
      && stamp.entries.every((entry, index) => entry.name === sources[index]![0] && entry.size === sources[index]![1])
      && archive.size === size && archive.chunkSize === chunkSize
      && archive.chunks.length === Math.ceil(size / chunkSize);
    return complete ? stamp : null;
  } catch {
    // Missing, cut short or edited by hand: prepare the disc again.
    return null;
  }
}

async function build(files: DiscFile[], sources: Source[], chunkSize: number, size: number,
  onProgress?: (doneBytes: number, totalBytes: number) => void, signal?: AbortSignal): Promise<Stamp> {
  const total = files.reduce((sum, file) => sum + file.size, size);
  let done = 0;
  const advance = (bytes: number) => {
    done += bytes;
    onProgress?.(done, total);
  };

  // Pass one: every file once, for the checksums that the headers and the identity need.
  const entries: Entry[] = [];
  let firstTrackSha1 = '';
  for (const [index, file] of files.entries()) {
    const sha256 = createHash('sha256');
    const sha1 = index === 1 ? createHash('sha1') : null;
    let checksum = 0;
    let read = 0;
    for await (const part of createReadStream(file.path, { highWaterMark: READ_SIZE }) as AsyncIterable<Buffer>) {
      signal?.throwIfAborted();
      sha256.update(part);
      sha1?.update(part);
      checksum = crc32(part, checksum);
      read += part.length;
      advance(part.length);
    }
    if (read !== file.size) throw new GameFilesChangedError('The game files changed while they were being prepared.');
    if (sha1) firstTrackSha1 = sha1.digest('hex');
    entries.push({ name: file.name, size: file.size, crc32: checksum, sha256: sha256.digest('hex') });
  }

  // Pass two: the archive exactly as it will be sent, for its own hashes.
  const whole = createHash('sha256');
  const chunks: string[] = [];
  let chunk = createHash('sha256');
  let filled = 0;
  let produced = 0;
  for await (const part of archiveParts(files, entries, signal)) {
    whole.update(part);
    for (let offset = 0; offset < part.length;) {
      const take = Math.min(chunkSize - filled, part.length - offset);
      chunk.update(part.subarray(offset, offset + take));
      filled += take;
      offset += take;
      if (filled === chunkSize) {
        chunks.push(chunk.digest('hex'));
        chunk = createHash('sha256');
        filled = 0;
      }
    }
    produced += part.length;
    advance(part.length);
  }
  if (filled > 0) chunks.push(chunk.digest('hex'));
  if (produced !== size) throw new Error('The prepared archive does not have its planned size.');
  await expectUnchanged(files, 'The game files changed while they were being prepared.');

  const manifest = entries.map(entry => [entry.name, entry.size, entry.sha256]);
  return {
    format: FORMAT, chunkSize, sources, entries, firstTrackSha1,
    identity: {
      disc: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
      pal: firstTrackSha1 === PAL_FIRST_TRACK_SHA1,
      archive: { sha256: whole.digest('hex'), size, chunkSize, chunks },
    },
  };
}

export async function prepareGameData(disc: DiscFolder, cacheRoot: string, options: {
  chunkSize?: number;
  onProgress?: (doneBytes: number, totalBytes: number) => void;
  /** Stops the preparation between two reads; the promise then rejects with the signal's reason. */
  signal?: AbortSignal;
} = {}): Promise<GameData> {
  const chunkSize = options.chunkSize ?? DISC_CHUNK_SIZE;
  const { files } = disc;
  const size = archiveSize(files);
  if (files.length > 0xffff || size >= ZIP_LIMIT || files.some(file => file.size >= ZIP_LIMIT))
    throw new GameFolderError('The game files are too large for the archive format.');
  const sources = files.map((file): Source => [file.name, file.size, file.mtimeNs]);

  const folder = join(cacheRoot, 'game-data');
  const stampPath = join(folder, 'archive.json');
  let stamp = await readStamp(stampPath, chunkSize, sources, size);
  const reused = stamp !== null;
  if (!stamp) {
    stamp = await build(files, sources, chunkSize, size, options.onProgress, options.signal);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const temporary = `${stampPath}.${process.pid}.tmp`;
    await writeFile(temporary, sealStamp(stamp), { mode: 0o600 });
    await rename(temporary, stampPath);
  }

  const { entries, identity } = stamp;
  return {
    identity,
    reused,
    async openArchive() {
      await expectUnchanged(files, CHANGED);
      return Readable.from(archiveParts(files, entries), { objectMode: false });
    },
  };
}

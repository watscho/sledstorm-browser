// Finds the disc image in the folder the user chose: one CUE sheet and the
// track files it lists. A name read from the CUE is never trusted as a path.
// The sheet's rules and bounds are the page's (web/disc-sheet.js), so that a
// player's own files are taken exactly when the host's would be.
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CUE_LIMIT, DiscSheetError, checkDiscSize, cueTrackNames } from './network.ts';

export interface DiscFile {
  /** The name as the CUE spells it; the emulator looks the track up by it. */
  name: string;
  path: string;
  size: number;
  mtimeNs: string;
}

/** files[0] is the CUE; the tracks follow in CUE order. `folder` is a real path. */
export interface DiscFolder {
  folder: string;
  files: DiscFile[];
}

export class GameFolderError extends Error {}

async function regularFile(path: string, name: string): Promise<DiscFile | null> {
  const status = await stat(path, { bigint: true });
  return status.isFile() ? { name, path, size: Number(status.size), mtimeNs: String(status.mtimeNs) } : null;
}

function sheetRule<T>(rule: () => T): T {
  try {
    return rule();
  } catch (error) {
    if (error instanceof DiscSheetError) throw new GameFolderError(error.message);
    throw error;
  }
}

/** The CUE's text: refused over its bound before a byte is read, and never read past it. */
async function readCue(cue: DiscFile): Promise<string> {
  sheetRule(() => checkDiscSize([cue.size]));
  const handle = await open(cue.path, 'r');
  try {
    const buffer = Buffer.alloc(CUE_LIMIT + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    sheetRule(() => checkDiscSize([length]));
    return buffer.toString('utf8', 0, length);
  } finally {
    await handle.close();
  }
}

export async function findDisc(chosen: string): Promise<DiscFolder> {
  let folder: string;
  let entries;
  try {
    folder = await realpath(chosen);
    entries = await readdir(folder, { withFileTypes: true });
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT') throw new GameFolderError('The game folder does not exist.');
    if (code === 'ENOTDIR') throw new GameFolderError('The game folder is not a folder.');
    if (code === 'EACCES' || code === 'EPERM')
      throw new GameFolderError('The game folder cannot be read. Check its permissions.');
    throw error;
  }

  const cues = entries.filter(entry => entry.isFile() && /\.cue$/i.test(entry.name));
  if (cues.length !== 1) throw new GameFolderError('Expected exactly one CUE file in the game folder.');
  const cueName = cues[0]!.name;
  const cue = await regularFile(join(folder, cueName), cueName);
  if (!cue) throw new GameFolderError('Expected exactly one CUE file in the game folder.');
  const text = await readCue(cue);
  const names = sheetRule(() => cueTrackNames(text, cueName));

  const files = [cue];
  for (const name of names) {
    const refused = new GameFolderError(`The CUE file refers to a missing track or a file outside the game folder: ${name}`);
    // The real path settles links: the track must sit directly in the folder.
    const track = await realpath(join(folder, name)).catch(() => null);
    if (!track || dirname(track) !== folder) throw refused;
    const file = await regularFile(track, name);
    if (!file) throw refused;
    files.push(file);
  }
  sheetRule(() => checkDiscSize(files.map(file => file.size)));
  return { folder, files };
}

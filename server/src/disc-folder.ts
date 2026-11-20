// Finds the disc image in the folder the user chose: one CUE sheet and the
// track files it lists. A name read from the CUE is never trusted as a path.
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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
  const text = await readFile(cue.path, 'utf8');
  // Some editors start the file with a byte order mark. The browser client ignores it as well.
  const sheet = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const names = Array.from(sheet.matchAll(/^FILE "([^"]+)" BINARY\s*$/gm), match => match[1]!);
  if (!names.length) throw new GameFolderError('The CUE file lists no BINARY tracks.');

  const files = [cue];
  const listed = new Set<string>();
  for (const name of names) {
    if (listed.has(name)) throw new GameFolderError(`The CUE file lists a track twice: ${name}`);
    listed.add(name);
    const refused = new GameFolderError(`The CUE file refers to a missing track or a file outside the game folder: ${name}`);
    if (/[\\/]/.test(name)) throw refused;
    // The real path settles links: the track must sit directly in the folder.
    const track = await realpath(join(folder, name)).catch(() => null);
    if (!track || dirname(track) !== folder) throw refused;
    const file = await regularFile(track, name);
    if (!file) throw refused;
    files.push(file);
  }
  return { folder, files };
}

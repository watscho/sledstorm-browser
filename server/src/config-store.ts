// The host's saved choices. The file is versioned, validated on every read
// and replaced atomically; reading never changes it.
import { randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { Paths } from './paths.ts';

/** Whether remote players may download the host's disc, or must bring their own files. */
export type DiscPolicy = 'local-only' | 'shared-allowed';

/**
 * What the owner chose for the room: all content unlocked or the original progression, and separate
 * cameras or a shared one. Only the verified PAL disc plays them; any other disc plays the original
 * progression with a shared camera.
 */
export interface RoomPreference {
  progress: 'all' | 'original';
  camera: boolean;
}

export interface HostConfig {
  version: 1;
  gameFolder: string | null;
  /** Null until the host has chosen: sharing is never switched on by default. */
  discPolicy: DiscPolicy | null;
  /** Whether hosting starts when the server does. A file without the key means yes. */
  autoStart: boolean;
  /** A file without the key means the web client's defaults: all content unlocked, separate cameras. */
  roomOptions: RoomPreference;
}

export const defaultConfig: HostConfig = Object.freeze({ version: 1, gameFolder: null, discPolicy: null, autoStart: true,
  roomOptions: Object.freeze({ progress: 'all', camera: true }) });

/** True for an object with exactly the two fields of a room preference, each valid. */
export function isRoomPreference(value: unknown): value is RoomPreference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { progress, camera, ...rest } = value as Record<string, unknown>;
  return Object.keys(rest).length === 0 && (progress === 'all' || progress === 'original') && typeof camera === 'boolean';
}

const configFile = (paths: Paths) => join(paths.dataRoot, 'config.json');
const damaged = 'The configuration file is damaged. Choose the game folder again.';

/** `problem` is a sentence for the user, or null. A problem never changes the file. */
export async function readConfig(paths: Paths): Promise<{ config: HostConfig; problem: string | null }> {
  const failed = (problem: string) => ({ config: defaultConfig, problem });
  let text: string;
  try {
    text = await readFile(configFile(paths), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { config: defaultConfig, problem: null };
    return failed('The configuration file cannot be read.');
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return failed(damaged); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return failed(damaged);
  const { version, gameFolder = null, discPolicy = null, autoStart = true, roomOptions = defaultConfig.roomOptions } =
    value as Record<string, unknown>;
  if (typeof version === 'number' && version > 1)
    return failed('The configuration was written by a newer version of Sled Storm Server. Update the application.');
  if (version !== 1) return failed(damaged);
  if (gameFolder !== null && (typeof gameFolder !== 'string' || !isAbsolute(gameFolder))) return failed(damaged);
  if (discPolicy !== null && discPolicy !== 'local-only' && discPolicy !== 'shared-allowed') return failed(damaged);
  if (typeof autoStart !== 'boolean') return failed(damaged);
  if (!isRoomPreference(roomOptions)) return failed(damaged);
  return { config: { version: 1, gameFolder, discPolicy, autoStart, roomOptions: { progress: roomOptions.progress, camera: roomOptions.camera } },
    problem: null };
}

export async function writeConfig(paths: Paths, config: HostConfig): Promise<void> {
  const file = configFile(paths);
  // A file this version cannot use is set aside, not destroyed.
  if ((await readConfig(paths)).problem) await rename(file, `${file}.bad`).catch(() => {});
  // A name of its own for every write: the server and a command may write at the same moment, and each
  // puts a whole file in place.
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

// Every location the server reads or writes is decided here.
import { mkdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { isSea } from 'node:sea';

export const applicationName = 'Sled Storm Server';
const PROFILES = 'browser-profiles';

export interface Paths {
  /** Immutable files shipped with the executable. Never written. */
  resourceRoot: string;
  /** Persistent configuration and service records. */
  dataRoot: string;
  /** Data that can be rebuilt. */
  cacheRoot: string;
  logRoot: string;
  /** Parent of per-run temporary directories. */
  tempRoot: string;
  /** Temporary profiles of the emulator's browser, and its crash reports. Emptied when hosting starts; nothing else lives here. */
  profileRoot: string;
}

export interface PathInputs {
  sea: boolean;
  execPath: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  temp: string;
}

export function resolvePaths({ sea, execPath, platform, env, home, temp }: PathInputs): Paths {
  let resourceRoot: string;
  if (sea) {
    // Resources sit beside the executable, wherever the user put the application.
    const directory = dirname(execPath);
    const contents = dirname(directory);
    resourceRoot = ['MacOS', 'Helpers'].includes(basename(directory)) && basename(contents) === 'Contents'
      ? join(contents, 'Resources')
      : join(directory, 'resources');
  } else {
    const development = env.SLED_SERVER_RESOURCES;
    if (!development || !isAbsolute(development))
      throw new Error('Set SLED_SERVER_RESOURCES to an absolute resource directory when running outside the packaged executable.');
    resourceRoot = development;
  }

  const relocated = env.SLED_SERVER_HOME;
  if (relocated !== undefined && relocated !== '') {
    if (!isAbsolute(relocated)) throw new Error('SLED_SERVER_HOME must be an absolute path.');
    const cacheRoot = join(relocated, 'cache');
    return { resourceRoot, dataRoot: join(relocated, 'data'), cacheRoot, logRoot: join(relocated, 'logs'), tempRoot: temp,
      profileRoot: join(cacheRoot, PROFILES) };
  }
  if (platform !== 'darwin')
    throw new Error(`No default data location for ${platform} yet. Set SLED_SERVER_HOME to an absolute path.`);
  const library = join(home, 'Library');
  const cacheRoot = join(library, 'Caches', applicationName);
  return {
    resourceRoot,
    dataRoot: join(library, 'Application Support', applicationName),
    cacheRoot,
    logRoot: join(library, 'Logs', applicationName),
    tempRoot: temp,
    profileRoot: join(cacheRoot, PROFILES),
  };
}

export function currentPaths(): Paths {
  return resolvePaths({ sea: isSea(), execPath: process.execPath, platform: process.platform,
    env: process.env, home: homedir(), temp: tmpdir() });
}

export async function ensureWritableRoots(paths: Paths): Promise<void> {
  for (const root of [paths.dataRoot, paths.cacheRoot, paths.logRoot])
    await mkdir(root, { recursive: true, mode: 0o700 });
}

// Shared helpers for the developer and CI build scripts.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const repoRoot = dirname(serverRoot);
export const distRoot = join(repoRoot, 'dist');
export const executableName = 'SledStormServer';
export const applicationName = 'Sled Storm Server';

const execFileAsync = promisify(execFile);

export async function run(command, args, options = {}) {
  const { stdout } = await execFileAsync(command, args, { maxBuffer: 16 * 1024 * 1024, ...options });
  return stdout.trim();
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

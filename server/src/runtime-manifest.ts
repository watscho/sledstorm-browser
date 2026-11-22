// The runtime manifest that the build writes beside the executable: the
// versions and checksums of its parts. It holds no secret.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSea } from 'node:sea';

export type RuntimeManifest = Record<string, unknown>;

/** The manifest of the build in this resource root, or null when there is none that can be read. */
export async function readRuntimeManifest(resourceRoot: string): Promise<RuntimeManifest | null> {
  try {
    const value: unknown = JSON.parse(await readFile(join(resourceRoot, 'runtime-manifest.json'), 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RuntimeManifest : null;
  } catch {
    return null;
  }
}

/** The checksum of the server's own code in the build: what tells one build from another. Null without one. */
export function buildOf(manifest: RuntimeManifest | null): string | null {
  const server = manifest?.server;
  const sha256 = typeof server === 'object' && server !== null ? (server as { sha256?: unknown }).sha256 : undefined;
  return typeof sha256 === 'string' && /^[a-f0-9]{64}$/.test(sha256) ? sha256 : null;
}

/** The build of this program: its manifest's, when it is the packaged executable. A run from source has none. */
export async function currentBuild(resourceRoot: string): Promise<string | null> {
  return isSea() ? buildOf(await readRuntimeManifest(resourceRoot)) : null;
}

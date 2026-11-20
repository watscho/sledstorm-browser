// Values that must agree across files that cannot import each other.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { applicationName as packagedName } from '../scripts/lib.mjs';
import { applicationName } from '../src/paths.ts';

const json = async (path: string) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('the server and the existing network modules pin the same ws', async () => {
  const server = await json('../package.json');
  const network = await json('../../research/network/package.json');
  assert.equal(server.dependencies.ws, network.dependencies.ws);
  assert.match(server.dependencies.ws, /^\d+\.\d+\.\d+$/, 'an exact version, not a range');
});

test('the server package follows the wrapper version', async () => {
  const version = (await readFile(new URL('../../VERSION', import.meta.url), 'utf8')).trim();
  assert.equal((await json('../package.json')).version, version);
  assert.equal((await json('../package-lock.json')).version, version);
});

test('the build scripts and the server agree on the application name', () => {
  assert.equal(packagedName, applicationName);
});

test('the pinned Node.js archive is identified by version and SHA-256', async () => {
  const { node } = await json('../toolchain.lock.json');
  assert.match(node.version, /^\d+\.\d+\.\d+$/);
  for (const archive of Object.values(node.archives) as { file: string; sha256: string }[]) {
    assert.ok(archive.file.includes(`v${node.version}`), archive.file);
    assert.match(archive.sha256, /^[a-f0-9]{64}$/);
  }
});

test('the sources hold no invisible characters', async () => {
  // A zero-width or control character in source survives review unseen and dies in a formatter.
  const invisible = (code: number) => code === 0xfeff || code === 0x2060 || code === 0x7f
    || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202f) || (code < 0x20 && code !== 0x09 && code !== 0x0a);
  const offenders: string[] = [];
  for (const directory of ['src', 'test', 'scripts', 'smoke']) {
    const root = new URL(`../${directory}/`, import.meta.url);
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const text = await readFile(join(entry.parentPath, entry.name), 'utf8');
      if (Array.from(text).some(character => invisible(character.codePointAt(0)!))) offenders.push(`${directory}/${entry.name}`);
    }
  }
  assert.deepEqual(offenders, []);
});

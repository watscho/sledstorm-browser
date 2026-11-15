// Values that must agree across files that cannot import each other.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

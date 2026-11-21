// Values that must agree across files that cannot import each other.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { applicationName as packagedName } from '../scripts/lib.mjs';
import { QUIT_WAIT_MS } from '../src/control.ts';
import { WORKER_GRACE_MS } from '../src/dedicated.ts';
import { applicationName } from '../src/paths.ts';
import { TUNNEL_GRACE_MS } from '../src/tunnel.ts';

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

test('the pinned cloudflared is identified by version and two SHA-256 values', async () => {
  const { cloudflared } = await json('../toolchain.lock.json');
  assert.match(cloudflared.version, /^\d{4}\.\d+\.\d+$/);
  const archives = Object.values(cloudflared.archives) as { url: string; file: string; sha256: string; binarySha256: string }[];
  assert.ok(archives.length > 0);
  for (const archive of archives) {
    assert.equal(archive.url, `https://github.com/cloudflare/cloudflared/releases/download/${cloudflared.version}/${archive.file}`);
    assert.match(archive.sha256, /^[a-f0-9]{64}$/);
    assert.match(archive.binarySha256, /^[a-f0-9]{64}$/);
    assert.notEqual(archive.sha256, archive.binarySha256);
  }
});

test('the pinned Chromium is one exact build from the project\'s own snapshot store', async () => {
  const { chromium } = await json('../toolchain.lock.json');
  assert.match(chromium.version, /^\d+\.\d+\.\d+\.\d+$/);
  const archives = Object.values(chromium.archives) as { position: number; commit: string; url: string; file: string;
    sha256: string; application: string; executable: string; framework: string; executableSha256: string; frameworkSha256: string }[];
  assert.ok(archives.length > 0);
  for (const archive of archives) {
    assert.ok(Number.isInteger(archive.position));
    assert.match(archive.url,
      new RegExp(`^https://storage\\.googleapis\\.com/chromium-browser-snapshots/[A-Za-z_]+/${archive.position}/${archive.file}$`));
    assert.match(archive.sha256, /^[a-f0-9]{64}$/);
    assert.match(archive.commit, /^[a-f0-9]{40}$/);
    for (const piece of [archive.application, archive.executable, archive.framework])
      assert.ok(!piece.startsWith('/') && !piece.split('/').includes('..'), piece);
    // The launcher is a small stub; the framework holds the browser. Both are pinned, beside the archive.
    assert.ok(archive.framework.includes(chromium.version), archive.framework);
    for (const hash of [archive.executableSha256, archive.frameworkSha256]) assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(new Set([archive.sha256, archive.executableSha256, archive.frameworkSha256]).size, 3);
    assert.ok(archive.application.endsWith('.app'));
  }
});

test('the quit command waits longer than the forced ends of a tunnel and of a worker together', () => {
  // The host stops its tunnels first and its workers after them; each may need its whole grace period.
  assert.ok(QUIT_WAIT_MS >= TUNNEL_GRACE_MS + WORKER_GRACE_MS + 2000, `${QUIT_WAIT_MS} ms`);
});

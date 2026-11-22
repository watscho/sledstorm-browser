import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkFiles } from '../scripts/macos-release.mjs';

test('RELEASE-01 requires the expected manifest and notices as regular files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sled-release-test-'));
  try {
    const files = ['runtime-manifest.json', 'licenses/upstream.txt'];
    const notice = join(root, 'licenses', 'upstream.txt');
    await mkdir(join(root, 'licenses'));
    await writeFile(join(root, 'runtime-manifest.json'), '{}');
    await assert.rejects(checkFiles(root, files), /RELEASE-01.*inventory/);
    await symlink('../runtime-manifest.json', notice);
    await assert.rejects(checkFiles(root, files), /RELEASE-01.*regular file/);
    await rm(notice);
    await writeFile(notice, 'synthetic license');
    await checkFiles(root, files);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('RELEASE-01 rejects disc, save, credential and unexpected folder entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sled-release-test-'));
  try {
    const expected = ['app.js'];
    await writeFile(join(root, 'app.js'), 'synthetic asset');
    for (const name of ['disc.bin', 'profile.sledsave', '.env']) {
      await writeFile(join(root, name), 'synthetic excluded file');
      await assert.rejects(checkFiles(root, expected), /RELEASE-01.*inventory/);
      await rm(join(root, name));
    }
    await mkdir(join(root, 'cache'));
    await assert.rejects(checkFiles(root, expected), /RELEASE-01.*inventory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

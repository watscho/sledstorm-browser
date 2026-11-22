// The discs that the page's tests read too (web/disc-identity.test.mjs), with the identities of the
// Python launcher's algorithm (server/scripts/disc-fixtures.py): one disc, one identity, whoever reads it.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { findDisc, GameFolderError } from '../src/disc-folder.ts';
import { prepareGameData } from '../src/game-data.ts';
import { identifyDisc } from '../../web/disc-identity.js';
import { readDiscZip } from '../../web/disc-zip.js';

interface FixtureFile { name: string; base64: string }
const fixtures = JSON.parse(await readFile(new URL('../../web/disc-identity.fixtures.json', import.meta.url), 'utf8')) as {
  discs: { name: string; files: FixtureFile[]; disc: string; pal: boolean; foldedNames?: true }[];
  refused: { name: string; files: FixtureFile[]; error: string }[];
  archives: { name: string; from?: string; base64: string; disc?: string; canonical?: true }[];
};

async function scratch(t: TestContext): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sled disc identity ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeFiles(folder: string, files: FixtureFile[]): Promise<void> {
  await mkdir(folder, { recursive: true });
  for (const file of files) await writeFile(join(folder, file.name), Buffer.from(file.base64, 'base64'));
}

/** Whether the volume finds a file by a name in another case and normalization, as macOS volumes do by default. */
async function foldsNames(root: string): Promise<boolean> {
  await writeFile(join(root, 'PROBE E\u0301'), '');
  return stat(join(root, 'probe \u00e9')).then(() => true, () => false);
}

test('the server gives each shared disc the identity that the page and the Python launcher give it', async t => {
  assert.ok(fixtures.discs.length >= 4);
  const root = await scratch(t);
  const folds = await foldsNames(root);
  for (const [index, fixture] of fixtures.discs.entries()) {
    if (fixture.foldedNames && !folds) {
      t.diagnostic(`skipped on a volume that matches names exactly: ${fixture.name}`);
      continue;
    }
    const folder = join(root, `disc ${index}`);
    await writeFiles(folder, fixture.files);
    const { identity } = await prepareGameData(await findDisc(folder), join(root, `cache ${index}`));
    assert.deepEqual({ disc: identity.disc, pal: identity.pal }, { disc: fixture.disc, pal: fixture.pal }, fixture.name);
  }
});

test('the server refuses each shared refused disc with the page\'s message', async t => {
  assert.ok(fixtures.refused.length >= 6);
  const root = await scratch(t);
  for (const [index, fixture] of fixtures.refused.entries()) {
    const folder = join(root, `disc ${index}`);
    await writeFiles(folder, fixture.files);
    await assert.rejects(findDisc(folder), (error: unknown) => {
      assert.ok(error instanceof GameFolderError, `${fixture.name}: ${String(error)}`);
      assert.equal(error.message, fixture.error, fixture.name);
      return true;
    });
  }
});

test('the server streams the canonical archive that the fixtures rebuild, and the page reads the server\'s identity from it', async t => {
  const canonical = fixtures.archives.filter(archive => archive.canonical);
  assert.equal(canonical.length, fixtures.discs.length);
  const root = await scratch(t);
  const folds = await foldsNames(root);
  for (const [index, archive] of canonical.entries()) {
    const fixture = fixtures.discs.find(disc => disc.name === archive.from)!;
    if (fixture.foldedNames && !folds) {
      t.diagnostic(`skipped on a volume that matches names exactly: ${fixture.name}`);
      continue;
    }
    const folder = join(root, `disc ${index}`);
    await writeFiles(folder, fixture.files);
    const data = await prepareGameData(await findDisc(folder), join(root, `cache ${index}`));
    const parts: Buffer[] = [];
    for await (const part of await data.openArchive()) parts.push(part as Buffer);
    const bytes = Buffer.concat(parts);
    // The archive's bytes are pinned (brief 11.4): unchanged files give the same archive, whoever builds it.
    assert.ok(bytes.equals(Buffer.from(archive.base64, 'base64')), archive.name);
    const files = await readDiscZip(new File([bytes], 'disc.zip'));
    assert.deepEqual(await identifyDisc(files), { disc: data.identity.disc, pal: data.identity.pal }, archive.name);
    assert.equal(data.identity.disc, fixture.disc, archive.name);
  }
});

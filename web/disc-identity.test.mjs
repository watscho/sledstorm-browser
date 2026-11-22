import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { identifyDisc } from './disc-identity.js';
import { selectedDisc } from './local-disc.js';

test('local file identity matches the server manifest and rejects changed audio', async () => {
  const files = [
    { name: 'Sled Storm.cue', data: new Blob(['FILE "Track 01.bin" BINARY\n']) },
    { name: 'Track 01.bin', data: new Blob([new Uint8Array([1, 2, 3])]) },
    { name: 'Track 02.bin', data: new Blob([new Uint8Array([4, 5, 6])]) },
  ].map(file => ({ ...file, size: file.data.size }));
  const manifest = await Promise.all(files.map(async file => [file.name, file.size,
    createHash('sha256').update(new Uint8Array(await file.data.arrayBuffer())).digest('hex')]));
  const actual = await identifyDisc(files);
  assert.equal(actual.disc, createHash('sha256').update(JSON.stringify(manifest)).digest('hex'));
  assert.equal(actual.pal, false);
  files[2].data = new Blob([new Uint8Array([4, 5, 7])]);
  assert.notEqual((await identifyDisc(files)).disc, actual.disc);
});

// The fixtures that the server's tests read too (server/test/disc-identity.test.ts), with the
// identities of the Python launcher's algorithm (server/scripts/disc-fixtures.py).
const fixtures = JSON.parse(await readFile(new URL('./disc-identity.fixtures.json', import.meta.url), 'utf8'));
const chosen = list => list.map(({ name, base64 }) => new File([Buffer.from(base64, 'base64')], name));

test('the page gives each shared disc the identity that the server and the Python launcher give it', async () => {
  assert.ok(fixtures.discs.length >= 4);
  for (const fixture of fixtures.discs) {
    // The player chooses the files in any order; the CUE decides the order of the tracks.
    const disc = await selectedDisc(chosen(fixture.files).reverse());
    assert.deepEqual(await identifyDisc(disc), { disc: fixture.disc, pal: fixture.pal }, fixture.name);
  }
});

test('the page refuses each shared refused disc with the server\'s message', async () => {
  assert.ok(fixtures.refused.length >= 6);
  for (const fixture of fixtures.refused)
    await assert.rejects(selectedDisc(chosen(fixture.files)), { message: fixture.error }, fixture.name);
});

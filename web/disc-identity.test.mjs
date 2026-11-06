import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { identifyDisc } from './disc-identity.js';

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

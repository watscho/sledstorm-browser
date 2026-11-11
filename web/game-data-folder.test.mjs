import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingGameArchive, restoreGameArchive, reopenGameArchive } from './game-data-folder.js';

async function fixture() {
  const file = new File(['disc-data'], 'saved.zip');
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())).toString('hex');
  const archive = { sha256: digest, size: file.size, chunkSize: file.size, chunks: [digest] };
  const handle = { queryPermission: async () => 'granted', getFile: async () => file };
  return { file, archive, handle };
}

test('a previously selected archive can be reused after a reload without a picker', async () => {
  const { file, archive, handle } = await fixture();
  assert.deepEqual(await restoreGameArchive(archive, async () => ({ sha256: archive.sha256, handle })),
    { file, handle });
});

test('a remembered archive for another disc is never read', async () => {
  const { archive } = await fixture();
  const handle = { queryPermission() { throw new Error('Must not access another disc'); } };
  assert.equal(await restoreGameArchive(archive, async () => ({ sha256: 'other', handle })), null);
});

test('guest reload retains the chosen ZIP when browser access resets to prompt', async () => {
  const { archive, file, handle } = await fixture();
  let requests = 0;
  handle.queryPermission = async () => 'prompt';
  handle.requestPermission = async () => { requests++; return 'granted'; };
  const selected = await restoreGameArchive(archive, async () => ({ sha256: archive.sha256, handle }));
  assert.deepEqual(selected, { handle });
  assert.equal(requests, 0, 'loading the lobby must not ask permission');
  assert.deepEqual(await reopenGameArchive(selected.handle, archive), { file, handle });
  assert.equal(requests, 1, 'Join renews access to the existing source');
});

test('denying renewed access keeps a useful retry error instead of opening a source picker', async () => {
  const { archive, handle } = await fixture();
  handle.requestPermission = async () => 'denied';
  await assert.rejects(reopenGameArchive(handle, archive), /Allow access.*retry/);
});

test('a ZIP changed on disk must pass the full chunk checks again', async () => {
  const { file, archive, handle } = await fixture();
  const changed = new File(['fake-data'], file.name);
  assert.equal(changed.size, file.size);
  assert.equal(await matchingGameArchive(changed, archive), null);
  handle.getFile = async () => changed;
  assert.equal(await restoreGameArchive(archive, async () => ({ sha256: archive.sha256, handle })), null);
});

test('deleted files and unavailable browser storage do not prevent manual selection', async () => {
  const { archive, handle } = await fixture();
  handle.getFile = async () => { throw new Error('Deleted'); };
  assert.equal(await restoreGameArchive(archive, async () => ({ sha256: archive.sha256, handle })), null);
  assert.equal(await restoreGameArchive(archive, async () => { throw new Error('Storage denied'); }), null);
});

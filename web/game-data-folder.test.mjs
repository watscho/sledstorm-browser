import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingGameArchive, askToKeepStorage, unsavedGameDataNotice } from './game-data-folder.js';

// A remembered copy is restored and renewed by web/disc-source.js (its tests); this file keeps the
// checksum test of the exact copy of a room's archive, which the ZIP reader's fast path uses (D74).
async function fixture() {
  const file = new File(['disc-data'], 'saved.zip');
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())).toString('hex');
  const archive = { sha256: digest, size: file.size, chunkSize: file.size, chunks: [digest] };
  return { file, archive };
}

test('the exact copy of the room\'s archive passes its chunk checks', async () => {
  const { file, archive } = await fixture();
  assert.equal(await matchingGameArchive(file, archive), file);
});

test('a ZIP changed on disk must pass the full chunk checks again', async () => {
  const { file, archive } = await fixture();
  const changed = new File(['fake-data'], file.name);
  assert.equal(changed.size, file.size);
  assert.equal(await matchingGameArchive(changed, archive), null);
  assert.equal(await matchingGameArchive(new File(['disc-data!'], file.name), archive), null, 'another size');
});

// A stand-in for navigator.storage: `persisted()` answers from the list in turn, `persist()` is counted.
function storageStandIn(answers) {
  const calls = { persisted: 0, persist: 0 };
  return {
    calls,
    persisted: async () => answers[calls.persisted++],
    persist: async () => { calls.persist += 1; return false; },
  };
}

test('askToKeepStorage asks only when storage is not yet persistent', async () => {
  const storage = storageStandIn([false, true]);
  await askToKeepStorage(storage);
  assert.deepEqual(storage.calls, { persisted: 1, persist: 1 });
  await askToKeepStorage(storage);
  assert.deepEqual(storage.calls, { persisted: 2, persist: 1 }, 'already persistent: not asked again');
});

test('askToKeepStorage asks nothing until persisted() has answered false', async () => {
  const storage = storageStandIn([undefined]);
  await askToKeepStorage(storage);
  assert.equal(storage.calls.persist, 0, 'an answer that is not false is no reason to ask');
});

test('askToKeepStorage never throws', async () => {
  const refused = async () => { throw new Error('refused'); };
  const cases = [
    undefined,
    null,
    {},
    { persisted: async () => false },
    { persisted: refused, persist: async () => true },
    { persisted: () => { throw new Error('refused at once'); }, persist: async () => true },
    { persisted: async () => false, persist: refused },
  ];
  for (const storage of cases) {
    let result;
    assert.doesNotThrow(() => { result = askToKeepStorage(storage); });
    await assert.doesNotReject(Promise.resolve(result));
  }
});

test('a game data copy that was not kept is told with its cause', () => {
  const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
  assert.equal(unsavedGameDataNotice('browser', quota),
    'Game data was not kept in this browser: there is not enough storage. It downloads again next time.');
  assert.equal(unsavedGameDataNotice('browser', new TypeError('other')),
    'Game data was not kept in this browser. It downloads again next time.', 'another refusal names no cause');
  assert.equal(unsavedGameDataNotice('zip', quota), 'The game data ZIP could not be saved. The game runs without it.');
  assert.equal(unsavedGameDataNotice('zip', new Error('gone')), 'The game data ZIP could not be saved. The game runs without it.');
});

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startHostServer } from '../src/host-server.ts';
import { findLiveInstance, instanceLockFile, readInstanceRecord, removeInstanceRecord, requestQuit,
  writeInstanceRecord, type InstanceRecord } from '../src/instance.ts';
import { ensureWritableRoots, type Paths } from '../src/paths.ts';
import { acquireInstanceLock } from '../src/platform/instance-lock.ts';

async function temporaryPaths(): Promise<Paths & { remove(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'sled instance тест '));
  const paths = { resourceRoot: join(root, 'resources'), dataRoot: join(root, 'data'), cacheRoot: join(root, 'cache'),
    logRoot: join(root, 'logs'), tempRoot: root };
  await ensureWritableRoots(paths);
  return { ...paths, remove: () => rm(root, { recursive: true, force: true }) };
}

const record = (overrides: Partial<InstanceRecord> = {}): InstanceRecord => ({
  instance: 'a'.repeat(16), pid: process.pid, port: 4321, token: 'b'.repeat(64),
  startedAt: '2026-11-15T00:00:00.000Z', version: '1.1.0', ...overrides,
});

test('the instance lock is exclusive until released', async () => {
  const paths = await temporaryPaths();
  try {
    const file = instanceLockFile(paths);
    const release = acquireInstanceLock(file);
    assert.ok(release, 'the first holder gets the lock');
    assert.equal(acquireInstanceLock(file), null, 'a second holder is refused');
    release();
    release();
    const again = acquireInstanceLock(file);
    assert.ok(again, 'the lock is free after release');
    again();
  } finally {
    await paths.remove();
  }
});

test('the instance record is private, validated and removed only by its owner', async () => {
  const paths = await temporaryPaths();
  try {
    assert.equal(await readInstanceRecord(paths), null);
    await writeInstanceRecord(paths, record());
    const file = join(paths.dataRoot, 'instance.json');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(paths.dataRoot)).mode & 0o777, 0o700);
    assert.deepEqual(await readInstanceRecord(paths), record());

    await removeInstanceRecord(paths, 'c'.repeat(16));
    assert.deepEqual(await readInstanceRecord(paths), record(), 'another instance does not remove it');
    await removeInstanceRecord(paths, record().instance);
    assert.equal(await readInstanceRecord(paths), null);

    for (const invalid of ['', 'not json', '[]', JSON.stringify({ ...record(), port: 70000 }),
      JSON.stringify({ ...record(), token: 'short' }), JSON.stringify({ ...record(), pid: '1' })]) {
      await writeFile(file, invalid);
      assert.equal(await readInstanceRecord(paths), null, invalid);
    }
  } finally {
    await paths.remove();
  }
});

test('only a server that proves the recorded identity counts as running', async () => {
  const paths = await temporaryPaths();
  let quits = 0;
  const host = await startHostServer({ version: '1.1.0', onQuit: () => { quits += 1; }, status: () => ({ state: 'idle' }) });
  try {
    const live = record({ instance: host.instance, port: host.port, token: host.token });
    await writeInstanceRecord(paths, live);
    assert.deepEqual(await findLiveInstance(paths), live);

    await writeInstanceRecord(paths, { ...live, instance: 'd'.repeat(16) });
    assert.equal(await findLiveInstance(paths), null, 'the port answers, but as a different instance');
    await writeInstanceRecord(paths, { ...live, token: 'e'.repeat(64) });
    assert.equal(await findLiveInstance(paths), null, 'a stale credential is refused');
    assert.equal(await requestQuit({ ...live, token: 'e'.repeat(64) }), false);
    assert.equal(quits, 0);

    await writeInstanceRecord(paths, live);
    await host.close();
    assert.equal(await findLiveInstance(paths), null, 'a record without a listener is stale');
    assert.match(await readFile(join(paths.dataRoot, 'instance.json'), 'utf8'), /"instance"/, 'looking does not delete');
  } finally {
    await host.close();
    await paths.remove();
  }
});

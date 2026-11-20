import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { findDisc, GameFolderError } from '../src/disc-folder.ts';

async function scratch(t: TestContext): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sled disc тест ')));
  t.after(async () => {
    await chmod(root, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

const cueText = (names: string[], lineEnd = '\n') => names.map((name, index) =>
  `FILE "${name}" BINARY${lineEnd}  TRACK ${String(index + 1).padStart(2, '0')} ${index ? 'AUDIO' : 'MODE2/2352'}${lineEnd}    INDEX 01 00:00:00${lineEnd}`).join('');

async function writeDisc(folder: string, tracks: Record<string, number>,
  options: { cueName?: string; lineEnd?: string; listed?: string[] } = {}): Promise<string> {
  await mkdir(folder, { recursive: true });
  for (const [name, size] of Object.entries(tracks)) await writeFile(join(folder, name), Buffer.alloc(size, 7));
  const text = cueText(options.listed ?? Object.keys(tracks), options.lineEnd);
  await writeFile(join(folder, options.cueName ?? 'Game.cue'), text);
  return text;
}

const refused = (message: string | RegExp) => (error: unknown) => {
  assert.ok(error instanceof GameFolderError, String(error));
  if (typeof message === 'string') assert.equal(error.message, message);
  else assert.match(error.message, message);
  return true;
};
const outside = /^The CUE file refers to a missing track or a file outside the game folder: /;

test('finds the CUE and its tracks in CUE order', async t => {
  const folder = join(await scratch(t), 'Sled Storm диск');
  const text = await writeDisc(folder, { 'Трек 02.bin': 3000, 'Track 01.bin': 5000 },
    { lineEnd: '\r\n', listed: ['Track 01.bin', 'Трек 02.bin'] });
  const disc = await findDisc(folder);
  assert.equal(disc.folder, folder);
  assert.deepEqual(disc.files.map(file => [file.name, file.size]),
    [['Game.cue', Buffer.byteLength(text)], ['Track 01.bin', 5000], ['Трек 02.bin', 3000]]);
  for (const file of disc.files) {
    assert.match(file.mtimeNs, /^\d+$/);
    assert.equal(file.path, join(folder, file.name));
  }
});

test('accepts an upper-case CUE extension', async t => {
  const folder = await scratch(t);
  await writeDisc(folder, { 'a.bin': 10 }, { cueName: 'GAME.CUE' });
  assert.deepEqual((await findDisc(folder)).files.map(file => file.name), ['GAME.CUE', 'a.bin']);
});

test('reads a CUE that starts with a byte order mark', async t => {
  const folder = await scratch(t);
  await writeDisc(folder, { 'a.bin': 10, 'b.bin': 20 });
  await writeFile(join(folder, 'Game.cue'), String.fromCharCode(0xfeff) + cueText(['a.bin', 'b.bin']));
  assert.deepEqual((await findDisc(folder)).files.map(file => file.name), ['Game.cue', 'a.bin', 'b.bin']);
});

test('rejects a folder without exactly one CUE', async t => {
  const folder = await scratch(t);
  await writeFile(join(folder, 'a.bin'), 'x');
  await assert.rejects(findDisc(folder), refused('Expected exactly one CUE file in the game folder.'));
  await writeDisc(folder, { 'a.bin': 10 });
  await writeFile(join(folder, 'Other.cue'), cueText(['a.bin']));
  await assert.rejects(findDisc(folder), refused('Expected exactly one CUE file in the game folder.'));
});

test('rejects a CUE without tracks or with a repeated track', async t => {
  const folder = await scratch(t);
  await writeDisc(folder, { 'a.bin': 10 }, { listed: [] });
  await assert.rejects(findDisc(folder), refused('The CUE file lists no BINARY tracks.'));
  await writeDisc(folder, { 'a.bin': 10 }, { listed: ['a.bin', 'a.bin'] });
  await assert.rejects(findDisc(folder), refused('The CUE file lists a track twice: a.bin'));
});

test('rejects tracks that are missing, not regular files or outside the folder', async t => {
  const root = await scratch(t);
  const folder = join(root, 'game');
  await writeFile(join(root, 'outside.bin'), 'secret');
  await writeDisc(folder, { 'a.bin': 10 }, { listed: ['a.bin', 'missing.bin'] });
  await assert.rejects(findDisc(folder), refused(outside));
  await mkdir(join(folder, 'folder.bin'));
  await writeDisc(folder, {}, { listed: ['a.bin', 'folder.bin'] });
  await assert.rejects(findDisc(folder), refused(outside));
  await writeDisc(folder, {}, { listed: ['a.bin', '../outside.bin'] });
  await assert.rejects(findDisc(folder), refused(outside));
  await symlink(join(root, 'outside.bin'), join(folder, 'link.bin'));
  await writeDisc(folder, {}, { listed: ['a.bin', 'link.bin'] });
  await assert.rejects(findDisc(folder), refused(outside));
});

test('rejects a missing folder, a file and an unreadable folder', async t => {
  const root = await scratch(t);
  await assert.rejects(findDisc(join(root, 'absent')), refused('The game folder does not exist.'));
  await writeFile(join(root, 'file'), 'x');
  await assert.rejects(findDisc(join(root, 'file')), refused('The game folder is not a folder.'));
  const locked = join(root, 'locked');
  await writeDisc(locked, { 'a.bin': 10 });
  await chmod(locked, 0o000);
  try {
    await assert.rejects(findDisc(locked), refused('The game folder cannot be read. Check its permissions.'));
  } finally {
    await chmod(locked, 0o700);
  }
});

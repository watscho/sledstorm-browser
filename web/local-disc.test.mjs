import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { identifyDisc } from './disc-identity.js';
import { CUE_LIMIT, DISC_LIMIT } from './disc-sheet.js';
import { DiscZipError } from './disc-zip.js';
import { chosenDisc, selectedDisc, sessionDiscMode } from './local-disc.js';

test('a gateway that refuses the disc makes the session local, whatever the body says', () => {
  // The body comes from the origin behind the gateway; the header from the gateway itself (D73).
  assert.equal(sessionDiscMode({ discMode: 'shared' }, null), 'shared');
  assert.equal(sessionDiscMode({ discMode: 'shared' }, 'local'), 'local');
  assert.equal(sessionDiscMode({ discMode: 'local' }, null), 'local');
  assert.equal(sessionDiscMode({ discMode: 'local' }, 'local'), 'local');
});

const trackNames = Array.from({ length: 11 }, (_, index) => `Sled Storm (Europe) (Track ${index + 1}).bin`);
const cueText = names => names.map(name => `FILE "${name}" BINARY\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n`).join('');
const cueFile = (names, name = 'Sled Storm (Europe).cue') => new File([cueText(names)], name);
const tracks = names => names.map((name, index) => new File([new Uint8Array(index + 1)], name));

test('no files chosen is no disc', async () => {
  assert.equal(await selectedDisc([]), null);
});

test('one CUE with its eleven tracks gives the CUE first and the tracks in CUE order', async () => {
  const cue = cueFile(trackNames);
  // The browser hands the files over in any order.
  const files = [...tracks(trackNames).reverse(), cue];
  const disc = await selectedDisc(files);
  assert.deepEqual(disc.map(file => file.name), [cue.name, ...trackNames]);
  assert.deepEqual(disc.slice(1).map(file => file.size), trackNames.map((_, index) => index + 1));
  assert.equal(disc[0].data, cue);
  for (const file of disc) assert.equal(file.size, file.data.size);
});

test('a track the CUE names but the player did not choose is named', async () => {
  const files = [cueFile(trackNames), ...tracks(trackNames).filter((_, index) => index !== 6)];
  await assert.rejects(selectedDisc(files), { message: `Missing local track: ${trackNames[6]}` });
});

test('two CUE sheets, or none, are refused', async () => {
  const two = [cueFile(trackNames), cueFile(trackNames, 'copy.cue'), ...tracks(trackNames)];
  await assert.rejects(selectedDisc(two), { message: 'Select one CUE and all its BIN tracks together' });
  await assert.rejects(selectedDisc(tracks(trackNames)), { message: 'Select one CUE and all its BIN tracks together' });
});

test('a CUE of any number of tracks the shared rules allow is taken; a hundred are not (D75)', async () => {
  const twelve = Array.from({ length: 12 }, (_, index) => `Track ${index + 1}.bin`);
  const disc = await selectedDisc([cueFile(twelve), ...tracks(twelve)]);
  assert.deepEqual(disc.slice(1).map(file => file.name), twelve);
  const two = await selectedDisc([cueFile(['b.bin', 'a.bin']), ...tracks(['a.bin', 'b.bin'])]);
  assert.deepEqual(two.map(file => file.name), ['Sled Storm (Europe).cue', 'b.bin', 'a.bin']);
  const hundred = Array.from({ length: 100 }, (_, index) => `t${index}.bin`);
  await assert.rejects(selectedDisc([cueFile(hundred), ...tracks(hundred)]), { message: 'The CUE file lists more than 99 tracks.' });
  const doubled = [cueFile([...trackNames.slice(0, 10), trackNames[0]]), ...tracks(trackNames)];
  await assert.rejects(selectedDisc(doubled), { message: `The CUE file lists a track twice: ${trackNames[0]}` });
});

test('a track whose file is named in another case or normalization is found, and named as the CUE spells it (D77)', async () => {
  const files = [cueFile(['data.bin', '\u00e9t\u00e9 02.bin']), new File(['d'], 'DATA.BIN'), new File(['e'], 'E\u0301TE\u0301 02.bin')];
  const disc = await selectedDisc(files);
  assert.deepEqual(disc.map(file => file.name), ['Sled Storm (Europe).cue', 'data.bin', '\u00e9t\u00e9 02.bin']);
  assert.equal(disc[1].data, files[1]);
  assert.equal(disc[2].data, files[2]);
  // Two chosen files that match one name of the CUE are ambiguous.
  await assert.rejects(selectedDisc([cueFile(['a.bin']), new File(['1'], 'a.bin'), new File(['2'], 'A.BIN')]),
    { message: 'Two chosen files match the track a.bin' });
});

test('a CUE or a disc over its bound is refused before any file is read (D76)', async () => {
  const unread = (name, size) => ({ name, size, text: () => assert.fail(`${name} was read`), arrayBuffer: () => assert.fail(`${name} was read`) });
  await assert.rejects(selectedDisc([unread('Big.cue', CUE_LIMIT + 1), ...tracks(['a.bin'])]), { message: 'The CUE file is larger than 1 MiB.' });
  const big = [cueFile(['a.bin', 'b.bin']), unread('a.bin', DISC_LIMIT / 2), unread('b.bin', DISC_LIMIT / 2)];
  await assert.rejects(selectedDisc(big), { message: 'The game files are larger than a CD (1 GiB).' });
});

// A guest's own ZIP (DATA-03): the archives that server/scripts/disc-fixtures.py made.
const fixtures = JSON.parse(await readFile(new URL('./disc-identity.fixtures.json', import.meta.url), 'utf8'));
const archiveNamed = name => fixtures.archives.find(fixture => fixture.name === name);
const zipOf = (fixture, name = 'Sled Storm.zip') => new File([Buffer.from(fixture.base64, 'base64')], name);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** The manifest that the session info announces for the server's archive (D74). */
function manifestOf(bytes, chunkSize = 256) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) chunks.push(sha256(bytes.subarray(offset, offset + chunkSize)));
  return { sha256: sha256(bytes), size: bytes.length, chunkSize, chunks };
}
const unread = name => ({ name, size: 10, text: () => assert.fail(`${name} was read`), arrayBuffer: () => assert.fail(`${name} was read`),
  slice: () => assert.fail(`${name} was read`) });
const BOTH = 'Choose either one ZIP or your CUE and all its BIN tracks.';

test('no files chosen is no disc; CUE and BIN files are taken as before', async () => {
  assert.equal(await chosenDisc([], null), null);
  const cue = cueFile(trackNames);
  const chosen = await chosenDisc([...tracks(trackNames), cue], null);
  assert.deepEqual(Object.keys(chosen), ['files']);
  assert.deepEqual(chosen.files.map(file => file.name), [cue.name, ...trackNames]);
});

test('one ZIP is read in the page and gives the disc that its files give', async () => {
  const fixture = archiveNamed('zip -r: deflated, names in UTF-8 without the flag, the CUE in a folder');
  const lines = [];
  const chosen = await chosenDisc([zipOf(fixture)], null, line => lines.push(line));
  assert.deepEqual(Object.keys(chosen), ['files']);
  assert.deepEqual(await identifyDisc(chosen.files), { disc: fixture.disc, pal: fixture.pal });
  assert.ok(lines.some(line => line.startsWith('Checking the ZIP: track 1/2: ')), lines.join(' | '));
  // A ZIP is known by its name's extension, in any case.
  const upper = await chosenDisc([zipOf(fixture, 'SLED STORM.ZIP')], null);
  assert.deepEqual(await identifyDisc(upper.files), { disc: fixture.disc, pal: fixture.pal });
});

test('the exact copy of the room\'s archive keeps its fast path, and any other ZIP is read', async () => {
  const fixture = fixtures.archives.find(archive => archive.canonical);
  const bytes = Buffer.from(fixture.base64, 'base64');
  const copy = zipOf(fixture, 'sled-storm-copy.zip');
  assert.deepEqual(await chosenDisc([copy], manifestOf(bytes)), { archive: copy });
  const other = archiveNamed('zip -0 -r: stored, the CUE in a folder');
  const read = await chosenDisc([zipOf(other)], manifestOf(bytes));
  assert.deepEqual(await identifyDisc(read.files), { disc: other.disc, pal: other.pal });
});

test('a ZIP chosen with other files, or two ZIPs, are refused before any file is read', async () => {
  for (const list of [[unread('a.zip'), unread('Game.cue')], [unread('Track 01.bin'), unread('a.zip')], [unread('a.zip'), unread('b.ZIP')]])
    await assert.rejects(chosenDisc(list, null), { message: BOTH }, list.map(file => file.name).join(', '));
});

test('a damaged ZIP is refused with the reader\'s words, also when the room announces its archive', async () => {
  const canonical = Buffer.from(fixtures.archives.find(archive => archive.canonical).base64, 'base64');
  for (const archive of [null, manifestOf(canonical)])
    await assert.rejects(chosenDisc([zipOf(archiveNamed('a wrong CRC'))], archive),
      error => error instanceof DiscZipError && error.code === 'corrupt' && error.message.length > 20);
  await assert.rejects(chosenDisc([zipOf(archiveNamed('no CUE'))], null), { code: 'no-cue' });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { CUE_LIMIT, DISC_LIMIT, DiscSheetError, TRACK_LIMIT, checkDiscSize, cueTrackNames, nameKey } from './disc-sheet.js';

const sheet = (names, lineEnd = '\n') => names.map((name, index) =>
  `FILE "${name}" BINARY${lineEnd}  TRACK ${String(index + 1).padStart(2, '0')} AUDIO${lineEnd}    INDEX 01 00:00:00${lineEnd}`).join('');
const refused = message => error => error instanceof DiscSheetError && error.message === message;

test('the bounds are a CD\'s', () => {
  assert.equal(CUE_LIMIT, 1024 * 1024);
  assert.equal(TRACK_LIMIT, 99);
  assert.equal(DISC_LIMIT, 1024 ** 3);
  // A 99-minute CD, read raw, fits with its CUE.
  assert.ok(99 * 60 * 75 * 2352 + CUE_LIMIT <= DISC_LIMIT);
});

test('a CUE names its BINARY tracks in its own order', () => {
  assert.deepEqual(cueTrackNames(sheet(['b.bin', 'a.bin'])), ['b.bin', 'a.bin']);
  assert.deepEqual(cueTrackNames('\ufeff' + sheet(['Трек 1.bin', 'b.bin'], '\r\n')), ['Трек 1.bin', 'b.bin']);
  // Other lines and other file types are not tracks of the disc.
  assert.deepEqual(cueTrackNames(`REM x\nFILE "a.wav" WAVE\n${sheet(['c.bin'])}`), ['c.bin']);
});

test('twelve tracks are taken, and ninety-nine, but not a hundred', () => {
  const names = count => Array.from({ length: count }, (_, index) => `Track ${index + 1}.bin`);
  assert.equal(cueTrackNames(sheet(names(12))).length, 12);
  assert.equal(cueTrackNames(sheet(names(99))).length, 99);
  assert.throws(() => cueTrackNames(sheet(names(100))), refused('The CUE file lists more than 99 tracks.'));
});

test('a CUE without tracks, with a track twice or with a track in another folder is refused', () => {
  assert.throws(() => cueTrackNames(''), refused('The CUE file lists no BINARY tracks.'));
  assert.throws(() => cueTrackNames(sheet(['a.bin', 'A.BIN'])), refused('The CUE file lists a track twice: A.BIN'));
  assert.throws(() => cueTrackNames(sheet(['\u00e9.bin', 'E\u0301.bin'])), refused('The CUE file lists a track twice: E\u0301.bin'));
  for (const name of ['../a.bin', 'sub/a.bin', 'sub\\a.bin', '/a.bin'])
    assert.throws(() => cueTrackNames(sheet(['b.bin', name])), refused(`The CUE file refers to a file outside its folder: ${name}`));
});

test('a CUE is text: a sheet with a control character, as every archive the emulator unpacks has, is refused (D85)', () => {
  // The signatures that the emulator's own extractor looks for at the start of the file it is given:
  // ZIP (three kinds), 7z and RAR. Read as UTF-8, as the page and the server read a CUE.
  const signatures = [[0x50, 0x4b, 3, 4], [0x50, 0x4b, 5, 6], [0x50, 0x4b, 7, 8], [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
    [0x52, 0x61, 0x72, 0x21, 0x1a, 7, 0]];
  const body = new TextEncoder().encode(sheet(['a.bin']));
  for (const signature of signatures) {
    const text = new TextDecoder().decode(new Uint8Array([...signature, ...body]));
    assert.throws(() => cueTrackNames(text), refused('The CUE file is not a text file.'), signature.join(' '));
  }
  const control = code => String.fromCharCode(code);
  assert.throws(() => cueTrackNames(sheet(['a.bin']) + control(0)), refused('The CUE file is not a text file.'));
  assert.throws(() => cueTrackNames(control(0x1f) + sheet(['a.bin'])), refused('The CUE file is not a text file.'));
  // Tabs, both line ends and the end-of-file mark of old DOS editors are text.
  assert.deepEqual(cueTrackNames(`FILE "a.bin" BINARY\r\n${control(9)}TRACK 01 AUDIO\r\n${control(0x1a)}`), ['a.bin']);
});

test('a CUE that lists itself, or a track whose name holds a control character, is refused', () => {
  // The CUE's own name, in any case, is never one of its tracks.
  assert.throws(() => cueTrackNames(sheet(['a.bin', 'GAME.cue']), 'Game.CUE'), refused('The CUE file lists itself as a track: GAME.cue'));
  assert.deepEqual(cueTrackNames(sheet(['Game.bin']), 'Game.cue'), ['Game.bin']);
  // A tab or a line break inside the quotes, DEL or a C1 control: no folder or ZIP holds such a track.
  const control = code => String.fromCharCode(code);
  for (const code of [9, 10, 13, 0x7f, 0x85])
    assert.throws(() => cueTrackNames(sheet(['a.bin', `b${control(code)}c.bin`])),
      refused('The CUE file names a track with a control character in its name.'), String(code));
});

test('any number of byte order marks before the sheet are taken, as the page and the server decode it differently', () => {
  // The page's Blob.text() removes one mark; the server's Buffer.toString() keeps them all.
  const mark = String.fromCharCode(0xfeff);
  for (const marks of [1, 2, 3]) assert.deepEqual(cueTrackNames(mark.repeat(marks) + sheet(['a.bin'])), ['a.bin'], String(marks));
});

test('a name is matched in NFC and lower case', () => {
  assert.equal(nameKey('E\u0301T\u00c9 02.BIN'), '\u00e9t\u00e9 02.bin');
  assert.equal(nameKey('Track 01.bin'), nameKey('TRACK 01.BIN'));
  assert.notEqual(nameKey('Track 01.bin'), nameKey('Track 1.bin'));
});

test('a disc larger than a CD, or a CUE larger than its bound, is refused', () => {
  assert.doesNotThrow(() => checkDiscSize([CUE_LIMIT, DISC_LIMIT - CUE_LIMIT]));
  assert.throws(() => checkDiscSize([CUE_LIMIT + 1, 10]), refused('The CUE file is larger than 1 MiB.'));
  assert.throws(() => checkDiscSize([100, DISC_LIMIT]), refused('The game files are larger than a CD (1 GiB).'));
});

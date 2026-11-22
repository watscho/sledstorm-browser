import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { deflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';
import { identifyDisc } from './disc-identity.js';
import { DiscZipError, HELD_LIMIT, crc32, discFromZip, readDiscZip } from './disc-zip.js';

// The archives that server/scripts/disc-fixtures.py made: by zip, ditto and Python's zipfile, the
// server's canonical archive, and damaged and hostile ones built byte by byte (DATA-02 to DATA-04).
const fixtures = JSON.parse(await readFile(new URL('./disc-identity.fixtures.json', import.meta.url), 'utf8'));
const archiveFile = fixture => new File([Buffer.from(fixture.base64, 'base64')], 'game.zip');
const named = name => fixtures.archives.find(fixture => fixture.name === name);
const REPLACEMENT = String.fromCharCode(0xfffd);

test('CRC-32 is the one that ZIP and zlib compute', () => {
  for (const length of [0, 1, 7, 8, 9, 63, 64, 1000, 1024 * 1024 + 3]) {
    const bytes = randomBytes(length);
    assert.equal(crc32(bytes), zlibCrc32(bytes), `${length} bytes`);
    // Fed in parts, as a stream hands it over.
    const middle = Math.floor(length / 3);
    assert.equal(crc32(bytes.subarray(middle), crc32(bytes.subarray(0, middle))), zlibCrc32(bytes), `${length} bytes in two parts`);
  }
});

test('every archive gives the identity of its disc, or the page\'s refusal', async () => {
  assert.ok(fixtures.archives.filter(fixture => fixture.disc).length >= 9);
  assert.ok(fixtures.archives.filter(fixture => fixture.error).length >= 30);
  for (const fixture of fixtures.archives) {
    if (fixture.disc) {
      const files = await readDiscZip(archiveFile(fixture));
      assert.deepEqual(await identifyDisc(files), { disc: fixture.disc, pal: fixture.pal }, fixture.name);
    } else {
      await assert.rejects(readDiscZip(archiveFile(fixture)), error => {
        assert.ok(error instanceof DiscZipError, `${fixture.name}: ${error}`);
        assert.equal(error.code, fixture.error, `${fixture.name}: ${error.message}`);
        assert.ok(error.message.length > 20, fixture.name);
        return true;
      });
    }
  }
});

test('the disc comes out as the player\'s own files would: the CUE, then its tracks in CUE order as it spells them', async () => {
  // zip stored the tracks before the CUE, and the CUE lists Track 02 first.
  const files = await readDiscZip(archiveFile(named('zip -0 -r: stored, the CUE in a folder')));
  const cue = Buffer.from(fixtures.discs[0].files[0].base64, 'base64');
  assert.deepEqual(files.map(file => [file.name, file.size]), [['Game.cue', cue.length], ['Track 02.bin', 300], ['Track 01.bin', 200]]);
  assert.deepEqual(Buffer.from(await files[0].data.arrayBuffer()), cue);
  for (const file of files) {
    assert.ok(file.data instanceof File);
    assert.equal(file.data.name, file.name);
    assert.equal(file.data.size, file.size);
  }
  // Finder's archive holds the track's file in NFD and capitals; the emulator looks it up as the CUE spells it.
  const finder = await readDiscZip(archiveFile(named('Finder\'s Compress: a name in NFD and capitals, __MACOSX, data descriptors')));
  assert.deepEqual(finder.map(file => file.name), ['Disc.cue', 'data.bin', 'été 02.bin'.normalize('NFC')]);
});

/** Each entry's method, by the last segment of its name in NFC and lower case, from the central directory. */
function methodsOf(bytes) {
  const methods = new Map();
  for (let at = bytes.indexOf(Buffer.from('PK\x01\x02', 'latin1')); at >= 0; at = bytes.indexOf(Buffer.from('PK\x01\x02', 'latin1'), at + 46)) {
    const name = bytes.subarray(at + 46, at + 46 + bytes.readUInt16LE(at + 28)).toString('utf8');
    methods.set(name.slice(name.lastIndexOf('/') + 1).normalize('NFC').toLowerCase(), bytes.readUInt16LE(at + 10));
  }
  return methods;
}

test('a deflated entry says what it keeps in memory', async () => {
  const stored = await readDiscZip(archiveFile(named('zip -0 -r: stored, the CUE in a folder')));
  assert.deepEqual(stored.map(file => file.held), stored.map(() => 0));

  const fixture = named('zip -r: deflated, names in UTF-8 without the flag, the CUE in a folder');
  const methods = methodsOf(Buffer.from(fixture.base64, 'base64'));
  const deflated = await readDiscZip(archiveFile(fixture));
  assert.ok(deflated.some(file => methods.get(file.name.normalize('NFC').toLowerCase()) === 8), 'no deflated entry in the fixture');
  for (const file of deflated) {
    const method = methods.get(file.name.normalize('NFC').toLowerCase());
    assert.equal(file.held, method === 8 ? file.size : 0, `${file.name}, method ${method}`);
  }
});

test('an entry that inflates past its declared size is stopped at once, not inflated to the end', async t => {
  // Count what the inflater hands over: the bomb holds 4 MiB of zeros under a declared size of 200 bytes.
  const Original = globalThis.DecompressionStream;
  let produced = 0;
  globalThis.DecompressionStream = function counting(format) {
    const inflater = new Original(format);
    const counter = new TransformStream({ transform(chunk, controller) { produced += chunk.length; controller.enqueue(chunk); } });
    return { writable: inflater.writable, readable: inflater.readable.pipeThrough(counter) };
  };
  t.after(() => { globalThis.DecompressionStream = Original; });
  await assert.rejects(readDiscZip(archiveFile(named('a small entry that inflates to megabytes'))), { code: 'corrupt' });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(produced < 1024 * 1024, `${produced} bytes inflated`);
});

test('a browser that cannot inflate refuses a deflated ZIP before reading it, and still reads a stored one', async t => {
  const Original = globalThis.DecompressionStream;
  t.after(() => { globalThis.DecompressionStream = Original; });
  const message = 'This browser cannot read a compressed ZIP. Make a ZIP without compression, or choose your CUE and BIN files instead.';
  const deflatedZip = named('zip -r: deflated, names in UTF-8 without the flag, the CUE in a folder');
  // None at all (Safari before 16.4, Firefox before 113), or one without the raw format (Chrome before 103).
  for (const stand of [undefined, function noRaw(format) { if (format === 'deflate-raw') throw new TypeError('Unsupported compression format'); return new Original(format); }]) {
    globalThis.DecompressionStream = stand;
    await assert.rejects(readDiscZip(archiveFile(deflatedZip)), { code: 'unsupported', message });
    const stored = named('zip -0 -r: stored, the CUE in a folder');
    assert.equal((await identifyDisc(await readDiscZip(archiveFile(stored)))).disc, stored.disc);
  }
});

test('the reader tells the player what it is reading', async () => {
  const lines = [];
  await readDiscZip(archiveFile(named('Python\'s zipfile: an empty track')), line => lines.push(line));
  assert.deepEqual(lines, ['Checking the ZIP: track 1/2: data.bin', 'Checking the ZIP: track 2/2: silence.bin']);
});

test('a refused name is shown without its control characters', async () => {
  await assert.rejects(readDiscZip(archiveFile(named('a name with a NUL'))), { code: 'unsafe-name',
    message: `The ZIP file holds a file whose name has a control character: Track 01.bin${REPLACEMENT}.txt. Choose another ZIP, or choose your CUE and BIN files instead.` });
  await assert.rejects(readDiscZip(archiveFile(named('a name with a backslash'))),
    { code: 'unsafe-name', message: 'The ZIP file holds a file whose name leaves its folder: Game\\Track 01.bin. Choose another ZIP.' });
  // A name in a legacy code page: making the ZIP again with the same tool would not help.
  await assert.rejects(readDiscZip(archiveFile(named('a name in a legacy code page'))), { code: 'bad-name',
    message: 'The ZIP file holds a file name that is not UTF-8, which this page does not read. Make the ZIP with a tool that writes UTF-8 names, such as Finder\'s Compress, or choose your CUE and BIN files instead.' });
  await assert.rejects(readDiscZip(archiveFile(named('a CUE without a BINARY track'))),
    { code: 'sheet', message: 'The CUE file lists no BINARY tracks.' });
  await assert.rejects(readDiscZip(archiveFile(named('a missing track'))),
    { code: 'missing-track', message: 'The ZIP file lacks a track that its CUE lists: Track 03.bin. The tracks must sit beside the CUE.' });
});

/** An end record: `entries` in the directory of `size` bytes at `offset`. */
function endRecord(entries, size, offset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(entries, 8);
  record.writeUInt16LE(entries, 10);
  record.writeUInt32LE(size, 12);
  record.writeUInt32LE(offset, 16);
  return record;
}

/** A plain ZIP of `members` ({ name, data, deflate }): their local records, then the directory. */
function zipOf(members) {
  const parts = [], directory = [];
  let offset = 0;
  for (const { name, data, deflate } of members) {
    const packed = deflate ? deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name);
    const crc = zlibCrc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, packed);
    directory.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const list = Buffer.concat(directory);
  return Buffer.concat([...parts, list, endRecord(members.length, list.length, offset)]);
}

test('a deflated entry goes to the browser\'s blob store in parts of at most 16 MiB, not held whole (D86)', async t => {
  assert.equal(HELD_LIMIT, 16 * 1024 * 1024);
  const track = Buffer.alloc(40 * 1024 * 1024 + 5);
  for (let index = 0; index < track.length; index += 997) track[index] = index & 0xff;
  const cue = Buffer.from('FILE "t.bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n');
  const zip = zipOf([{ name: 'Disc/Disc.cue', data: cue }, { name: 'Disc/t.bin', data: track, deflate: true }]);
  // Count the loose bytes that each Blob or File is made of; a Blob given to another one is not copied.
  const [OriginalBlob, OriginalFile] = [globalThis.Blob, globalThis.File];
  let largest = 0;
  const loose = parts => parts.reduce((sum, part) => sum + (part instanceof OriginalBlob ? 0 : part.byteLength ?? part.length), 0);
  globalThis.Blob = class extends OriginalBlob { constructor(parts = [], options) { largest = Math.max(largest, loose(parts)); super(parts, options); } };
  globalThis.File = class extends OriginalFile { constructor(parts, name, options) { largest = Math.max(largest, loose(parts)); super(parts, name, options); } };
  t.after(() => { [globalThis.Blob, globalThis.File] = [OriginalBlob, OriginalFile]; });
  const disc = await readDiscZip(new OriginalFile([zip], 'disc.zip'));
  assert.ok(largest > 0 && largest <= HELD_LIMIT + 1024 * 1024, `${largest} bytes made into one Blob at once`);
  assert.equal(disc[1].size, track.length);
  assert.equal(sha256(Buffer.from(await disc[1].data.arrayBuffer())), sha256(track));
});

test('an archive of more than 1,000 entries, or a directory over 1 MiB, is refused before its directory is read', async () => {
  const canonical = Buffer.from(named('the server\'s canonical archive: ASCII names, the tracks listed in another order than their names').base64, 'base64');
  const many = Buffer.from(canonical);
  many.writeUInt16LE(1001, many.length - 22 + 8);
  many.writeUInt16LE(1001, many.length - 22 + 10);
  await assert.rejects(readDiscZip(new File([many], 'many.zip')), { code: 'too-large', message: /more than 1000 files/ });
  const directory = 1024 * 1024 + 46;
  const large = new File([new Uint8Array(directory), endRecord(1, directory, 0)], 'large.zip');
  await assert.rejects(readDiscZip(large), { code: 'too-large', message: /list of contents is larger than 1 MiB/ });
});

test('a file that is not a ZIP is refused as one', async () => {
  for (const bytes of [new Uint8Array(0), new Uint8Array(21), Buffer.from('FILE "a.bin" BINARY\n')])
    await assert.rejects(readDiscZip(new File([bytes], 'game.zip')), { code: 'damaged' });
});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** The manifest that the server announces for its archive (server/src/game-data.ts, ArchiveManifest). */
function manifestOf(bytes, chunkSize = 256) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) chunks.push(sha256(bytes.subarray(offset, offset + chunkSize)));
  return { sha256: sha256(bytes), size: bytes.length, chunkSize, chunks };
}

test('the exact copy of the server\'s archive keeps its fast path; any other ZIP is read and checked', async () => {
  const unicode = fixtures.discs[1];
  const bytes = Buffer.from(named(`the server's canonical archive: ${unicode.name}`).base64, 'base64');
  const archive = manifestOf(bytes);
  const copy = new File([bytes], 'sled-storm.zip');
  const fast = await discFromZip(copy, archive);
  assert.deepEqual(Object.keys(fast), ['archive']);
  assert.equal(fast.archive, copy);

  // One byte changed in the last track: not the server's archive, and its CRC-32 refuses it.
  const changed = Buffer.from(bytes);
  changed[changed.readUInt32LE(changed.length - 22 + 16) - 1] ^= 1;
  await assert.rejects(discFromZip(new File([changed], 'sled-storm.zip'), archive), { code: 'corrupt' });

  // Another container of the same disc: read through the general path, with the same identity.
  const lines = [];
  const general = await discFromZip(archiveFile(named('zip -r: deflated, names in UTF-8 without the flag, the CUE in a folder')), archive,
    line => lines.push(line));
  assert.deepEqual(Object.keys(general), ['files']);
  assert.deepEqual(await identifyDisc(general.files), { disc: unicode.disc, pal: unicode.pal });
  assert.ok(lines.includes('Checking the ZIP: track 1/2: ' + general.files[1].name), lines.join(' | '));

  // A room that announces no archive (the Python launcher's local mode) leaves only the general path.
  const alone = await discFromZip(copy, null);
  assert.deepEqual(await identifyDisc(alone.files), { disc: unicode.disc, pal: unicode.pal });
});

#!/usr/bin/env python3
"""Write web/disc-identity.fixtures.json, the discs that the server's tests and the page's tests share.

Every disc is made of synthetic bytes. Each identity is computed here with the
Python launcher's algorithm (server.py, shared_identity), which is independent
of the server's TypeScript and of the page's JavaScript: the SHA-256 of
json.dumps(manifest, ensure_ascii=False, separators=(',', ':')), where the
manifest lists [name, size, sha256] for the CUE under its file's name and then
for each track in CUE order under the name the CUE spells.

The archives are ZIPs of those discs: made by the tools a player has on a Mac
(zip, ditto as Finder's Compress, Python's zipfile), the server's canonical
archive rebuilt here byte for byte (server/src/game-data.ts, stored-v2), and
damaged or hostile archives built here byte by byte. Each one either gives its
disc's identity or names the page's refusal (web/disc-zip.js, DiscZipError.code).
The archives that ditto makes change with every run in the times of their
__MACOSX folders; their identities do not.

Run from the repository's root on macOS: python3 server/scripts/disc-fixtures.py
"""
import base64
import hashlib
import io
import json
import os
import pathlib
import platform
import struct
import subprocess
import tempfile
import unicodedata
import zipfile
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
TARGET = ROOT / 'web' / 'disc-identity.fixtures.json'
PAL_FIRST_TRACK_SHA1 = 'c5506c3eb3601d68d11f2c8754e03a6b06be5f2d'


def pattern(seed, size):
    return bytes((seed * 31 + index * 7) % 256 for index in range(size))


def cue_text(spellings, line_end='\n', bom=False):
    lines = []
    for number, spelling in enumerate(spellings, 1):
        mode = 'MODE2/2352' if number == 1 else 'AUDIO'
        lines += [f'FILE "{spelling}" BINARY', f'  TRACK {number:02d} {mode}', '    INDEX 01 00:00:00']
    text = line_end.join(lines) + line_end
    return ('\ufeff' if bom else '') + text


def encoded(name, data):
    return {'name': name, 'base64': base64.b64encode(data).decode('ascii')}


def disc(name, cue_name, cue, tracks, order=None):
    """`tracks`: (spelling in the CUE, file name, bytes) in CUE order. `order`: the files' order after the CUE.

    `foldedNames` marks a disc whose CUE spells a track otherwise than its file: the server finds that
    track only on a volume that matches names as macOS does by default (D77).
    """
    cue_bytes = cue.encode('utf-8')
    manifest = [[cue_name, len(cue_bytes), hashlib.sha256(cue_bytes).hexdigest()]]
    manifest += [[spelling, len(data), hashlib.sha256(data).hexdigest()] for spelling, _, data in tracks]
    serialized = json.dumps(manifest, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    files = [encoded(file_name, data) for _, file_name, data in tracks]
    if order:
        files = [files[index] for index in order]
    result = {
        'name': name,
        'files': [encoded(cue_name, cue_bytes), *files],
        'disc': hashlib.sha256(serialized).hexdigest(),
        'pal': hashlib.sha1(tracks[0][2]).hexdigest() == PAL_FIRST_TRACK_SHA1,
    }
    if any(spelling != file_name for spelling, file_name, _ in tracks):
        result['foldedNames'] = True
    return result


def refused(name, cue, files, error):
    return {'name': name, 'files': [encoded('Disc.cue', cue.encode('utf-8')), *(encoded(n, d) for n, d in files)], 'error': error}


def nfd(text):
    return unicodedata.normalize('NFD', text)


discs = [
    disc('ASCII names, the tracks listed in another order than their names', 'Game.cue',
         cue_text(['Track 02.bin', 'Track 01.bin']),
         [('Track 02.bin', 'Track 02.bin', pattern(2, 300)), ('Track 01.bin', 'Track 01.bin', pattern(1, 200))],
         order=[1, 0]),
    disc('Unicode names, CRLF line ends and a byte order mark', 'Sled Storm (Европа).cue',
         cue_text(['Трек 01.bin', 'Piste 02 – été.bin'], '\r\n', bom=True),
         [('Трек 01.bin', 'Трек 01.bin', pattern(3, 257)), ('Piste 02 – été.bin', 'Piste 02 – été.bin', pattern(4, 64))]),
    disc('a track named in the CUE in NFC and lower case, its file in NFD and capitals', 'Disc.cue',
         cue_text(['data.bin', 'été 02.bin']),
         [('data.bin', 'data.bin', pattern(5, 128)), ('été 02.bin', nfd('ÉTÉ 02.BIN'), pattern(6, 96))]),
    disc('an empty track', 'Empty.cue',
         cue_text(['data.bin', 'silence.bin']),
         [('data.bin', 'data.bin', pattern(7, 100)), ('silence.bin', 'silence.bin', b'')]),
]

hundred = [f't{number:03d}.bin' for number in range(1, 101)]
refusals = [
    refused('a CUE without a BINARY track', 'FILE "a.wav" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n',
            [('a.wav', pattern(8, 10))], 'The CUE file lists no BINARY tracks.'),
    refused('a track listed twice, once in another case', cue_text(['a.bin', 'b.bin', 'A.BIN']),
            [('a.bin', pattern(9, 10)), ('b.bin', pattern(10, 10))], 'The CUE file lists a track twice: A.BIN'),
    refused('a track in the folder above', cue_text(['a.bin', '../b.bin']),
            [('a.bin', pattern(11, 10))], 'The CUE file refers to a file outside its folder: ../b.bin'),
    refused('a track in a folder below', cue_text(['a.bin', 'sub/b.bin']),
            [('a.bin', pattern(12, 10))], 'The CUE file refers to a file outside its folder: sub/b.bin'),
    refused('a track behind a backslash', cue_text(['a.bin', 'sub\\b.bin']),
            [('a.bin', pattern(13, 10))], 'The CUE file refers to a file outside its folder: sub\\b.bin'),
    refused('a hundred tracks', cue_text(hundred),
            [(name, bytes([index % 256])) for index, name in enumerate(hundred)], 'The CUE file lists more than 99 tracks.'),
    # The emulator's own extractor would unpack it (D85).
    refused('a CUE that begins as a ZIP archive', 'PK\x03\x04' + cue_text(['a.bin']),
            [('a.bin', pattern(14, 10))], 'The CUE file is not a text file.'),
    refused('a CUE that lists itself as a track', cue_text(['a.bin', 'Disc.cue']),
            [('a.bin', pattern(15, 10))], 'The CUE file lists itself as a track: Disc.cue'),
    refused('a track whose name holds a tab', cue_text(['a.bin', 'b\tc.bin']),
            [('a.bin', pattern(16, 10)), ('b\tc.bin', pattern(17, 10))],
            'The CUE file names a track with a control character in its name.'),
]

# Archives. ----------------------------------------------------------------------------------------

# 2000-01-01T00:00:00Z: tool-made archives then do not change with the files' times or the time zone.
FIXED_TIME = 946684800
FIXED_DATE = (2000, 1, 1, 0, 0, 0)
# The server's canonical archive: 1980-01-01, no time (server/src/game-data.ts).
DOS_DATE = 0x0021


def raw_files(fixture):
    """The disc's files as (name, bytes), the CUE first."""
    return [(item['name'], base64.b64decode(item['base64'])) for item in fixture['files']]


def by_cue(fixture):
    """The disc as the server prepares it: the CUE under its file's name, then the tracks in CUE order
    under the names the CUE spells (the order and spellings that its identity counts)."""
    files = raw_files(fixture)
    cue_name, cue = files[0]
    by_key = {unicodedata.normalize('NFC', name).lower(): data for name, data in files[1:]}
    text = cue.decode('utf-8').lstrip(chr(0xfeff))
    spellings = [line.split('"')[1] for line in text.splitlines() if line.startswith('FILE ') and line.rstrip().endswith(' BINARY')]
    return [(cue_name, cue)] + [(name, by_key[unicodedata.normalize('NFC', name).lower()]) for name in spellings]


def deflated(data):
    compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
    return compressor.compress(data) + compressor.flush()


def member(name, data, method=0, flags=None, crc=None, size=None, payload=None, local_name=None, packed=None, local=None,
           name_length=None):
    """One entry for `assemble`. Every field that a hostile archive bends can be given. `local` maps fields of the
    local record (method, flags, crc, packed, size) to values other than the central record's; `name_length` is the
    central record's name length when it does not count the name's bytes."""
    raw_name = name if isinstance(name, bytes) else name.encode('utf-8')
    body = payload if payload is not None else (data if method == 0 else deflated(data))
    return {
        'name': raw_name, 'local_name': raw_name if local_name is None else local_name, 'body': body,
        'method': method, 'flags': (0 if raw_name.isascii() else 0x0800) if flags is None else flags,
        'crc': zlib.crc32(data) if crc is None else crc, 'size': len(data) if size is None else size,
        'packed': len(body) if packed is None else packed, 'at': None, 'local': local or {}, 'name_length': name_length,
    }


def local_record(item):
    field = lambda key: item['local'].get(key, item[key])
    return struct.pack('<IHHHHHIIIHH', 0x04034b50, 20, field('flags'), field('method'), 0, DOS_DATE, field('crc'),
                       field('packed'), field('size'), len(item['local_name']), 0) + item['local_name'] + item['body']


def assemble(members, prefix=b'', count=None, zip64=False, disks=0, trailer=b'', size_delta=0, directory_tail=b''):
    """A ZIP laid out as the server lays out its own: local records, the central directory, the end record.
    A member whose `at` is set has no local record of its own; its central record points there."""
    out = bytearray()
    central = bytearray()
    for item in members:
        offset = len(out) if item['at'] is None else item['at']
        if item['at'] is None:
            out += local_record(item)
        central += struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 0x0314, 20, item['flags'], item['method'], 0, DOS_DATE,
                               item['crc'], item['packed'], item['size'],
                               len(item['name']) if item['name_length'] is None else item['name_length'], 0, 0, 0, 0, 0x81a40000, offset)
        central += item['name']
    # Bytes after the last record that the directory's size counts.
    central += directory_tail
    start = len(out)
    out += central
    entries = len(members) if count is None else count
    if zip64:
        record = len(out)
        out += struct.pack('<IQHHIIQQQQ', 0x06064b50, 44, 45, 45, 0, 0, entries, entries, len(central), start)
        out += struct.pack('<IIQI', 0x07064b50, 0, record, 1)
    if zip64 is True:
        out += struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, 0xffff, 0xffff, 0xffffffff, 0xffffffff, 0)
    else:
        # zip64='locator': the ZIP64 records stand before an end record whose own fields are not saturated.
        out += struct.pack('<IHHHHIIH', 0x06054b50, disks, disks, entries, entries, len(central) + size_delta, start, 0)
    return prefix + bytes(out) + trailer


def canonical(fixture):
    """The server's canonical archive of the disc (server/src/game-data.ts, stored-v2), byte for byte."""
    return assemble([member(name, data) for name, data in by_cue(fixture)])


def tool_archive(fixture, folder, command):
    """`command` run in a scratch folder that holds the disc's files in `folder`, with fixed times;
    `{zip}` and `{folder}` in the command name the archive and the folder."""
    with tempfile.TemporaryDirectory() as scratch:
        base = pathlib.Path(scratch)
        root = base / folder
        root.mkdir()
        for name, data in raw_files(fixture):
            (root / name).write_bytes(data)
            os.utime(root / name, (FIXED_TIME, FIXED_TIME))
        os.utime(root, (FIXED_TIME, FIXED_TIME))
        target = base / 'archive.zip'
        arguments = [str(target) if part == '{zip}' else folder if part == '{folder}' else part for part in command]
        subprocess.run(arguments, cwd=base, check=True, env={**os.environ, 'TZ': 'UTC'})
        return target.read_bytes()


def python_archive(fixture, folder, comment=b'', extra=()):
    """Python's zipfile, deflated, with folder entries; it sets the UTF-8 flag on names that are not ASCII."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        parts = folder.split('/')
        for depth in range(1, len(parts) + 1):
            archive.writestr(zipfile.ZipInfo('/'.join(parts[:depth]) + '/', FIXED_DATE), b'')
        for name, data in [*raw_files(fixture), *extra]:
            info = zipfile.ZipInfo(f'{folder}/{name}', FIXED_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
        archive.comment = comment
    return buffer.getvalue()


def stored_names(data):
    """The names as the archive stores them, decoded as UTF-8, whatever its flags say."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return [info.orig_filename.encode('utf-8' if info.flag_bits & 0x0800 else 'cp437').decode('utf-8')
                for info in archive.infolist()]


zip_version = subprocess.run(['zip', '-v'], capture_output=True, text=True, check=True).stdout.splitlines()[1].strip()
macos = subprocess.run(['sw_vers', '-productVersion'], capture_output=True, text=True, check=True).stdout.strip()
ascii_disc, unicode_disc, folded_disc, empty_disc = discs


def made(name, tool, fixture, data, **more):
    return {'name': name, 'tool': tool, 'from': fixture['name'], 'base64': base64.b64encode(data).decode('ascii'),
            'disc': fixture['disc'], 'pal': fixture['pal'], **more}


ditto = tool_archive(folded_disc, 'Disc', ['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', '{folder}', '{zip}'])
# Finder keeps a name as the volume holds it: the track's file stays in NFD and capitals.
assert nfd('Disc/ÉTÉ 02.BIN') in stored_names(ditto), 'ditto changed the form of a name'
assert any(name.startswith('__MACOSX/') for name in stored_names(ditto)), 'ditto wrote no __MACOSX folder'

archives = [
    made('zip -0 -r: stored, the CUE in a folder', f'{zip_version}; zip -q -X -0 -r', ascii_disc,
         tool_archive(ascii_disc, 'Game', ['zip', '-q', '-X', '-0', '-r', '{zip}', '{folder}'])),
    made('zip -r: deflated, names in UTF-8 without the flag, the CUE in a folder', f'{zip_version}; zip -q -X -r', unicode_disc,
         tool_archive(unicode_disc, 'Sled Storm', ['zip', '-q', '-X', '-r', '{zip}', '{folder}'])),
    made('Finder\'s Compress: a name in NFD and capitals, __MACOSX, data descriptors',
         f'ditto on macOS {macos}; ditto -c -k --sequesterRsrc --keepParent', folded_disc, ditto),
    made('Python\'s zipfile: the UTF-8 flag, folders, a comment and a file the disc does not use',
         f'Python {platform.python_version()} zipfile', unicode_disc,
         python_archive(unicode_disc, 'Games/Sled', comment=b'made for a test', extra=[('readme.txt', b'not a track\n')])),
    made('Python\'s zipfile: an empty track', f'Python {platform.python_version()} zipfile', empty_disc,
         python_archive(empty_disc, 'Empty')),
    *(made(f'the server\'s canonical archive: {fixture["name"]}', 'server/src/game-data.ts stored-v2, rebuilt here', fixture,
           canonical(fixture), canonical=True) for fixture in discs),
]

# Hostile and damaged archives, each built from the ASCII disc: Game.cue, Track 02.bin, Track 01.bin.
(cue_name, cue), (second_name, second), (first_name, first) = by_cue(ascii_disc)


def plain(**bend):
    """The ASCII disc's members, stored; `bend` maps a member's name to the fields it changes."""
    return [member(name, data, **bend.get(name, {})) for name, data in [(cue_name, cue), (second_name, second), (first_name, first)]]


def overlapping():
    """Track 01's central record points inside Track 02's data, which holds a local record for it."""
    inner = member(first_name, first)
    outer = member(second_name, local_record(inner) + second)
    head = member(cue_name, cue)
    inner['at'] = len(local_record(head)) + 30 + len(second_name.encode())
    return assemble([head, outer, inner])


def near_the_end():
    """Track 01's central record points 10 bytes before the end of the file, inside the end record."""
    def build(at):
        first_member = member(first_name, first)
        first_member['at'] = at
        return assemble([*plain()[:2], first_member])
    return build(len(build(0)) - 10)


archives.append(made('a __MACOSX folder that holds a copy of the CUE', 'built byte by byte here', ascii_disc,
                     assemble([*plain(), member('__MACOSX/' + cue_name, cue)])))

bomb = b'\0' * (4 * 1024 * 1024)
NUL = bytes([0])


def hostile(name, data, error):
    return {'name': name, 'tool': 'built byte by byte here', 'base64': base64.b64encode(data).decode('ascii'), 'error': error}


archives += [
    hostile('a wrong CRC', assemble(plain(**{first_name: {'crc': zlib.crc32(first) ^ 1}})), 'corrupt'),
    hostile('a cut file', canonical(ascii_disc)[:-1], 'damaged'),
    hostile('bytes after the end record', assemble(plain(), trailer=bytes(7)), 'damaged'),
    hostile('data before the archive', assemble(plain(), prefix=b'MZ' + bytes(98)), 'damaged'),
    hostile('entry counts that disagree with the directory', assemble(plain(), count=4), 'damaged'),
    hostile('a directory size that disagrees with its place', assemble(plain(), size_delta=-1), 'damaged'),
    hostile('a local record that names another file',
            assemble(plain(**{first_name: {'local_name': b'Track 03.bin'}})), 'damaged'),
    hostile('an entry inside the data of another', overlapping(), 'damaged'),
    # The last track's data, as declared, runs into the first ten bytes of the directory; its CRC-32 counts them.
    hostile('an entry whose data runs into the directory', assemble([*plain()[:2], member(
        first_name, first + struct.pack('<IHHH', 0x02014b50, 0x0314, 20, 0), payload=first, packed=len(first) + 10)]), 'damaged'),
    hostile('a stored entry whose two sizes differ', assemble(plain(**{first_name: {'size': len(first) + 5}})), 'damaged'),
    hostile('bytes left in the directory after its last record', assemble(plain(), directory_tail=bytes(12)), 'damaged'),
    # The last name is cut inside a UTF-8 sequence and declared one byte longer than the directory holds.
    hostile('a central record whose name runs past the directory', assemble([*plain(), member(
        b'Track 0' + bytes([0xc3]), b'', flags=0x0800, name_length=9)]), 'damaged'),
    hostile('an entry that starts within 30 bytes of the end of the file', near_the_end(), 'damaged'),
    hostile('a local record of another method', assemble(plain(**{first_name: {'local': {'method': 8}}})), 'damaged'),
    hostile('a local record that says the entry is encrypted', assemble(plain(**{first_name: {'local': {'flags': 1}}})), 'damaged'),
    hostile('a local record with another CRC-32', assemble(plain(**{first_name: {'local': {'crc': zlib.crc32(first) ^ 1}}})),
            'damaged'),
    hostile('a local record with another size', assemble(plain(**{first_name: {'local': {'size': len(first) + 1}}})), 'damaged'),
    hostile('a local record with another compressed size',
            assemble(plain(**{first_name: {'local': {'packed': len(first) + 1}}})), 'damaged'),
    hostile('a CUE declared larger than 1 MiB', assemble(plain(**{cue_name: {'method': 8, 'size': 2 * 1024 * 1024}})), 'too-large'),
    hostile('tracks declared larger than a CD', assemble(plain(**{
        first_name: {'method': 8, 'size': 600_000_000}, second_name: {'method': 8, 'size': 600_000_000}})), 'too-large'),
    hostile('an entry that inflates beyond its declared size',
            assemble(plain(**{first_name: {'method': 8, 'size': len(first) - 50}})), 'corrupt'),
    hostile('a small entry that inflates to megabytes',
            assemble(plain(**{first_name: {'method': 8, 'payload': deflated(bomb)}})), 'corrupt'),
    hostile('an entry shorter than declared', assemble(plain(**{first_name: {'method': 8, 'size': len(first) + 50}})), 'corrupt'),
    hostile('damaged deflated data', assemble(plain(**{first_name: {'method': 8, 'payload': bytes([0xff]) + deflated(first)[1:]}})),
            'corrupt'),
    hostile('a name in the folder above', assemble([member('../' + cue_name, cue), *plain()[1:]]), 'unsafe-name'),
    hostile('a name from the root', assemble([member('/' + cue_name, cue), *plain()[1:]]), 'unsafe-name'),
    hostile('a name with a drive letter', assemble([member('C:' + cue_name, cue), *plain()[1:]]), 'unsafe-name'),
    hostile('a name with a backslash', assemble([*plain()[:2], member('Game\\' + first_name, first)]), 'unsafe-name'),
    hostile('a name with a NUL', assemble([*plain(), member(first_name.encode() + NUL + b'.txt', b'')]), 'unsafe-name'),
    hostile('an ignored entry that leaves the archive', assemble([*plain(), member('__MACOSX/../../evil', b'')]), 'unsafe-name'),
    hostile('a name flagged UTF-8 that is not', assemble([*plain(), member(b'Track ' + bytes([0xff]) + b'.bin', b'', flags=0x0800)]),
            'bad-name'),
    hostile('a name in a legacy code page', assemble([*plain(), member(b'Piste ' + bytes([0x82]) + b't.bin', b'', flags=0)]),
            'bad-name'),
    hostile('two entries of one name', assemble([*plain(), member(first_name, first)]), 'duplicate-name'),
    hostile('two entries whose names differ in case', assemble([*plain(), member(first_name.upper(), first)]), 'duplicate-name'),
    hostile('no CUE', assemble(plain()[1:]), 'no-cue'),
    hostile('two CUEs', assemble([*plain(), member('Other/' + cue_name, cue)]), 'cue-count'),
    hostile('a CUE without a BINARY track', assemble([member(cue_name, b'FILE "a.wav" WAVE\n'), *plain()[1:]]), 'sheet'),
    hostile('a CUE that is itself an archive', assemble([member(cue_name, b'PK\x03\x04' + cue), *plain()[1:]]), 'sheet'),
    hostile('a CUE that lists itself as a track',
            assemble([member(cue_name, cue_text([second_name, first_name, cue_name]).encode()), *plain()[1:]]), 'sheet'),
    hostile('a CUE that names a track with a tab',
            assemble([member(cue_name, cue_text([second_name, 'Track\t01.bin']).encode()), *plain()[1:]]), 'sheet'),
    hostile('a missing track', assemble([member(cue_name, cue_text([second_name, first_name, 'Track 03.bin']).encode()),
                                         *plain()[1:]]), 'missing-track'),
    hostile('the tracks outside the CUE\'s folder', assemble([member('Game/' + cue_name, cue), *plain()[1:]]), 'missing-track'),
    hostile('an encrypted track', assemble(plain(**{first_name: {'flags': 1}})), 'unsupported'),
    hostile('an unknown method', assemble(plain(**{cue_name: {'method': 14}})), 'unsupported'),
    hostile('ZIP64', assemble(plain(), zip64=True), 'unsupported'),
    hostile('a ZIP64 locator before a plain end record', assemble(plain(), zip64='locator'), 'unsupported'),
    hostile('one part of several', assemble(plain(), disks=1), 'unsupported'),
]

document = {
    'about': ('Shared by the page\'s tests (web/disc-identity.test.mjs, web/disc-zip.test.mjs) and the server\'s '
              '(server/test/disc-identity.test.ts). Written by server/scripts/disc-fixtures.py, whose identities follow the '
              'Python launcher\'s algorithm. files[0] is the CUE; a track\'s file may be named otherwise than the CUE spells it. '
              'Each archive gives the identity of the disc it was made from, or names the page\'s refusal (DiscZipError.code). '
              'Synthetic bytes only; no fixture has the PAL flag, which needs the real first data track.'),
    'discs': discs,
    'refused': refusals,
    'archives': archives,
}
# Escaped, so that an editor cannot change a name's normalization unseen.
TARGET.write_text(json.dumps(document, ensure_ascii=True, indent=2) + '\n', encoding='utf-8')
print(f'Wrote {TARGET.relative_to(ROOT)}: {len(discs)} discs, {len(refusals)} refused, {len(archives)} archives.')

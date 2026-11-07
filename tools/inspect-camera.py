"""Read the local MODE2/2352 data track and inspect title-specific camera code.

Does not modify disc images. Extracted executable and disassembly stay in .cache.
Capstone is optional and loaded from project-local tooling.
"""
from pathlib import Path
import hashlib
import json
import struct
import sys
import os
import re

ROOT = Path(__file__).resolve().parent.parent
disc_dir = Path(os.environ.get('SLEDSTORM_DISC_DIR', ROOT / 'game')).expanduser()
cues = sorted(p for p in disc_dir.glob('*') if p.suffix.lower() == '.cue') if disc_dir.is_dir() else []
if not cues and 'SLEDSTORM_DISC_DIR' not in os.environ:
    cues = sorted(p for p in ROOT.glob('*/*') if p.suffix.lower() == '.cue')
if len(cues) != 1:
    raise SystemExit('Expected one CUE; place it in game/ or set SLEDSTORM_DISC_DIR. See docs/setup.md.')
track_names = re.findall(r'^FILE "([^"]+)" BINARY', cues[0].read_text(), re.M)
if not track_names:
    raise SystemExit('CUE contains no BINARY tracks.')
TRACK = cues[0].parent / track_names[0]
if TRACK.resolve().parent != cues[0].parent.resolve() or not TRACK.is_file():
    raise SystemExit('First CUE track must be a file in the same disc folder.')
KNOWN_SHA1 = 'c5506c3eb3601d68d11f2c8754e03a6b06be5f2d'


def read_extent(stream, sector, size):
    result = bytearray()
    while len(result) < size:
        stream.seek(sector * 2352 + 24)
        chunk = stream.read(min(2048, size - len(result)))
        if not chunk:
            raise ValueError('Truncated MODE2 image')
        result.extend(chunk)
        sector += 1
    return bytes(result)


def read_boot_exe():
    digest = hashlib.sha1()
    with TRACK.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
        if digest.hexdigest() != KNOWN_SHA1:
            raise ValueError('Image does not match the audited PAL release')
        pvd = read_extent(stream, 16, 2048)
        if pvd[:7] != b'\x01CD001\x01':
            raise ValueError('Expected ISO9660 primary volume descriptor')
        root_sector = struct.unpack_from('<I', pvd, 158)[0]
        root_size = struct.unpack_from('<I', pvd, 166)[0]
        directory = read_extent(stream, root_sector, root_size)
        offset = 0
        while offset < len(directory):
            length = directory[offset]
            if not length:
                offset = (offset // 2048 + 1) * 2048
                continue
            record = directory[offset:offset + length]
            if len(record) < 34:
                raise ValueError('Invalid directory entry')
            name = record[33:33 + record[32]].decode('ascii', errors='replace')
            if name == 'SLES_021.94;1':
                extent, size = struct.unpack_from('<I', record, 2)[0], struct.unpack_from('<I', record, 10)[0]
                exe = read_extent(stream, extent, size)
                if exe[:8] != b'PS-X EXE':
                    raise ValueError('Invalid PS-X executable')
                return exe
            offset += length
    raise ValueError('PAL boot executable not found')


def main():
    exe = read_boot_exe()
    cache = ROOT / '.cache/camera'
    cache.mkdir(parents=True, exist_ok=True)
    (cache / 'SLES_021.94').write_bytes(exe)
    entry, _, load, text_size = struct.unpack_from('<IIII', exe, 0x10)
    report = {'disc_sha1': KNOWN_SHA1, 'exe_sha256': hashlib.sha256(exe).hexdigest(),
              'entry': hex(entry), 'load': hex(load), 'text_size': text_size,
              'candidates': {'view_layout': '0x8005aea0', 'frame_loop': '0x80053a90',
                             'view0': '0x800e2cb0', 'view_stride': '0x224',
                             'race_render_callsite': '0x80014e90',
                             'race_renderer': '0x80051010',
                             'camera_state0': '0x800e27f0', 'camera_state_stride': '0x110'},
              'rejected_candidates': {'0x80078110': 'mutates object lists; not a pure world-render entry'},
              'independent_camera_implemented': False}
    (cache / 'inspection.json').write_text(json.dumps(report, indent=2) + '\n')
    sys.path.insert(0, str(ROOT / '.cache/tooling'))
    try:
        from capstone import Cs, CS_ARCH_MIPS, CS_MODE_MIPS32, CS_MODE_LITTLE_ENDIAN
    except ImportError:
        print(json.dumps(report, indent=2))
        return
    disassembler = Cs(CS_ARCH_MIPS, CS_MODE_MIPS32 | CS_MODE_LITTLE_ENDIAN)
    for name, address, size in [('view_layout', 0x8005AEA0, 2244),
                                ('object_list_rejected', 0x80078110, 0x1000),
                                ('frame_loop', 0x80053A90, 1020),
                                ('race_render_callsite', 0x80014E20, 0xB4),
                                ('race_renderer', 0x80051010, 0x520),
                                ('view_creation', 0x8005BC70, 0x500),
                                ('pause-state', 0x8006D004, 0x1E4),
                                ('hud-resource-select', 0x8005F344, 0x180)]:
        offset = address - load + 2048
        if not 2048 <= offset < len(exe) or offset + size > len(exe):
            raise ValueError('Candidate is outside executable text')
        lines = [f'{i.address:08x}: {i.mnemonic:10} {i.op_str}'
                 for i in disassembler.disasm(exe[offset:offset + size], address)]
        (cache / f'{name}.asm').write_text('\n'.join(lines) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

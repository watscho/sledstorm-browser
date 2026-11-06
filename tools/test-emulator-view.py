#!/usr/bin/env python3
"""Verify presentation isolation and PAL viewport bounds against pinned headers."""
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / '.cache/pcsx-sources'
compiler = shutil.which('clang') or shutil.which('cc')
if not compiler or not CORE.is_dir():
    sys.exit('Install a C compiler and run tools/build-emulator.py first.')
subprocess.run([sys.executable, str(ROOT / 'tools/prepare-emulator-native.py')], check=True)
includes = ['frontend', 'plugins/gpulib', 'libpcsxcore', 'include', 'deps/libretro-common/include']
output = ROOT / '.cache/emulator-view-test'
subprocess.run([compiler, *['-I' + str(CORE / path) for path in includes], '-DHAVE_LIBRETRO', '-DNO_FRONTEND',
                str(ROOT / 'research/emulator/view-test.c'), str(CORE / 'frontend/sled-view.c'), '-o', str(output)], check=True)
subprocess.run([str(output)], check=True)
print('Presentation isolation, four PAL controller viewports and native-menu bypass passed.')

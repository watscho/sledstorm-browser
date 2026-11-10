"""Check the Node.js requirement shared by both launchers."""

import shutil
import subprocess


def require_node():
    node = shutil.which('node')
    hint = 'Activate Node.js 22 or newer in this terminal. See docs/setup.md.'
    if not node:
        raise RuntimeError(f'Node.js was not found on PATH. {hint}')
    try:
        version = subprocess.check_output([node, '--version'], text=True, timeout=5).strip()
    except (OSError, subprocess.SubprocessError) as error:
        raise RuntimeError(f'Could not read the Node.js version. {hint}') from error
    major = version.removeprefix('v').split('.', 1)[0]
    if not major.isdecimal() or int(major) < 22:
        raise RuntimeError(f'Found Node.js {version} on PATH. {hint}')
    return node

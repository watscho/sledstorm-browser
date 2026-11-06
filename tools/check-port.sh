#!/bin/sh
set -eu
TASK_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$TASK_ROOT"
node --check research/wasm/port.js
node --check research/wasm/lobby.js
node --check research/wasm/launch-settings.js
node --test research/wasm/launch-settings.test.mjs
node --check research/wasm/network-client.js
node --check research/wasm/disc-fs.js
node --check research/wasm/local-disc.js
node --check research/network/server.mjs
python3 -m py_compile research/serve_port.py tools/inspect-camera.py
python3 tools/inspect-camera.py
EMSDK_QUIET=1
export EMSDK_QUIET
. "$TASK_ROOT/.cache/emsdk/emsdk_env.sh"
emcc research/wasm/fiber_web.c research/wasm/test_fiber_web.c \
    -Iresearch/port/psxrecomp/runtime/include \
    -sASYNCIFY=1 -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=node -sASSERTIONS=1 \
    -o .cache/fiber-test.js
node .cache/fiber-test.js
emcc research/wasm/test_pixel_convert.c -sUSE_SDL=2 \
    -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 -sENVIRONMENT=node \
    -o .cache/pixel-test.js
node .cache/pixel-test.js
emcc research/wasm/test_disc_fs.c -sASYNCIFY=1 \
    --js-library research/wasm/disc_io.js -sASYNCIFY_STACK_SIZE=65536 \
    -sEXPORTED_RUNTIME_METHODS=FS,callMain,Asyncify,HEAPU8 -sFORCE_FILESYSTEM=1 \
    -sENVIRONMENT=node -sMODULARIZE=1 -sEXPORT_ES6=1 -sINVOKE_RUN=0 \
    -o .cache/test-disc.mjs
node tools/test-disc-fs.mjs
emcc research/wasm/web_hud.c research/wasm/test_hud.c \
    -Iresearch/wasm -Iresearch/port/psxrecomp/runtime/include \
    -sENVIRONMENT=node -o .cache/hud-test.js
node .cache/hud-test.js
emcc research/port/psxrecomp/runtime/src/sio.c research/wasm/web_controllers.c \
    research/wasm/test_controllers.c -DPSX_MAX_PLAYERS=5 \
    -Iresearch/wasm -Iresearch/port/psxrecomp/runtime/include \
    -sENVIRONMENT=node -o .cache/controller-test.js
node .cache/controller-test.js
emcc research/wasm/web_progress.c research/wasm/test_progress.c \
    -Iresearch/wasm -Iresearch/port/psxrecomp/runtime/include \
    -sENVIRONMENT=node -o .cache/progress-test.js
node .cache/progress-test.js
emcc research/wasm/web_preferences.c research/wasm/test_preferences.c \
    -Iresearch/wasm -Iresearch/port/psxrecomp/runtime/include \
    -sENVIRONMENT=node -o .cache/preferences-test.js
node .cache/preferences-test.js
python3 tools/prepare-browser-main.py
python3 tools/test-gpu-irq.py
cd research/network
npm test

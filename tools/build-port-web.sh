#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
SDK="$ROOT/.cache/emsdk/upstream/emscripten"
CMAKE="$ROOT/.cache/tooling/cmake/data/bin/cmake"
NINJA="$ROOT/.cache/tooling/bin/ninja"
if [ ! -x "$SDK/emcc" ] || [ ! -x "$CMAKE" ] || [ ! -x "$NINJA" ]; then
    echo 'Missing project-local SDK, CMake or Ninja. Run python3 tools/bootstrap.py; see docs/setup.md.' >&2
    exit 1
fi
python3 tools/prepare-browser-main.py
set --
if [ -d "$ROOT/.cache/build-native/_deps/psx_libwebp-src" ]; then
    set -- "-DFETCHCONTENT_SOURCE_DIR_PSX_LIBWEBP=$ROOT/.cache/build-native/_deps/psx_libwebp-src"
fi
"$CMAKE" -S research/wasm -B .cache/build-web -G Ninja \
    "-DCMAKE_TOOLCHAIN_FILE=$SDK/cmake/Modules/Platform/Emscripten.cmake" \
    "-DCMAKE_MAKE_PROGRAM=$NINJA" \
    "$@" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
"$CMAKE" --build .cache/build-web --target psx-runtime -j 2

# Sources, attribution and license boundaries

The root [MIT license](LICENSE) applies to this project's original contributions:
the browser launch/settings UI, custom WebSocket relay/client and gateway,
original adapter code, tooling additions, documentation and decorative SVG.
It does **not** relicense upstream source, upstream-derived snippets in the
integration generator, original game code/data, or generated and compiled
runtime output. Where a file combines contributions, MIT covers only our
original additions. The applicable upstream terms remain in force.

## Components used by the current browser build

| Source | Pinned revision / version | What we use | Terms / notices |
| --- | --- | --- | --- |
| [PeriBluGaming/SledStormPSXRecomp](https://github.com/PeriBluGaming/SledStormPSXRecomp/tree/2abf4ec86baf7f98629da09017bf4d978772ebb4) | `2abf4ec86baf7f98629da09017bf4d978772ebb4` | PAL SLES-02194 generated C/scaffold, title configuration, widescreen integration and supplied framework patches | Mixed provenance; author's contributions use PolyForm Noncommercial 1.0.0. See preserved [LICENSE](docs/licenses/port-LICENSE.txt) and detailed [NOTICE](docs/licenses/port-NOTICE.md). Generated game code is explicitly outside that grant. |
| [mstan/psxrecomp](https://github.com/mstan/psxrecomp/tree/c1f5cafd4102daa57b7342bec7c432aaca8981ce) | `c1f5cafd4102daa57b7342bec7c432aaca8981ce` | CPU/runtime, GPU, GTE, audio, CD, SIO/Multitap, render transactions and port interfaces; browser generator adapts runtime source into ignored build files | [PolyForm Noncommercial 1.0.0](docs/licenses/psxrecomp-LICENSE.txt); internal third-party components retain their terms. |
| [PCSX-Redux OpenBIOS](https://github.com/grumpycoders/pcsx-redux/tree/55fbf0468345acfbe5512628a3be5c0cfe3f22e7/src/mips/openbios) | `55fbf0468345acfbe5512628a3be5c0cfe3f22e7` | OpenBIOS binary delivered by the pinned framework, not a Sony BIOS dump | MIT, Copyright (c) 2019 PCSX-Redux authors; includes [uC-sdk](https://github.com/grumpycoders/uC-sdk/tree/69e06871824e2d62069487a7426ded09090ceb69) permissively licensed components. Preserve the [OpenBIOS notice](docs/licenses/OpenBIOS-LICENSE.txt) and upstream component notices when distributing it. |
| [websockets/ws](https://github.com/websockets/ws) | npm `ws@8.22.1`, integrity locked in `research/network/package-lock.json` | Node WebSocket transport for our custom relay/gateway | [MIT](docs/licenses/ws-LICENSE.txt). |
| [emscripten-core/emsdk](https://github.com/emscripten-core/emsdk/tree/35659964bc2762fffec0d257997fb61475f765b7) | SDK `6.0.13`, emsdk `35659964bc2762fffec0d257997fb61475f765b7` | WebAssembly compiler, JS glue, Asyncify and cooperative fibers, SDL2/zlib ports | Emscripten MIT/NCSA and per-component toolchain/port licenses; preserve distribution notices supplied by the SDK. |
| [SDL2](https://github.com/libsdl-org/SDL), [zlib](https://github.com/madler/zlib), [libwebp](https://github.com/webmproject/libwebp) | SDL2/zlib selected by the pinned Emscripten SDK; libwebp archive pinned by framework `third_party/deps.manifest` | Graphics/input/audio backend, compression and runtime image decoding | SDL2: zlib license; zlib: zlib license; libwebp: BSD-style license and PATENTS. Their source packages carry complete notices. |

CMake 4.4.4 (BSD 3-Clause), Ninja 1.13.2 (Apache 2.0), and Capstone 5.0.9
(BSD-style) are project-local build/inspection tools installed by bootstrap.
Their distributions carry their own licenses. They are not vendored in this
repository. Additional transitive runtime/toolchain dependencies are described
by the pinned framework and SDK; this table does not replace their notices.

The source/build pins are recorded in [upstream.lock.json](upstream.lock.json).
Bootstrap downloads only the port, framework and SDK, then applies the port's
own version-checked framework patch script. Browser-specific changes are
anchor-checked in `tools/prepare-browser-main.py` and written into `.cache/`.
Those generated files include upstream and game-derived material and are not
covered wholesale by our MIT license.

## What our networking adds

`research/network/` and `research/wasm/network-client.js` implement our browser
controller lockstep, room capabilities, history catch-up and content/state
checks. This is not a direct port of the upstream UDP/ICE/rollback transport.
The browser CMake disables native `PSX_NETPLAY` and `PSX_RECOMP_UI`.

[RetroPortingToolKit/recomp-ui](https://github.com/RetroPortingToolKit/recomp-ui)
is an upstream optional native UI dependency. [recomp-net](https://github.com/RetroPortingToolKit/recomp-net)
(research snapshot `e53059306824edf4f0aec4aae5ae65151b18535f`) and
[rbengine](https://github.com/RetroPortingToolKit/rbengine)
(`b29bdde642bc087f21303b827fadba40496b502d`) were inspected during research.
These optional source trees are not compiled into our current browser target,
are not fetched by bootstrap, and are not vendored here.

## Optional tunnel tooling

`tools/play-online.py` runs a separately installed
[cloudflare/cloudflared](https://github.com/cloudflare/cloudflared) executable
(Apache License 2.0) for temporary internet access. The executable is not
vendored in this repository and is not part of the compiled game. Its original
license and notices remain with the Cloudflare distribution.

## Browser emulator adapter

The `research/browser-emulator` branch uses
[EmulatorJS 4.2.3](https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3)
(GPL-3.0) assets from its SHA-256-verified official release. Installed assets
are listed in `emulator.lock.json` and remain ignored under `vendor/`.

The native build uses [EmulatorJS/pcsx_rearmed](https://github.com/EmulatorJS/pcsx_rearmed)
at `f29871dde1742cafb0ab56ba33636a8600bbbd80` and
[EmulatorJS/RetroArch](https://github.com/EmulatorJS/RetroArch)
at `6dd4353937ef48b6ec0bfbdbb15d1c5992d86927`. These retain their GPL and component
license terms. `tools/build-emulator.py` fetches those exact sources and an
isolated Emscripten 6.0.13 SDK, then applies our version-checked source hooks.
The generated core archive retains the bundled license and metadata. No source
checkout, emulator binary or SDK is committed here.

Our original launcher, frame adapter, controller protocol, canonical state
checker and build scripts are MIT-licensed. This does not relicense the compiled
emulator or any upstream component. See [the emulator guide](docs/browser-emulator.md)
for the build and source details. The static recompilation dependencies above
belong to the separate retained recompiled target, not this emulator build.

## README cover image

`docs/images/sled-storm-pal-cover.jpg` is the PAL SLES-02194 cover scan from
[PSX Data Center](https://psxdatacenter.com/images/hires/P/S/SLES-02194/SLES-02194-F-ALL.html),
retrieved on 2026-11-06 and included for identification and illustration.
It is not original wrapper artwork or MIT-licensed material. Game artwork,
Electronic Arts and PlayStation marks remain with their respective rights
holders.

## Original game and distribution

Sled Storm names, game code, graphics, music and disc contents belong to their
respective rights holders. No rights to those works are granted here. The
upstream port's notice expressly excludes generated game C and the compiled
game from its license grant. A repository containing only wrapper code does
not establish permission to distribute a compiled game or host it publicly.

Do not add disc images, generated game code, compiled JS/Wasm, memory cards or
private access/session tokens to this repository. Preserve all applicable
upstream license files and required notices with any permitted distribution.

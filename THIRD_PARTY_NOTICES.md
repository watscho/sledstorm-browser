# Sources, attribution and license boundaries

The root [MIT license](LICENSE), copyright **Vacho Aivazov**, applies to this
project's original wrapper, launcher, controller protocol, gateway, adapters,
tooling and documentation. Upstream source, derived snippets, compiled upstream
components and game content retain their respective terms. MIT does not
relicense those materials.

## Browser emulator dependencies

| Component | Pinned version / source | Use | Terms |
| --- | --- | --- | --- |
| [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3) | 4.2.3 official release; archive and file SHA-256 hashes in `emulator.lock.json` | Browser loader, frontend assets and core packaging | GPL-3.0 and bundled component notices. |
| [EmulatorJS/pcsx_rearmed](https://github.com/EmulatorJS/pcsx_rearmed/tree/f29871dde1742cafb0ab56ba33636a8600bbbd80) | `f29871dde1742cafb0ab56ba33636a8600bbbd80` | PlayStation emulation core | Upstream GPL and per-component terms. |
| [EmulatorJS/RetroArch](https://github.com/EmulatorJS/RetroArch/tree/6dd4353937ef48b6ec0bfbdbb15d1c5992d86927) | `6dd4353937ef48b6ec0bfbdbb15d1c5992d86927` | WebAssembly core frontend and browser integration | Upstream GPL and per-component terms. |
| [websockets/ws](https://github.com/websockets/ws) | `ws@8.22.1`; npm integrity in `research/network/package-lock.json` | Custom WebSocket relay and gateway transport | [MIT notice](docs/licenses/ws-LICENSE.txt). |
| [emscripten-core/emsdk](https://github.com/emscripten-core/emsdk/tree/35659964bc2762fffec0d257997fb61475f765b7) | SDK 6.0.13; emsdk `35659964bc2762fffec0d257997fb61475f765b7` | WebAssembly compiler and toolchain | MIT/NCSA and per-component SDK terms. |

`tools/bootstrap-emulator.py` verifies official assets against
[emulator.lock.json](emulator.lock.json). `tools/build-emulator.py` fetches exact
core/frontend sources and an isolated SDK, then applies anchor-checked hooks
from `tools/prepare-emulator-native.py` and `research/emulator/`. The hooks add
console-step gating, state access and isolated camera/HUD presentation. Generated
manifests record source pins and output hashes; the core archive retains bundled
license metadata and notices. See [architecture](docs/browser-emulator.md).

Downloaded assets, source checkouts, SDK and binaries remain in ignored
`vendor/` and `.cache/` directories. Preserve applicable upstream notices and
source-distribution obligations when distributing compiled components.

## Optional hosting tool

`tools/play-online.py` runs a separately installed
[cloudflare/cloudflared](https://github.com/cloudflare/cloudflared) executable
under Apache License 2.0. It provides temporary HTTPS access and is not vendored
or compiled into the emulator. Its distribution carries its own notices.

## Optional recompiled engine components

The explicit `--engine recompiled` option has its own source/build dependencies
in [upstream.lock.json](upstream.lock.json). These notices apply to that option
and its integration tooling; they are not dependencies of the emulator build.

| Source | Pinned revision | Use and terms |
| --- | --- | --- |
| [PeriBluGaming/SledStormPSXRecomp](https://github.com/PeriBluGaming/SledStormPSXRecomp/tree/2abf4ec86baf7f98629da09017bf4d978772ebb4) | `2abf4ec86baf7f98629da09017bf4d978772ebb4` | PAL generated C/scaffold, configuration, widescreen integration and framework patches. Mixed provenance; author's contributions use PolyForm Noncommercial 1.0.0. Preserve [LICENSE](docs/licenses/port-LICENSE.txt) and [NOTICE](docs/licenses/port-NOTICE.md). Generated game code is outside that grant. |
| [mstan/psxrecomp](https://github.com/mstan/psxrecomp/tree/c1f5cafd4102daa57b7342bec7c432aaca8981ce) | `c1f5cafd4102daa57b7342bec7c432aaca8981ce` | Recompiled runtime and interfaces. [PolyForm Noncommercial 1.0.0](docs/licenses/psxrecomp-LICENSE.txt); internal components retain their terms. |
| [PCSX-Redux OpenBIOS](https://github.com/grumpycoders/pcsx-redux/tree/55fbf0468345acfbe5512628a3be5c0cfe3f22e7/src/mips/openbios) | `55fbf0468345acfbe5512628a3be5c0cfe3f22e7` | Framework OpenBIOS binary. MIT, Copyright (c) 2019 PCSX-Redux authors; includes permissive [uC-sdk](https://github.com/grumpycoders/uC-sdk/tree/69e06871824e2d62069487a7426ded09090ceb69) components. Preserve [OpenBIOS notice](docs/licenses/OpenBIOS-LICENSE.txt) and component notices. |
| [SDL2](https://github.com/libsdl-org/SDL), [zlib](https://github.com/madler/zlib), [libwebp](https://github.com/webmproject/libwebp) | SDL2/zlib selected by pinned Emscripten; libwebp pinned by framework `third_party/deps.manifest` | Platform and image support. SDL2/zlib: zlib licenses; libwebp: BSD-style license and PATENTS. Source packages carry full notices. |

That option's local build/inspection tools include CMake 4.4.4 (BSD 3-Clause),
Ninja 1.13.2 (Apache 2.0) and Capstone 5.0.9 (BSD-style). Its anchor-checked
integration generator writes derived source into `.cache/`; generated output
is not covered wholesale by the wrapper's MIT license. Additional component
notices are supplied by the pinned source distributions.

## Cover image

`docs/images/sled-storm-pal-cover.jpg` and its launcher copy
`web/sled-storm-pal-cover.jpg` use the PAL SLES-02194 cover scan from
[PSX Data Center](https://psxdatacenter.com/images/hires/P/S/SLES-02194/SLES-02194-F-ALL.html),
retrieved on 2026-11-06 for identification and illustration. The artwork and
Electronic Arts / PlayStation marks belong to their respective rights holders
and are outside the wrapper's MIT license.

## Game content and distribution

Sled Storm game code, graphics, music, disc contents and trademarks belong to
their respective rights holders. This repository grants no rights to those
works. The optional upstream port also excludes generated game C and the
compiled game from its license grant.

Keep disc images, BIOS, generated game code, compiled JS/Wasm, memory cards and
private invitation/access tokens out of Git. Hosting or distributing game
content requires its own appropriate rights; the wrapper license does not
supply them.

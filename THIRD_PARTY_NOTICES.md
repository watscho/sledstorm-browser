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
| [EmulatorJS/RetroArch](https://github.com/EmulatorJS/RetroArch/tree/6dd4353937ef48b6ec0bfbdbb15d1c5992d86927) | `6dd4353937ef48b6ec0bfbdbb15d1c5992d86927` | WebAssembly core frontend, Netplay implementation and browser integration | Upstream GPL and per-component terms. |
| [websockets/ws](https://github.com/websockets/ws) | `ws@8.22.1`; npm integrity in `research/network/package-lock.json` | WebSocket transport for the Netplay relay and gateway | [MIT notice](docs/licenses/ws-LICENSE.txt). |
| [emscripten-core/emsdk](https://github.com/emscripten-core/emsdk/tree/35659964bc2762fffec0d257997fb61475f765b7) | SDK 6.0.13; emsdk `35659964bc2762fffec0d257997fb61475f765b7` | WebAssembly compiler and toolchain | MIT/NCSA and per-component SDK terms. |

`tools/bootstrap-emulator.py` verifies official assets against
[emulator.lock.json](emulator.lock.json). `tools/build-emulator.py` fetches exact
core/frontend sources and an isolated SDK, then applies anchor-checked hooks
from `tools/prepare-emulator-native.py` and `research/emulator/`. The hooks add
console-step gating, state access, dedicated Netplay synchronization and
isolated camera/HUD presentation. Generated
manifests record source pins and output hashes; the core archive retains bundled
license metadata and notices. See [architecture](docs/browser-emulator.md).

Downloaded assets, source checkouts, SDK and binaries remain in ignored
`vendor/` and `.cache/` directories. Preserve applicable upstream notices and
source-distribution obligations when distributing compiled components.

The 1.0.0 GitHub release distributes this repository's source. Emulator assets
and native binaries are prepared locally from the pinned dependencies above;
no game disc, BIOS or memory-card data is included in the release archive.

## Image rendering

The browser emulator's 16:9 race view uses four PAL track-renderer addresses
documented by PeriBluGaming's SledStormPSXRecomp. The PCSX-ReARMed adapter uses
those addresses to keep track geometry visible in the added side margins.
See the [emulator architecture](docs/browser-emulator.md#cameras-progression-and-technical-settings)
and the [pinned widescreen source](https://github.com/PeriBluGaming/SledStormPSXRecomp/blob/2abf4ec86baf7f98629da09017bf4d978772ebb4/mods/src/widescreen.c).
The upstream widescreen mod carries its own [PolyForm Noncommercial 1.0.0 license](docs/licenses/port-LICENSE.txt).

**Enhanced 2×** uses the pinned [PCSX-ReARMed enhancement rasterizer](https://github.com/EmulatorJS/pcsx_rearmed/tree/f29871dde1742cafb0ab56ba33636a8600bbbd80/plugins/gpu_neon).
The adapter in `research/emulator/sled-enhanced.c` includes the upstream
rasterizer and is available under GPL-2.0-or-later. The upstream source keeps
its existing notices and license options.

The WebGL2 race renderer uses [eNGE by Rene Kootstra](https://github.com/kootstra-rene/enge-js/tree/3c154d8c429fca39eb9295104c922c9b803a2823)
under the MIT license. `tools/prepare-hardware-preview.py` verifies the pinned
renderer, shaders, selected GP0 handlers, and license against SHA-256 hashes.
The generated browser module includes the upstream copyright and license.

The **Clean** preset uses [Sharp Bilinear by Themaister](https://github.com/libretro/glsl-shaders/blob/6c9437bb938f1d9154353ccbfaf5238da5d2f8e3/interpolation/shaders/sharp-bilinear.glsl),
marked public domain in its source. The local copy clamps the automatic scale
to at least 1 for small windows.

The **CRT · Lottes** preset uses [CRT Lottes by Timothy Lottes](https://github.com/libretro/glsl-shaders/blob/master/crt/shaders/crt-lottes.glsl).
The source header dedicates the shader to the public domain. The preset uses
less bloom, a softer mask and a flat screen.

## Controller illustration

The controller in the Controls panel uses [playstation controller by MatthewHenninger](https://openclipart.org/detail/175351/playstation-controller).
The [Openclipart CC0 dedication](https://openclipart.org/share) applies to the illustration.
The local SVG is cropped, with a simplified Circle symbol and editor metadata removed.

## Hosting tools

Dedicated mode launches a separately installed Chrome executable to run the
server-owned emulator. Chrome is provided by the host and carries its own
license and component notices.

`tools/play-online.py` runs a separately installed
[cloudflare/cloudflared](https://github.com/cloudflare/cloudflared) executable
under Apache License 2.0. It provides temporary HTTPS access and is not vendored
or compiled into the emulator. Its distribution carries its own notices.

## Interface inspiration

OpenEmu served as a design reference for the in-game toolbar and shortcuts,
quick save and load, automatic solo snapshots, and press-to-bind controller
remapping. See the [OpenEmu save state guide](https://github.com/OpenEmu/OpenEmu/wiki/User-guide%3A-Save-states)
and [controls guide](https://github.com/OpenEmu/OpenEmu/wiki/User-guide%3A-Preferences%3A-Controls).

The browser launcher implements these workflows locally. Saves use
PCSX-ReARMed snapshots stored in IndexedDB. Controller remapping uses the
browser's Gamepad API. Clean and CRT Lottes use Libretro shaders, and Enhanced
2× uses the PCSX-ReARMed rasterizer. See [image rendering](#image-rendering).

## Cover image

`docs/images/sled-storm-pal-cover.jpg` and its launcher copy
`web/sled-storm-pal-cover.jpg` use the PAL SLES-02194 cover scan from
[PSX Data Center](https://psxdatacenter.com/images/hires/P/S/SLES-02194/SLES-02194-F-ALL.html),
retrieved on 2026-11-06 for identification and illustration. The artwork and
Electronic Arts / PlayStation marks belong to their respective rights holders
and are outside the wrapper's MIT license.

## Header logo

`web/sled-storm-logo.png` is the existing 400 × 224 transparent Sled Storm
logo asset from [HFS DB](https://db.hfsplay.fr/games/87858-sled-storm?lang=en),
[original PNG](https://db.hfsplay.fr/files/2019/09/04/Sled_Storm_274TiZl.png),
retrieved on 2026-11-07. It is used unchanged, rather than recreated with a font.
The game logo remains the property of its respective rights holders and is
outside the wrapper's MIT license.

## Game content and distribution

Sled Storm game code, graphics, music, disc contents and trademarks belong to
their respective rights holders. This repository grants no rights to those
works.

Keep disc images, BIOS, generated game code, compiled JS/Wasm, memory cards and
private invitation/access tokens out of Git. Hosting or distributing game
content requires its own appropriate rights; the wrapper license does not
supply them.

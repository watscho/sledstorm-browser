# Browser emulator multiplayer

This work lives on `research/browser-emulator`, based on stable v0.2.0.
The previous runtime investigation is preserved on `research/performance-baseline`.
This branch runs PCSX-ReARMed in each browser. It synchronizes controller inputs;
it does not stream the host's video. Two-player races can use separate full cameras and the original single-player HUD.

## Build and run

Requirements: Python 3.10+, Git, Bash, make, Node.js 22+ with npm, and
bsdtar/libarchive (`tar` on macOS). The first build downloads pinned sources and
an isolated Emscripten SDK. Linux setup has not been qualified.

```sh
python3 tools/bootstrap-emulator.py
python3 tools/build-emulator.py
python3 server.py
```

Keep exactly one game subdirectory containing a CUE and every referenced BIN
track directly under the repository root. Bootstrap does not download game data.
The launcher prepares an ignored, uncompressed `.cache/disc.zip`, including CD
audio. This avoids costly JavaScript inflation at each join. It reuses the ZIP
until source filenames, sizes or modification times change.

Open <http://127.0.0.1:8000/> and press **Start game**. An optional user-supplied
BIOS must match on all clients; the verified test used HLE (no BIOS).
The launcher creates an invitation automatically. Open the complete invitation
in another browser and start the game, then select Multiplayer in the original
game menus. Each joined browser controls its assigned controller. Separate new
launcher sessions create isolated rooms, with at most four controllers each.

Controls: arrows, **X** for cross/accelerate, **Enter** for Start, **A** for
triangle/back. Click the game to focus it. Rooms use fresh temporary memory
cards; persistent single-player cards are neither loaded nor overwritten.

Loopback invitations work only on this computer. For a temporary private
internet launcher, with `cloudflared` installed:

```sh
python3 tools/play-online.py --engine emulator --disc-mode shared
```

Open the complete private URL printed by the helper, start a game, and share the
in-game invitation. Keep the helper running. Ctrl+C stops its owned processes.
Host-disc mode transfers the complete disc to each authenticated browser; it does not use the earlier
recompiled port's bounded disc cache. Alternatively, use `--disc-mode local` with the helper, or
`python3 server.py --disc-mode local`. Each browser selects its own CUE and all
11 BIN tracks; this mode blocks `/disc.zip` at both launcher and gateway. Disc
identity hashes every track's contents, including audio, in CUE order. Files
are read locally by the browser. No host disc is required to start this mode.
Local-file boot was verified with the complete PAL CUE/BIN set. The launcher
refused host disc downloads in that mode. The emulator tunnel path has not yet
been qualified across physical computers. The older helper's default engine remains
`recompiled`; always include `--engine emulator` for this branch.

## Synchronization

The native core adapter gates `retro_run` before advancing the PlayStation.
Exactly one accepted controller row advances one core step. The frontend's
animation-loop counter is insufficient: fast-forward can execute frontend
iterations without advancing the console. The visible performance probe uses
our completed-core-step counter instead. PAL targets 50 steps/s; it does not
measure audio underruns or distinct displayed images.

Every 250 steps, peers compare canonical serialized state. The pinned format
check includes RAM, CPU, BIOS, VRAM, GPU registers and audio state. It excludes
only the serializer's save-call counter and unused, uninitialized GPU-control
padding, as audited against the pinned source. Other differences stop the room.

Late joins replay controller history from boot with muted catch-up audio, then
switch to live play. History uses compact fixed-size records. Catch-up pauses
the room at a fixed boundary. Long-running sessions can therefore take time to
join. The slowest live peer can hold up the room. There is no rollback, host
migration or durable room storage.

Snapshot joining is experimental and disabled by default. The stock core's
load-state routine normalizes CPU/event timers, so a raw round trip did not
preserve the strict state checksum. Transport tests do not qualify snapshot
netplay; deterministic history replay remains the supported path.

## Verification record — 2026-11-06/07

Two actual browsers controlled different sleds in a two-player Pine Valley
race. Accelerating controller 2 moved the right sled while the left stayed
stationary, and controller 1 independently moved the left sled. Both sustained
short samples around 50 completed core steps/s. State checks agreed past 8,500
steps. A third browser caught up and reached live play with agreement at 34,000
steps. Guest Start opened the original pause menu in 4:3.

These checks used the Codex in-app browser on one Mac, PAL disc, HLE BIOS,
single-threaded Wasm and a 512 MiB heap per instance. They do not qualify Chrome,
hidden tabs, four active racers, long sessions, multiple computers, internet
latency or audible soundtrack quality. Initial independent-game measurements
used the frontend counter and should not be read as native-step measurements.

## Cameras, progression and technical settings

**Separate cameras (two-player races)** is enabled by default before launch. This
uses a presentation-only GPU command replay into private VRAM, widening each
player's viewport without stretching a framebuffer crop. Both clients execute
the same canonical single-player HUD builder for both racers; presentation
selects the local HUD. The PAL resource loader selects the original single-player
HUD atlas in memory. The disc remains unchanged. The right pane's native
two-pixel divider is explicitly accounted for.

Both seats were visually checked while driving with original-sized HUDs and
short samples around 50 core steps/s. The native isolation test checks that
presentation restores canonical GPU state and leaves canonical VRAM unchanged.
The fresh two-player network race with the HUD adapter agreed beyond 10,000
steps. The later right-pane clipping fix was checked in a saved race on both
seats; a fresh network run of that exact fix remains to be recorded.

Pause menus bypass camera replay and keep their native 4:3 presentation.
Three/four-player races currently retain original split-screen; four independent
cameras are not implemented. Edge visibility across every course, weather and
race phase is not comprehensively qualified. Keep the option off for the
original rendering fallback.

**All content unlocked** applies the audited PAL progress preset to initialized
menu RAM on every peer. It leaves disc and persistent memory cards untouched.
Invitations carry progression and camera options, so guests inherit the same
settings. Image filtering and volume are local preferences. The preset has
passed focused RAM tests and the two-player menu/race flow; selecting every
unlock individually remains unqualified. No release/tag or feature parity is
claimed for this research branch.

Local diagnostic artifacts are ignored under `.cache/`. `?dev=1` exposes a
loopback-only snapshot button. A developer can copy an appropriate snapshot to
`.cache/emulator-lab.state` and open `?lab=1&seat=0` or `?lab=1&seat=1` to restore it without joining a
network room. Add `&hud=1` only for a fixture saved after the single-player HUD atlas loaded. `/lab-state` and snapshot upload are not public-gateway routes.

## Source provenance

| Component | Pinned source |
| --- | --- |
| EmulatorJS frontend assets | [4.2.3 official release](https://github.com/EmulatorJS/EmulatorJS/releases/tag/v4.2.3), SHA-256 in `emulator.lock.json` |
| PCSX-ReARMed core | [EmulatorJS/pcsx_rearmed](https://github.com/EmulatorJS/pcsx_rearmed/tree/f29871dde1742cafb0ab56ba33636a8600bbbd80) at `f29871dde1742cafb0ab56ba33636a8600bbbd80` |
| RetroArch browser frontend | [EmulatorJS/RetroArch](https://github.com/EmulatorJS/RetroArch/tree/6dd4353937ef48b6ec0bfbdbb15d1c5992d86927) at `6dd4353937ef48b6ec0bfbdbb15d1c5992d86927` |
| Emscripten | 6.0.13, isolated SDK checkout pinned in `upstream.lock.json` |

The bundled core's `STv4 PCSXra f29871d` state header identifies the core source.
Our anchor-checked build adds native frame gating, a RAM pointer export and a
synchronous restore export, guarded PAL HUD hooks and a presentation-only GPU replay. A portable sed replacement preserves the revision
header on macOS. The generated build manifest records output hashes and source
pins. The prepared core archive retains upstream metadata and notices.

The official asset installation remains unchanged under ignored `vendor/`;
patched source and generated binaries stay under ignored `.cache/`. `?solo=1`
retains the original independent-game baseline. Built-in experimental
EmulatorJS netplay is not used. Our MIT wrapper and the emulator's GPL/component
terms remain separate; see [third-party notices](../THIRD_PARTY_NOTICES.md).

## Focused checks

```sh
node --test web/*.test.mjs
npm test --prefix research/network
python3 tools/test-emulator-view.py
```

The native presentation check requires the pinned source checkout and a local C
compiler. Protocol tests use synthetic controller rows and do not substitute for
real game, audio or internet checks.

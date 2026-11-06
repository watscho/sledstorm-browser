# Sled Storm Browser

**Version 0.3.0 · experimental · [Changelog](CHANGELOG.md)**

PCSX-ReARMed runs in each browser, with synchronized controllers, private room
links and separate player cameras. The earlier recompiled target remains
available through `--engine recompiled`.

<p align="center">
  <img src="docs/images/sled-storm-pal-cover.jpg" alt="Sled Storm PlayStation PAL cover art" width="420">
</p>

*Sled Storm — PlayStation PAL (SLES-02194). Cover scan:
[PSX Data Center](https://psxdatacenter.com/images/hires/P/S/SLES-02194/SLES-02194-F-ALL.html).
Original artwork is not covered by the wrapper's MIT license.*

Play **Sled Storm (1999), PAL SLES-02194**, in a browser with friends. Starting a
game creates a private room invitation automatically. Friends join the same
simulated console as additional controllers, with up to four browsers per room.
Separate invitations create separate sessions. Game mode, riders, sleds and
courses remain in the original game menus.

Each browser runs its own emulator and exchanges controller inputs. The host
does not stream video. Separate-camera presentation replays the selected
player's geometry into a private framebuffer and uses the original single-player
HUD. Native menus keep their 4:3 proportions. The all-content preset unlocks
selection/progression in memory without modifying disc files or persistent cards.

## Build and start

Requirements: macOS or Linux, Python 3.10+, Git, Bash, make, Node.js 22+ with npm,
bsdtar/libarchive, a desktop browser with WebAssembly and WebGL2, and your own
compatible CUE/BIN files. macOS setup has been exercised; Linux setup has not
been qualified. First setup downloads pinned emulator assets, sources and an
isolated Emscripten SDK. No game data is downloaded by these scripts.

```sh
git clone https://github.com/watscho/sledstorm-browser.git
cd sledstorm-browser
python3 tools/bootstrap-emulator.py
python3 tools/build-emulator.py
# Put your PAL CUE and all eleven referenced BIN tracks in game/.
python3 server.py
```

Open [the launcher](http://127.0.0.1:8000/), choose progress, image filtering,
volume and camera preferences, then press **Start game**. A BIOS is optional;
all players must use the same BIOS or all use HLE (no BIOS). Copy **Invite
friends** after launch. Guests inherit the room's progression and camera options.
Keyboard: arrows, **X** for cross/confirm/accelerate, **Enter** for Start,
**A** for triangle/back. Click the game to focus it.

In the original menus, select **Start → Multiplayer quick race** (or another
native multiplayer mode). Each participant presses **X** to join and confirms
its rider. Controller 1 advances to course selection after everyone is ready.
Play proceeds as with controllers attached to one console. Keep connected tabs
open; joining players synchronize automatically before the room resumes.

## Play over the internet

With `cloudflared` installed, stop any existing local launcher and run:

```sh
python3 tools/play-online.py
```

Open [the host launcher](http://127.0.0.1:8000/), start a game, and share
**Invite friends**. The link automatically uses the private HTTPS tunnel origin;
the host reads its own disc locally. The helper also prints a private HTTPS
launcher for other devices. In **shared** mode, only the host needs disc files;
each authenticated browser downloads the complete disc, including music.
Startup therefore depends on the host's upload speed. Keep the helper running;
Ctrl+C stops its tunnel, gateway and runtime. A loopback invitation beginning
with `127.0.0.1` works only on the host computer.

For **local** mode, where every player selects matching CUE/BIN files and host
disc downloads are blocked:

```sh
python3 tools/play-online.py --engine emulator --disc-mode local
# Without a tunnel:
python3 server.py --disc-mode local
```

Local mode can start without disc files on the server. Each browser verifies
all selected track contents before joining. Cloudflare supports both modes.
The defaults are `--engine emulator --disc-mode shared`. Select
`--engine recompiled` explicitly for the earlier runtime.

## Status and limits

Four browsers raced together with independent sled controls and full camera/HUD
views. All four agreed at 19,500 core steps; final short samples were 48.5–50.3
steps/s. The host passed 30 full-state presentation checks. History catch-up and
a third late join were also exercised, and two browsers loaded and joined
through the private Cloudflare HTTPS tunnel. See the
[verification record](docs/browser-emulator.md#verification-record--2026-11-0607)
for exact observations and remaining qualification.

Late joins replay input history from boot; a long session can take time to
catch up. The room pauses at a fixed boundary while a player synchronizes.
The slowest peer can hold up the room. There is no rollback, host migration,
matchmaking or durable room storage. Snapshot joining is experimental and
**disabled**, because stock state restoration normalizes timers.

World geometry and detail remain those of the original multiplayer game.
Separate cameras do not reconstruct higher-detail single-player geometry.
Every course, race phase, hidden-tab behavior, Chrome, audible soundtrack
quality and separate physical computers are not comprehensively qualified.
This is an experimental project, not a promise of lag-free play on every device.

## Sources and licensing

The emulator target uses [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS),
[EmulatorJS/PCSX-ReARMed](https://github.com/EmulatorJS/pcsx_rearmed) and
[EmulatorJS/RetroArch](https://github.com/EmulatorJS/RetroArch). Versions, source
commits, asset SHA-256 hashes and modifications are documented in
[the emulator guide](docs/browser-emulator.md) and
[third-party notices](THIRD_PARTY_NOTICES.md).

The earlier target builds on
[PeriBluGaming/SledStormPSXRecomp](https://github.com/PeriBluGaming/SledStormPSXRecomp)
and [mstan/psxrecomp](https://github.com/mstan/psxrecomp). Its build scripts and
[setup](docs/setup.md), [hosting](docs/multiplayer.md) and
[rendering](docs/browser-lobby.md) documentation are retained for that target.
Those dependencies are not compiled into the new emulator target. The earlier
performance investigation is preserved on `research/performance-baseline`.

Our original wrapper, networking and tooling are **MIT**, copyright
**Vacho Aivazov**. The emulator and other components retain their GPL/component
terms; MIT does not relicense them. No game images, BIOS, generated game code,
emulator binaries, memory cards or private invitation tokens are committed.
Original game content and trademarks remain with their respective owners.
This project is not affiliated with Electronic Arts or upstream authors.

## Checks

```sh
node --test web/*.test.mjs
npm test --prefix research/network
python3 tools/test-emulator-view.py
python3 tools/test-emulator-server.py
```

The native presentation check requires a local C compiler and the pinned source
checkout created by the build. Protocol tests use synthetic inputs and do not
replace real-game verification.

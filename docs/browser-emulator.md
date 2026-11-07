# Browser emulator multiplayer

Each browser runs PCSX-ReARMed and synchronizes controller inputs with the room.
Up to four racers have separate full cameras and the original single-player HUD.

For installation and commands, see [setup](setup.md). For invitations, starting a
race and shutting down, see [playing with friends](multiplayer.md). This guide
covers the implementation and pinned source dependencies.

## Runtime and disc loading

The host serves the launcher on loopback port 8000 and starts the controller
relay on 8004. The online helper adds a private gateway on 8005 and a temporary
Cloudflare HTTPS tunnel. It publishes the HTTPS invitation origin to its own
runtime, so the host can play through localhost without downloading its disc
through the tunnel. Metadata is bound to that runtime PID and removed on stop.

Shared mode packages the CUE and all eleven BIN tracks into an ignored,
uncompressed `.cache/disc.zip`, including CD audio. This avoids JavaScript
inflation at each join. The archive is reused until source filenames, sizes or
modification times change. Each guest loads the complete archive. On localhost
and permanent hostnames, the launcher stores one archive per browser origin
using Cache Storage and checks the disc fingerprint before reusing it. Quick
Tunnel launches use the session download so changing hostnames does not leave
behind additional saved copies.

Local-file mode reads browser-selected CUE/BIN files and blocks `/disc.zip` at
both server and gateway. Disc identity hashes every track, including audio, in
CUE order. No host disc is required to start this mode. BIOS selection must match
across all clients; the verified configuration uses HLE with no BIOS file.
Rooms use fresh temporary memory cards, without loading or overwriting persistent
single-player cards.

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

## Verification

The [verification record](verification.md) documents the four-browser race,
state agreement, native isolation checks, internet-path checks and remaining
qualification limits.

## Cameras, progression and technical settings

**Separate cameras** is enabled by default. The adapter replays the selected
player's GPU geometry into private VRAM. Two-player panes gain a wider clip;
three/four-player geometry is rerasterized at full viewport size, preserving
texture coordinates. It does not stretch a framebuffer crop. The PAL right
pane starts at X=258, and the lower panes start at Y=129; both native divider
margins are accounted for.

The original single-player HUD routine runs once for the local racer in an
isolated presentation pass. Four complete HUDs would overflow the game's
256-slot UI pool. Instead, the adapter uses a private ordering table, freezes
hardware event dispatch during that audited UI routine, then restores all
interpreter registers, console RAM and instruction-cache contents before
returning. GPU state and the canonical framebuffer are restored too. It never
uses LoadState for this transaction or advances canonical simulation time.
The resource loader selects the original single-player HUD atlas in memory;
the disc remains unchanged.

All four controller/camera seats were visually checked while driving in a
local four-player race. Short samples were around 48–50 core steps/s with
extra developer validation enabled. Full serialized-state comparisons before
and after presentation passed while switching cameras. The native isolation
test also covers partial HUD execution failure, register/RAM restoration,
canonical VRAM preservation, native viewport bounds and menu bypass.

Pause menus bypass replay and retain native 4:3 presentation. World geometry,
LOD and scenery remain those of the original multiplayer mode. Course, weather and race-phase coverage is not comprehensive. Turning the camera
option off before starting restores original rendering.

**All content unlocked** applies the audited PAL progress preset to initialized
menu RAM on every peer. It leaves disc and persistent memory cards untouched.
Invitations carry progression and camera options, so guests inherit the same
settings. Image filtering and volume are local preferences. The preset has
passed focused RAM tests and multiplayer menu/race flows; selecting every
unlock individually remains unqualified.

## Local diagnostics

Diagnostic files stay under ignored `.cache/`. These are developer tools; use
the normal launcher for multiplayer play.

1. Open [the local diagnostic launcher](http://127.0.0.1:8000/?dev=1) and start
   a room. Wait until it is synchronized and reach the desired game state.
2. Expand **Technical details** and click **Save local diagnostic snapshot**.
   The server writes `.cache/emulator-state-3-1000.bin`.
3. Copy that file to `.cache/emulator-lab.state` while keeping the server running:

   ```sh
   cp .cache/emulator-state-3-1000.bin .cache/emulator-lab.state
   ```

4. Open [the fixture console](http://127.0.0.1:8000/?console=1&dev=1&fixture=1),
   then click **Start game**. It restores the snapshot without joining a room.
   The controller selector changes the local input and camera seat.

Without `fixture=1`, `?console=1&dev=1` starts a fresh diagnostic console. The
saved snapshot must match the pinned core and relevant progress/camera setup.
Developer mode also samples canonical state before and after presentation.
`?verifyView=1` enables that check in a normal room without opening developer UI.

The specialized `?lab=1&seat=0` and `?lab=1&seat=1` camera harness expects a
two-player fixture paused by controller 2. Its keyboard controls controller 2;
`seat` selects the camera. Add `&hud=1` only when the fixture already contains the
single-player HUD atlas. Use the fixture console above for general diagnostics.

Snapshot upload and `/lab-state` are loopback-only routes excluded from the
public gateway. Diagnostic restoration does not qualify snapshot-based room
joining; supported multiplayer joining uses history replay.

## Source provenance

| Component | Pinned source |
| --- | --- |
| EmulatorJS frontend assets | [4.2.3 official release](https://github.com/EmulatorJS/EmulatorJS/releases/tag/v4.2.3), SHA-256 in `emulator.lock.json` |
| PCSX-ReARMed core | [EmulatorJS/pcsx_rearmed](https://github.com/EmulatorJS/pcsx_rearmed/tree/f29871dde1742cafb0ab56ba33636a8600bbbd80) at `f29871dde1742cafb0ab56ba33636a8600bbbd80` |
| RetroArch browser frontend | [EmulatorJS/RetroArch](https://github.com/EmulatorJS/RetroArch/tree/6dd4353937ef48b6ec0bfbdbb15d1c5992d86927) at `6dd4353937ef48b6ec0bfbdbb15d1c5992d86927` |
| Emscripten | 6.0.13, isolated SDK checkout pinned in `upstream.lock.json` |

The bundled core's `STv4 PCSXra f29871d` state header identifies the core source.
Our anchor-checked build adds native frame gating, a RAM pointer export, a
synchronous restore export, guarded PAL HUD hooks, an isolated UI execution
pass and presentation-only GPU replay. A portable sed replacement preserves the revision
header on macOS. The generated build manifest records output hashes and source
pins. The prepared core archive retains upstream metadata and notices.

The official asset installation remains unchanged under ignored `vendor/`;
patched source and generated binaries stay under ignored `.cache/`. `?solo=1`
starts an independent console for diagnostics. Room networking is implemented
by this project's controller protocol. Our MIT wrapper and the emulator's
GPL/component terms remain separate; see
[third-party notices](../THIRD_PARTY_NOTICES.md).

## Focused checks

```sh
node --test web/*.test.mjs
npm test --prefix research/network
python3 tools/test-emulator-view.py
python3 tools/test-emulator-server.py
```

The native presentation check requires the pinned source checkout and a local C
compiler. Protocol tests use synthetic controller rows and do not substitute for
real game, audio or internet checks.

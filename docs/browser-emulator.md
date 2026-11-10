# Browser emulator multiplayer

Each browser runs PCSX-ReARMed and synchronizes controller inputs with the room.
Up to four racers have separate full cameras and the original single-player HUD.

For installation and commands, see [setup](setup.md). For invitations, starting a
race and shutting down, see [playing with friends](multiplayer.md). This guide
covers the implementation and pinned source dependencies.

## Runtime and disc loading

The host serves the launcher on loopback port 8000, with RetroArch Netplay on
8006 and the legacy diagnostic relay on 8004. The online helper adds a private
gateway on 8005 and a temporary
Cloudflare HTTPS tunnel. It publishes the HTTPS invitation origin to its own
runtime, so the host can play through localhost without downloading its disc
through the tunnel. Metadata is bound to that runtime PID and removed on stop.

Shared mode packages the CUE and all eleven BIN tracks into an ignored,
uncompressed `.cache/disc.zip`, including CD audio. This avoids JavaScript
inflation at each join. The archive is reused until source filenames, sizes or
modification times change. Each guest loads the complete archive. On localhost
and permanent hostnames, the launcher stores one archive per browser origin
using Cache Storage and checks the disc fingerprint before reusing it. In Chrome
on a Quick Tunnel, the launcher can reuse an archive selected by the player
instead of storing separate copies per temporary hostname. It verifies the ZIP
against the host's chunk hashes before loading it.

Local-file mode reads browser-selected CUE/BIN files and blocks `/disc.zip` at
both server and gateway. Disc identity hashes every track, including audio, in
CUE order. No host disc is required to start this mode. BIOS selection must match
across all clients; the verified configuration uses HLE with no BIOS file.
Rooms use fresh temporary memory cards, without loading or overwriting persistent
single-player cards.

## Synchronization

The ordinary lobby uses upstream [RetroArch Netplay](https://docs.libretro.com/development/retroarch/netplay/)
for controller input, rollback and joining from the host's live state.
The browser opens WebSockets before RetroArch uses its emulated TCP sockets.
A loopback relay pairs each guest stream with its host stream. The private HTTPS
gateway forwards the same binary traffic at `/netplay` through Cloudflare.
The relay issues a one-time ticket to the host to pair each guest stream.

Dedicated Quick Tunnel clients open a second `/netplay-mirror` WebSocket
after synchronizing. The launcher starts a separate HTTP/2 connector for
this endpoint. Small messages, including controller input, carry sequence
numbers on both connections. The browser and gateway forward the first
available copy of each message to RetroArch in order. Large snapshots travel
on the primary connection. When the separate route is unavailable, the
browser uses the mirror endpoint through the primary connector. The launcher
retries an exited mirror connector and the browser keeps its fallback socket
until the replacement's first packet reaches the ordered stream. During the
overlap, both open mirrors can deliver input. The room and controller streams
continue through the handover.

In dedicated mode, the relay starts a headless Chrome/RetroArch runtime for
each room. The runtime follows the core's frame rate and owns the committed
controller input.
The relay owns seat reservations, readiness and room ownership. A player can
become owner while keeping their existing controller number. When a client
joins or requests resynchronization, the runtime sends the current snapshot
to that client. Existing clients continue receiving the live input stream.
In an active PAL multiplayer race through a Cloudflare Quick Tunnel, visible
clients can run up to two steps on the last confirmed inputs during steady
delivery. When confirmations pause, the limit grows toward 18 steps based on
the number of missing PAL ticks. Small batches of delayed confirmations keep
that progress paced until the backlog closes. Input is still sent on the
usual schedule. When newly confirmed input changes an earlier prediction,
RetroArch reconciles before drawing the next view. During replay, confirmed
steps use the room's input and unconfirmed steps reuse the latest full
controller state, including held steering. Clients that fall behind
temporarily skip personal presentation to catch up.

Dedicated rooms use WebAudio when the browser supports it. PAL clients through
Quick Tunnel configure a 160 ms queue. During multiplayer races, RetroArch
targets three quarters of that capacity and refills a depleted queue faster
with a bounded resampling adjustment. Audio queue waits yield between
emulator steps.

Guests load matching content before the handshake. The game becomes
visible after the guest receives the host state and RetroArch assigns the
controller. The browser uses the same controller slot for its camera and HUD.
Sled Storm requires racers to be registered in the multiplayer menu before the
race. Rejoining a live race attaches a controller to an existing racer.

Local diagnostic URLs with `?transport=legacy` use the earlier frame gate and
input history protocol. The optional checkpoint experiment
(`SLED_EMULATOR_CHECKPOINTS=1`) applies to that transport only.

## Verification

The [verification record](verification.md) documents the four-browser race,
state agreement, native isolation checks, internet-path checks and remaining
qualification limits.

## Cameras, progression and technical settings

**Separate cameras** is enabled by default. RetroArch rooms use the original
PAL full-size world renderer in a private pass, with the assigned racer's camera
and render buffers. The adapter restores the canonical multiplayer state before
the next console step. The GPU replay path serves as a fallback if a native
race render pass fails.

The PAL layout routine clears three particle lists when it installs a camera.
The private pass preserves their heads and lets the original particle routine
update them for the selected camera. The world draw exits after that camera's
viewport.

The original tread recorder runs on every peer using the stock PAL buffers
and its contact and surface rules. Personal cameras project the marks locally
and discard quads that cross the GTE near plane or stretch more than 128 native
pixels along either screen axis. The original shared renderer keeps its own
draw rules.

**Enhanced 2×** is a personal launch setting. Supported PAL races produce
1024×512 in 4:3 or 1368×512 in 16:9. Run
`python3 tools/prepare-hardware-preview.py` on the host to enable WebGL2
acceleration for dedicated 16:9 races with **Clean** or **Crisp pixels**.
The regular lobby selects the hardware renderer when it is available and
uses the PCSX-ReARMed rasterizer as its fallback. Both use the original HUD
and game textures. Menus and shared split-screen use the finished software
frame. This setting only affects the local display.

**Draw distance (experimental)** is a personal launch setting for the same
PAL race modes. **Original** targets the solo span of 10 terrain cells in
personal views. Dense scenes can fall back to the stock multiplayer range.
The opening sweep and countdown reserve geometry for sleds and shadows, and
the widescreen view extends the fog backdrop across the extra width. Values
up to **+100%** set a ceiling for extra terrain after the race clock starts.
Higher values can cause brief stutters. The canonical console state stays
shared across the room.

When a visible WebGL2 client falls moderately behind the dedicated room, it
can keep a recent image while processing more console steps. Full catch-up
handles large backlogs or recovery that has stopped making progress.

### Local WebGL2 race preview

To try the hardware renderer on a local PAL disc, build the core and generate
the preview module, then start the normal launcher.

```sh
python3 tools/build-emulator.py
python3 tools/prepare-hardware-preview.py
python3 server.py
```

Open [the local preview](http://127.0.0.1:8000/?console=1&renderer=hardware).
Select **16:9** and **Clean** or **Crisp pixels**, select **Start game**, and
enter a race. Use the regular launcher URL to play online.

Open the [preview with Sharp Bilinear texture filtering](http://127.0.0.1:8000/?console=1&renderer=hardware&textures=sharp)
to soften magnified terrain and vehicle textures. The filter samples the
original texture atlas, clamps sampling to each primitive's UV bounds, and
leaves the original HUD on its separate software layer. The regular preview
keeps nearest-neighbor texture sampling.

The preview submits the isolated PAL camera's GP0 command stream and texture
VRAM to eNGE's WebGL2 rasterizer. It draws the world at 2736×1024 before
correcting for the display aspect ratio. The shader samples native 16-bit
VRAM words and decodes indexed palettes on the GPU. The HUD still uses the original
rasterizer. Menus, pause, other image filters, and unhandled frames use the
existing software renderer. The preview does not change the simulated console.

The preview also uses RetroArch's browser-native WebAudio driver when
available. When its audio queue is full, RetroArch yields between emulator
steps after submitting the current frame.

The local console can also display a selected multiplayer camera. Live-room
checks covered separate Chrome contexts on one Mac. See the
[verification record](verification.md) for the measured frame timings.

### Personal cameras

In solo races, the adapter captures the original HUD packets from the game's
ordering-table submission. It removes those packets from the private world
pass and draws them once at native resolution. This preserves the original
award timing and avoids drawing a second HUD over the minimap and points.

When native rendering is unavailable, the GPU replay path draws the selected
player's split-screen geometry into private VRAM. Two-player panes gain a wider clip;
three/four-player geometry is rerasterized at full viewport size, preserving
texture coordinates. It does not stretch a framebuffer crop. The PAL right
pane starts at X=258, and the lower panes start at Y=129; both native divider
margins are accounted for.

For a multiplayer personal camera, the original single-player HUD routine
uses the local racer's values in an isolated presentation pass. The speedometer
history advances in the shared simulation, and the minimap reads the actual
positions of every racer. Four complete
HUDs would overflow the game's
256-slot UI pool. Instead, the adapter uses a private ordering table, freezes
hardware event dispatch during that audited UI routine, then restores all
interpreter registers, console RAM and instruction-cache contents before
returning. GPU state and the canonical framebuffer are restored too. It never
uses LoadState for this transaction or advances canonical simulation time.
The resource loader selects the original single-player HUD atlas in memory;
the disc remains unchanged.

All four controller and camera seats were visually checked in a four-player
Cloudflare race. Earlier local runs also exercised each camera while driving. Short samples were around 48–50 core steps/s with
extra developer validation enabled. Full serialized-state comparisons before
and after presentation passed while switching cameras. The native isolation
test also covers partial HUD execution failure, register/RAM restoration,
canonical VRAM preservation, native viewport bounds and menu bypass.

The shared pause menu retains its native 4:3 proportions and appears over
each player's personal camera. The usual racing HUD is hidden while paused.
Course, weather and race-phase coverage is recorded in the verification
guide. Turn **Separate cameras** off before starting to use the game's shared
screen.

**16:9 · Widescreen** adds a private 684×256 race framebuffer and widens the
PAL track edge checks identified by [SledStormPSXRecomp](../THIRD_PARTY_NOTICES.md#image-rendering).
The projected geometry
and HUD keep their original scale within the wider frame. The rasterizer reads
textures from the original VRAM so the added margins can safely overlap texture
pages in the private buffer. A crowded frame can require a second render pass
to preserve the racers when the PAL primitive pool fills up. A room can mix
4:3 and 16:9 clients. Enhanced 2× draws the wide scene in two tiles and
combines them into a 1368×512 framebuffer.
During a respawn, the adapter extends the original blended fade to the full
wide framebuffer before compositing the HUD. If the primitive pool requires
a second pass, the added margins receive the fade once.

**All content unlocked** applies the audited PAL progress preset to initialized
menu RAM on every peer. It leaves disc and persistent memory cards untouched.
Invitations carry progression and camera options, so guests inherit the same
settings. Image filtering, volume, keyboard bindings and gamepad selection are local
preferences. Each browser samples its selected device and keyboard for its
own seat. See [personal controls](browser-lobby.md#personal-controls). The preset has
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
public gateway. Diagnostic restoration is separate from RetroArch's live room synchronization.

## Source provenance

| Component | Pinned source |
| --- | --- |
| EmulatorJS frontend assets | [4.2.3 official release](https://github.com/EmulatorJS/EmulatorJS/releases/tag/v4.2.3), SHA-256 in `emulator.lock.json` |
| PCSX-ReARMed core | [EmulatorJS/pcsx_rearmed](https://github.com/EmulatorJS/pcsx_rearmed/tree/f29871dde1742cafb0ab56ba33636a8600bbbd80) at `f29871dde1742cafb0ab56ba33636a8600bbbd80` |
| RetroArch browser frontend | [EmulatorJS/RetroArch](https://github.com/EmulatorJS/RetroArch/tree/6dd4353937ef48b6ec0bfbdbb15d1c5992d86927) at `6dd4353937ef48b6ec0bfbdbb15d1c5992d86927` |
| Emscripten | 6.0.13, isolated SDK checkout pinned in `emulator.lock.json` |

The bundled core's `STv4 PCSXra f29871d` state header identifies the core source.
Our anchor-checked build adds native frame gating, a RAM pointer export, a
synchronous restore export, guarded PAL HUD hooks, an isolated UI execution
pass and presentation-only GPU replay. A portable sed replacement preserves the revision
header on macOS. The generated build manifest records output hashes and source
pins. The prepared core archive retains upstream metadata and notices.

The official asset installation remains unchanged under ignored `vendor/`;
patched source and generated binaries stay under ignored `.cache/`. Rooms use
RetroArch Netplay over the wrapper's WebSocket relay. Continuing a solo save
seeds the room's authoritative emulator before peers synchronize. Our MIT wrapper and the emulator's
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

### RetroArch Netplay lab

`python3 server.py --browser-hosted --retroarch-lab` also enables the standalone two-player
diagnostic at `/retroarch-lab` in shared-disc mode. It isolates the WebSocket
adapter from the lobby. For ordinary play, use the root launcher and **Copy invite link**.

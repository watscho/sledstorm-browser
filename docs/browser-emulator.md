# Emulator and networking architecture

## Runtime paths

| Area | Location and responsibility |
| --- | --- |
| Browser client | [`web/`](../web) handles the launcher, game-data choices, local emulation, presentation, controls and saves. |
| Packaged host | [`server/`](../server) bundles TypeScript into Node SEA. The server helper owns one dedicated room and supervises Chromium and the tunnel connectors. |
| Server window | [`packaging/macos/`](../packaging/macos) opens the [`admin/`](../admin) controls in a macOS window with an authenticated loopback session. |
| Python host | [`server.py`](../server.py) serves the game origin. [`tools/play-online.py`](../tools/play-online.py) starts the runtime, relay, private gateway and connectors. |
| Netplay and gateway | [`research/network/`](../research/network) runs the RetroArch relay, dedicated browser runtime and private HTTP/WebSocket gateway. |
| Native preparation | [`research/emulator/`](../research/emulator) and [`tools/prepare-emulator-native.py`](../tools/prepare-emulator-native.py) carry the adapter and anchor-checked transformations. |

The desktop app resolves read-only assets from its bundle and keeps
writable configuration, cache and logs in the user's Library.
`SLED_SERVER_HOME` isolates these paths in tests. A kernel advisory lock,
private instance record and authenticated probe coordinate a single
server per user. The app opens a window and starts or reuses that server.
The server can keep hosting while the window is closed.

The game origin and RetroArch relay use loopback ports 8000 and 8006.
The packaged gateway and admin listener select free ports. Keep the
stable local game origin when preserving browser saves. The public
gateway serves a route allowlist and proxies WebSockets. The admin
listener uses loopback, Host/Origin validation and authenticated sessions.
A room token belongs to the invitation. Keep tokens, invitations and
private tunnel origins out of logs and reports.

## Synchronization

A dedicated headless Chromium worker emulates the console even if the
creator's browser leaves. A browser-hosted room depends on the creator's
tab. Each player browser runs the same core and catches up from room
state before applying live inputs. The local player view follows the
controller assignment. A dedicated room can reserve a controller to
allow in-race rejoin.

Room identity covers the disc, core and adapter, native build fingerprints,
BIOS and room options. File delivery policy and archive packaging can vary
without changing the disc's identity. Keep the identity checks when
changing transport or rendering.

Internet play uses an authenticated Quick Tunnel gateway. Dedicated
clients can mirror small Netplay packets across the primary and mirror
paths. The first copy is used, and large transfers stay on the primary
path. The primary connector can fall back from QUIC to HTTP/2. Keep
COOP/COEP isolation and HTTPS/WSS on a custom deployment.

## Game-data delivery

The packaged runtime streams a deterministic stored ZIP from the disc
files and caches its identity and chunk manifest. The host does not
need a second full ZIP for that path. In local-only policy, the public
gateway blocks host disc downloads and guests supply their own copy.

The shared preview accepts 8 MiB chunk requests. Hosts run four guest
transfers at once and allow sixteen to wait. Overflow returns HTTP 503
with `Retry-After`. Loopback requests and metadata bypass this gate.
The gateway preserves the changed-files marker on a marked 503. Keep
chunk responses streamed through the gateway; the provider can buffer
fixed-length responses.

The client verifies length and SHA-256, keeps up to two requests in
flight, and commits the progress record after a checked part is written.
Where available, origin-private files and IndexedDB hold the parts under
a Web Lock. The client checks the completed archive and refetches a
corrupt part. A new tunnel hostname gets fresh browser storage. Exact
portable ZIPs take the archive fast path, and other compatible ZIPs are
validated as individual disc entries. These checks precede emulation.

## Cameras, progression and technical settings

The verified PAL executable provides independent per-player camera and
HUD presentation while the canonical console advances with shared
inputs. Widescreen and Enhanced 2× apply to supported gameplay scenes.
Native menus and shared pause stay in 4:3. The optional eNGE WebGL 2
race renderer is built separately with
`python3 tools/prepare-hardware-preview.py`.

Maintain canonical console state across personal render passes. For
changes to view hooks, verify RAM/register restoration, GPU/VRAM
isolation, all four viewports, menu transitions and gameplay. Earlier
Pine Valley regressions involved the opening sweep and lap/finish
geometry budgets. Preserve checkpoints for those areas in renderer tests.

[PAL progression preset](unlocked-profile.md) documents the audited
addresses and state guards. [Third-party notices](../THIRD_PARTY_NOTICES.md)
cover the rendering sources and their licenses.

## Browser saves and diagnostics

The IndexedDB library keys saves by verified disc, core, BIOS and
adapter identity. Use atomic writes and retain checked size limits
for the portable format. A packaged room can restore a compatible
checkpoint by handing over to a replacement worker while keeping
its invitation. Preserve the active worker if a requested restore
fails before the replacement is ready.

Distinguish canonical console steps/s, browser animation pacing,
painted FPS, end-to-end input latency and audio behavior. The current
Performance panel measures the console timeline and browser animation
intervals, and exposes synchronization and runtime diagnostics.

## Source pins and checks

[Emulator lock](../emulator.lock.json) pins upstream source and assets.
[Server toolchain lock](../server/toolchain.lock.json) pins Node.js,
Chromium and `cloudflared`. Keep downloaded checkouts and generated
artifacts in ignored directories. [Contributing](../CONTRIBUTING.md)
lists the focused test commands and [verification](verification.md)
records the manual release scope.

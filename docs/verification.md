# Verification and known limits

## v0.4.0 release checks — 2026-11-07

- 18 browser-module tests, 16 networking tests and three synthetic HTTP-handler
  tests passed. Coverage includes keyboard presets and conflict swapping,
  controller device selection and private-gateway access to the controller SVG.
- Native presentation assertions passed against the pinned source checkout,
  covering four PAL viewports, state isolation and native-menu bypass.
- The local launcher served v0.4.0 and the controller illustration with the
  expected SVG content type.
- An isolated Chrome preview rendered Controls at wide and narrow panel widths.
  A browser check changed a binding, verified the conflicting key swapped, and
  switched to WASD. This check used the launcher panel without a running game.

## v0.3.0 gameplay evidence — 2026-11-07

These runs used PAL SLES-02194 and the pinned PCSX-ReARMed / RetroArch runtime
in the Codex in-app browser on one Mac with HLE BIOS, single-threaded WebAssembly
and a 512 MiB heap per instance.

- Four browsers joined one Pine Valley race, each confirmed its own rider and
  independently accelerated a different sled.
- Each player had a separate full camera and original single-player HUD.
- All four agreed at **19,500 completed core steps**. Final short samples were
  **50.3, 49.0, 48.5 and 49.8 steps/s**, against a PAL target of 50.
- The host passed **30 full serialized-state comparisons** before and after
  private camera/HUD rendering.
- Controller 4 opened the shared pause menu with original **4:3** proportions.
- Two-player control and cameras were exercised separately, with state agreement
  past 8,500 steps. A third late arrival caught up and agreed at 34,000 steps.

Local evidence is ignored under `.cache/emulator-four-browser-*`.

## v0.3.0 disc loading and internet access

- Two actual browsers loaded the host disc through private Cloudflare HTTPS,
  joined one room, completed catch-up and agreed at 9,000 core steps. Short live
  samples were around 48 steps/s. This transport check preceded the final
  four-player camera/HUD changes.
- The final localhost host launcher generated a private HTTPS invitation. That
  invitation authenticated and opened the guest launcher with inherited settings,
  while the host continued reading its disc locally.
- Local-file mode booted from a complete PAL CUE and eleven BIN tracks selected
  in the browser; the server refused host archive downloads in that mode.

The internet-path checks used browsers on **one Mac**. A race between separate
physical computers on remote networks remains unqualified.

## Automated checks

```sh
node --test web/*.test.mjs
npm test --prefix research/network
python3 tools/test-emulator-view.py
python3 tools/test-emulator-server.py
```

Coverage includes invitation validation, public URL construction, frame gating,
state canonicalization, real loopback WebSocket exchange, compact history,
asset-route restrictions and disc policies. Native checks cover viewport bounds,
canonical GPU/VRAM preservation, interpreter RAM/register/instruction-cache
restoration, interrupted HUD execution and native menu bypass. The native test
requires a C compiler and the pinned source checkout from the build.

## Current limits for v0.4.0

- The documented live runs used one Mac. Separate physical computers, remote
  latency, long sessions and reconnect behavior still need hands-on testing.
- Audible soundtrack quality, hidden/background tabs, physical gamepads,
  Chrome gameplay, mobile gameplay and Linux/Windows are unqualified.
- Course/weather coverage is limited; three-player racing was not separately
  qualified as a full race. Three and four players share the same presentation
  path, and the four-player path was exercised.
- World geometry and detail follow the original multiplayer mode.
- Late joining replays history and pauses the room; the slowest client can slow
  everyone down. Snapshot joining is experimental and disabled.
- Rollback, host migration, persistent room recovery and durable saves are not
  implemented. Other game regions, standalone ISO/CHD and PS2 Sled Storm are not
  supported by this setup.

Core-step measurements do not measure distinct displayed images or audio
underruns. Passing source/transport tests does not replace real gameplay and
listening checks on the intended devices.

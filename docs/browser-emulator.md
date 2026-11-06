# Mature browser emulator experiment

This work lives on `research/browser-emulator`, based on stable v0.2.0. The
recompiled-runtime investigation is preserved on `research/performance-baseline`.
This is a performance and integration prototype, not a replacement multiplayer
release. No new release version or tag has been created.

## Run locally

Requirements: Python 3.10+, an internet connection for the initial emulator
download, and bsdtar/libarchive (macOS's built-in `tar` supports the release's 7z
archive). Linux users with GNU tar should install `bsdtar` first.

```sh
python3 tools/bootstrap-emulator.py
python3 tools/bootstrap-emulator.py --check
python3 server.py
```

Keep exactly one game directory containing its CUE and every referenced BIN
track directly under the repository root. The launcher prepares an ignored
`.cache/disc.zip` containing all tracks, including CD audio. It reuses the archive
until the input filenames, sizes or modification times change. The initial
download and disc extraction are substantial; wait for them to finish before
measuring steady-state performance. Game files are never installed by bootstrap.

Open <http://127.0.0.1:8000/?benchmark=1> and click **Start game**. A BIOS is
optional for this tested HLE boot; a user-supplied BIOS can be selected before
launch. Controls: arrows, X for confirm/accelerate, Enter for Start, A for back.
The emulator's controls menu supports remapping and gamepads.

For a second independent local instance, open
<http://localhost:8000/?benchmark=1>. These are independent games, not a connected
room. Both addresses refer to this computer. The server only listens on loopback;
neither URL is an invitation for another computer. The old Cloudflare stack was
stopped before switching branches and does not serve this prototype.

The opt-in benchmark samples the core's `getFrameNum()` every two seconds. Its
rate counts emulated frames, not distinct rendered images or browser animation
callbacks. PAL targets 50 emulated frames/s. Wasm heap size excludes JS buffers,
disc storage, graphics allocations and browser overhead. Visibility is reported
to help identify hidden-tab tests. The probe does not measure audio underruns.

## Dependency provenance

The experiment uses [EmulatorJS v4.2.3](https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3)
and the PCSX-ReARMed browser core bundled with its
[official release](https://github.com/EmulatorJS/EmulatorJS/releases/tag/v4.2.3).
That release was still GitHub's latest stable release when checked on 2026-11-06.
The core's bundled report records a build on 2025-06-14; it does not establish a
PCSX source commit, so we pin the binary distribution rather than inventing one.
`emulator.lock.json` records the release archive SHA-256 and individual asset
hashes. Installed assets were compared byte-for-byte with that verified archive.

Bootstrap extracts only the listed components and the upstream license under
ignored `vendor/emulatorjs/`. It refuses to overwrite differing existing files.
Our wrapper remains MIT; EmulatorJS and the core retain their own GPL/component
terms. See [third-party notices](../THIRD_PARTY_NOTICES.md). No game data or
emulator binaries are committed.

## Initial observations — 2026-11-06

Two instances were run in the Codex in-app browser on the same Mac. Chrome was
running but unavailable through the browser automation connection, so this does
not qualify the user's original two-Chrome-tab scenario. The games used the
complete PAL disc with HLE BIOS and `EJS_threads: false`.

| Observed scene | Short sample readings |
| --- | --- |
| Animated game setup / character menu, with another instance racing | 50.4–50.6 emulated frames/s |
| Pine Valley race, with another instance in menus | 50.0–51.0 emulated frames/s |
| Two concurrent Pine Valley races, final short samples | 50.6 and 50.0 emulated frames/s |
| Wasm heap, per running instance | 512 MiB |

The two-second counter window naturally fluctuates around 50. Steering and
acceleration reached 49 km/h; race time and map position advanced. Local
screenshots are saved under ignored `.cache/emulator-menu-measurement.png` and
`.cache/emulator-race-measurement.png`; the final two-race captures are
`.cache/emulator-two-races-1.png` and `.cache/emulator-two-races-2.png`.
These are short observations, not a
long-duration benchmark or a controlled same-browser comparison with the
recompiled port. Actual soundtrack playback has not been listened to and
qualified. Sustained driving in both races, Chrome performance, hidden tabs,
multiple physical computers and internet latency remain to be checked.

## Multiplayer migration gates

The existing room relay can retain invitation capabilities and controller seat
assignment, but its C/Wasm bridge belongs to the recompiled runtime. It cannot
be dropped into PCSX-ReARMed unchanged.

1. Establish a frame boundary adapter: collect all controller inputs, wait for
   the agreed input row, then advance exactly one emulated frame. Validate state
   agreement using the same core, disc, BIOS and initial save state.
2. Qualify savestate transfer, late join and deterministic replay, including
   CD audio. Do not enable a public netplay switch merely because it exists.
3. Adapt authenticated host-disc loading. The current emulator prototype loads
   the full ZIP; it does not use the native port's bounded range-read cache.
   Avoid multiplying archive extraction and memory pressure during room joins.
4. Reimplement player-specific full cameras and the original-size HUD. The old
   hooks intercept recompiled game/render functions; they do not exist in this
   core. Original multiplayer split-screen alone does not satisfy that goal.
5. Validate four controller seats, isolated rooms, pause menus in 4:3, technical
   launch settings and progression before replacing the existing launcher.

In the pinned release, built-in netplay requires both debug and experimental
flags. Its [source](https://github.com/EmulatorJS/EmulatorJS/blob/v4.2.3/data/src/emulator.js)
also labels controller synchronization as broken. Current website setup guides
and FAQ disagree about netplay readiness; the pinned implementation is the
relevant evidence here. This experiment leaves that feature disabled.

Performance is promising enough to continue with the frame adapter, but this
branch does not yet provide online play, host-only disc sharing, full-content
progression or separate cameras. Do not advertise feature parity yet.

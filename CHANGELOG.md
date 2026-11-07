# Changelog

All notable changes to this browser wrapper are recorded here. Versions use
semantic versioning and do not refer to the original game or upstream port.

## [Unreleased]

### Interface

- Restored the tabbed launch interface, responsive settings/summary layout,
  PAL cover artwork, keyboard tab navigation and reset action for the emulator.
- Added a focused game stage with invitations, fullscreen and confirmed return
  to the lobby, retaining existing room and native simulation behavior.

### Documentation

- Unified setup, multiplayer, launcher, progression and verification guides
  around the current emulator, with a prominent start/invite/stop walkthrough.
- Simplified README navigation and separated component notices from play instructions.
- Audited all project guides against runtime code, corrected invitation encoding
  and launch-setting behavior, completed local diagnostic steps, and added a
  documentation index plus context for preserved upstream license texts.

## [0.3.0] - 2026-11-07

### Added

- Added a reproducible PCSX-ReARMed / RetroArch native build with true
  console-step gating, exact source pins and SHA-256 output manifests.
- Connected invitation rooms, four controller seats, strict state checks and
  deterministic late-join replay to the browser emulator. Verified independent
  controller input in a four-browser race, agreement at 19,500 core steps,
  and a third client catching up in the earlier boundary test.
- Added compact controller history, muted accelerated replay and uncompressed
  host-disc ZIPs to reduce history memory and repeated extraction overhead.
- Added source-audited state canonicalization and focused protocol/core tests.
  Snapshot joining remains experimental and disabled after timer restoration
  differences were found; supported joining replays history from boot.
- Added experimental per-player full-camera GPU replay for two to four racers,
  including the PAL divider bounds and the original single-player HUD/atlas.
  The local HUD uses isolated interpreter execution with event dispatch frozen;
  CPU registers, RAM, instruction cache and canonical GPU state are restored.
  Added full-state presentation qualification and partial-failure isolation tests.
- Added the PAL unlock preset and launch controls for progress, image filtering,
  volume and camera presentation; invitation links inherit shared settings.
- Added emulator local-file mode, per-track content identity and blocked host
  disc routes alongside authenticated host-disc mode.
- Corrected the pinned core's Multitap option to `pcsx_rearmed_multitap =
  "port 1"` and verified all four native controllers.
- Preserved private access paths when guests reshare invitations. Added a local
  host launcher that publishes HTTPS invitations without downloading its own
  disc through Cloudflare, plus explicit replay/waiting status.
- Preserved original vendor assets and persistent single-player memory cards.
  Added a loopback-only diagnostic snapshot and camera laboratory.
- Documented current limits: separate physical devices,
  audible soundtrack quality and broad course coverage remain unqualified.

### Changed

- The default tunnel helper now uses the emulator and shared host disc.
  The previous runtime is available via `--engine recompiled`.
- Rewrote the primary README/setup flow around the emulator; retained earlier
  build and rendering documentation as explicitly marked legacy guides.

## [0.2.0] - 2026-11-06

### Added

- Explicit **Host disc** mode: `python3 tools/play-online.py --disc-mode shared`.
  One CUE/BIN set on the host is sufficient; other browsers start/join without
  choosing files. The protected gateway serves authenticated, bounded extents.
- Explicit **Local files** mode via `--disc-mode local`, preserving the default
  requirement for each browser to provide matching files and blocking host reads.
- Mode-aware file status, launch hints and host-disc transfer progress during
  startup; gateway authorization/range tests and
  real HTTP-handler tests using synthetic disc tracks.

### Changed

- Full-file and HEAD disc requests are refused by the development server;
  shared requests validate track index, query parameters, bounds and a 4 MiB cap.
- Guests retain the gateway access path in copied invitations after redirects.
- Updated setup/hosting documentation explains both modes and that Cloudflare
  also works for two computers on the same Wi-Fi, without being an offline LAN.


## [0.1.0] - 2026-11-06

### Added

- WebAssembly integration for the pinned PAL SLES-02194 recompilation and
  project-local bootstrap/build tooling.
- Browser multiplayer for up to four controller slots, independent room links,
  deterministic input history catch-up and content/state checks.
- Two-player WebGL2 personal cameras, original single-player HUD proportions,
  and original 4:3 pause/options presentation.
- English launch settings for graphics, audio, controls, fullscreen, local disc
  selection and an optional all-content progression preset.
- Private disc-free gateway and a one-command Cloudflare Quick Tunnel helper:
  `python3 tools/play-online.py`.
- PAL SLES-02194 README cover scan, with source and separate artwork attribution.
- Detailed setup, hosting, friend invitation, troubleshooting and verification
  guides; upstream source pins and preserved third-party notices.
- MIT licensing for original contributions, Copyright (c) 2026 Vacho Aivazov.

### Qualification

- Automated adapter/transport checks and a clean-source build passed on macOS.
- Local two-player gameplay was checked; three/four-player presentation retains
  the original split layout. Four independent cameras are not implemented.
- A live Cloudflare endpoint passed private HTTPS access, file blocking,
  synthetic two-client WSS synchronization and one real browser host boot.
- A real two-device internet race still requires participant testing; endpoint
  checks do not establish multiplayer latency/reliability.
- Disc images, saves, downloaded upstream sources, compiled output and private
  access/session links are excluded from the Git repository.

[Unreleased]: https://github.com/watscho/sledstorm-browser/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/watscho/sledstorm-browser/tree/v0.3.0
[0.2.0]: https://github.com/watscho/sledstorm-browser/tree/v0.2.0
[0.1.0]: https://github.com/watscho/sledstorm-browser/tree/v0.1.0

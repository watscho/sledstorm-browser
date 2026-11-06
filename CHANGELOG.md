# Changelog

All notable changes to this browser wrapper are recorded here. Versions use
semantic versioning and do not refer to the original game or upstream port.

## [Unreleased]

### Performance investigation (unreleased, not a complete stutter fix)

- Buffered controller rows and cached/MEMFS reads no longer unwind Wasm through
  Asyncify. Real network waits and disc misses remain asynchronous; controller
  ordering, replay history and digest phase are unchanged.
- One 16 MiB retained LRU disc cache across tracks replaces last-block-only
  caching. Remote requests use at most 4 MiB per block, coalesce in-flight reads,
  and retry failed/short reads without caching incomplete data.
- Standard WebAssembly SIMD is available as a default-off experiment; it did
  not establish a menu speedup and is not presented as a stutter fix.
- Catch-up discards host audio history while preserving guest SPU advancement;
  audio fill/underrun metrics and optional native diagnostics aid investigation.
- Fresh settings use 1× resolution. Explicit/saved 2× settings remain supported.
- Added live simulation-rate, network-wait, disc-request/cache and background-tab
  counters, plus real Wasm bridge regression tests and performance evidence.


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

[Unreleased]: https://github.com/watscho/sledstorm-browser/compare/v0.2.0...research/performance-baseline
[0.2.0]: https://github.com/watscho/sledstorm-browser/tree/v0.2.0
[0.1.0]: https://github.com/watscho/sledstorm-browser/tree/v0.1.0

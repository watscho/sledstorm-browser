# Changelog

All notable changes to this browser wrapper are recorded here. Versions use
semantic versioning and do not refer to the original game or upstream port.

## [Unreleased]

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

[Unreleased]: https://github.com/watscho/sledstorm-browser/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/watscho/sledstorm-browser/tree/v0.1.0

# Documentation

## Start here

| Guide | What you will find |
| --- | --- |
| [Quick start](../README.md#-start-invite-stop) | One-time setup, one-command launch, invitations and shutdown. |
| [Installation and troubleshooting](setup.md) | Prerequisites, disc layout, local play, updates and common errors. |
| [Playing with friends](multiplayer.md) | Host/guest steps, original multiplayer menus, disc modes and room lifetime. |
| [Launcher settings](browser-lobby.md) | What each setting does, which settings guests inherit and when to choose them. |
| [All-content preset](unlocked-profile.md) | Unlock behavior and the guarded PAL memory fields. |

## Development and reference

| Guide | What you will find |
| --- | --- |
| [Emulator architecture](browser-emulator.md) | RetroArch Netplay, camera/HUD isolation, local diagnostics and source pins. |
| [Verification](verification.md) | v0.6.0 camera, Cloudflare and controller recovery results, current limits and previous release checks. |
| [Contributing](../CONTRIBUTING.md) | Source conventions, checks and versioning. |
| [Third-party notices](../THIRD_PARTY_NOTICES.md) | Component attribution and license boundaries. |
| [Preserved license texts](licenses/README.md) | Scope and origin of the upstream files in `licenses/`. |
| [Changelog](../CHANGELOG.md) | Release history. |

Play instructions describe the browser emulator on port **8000**. The normal
internet command is `python3 tools/play-online.py --dedicated`. Press **Ctrl+C** in that
terminal to stop everything the helper started.

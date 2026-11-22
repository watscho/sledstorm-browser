# Documentation

## Play or host

| Guide | Use it for |
| --- | --- |
| [Devices and browsers](platforms.md) | Choose a setup on Apple Silicon, Intel Mac, Windows or Linux. |
| [Playing with friends](multiplayer.md) | Join, pick game data, start a race and reconnect. |
| [Controls, graphics and saves](browser-lobby.md) | Configure your player and manage checkpoints. |
| [Sled Storm Server app](sled-storm-server.md) | Open the macOS preview, start and stop a room, diagnose problems and replace the app. |
| [Python source setup](setup.md) | Install dependencies, build the emulator and run from the terminal. |

## Maintain or release

| Reference | Use it for |
| --- | --- |
| [Release checklist and verification](verification.md) | Find the current candidate, results, open checks, package commands and signing workflow. |
| [Emulator and networking architecture](browser-emulator.md) | Trace the runtime, Netplay, rendering, game-data delivery and saves. |
| [PAL progression preset](unlocked-profile.md) | Look up the audited memory fields and write guards. |
| [Contributing](../CONTRIBUTING.md) | Run checks and prepare changes. |
| [Changelog](../CHANGELOG.md) | Review version history. |
| [Third-party notices](../THIRD_PARTY_NOTICES.md) | Review license terms, source pins and bundled notices. |

## Engineering history

Completed P0–P5 work and earlier P6 notes are preserved in Git at
`a54e3880cccd2720dc724256536590a767ae0f61`. Start with the current
[release checklist](verification.md#release-checklist) for outstanding work.

```sh
git show a54e388:docs/sea-server-plan.md
git ls-tree -r --name-only a54e388 docs/superpowers/plans/
git show a54e388:docs/superpowers/plans/2026-11-22-p6-release-package.md
git show a54e388:docs/verification.md
```

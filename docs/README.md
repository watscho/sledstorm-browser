# Documentation

[Version 1.1.0](../README.md#version-110)
 · [Current verification summary](verification.md#110-verification-summary)

## Start here

| Guide | What you will find |
| --- | --- |
| [Devices, browsers and hosting options](platforms.md) | How to join, when to use the Apple Silicon app, and what to expect on Intel Mac, Linux and Windows. |
| [Sled Storm Server preview](sled-storm-server.md#first-run) | Open the packaged app, prepare the game folder, invite players and manage the room. |
| [Python quick start](../README.md#-start-invite-stop) | One-time source setup, one-command launch, invitations and shutdown. |
| [Installation and troubleshooting](setup.md) | Prerequisites, disc layout, local play, updates and common errors. |
| [Playing with friends](multiplayer.md) | Host/guest steps, original multiplayer menus, disc modes and room lifetime. |
| [Launcher settings](browser-lobby.md) | Graphics presets, diagnostics, controls, save slots and portable backups. |
| [All-content preset](unlocked-profile.md) | Unlock behavior and the guarded PAL memory fields. |

## Development and reference

| Guide | What you will find |
| --- | --- |
| [Emulator architecture](browser-emulator.md) | RetroArch Netplay, camera/HUD isolation, local diagnostics and source pins. |
| [Verification](verification.md) | Current results, known limits and the development test record. |
| [macOS preview packaging](sled-storm-server.md#build-it) | Build the app and ZIP, then sign and notarize a release candidate. |
| [Contributing](../CONTRIBUTING.md) | Source conventions, checks and versioning. |
| [Third-party notices](../THIRD_PARTY_NOTICES.md) | Component attribution and license boundaries. |
| [Preserved license texts](licenses/README.md) | Scope and origin of the upstream files in `licenses/`. |
| [Changelog](../CHANGELOG.md) | Release changes and development history. |

## Release work and engineering history

| Document | When to use it |
| --- | --- |
| [P6 release qualification](superpowers/plans/2026-11-22-p6-release-package.md) | Active checklist for signing, clean-Mac installation and remaining browser, network and gameplay checks. |
| [Node SEA implementation record](sea-server-plan.md) | Look up architecture decisions, acceptance criteria and the evidence behind changes. |
| [P0–P5 stage plans](superpowers/plans/) | Historical plans for completed work. Consult them when investigating a regression or revisiting a design decision. |

Start ongoing release work from the P6 checklist. Use the verification summary
when checking a current platform or workflow. The implementation record and
completed stage plans preserve the background for maintainers.

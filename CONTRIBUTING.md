# Contributing

Keep repository-owned UI, comments and documentation in English. Keep game
images, BIOS, cards, downloaded sources, generated output and private links out
of Git. Follow [the emulator guide](docs/browser-emulator.md) for the
runtime and [third-party notices](THIRD_PARTY_NOTICES.md) for license boundaries.

The native build pins PCSX-ReARMed, RetroArch and Emscripten. Make source changes
through the anchor-checked `tools/prepare-emulator-native.py` transformation and
our original adapters under `research/emulator/`. Patched checkouts and binaries
belong under `.cache/`; original vendor assets remain unchanged. Updating a pin
requires reauditing the serialization format, native anchors, memory ownership,
controller options and gameplay.

## Checks

Without a game disc or compiler:

```sh
npm ci --prefix research/network
node --test web/*.test.mjs
npm test --prefix research/network
python3 tools/test-emulator-server.py
python3 -m py_compile server.py tools/build-emulator.py tools/play-online.py
```

After building the pinned native emulator, with a local C compiler:

```sh
python3 tools/test-emulator-view.py
```

The HTTP and protocol tests use synthetic data and need loopback socket access.
Native presentation tests cover viewport bounds, canonical GPU/VRAM preservation,
interpreter register/RAM restoration and partial UI-call failure. They do not
replace actual game or internet verification.

Gameplay changes require matching clients through the affected race modes and
player counts, independent controller input, original menu proportions and state
agreement. Dedicated-room changes also require checking creator departure,
returning to a reserved controller during a race and replacing a saved
controller assignment in the lobby.
Presentation changes also need full-state before/after checks. Add
`?dev=1` for loopback diagnostics or `?verifyView=1` for sampled isolation checks.
Do not weaken checksums to accommodate unexplained divergence. Record exact
scope and limits in [the verification record](docs/verification.md).

## Before a commit

Review `git diff --cached` and `git status --ignored`. Do not stage game-derived
artifacts, user-specific absolute paths, secrets, tunnel capabilities or room
invitations. Fetch dependencies through bootstrap rather than copying source or
nested Git repositories into the project. Preserve upstream notices and keep
original contribution licensing separate from derived output.

## Versions and changelog

Use semantic versions for this wrapper, independently of the game and upstream
components. Bump the wrapper version before publishing a development build or
pushing to `main`, including documentation changes. Keep `VERSION`,
`research/network/package.json` and its lockfile
root/package versions in sync with the release labels in `README.md` and
`web/index.html`, including the launcher script's version parameter. Record
changes in `CHANGELOG.md` with an ISO date and use Unreleased while working.
Never record private tunnel domains,
access tokens, disc paths or invitation fragments. Distinguish an internet-path
check on one computer from a test with players on separate remote computers.

For a release, run the documented checks, update the current verification
summary with the actual scope, and review the staged file list. Tag the exact
release commit as `vMAJOR.MINOR.PATCH` and publish matching GitHub release notes.
The 1.0.0 source release is a regular release, without a prerelease marker.
Release archives must exclude game data, private links, generated emulator
binaries and local browser automation output. Preserve historical changelog
and verification entries when updating current guides.

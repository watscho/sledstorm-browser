# Contributing

Keep repository-owned UI, comments and documentation in English. Keep game
images, BIOS, cards, downloaded sources, generated output and private links out
of Git. Follow [the emulator guide](docs/browser-emulator.md) for the default
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
agreement. Presentation changes also need full-state before/after checks; add
`?dev=1` for loopback diagnostics or `?verifyView=1` for sampled isolation checks.
Do not weaken checksums to accommodate unexplained divergence. Record exact
scope and limits in [the verification record](docs/browser-emulator.md).

## Retained recompiled target

Its adapters live under `research/wasm/`, with audited transformations in
`tools/prepare-browser-main.py`. Its original dependency/build instructions are
in [the legacy setup guide](docs/setup.md). For changes affecting that target,
run its focused checks and `sh tools/check-port.sh`; C/C++ changes also require
`sh tools/build-port-web.sh`. Run its tunnel with `--engine recompiled`.

## Before a commit

Review `git diff --cached` and `git status --ignored`. Do not stage game-derived
artifacts, user-specific absolute paths, secrets, tunnel capabilities or room
invitations. Fetch dependencies through bootstrap rather than copying source or
nested Git repositories into the project. Preserve upstream notices and keep
original contribution licensing separate from derived output.

## Versions and changelog

Use semantic versions for this wrapper, independently of the game and upstream
components. Keep `VERSION`, `research/network/package.json` and its lockfile
root/package versions in sync. Record changes in `CHANGELOG.md` with an ISO
release date; use Unreleased while working. Never record private tunnel domains,
access tokens, disc paths or invitation fragments. Distinguish an internet-path
check on one computer from a test with players on separate remote computers.

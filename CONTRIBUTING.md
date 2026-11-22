# Contributing

Keep project-owned UI, comments and documentation in English. Keep game
images, BIOS files, snapshots, generated binaries, toolchain downloads and
private invitations out of Git. Preserve notices and source attribution.
See the [architecture](docs/browser-emulator.md) and
[third-party notices](THIRD_PARTY_NOTICES.md).

Make native changes through `tools/prepare-emulator-native.py` and the
original adapters under `research/emulator/`. Update source pins only
with the relevant state-format, RAM, rendering and controller checks.

## Run checks

Install dependencies before using the aggregate verifier. Tests that launch
the HTTP or relay fixtures need loopback socket access.

```sh
npm ci --prefix research/network
npm ci --prefix server
npm run verify --prefix server -- --quick
```

On Apple Silicon macOS, run the full verifier for packaged build and smoke
coverage:

```sh
npm run verify --prefix server
```

| Change | Additional check |
| --- | --- |
| Native presentation | After building the pinned emulator, run `python3 tools/test-emulator-view.py`. Exercise viewports, menu transitions and canonical-state isolation. |
| Save library | Run `node tools/serve-save-checks.mjs` and use **Run storage checks** and **Open sample library** in its loopback page. This fixture uses synthetic saves. |
| Real dedicated room | Give the local invitation to `node server/scripts/room-player.mjs <link> 60`. Exercise live room lifecycle and any affected controller, save or race behavior. |
| Network or performance | Record the OS, browser, device count, topology, disc policy and actual scope in [verification](docs/verification.md). Measure console steps, browser pacing and input latency separately. |

For gameplay and presentation changes, verify matching clients and
independent controller input through the affected race modes and counts.
For reconnect changes, check creator departure, reservation during a
race and replacement of a saved controller assignment in the lobby.
Investigate unexplained differences before changing checksums.

## Prepare a release

Review `git diff --cached` and `git status --ignored`. Keep wrapper versions
in sync across `VERSION`, `server/` and `research/network/` package and
lockfiles, the README and `web/index.html`. Use **Unreleased** in the
[Changelog](CHANGELOG.md) until versioning the release. Keep prior entries
for version history.

Follow the [release checklist](docs/verification.md#release-checklist),
record the exact tested commit and archive digest, and review assets and
notices before publishing. Release a tag and archive from the same
revision.

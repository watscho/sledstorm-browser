# Contributing

Keep repository-owned UI text, comments and documentation in English. Keep game
images, memory cards, downloaded upstream sources and generated runtime output
out of Git. Follow [setup](docs/setup.md) for pinned dependencies and build tools.
Do not modify the native checkout for browser-only changes: add an audited,
anchor-checked transformation in `tools/prepare-browser-main.py` or a separate
adapter under `research/wasm/`. Updating an upstream pin requires revalidating
those anchors, framework patches, build and gameplay.

## Checks

Fast JavaScript tests, without a game disc or compiler:

```sh
npm ci --prefix research/network
npm test --prefix research/network
node --test research/wasm/launch-settings.test.mjs
python3 -m py_compile tools/bootstrap.py research/serve_port.py
```

After bootstrap and disc setup, run the bounded integration suite:

```sh
sh tools/check-port.sh
```

It checks browser JS syntax/settings, PAL camera assumptions, real Wasm fibers,
disc filesystem extents, pixel conversion, HUD behavior, SIO/Multitap, progression,
preferences, the actual GPU IRQ parser and relay/gateway/client behavior.
It is not a replacement for browser race testing or internet qualification.

For C/C++ integration changes also run `sh tools/build-port-web.sh`. When testing
browser changes, inspect the local launch page at desktop and narrow widths;
verify keyboard focus, settings persistence, start and shared invitation flow.
Gameplay changes need two clients with matching state through a race, both
pause menus, and the affected renderer/player counts. Report the exact scope
and limitations in [verification.md](docs/verification.md).

## Before a commit

Review `git diff --cached` and `git status --ignored`. No game-derived artifacts,
local absolute paths, passwords, gateway paths or session invitations should be
staged. Source dependencies are fetched by bootstrap; do not add them as copied
source or accidental nested Git repositories. Preserve upstream notices and
keep original contribution licensing separate from derived output.

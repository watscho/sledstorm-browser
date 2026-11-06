# Sled Storm Browser

An experimental browser wrapper for the **PlayStation Sled Storm (1999), PAL
SLES-02194** static recompilation. Start a game, copy its invitation, and friends
join the same simulated console as additional controllers. Separate invitations
create separate sessions. Up to four browsers can connect to one room.

The browser version builds on [PeriBluGaming/SledStormPSXRecomp](https://github.com/PeriBluGaming/SledStormPSXRecomp)
and [mstan/psxrecomp](https://github.com/mstan/psxrecomp). Our additions include
WebAssembly integration, the English launch/settings interface, local disc
loading, WebSocket controller synchronization, and two-player camera/HUD work.
See [attribution and licenses](THIRD_PARTY_NOTICES.md) for exact sources and pins.
This project is not affiliated with Electronic Arts or the upstream authors.

## Quick start

Prerequisites: macOS or Linux, Python 3.10+ with pip, Git, Bash, Node.js 22+ with
npm, a desktop browser with WebAssembly and WebGL2, and your own compatible
CUE/BIN disc files. Development has been verified on macOS; Linux setup is not
qualified yet. The first setup downloads a compiler SDK and source dependencies.

From a fresh clone:

```sh
python3 tools/bootstrap.py
# Put your PAL SLES-02194 CUE and all 11 referenced BIN tracks in game/.
sh tools/build-port-web.sh
python3 research/serve_port.py
```

Open [the local launcher](http://127.0.0.1:8001/), choose technical settings, and
press **Start game**. It creates a session immediately and displays an invitation
under **Invite friends**. Game mode, riders, sleds and tracks are selected in the
original game menus. The default keyboard uses arrows, **X** to confirm or
accelerate, and **Enter** for Start; inspect **Controls** for the full mapping.

A `127.0.0.1` invitation only works on the host computer. For friends on the
internet, follow the [multiplayer hosting guide](docs/multiplayer.md), including
the private gateway and HTTPS setup. Each friend supplies matching local disc
files. Internet play across separate devices is not yet verified.

## Guides

- [Installation, build, local launch and troubleshooting](docs/setup.md)
- [Playing with friends: hosting, links and native game flow](docs/multiplayer.md)
- [Launch settings, networking and rendering internals](docs/browser-lobby.md)
- [All-content preset and original progression](docs/unlocked-profile.md)
- [Verification record and known limitations](docs/verification.md)
- [Upstream provenance and license boundaries](THIRD_PARTY_NOTICES.md)
- [Contributing and checks](CONTRIBUTING.md)

## Current behavior

Two-player WebGL2 races use a separate full view and the original single-player
HUD for each player. Pause/options menus return to their original 4:3
presentation. Software rendering and three/four-player races retain the
original split-screen layout; four independent cameras are not implemented.

Rooms use deterministic controller-history replay and frame synchronization.
Joining late can take time, and the slowest peer can hold up the room. There is
no rollback, host migration, durable room storage, matchmaking or voice chat.
The all-content preset unlocks selection/progression in memory; it does not edit
your disc or memory cards, and does not fabricate race records.

## Repository contents and licensing

Our original contributions are under the [MIT license](LICENSE). Third-party
code and derivative runtime output retain their own terms, including PolyForm
Noncommercial for the upstream port/framework. MIT does not cover the original
game, generated game code, disc data, or all parts of the compiled runtime.
Read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before redistributing a build.

Disc images, memory cards, generated game sources, downloaded dependencies and
compiled JS/Wasm are excluded from Git. No game download is provided. Supplying
a local image does not by itself establish permission to redistribute or host
game-derived code; the wrapper license grants no rights in Sled Storm.

The earlier EmulatorJS launcher remains in `server.py` and `web/` for historical
reference. It needs separately installed files under `vendor/emulatorjs`, is not
installed by bootstrap, and does not implement this multiplayer flow.

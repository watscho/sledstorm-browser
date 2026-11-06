# Installation and local play

> Legacy recompiled target. For the default v0.3.0 emulator, follow the
> [browser emulator guide](browser-emulator.md). Run the older tunnel helper
> with `--engine recompiled` explicitly.

## Requirements

- macOS or Linux, Bash, Git, Python 3.10+ with pip, Node.js 22+ and npm.
- A desktop browser with WebAssembly and WebGL2. Software rendering is an
  alternative inside the launcher; mobile and physical controllers are unverified.
- Several GB of free disk space and memory for the SDK, sources and compilation.
- A compatible PAL SLES-02194 disc in CUE/BIN format with all 11 BIN tracks.
  Other regions, a standalone ISO, CHD and the PS2 game are unsupported here.

The development environment used macOS, Python 3.12.2 and Node.js 24.13.0.
Windows users may experiment with WSL; that environment has not been verified.

## Fetch and build

Clone this repository into a directory you own, then run from its root:

```sh
python3 tools/bootstrap.py
sh tools/build-port-web.sh
```

Bootstrap fetches the exact commits in [upstream.lock.json](../upstream.lock.json)
into ignored `research/port/`, `research/port/psxrecomp/` and `.cache/emsdk/`, applies
only the port's supplied framework patches, installs Emscripten 6.0.13,
project-local CMake/Ninja/Capstone, and runs `npm ci` for the WebSocket relay.
It does not install global Python packages or change your shell profile.
Do not run recursive submodule initialization: optional native UI/network
submodules are unnecessary for this browser build.

The build uses Emscripten SDL2/zlib ports and psxrecomp's checksummed libwebp
archive. Network access is required on the first build. Sources prepared by
`tools/prepare-browser-main.py` go to `.cache/browser-source/`; the upstream
checkout is not rewritten by browser integration. The separate upstream
framework patch step intentionally patches the framework checkout.

Output is `.cache/build-web/port/SledStorm_Recompiled.js` and `.wasm`. Rebuild
after changing C/C++ or build settings. HTML/CSS/browser JS are served directly.
Never launch a client while a build is replacing the JS/Wasm pair.

For source-only inspection, run `python3 tools/bootstrap.py --sources-only`.
`python3 tools/bootstrap.py --check` checks checkout pins/tool presence without
modifying files; it does not certify that framework patches or runtime tests
pass. Bootstrap refuses to overwrite a different checkout or an unversioned
source snapshot. Preserve existing work and use a fresh clone in that case.

## Provide your disc

Create `game/` and place exactly one CUE and every BIN named by it in that folder.
The current PAL layout uses 11 BIN tracks. Preserve the original filenames and
CUE references. Do not commit these files. No conversion or game download is
performed by the setup scripts.

An external disc folder can be selected instead:

```sh
SLEDSTORM_DISC_DIR="/absolute/path/to/disc-folder" python3 research/serve_port.py
```

Without this variable the server checks `game/`, then a single CUE in a direct
child folder for compatibility with older workspaces. Ambiguous CUEs are rejected.
The server needs its own compatible disc to generate the manifest and content
identity, even when remote clients select local files.

## Start and play

```sh
python3 research/serve_port.py
```

Open [http://127.0.0.1:8001/](http://127.0.0.1:8001/). The server automatically
starts the Node relay on `127.0.0.1:8002` if needed. Keep this terminal open.
At this local address the browser can use the server's disc; the **Game files**
tab also allows selecting the CUE and all BIN files from your own computer.
The private gateway supports two disc modes. Use
`python3 tools/play-online.py --engine recompiled --disc-mode shared` for one host disc with no file
selection on other computers. Use `--disc-mode local` (the default) to require
local files on every client. Both use the same HTTPS session-link workflow.

Choose progress, graphics, audio, fullscreen and keyboard options before
**Start game**. Settings persist in this browser. An invitation appears after
launch; the creator's shared settings travel with it. Native game choices stay
in the original menus. See [multiplayer.md](multiplayer.md) for the race flow.

Stop the Python server with **Ctrl+C**. It terminates the relay it started.
If a relay was already running independently, stop it in its own terminal.
Stop a separately started gateway or HTTPS proxy in its terminal too.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Missing SDK/CMake/Ninja | Run bootstrap in a fresh clone; check network and pip availability. |
| Existing non-Git snapshot | Keep that workspace intact; bootstrap in a separate fresh clone. Existing configured workspaces can still run the build directly. |
| Missing/ambiguous CUE | Set `SLEDSTORM_DISC_DIR` explicitly; keep one CUE and every referenced BIN together. |
| Missing BIN / identity mismatch | Select all tracks, preserve names, and use the same PAL revision and shared build as the host. |
| Blank page or missing game.js | Finish the build, inspect the terminal error, then reload. |
| WebGL initialization failure | Try software rendering and reload; the original split view is expected there. |
| Port already in use | Stop the previous server/relay/gateway in its terminal before restarting. |
| Friend opens a different room | Copy the complete invitation including `#session=...`, not the bare launcher URL. |
| Client waits or catches up | Keep all peers running, invite before the race, and avoid suspended/background tabs. |
| Gamepad not detected | Press a button to activate the browser Gamepad API, inspect Controls, or use keyboard. Physical pads remain unverified. |

For verification commands and current qualification limits, see
[CONTRIBUTING.md](../CONTRIBUTING.md) and [verification.md](verification.md).

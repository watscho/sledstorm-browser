# Python source setup

Use this workflow to build and host from a checkout. For the packaged
Apple Silicon preview, use the [app guide](sled-storm-server.md).
[Device compatibility](platforms.md) describes the tested paths.

## Requirements

Install Python 3.10+, Git, Bash, make, Node.js 22+ with npm, and
bsdtar/libarchive (`tar` on macOS). The project uses Node.js 24 in
`.nvmrc`. Dedicated hosting needs Chrome or Chromium on the host;
internet hosting also needs
[`cloudflared`](https://github.com/cloudflare/cloudflared#installing-cloudflared).
Allow several GB of disk space for tools, the emulator and the disc.

The verified source runs used Apple Silicon macOS. Intel Mac and Linux
source hosting still need qualification. Windows/WSL hosting remains open.

## One-time setup

Run `python3 --version` before setup. Use the path to a supported Python
if your shell selects an older system interpreter.

```sh
git clone https://github.com/watscho/sledstorm-browser.git
cd sledstorm-browser
python3 tools/bootstrap-emulator.py
python3 tools/build-emulator.py
mkdir -p game
```

Bootstrap verifies the pinned EmulatorJS assets. The build fetches and
prepares pinned PCSX-ReARMed, RetroArch and Emscripten sources, then compiles
the native adapter. Downloaded inputs and built output live in `.cache/`
and `vendor/`. For the optional WebGL 2 race renderer, run
`python3 tools/prepare-hardware-preview.py` after the build.

## Add the game files

Use a lawfully obtained **Sled Storm (Europe) (En,Fr,De,Es)** PlayStation
disc image, PAL **SLES-02194**. Put one CUE and all eleven BIN tracks in
the same `game/` folder. Keep the filenames and CUE references aligned.
The verified data track is Track 01, MODE2/2352, SHA-1
`c5506c3eb3601d68d11f2c8754e03a6b06be5f2d`.

The launcher rejects ambiguous CUE sets. The verified PAL disc enables the
personal camera and progression hooks. Standalone ISO/CHD, other regions
and the PS2 release are outside this setup.

## Start and stop

| Scenario | Command |
| --- | --- |
| Dedicated, with an internet invitation | `python3 tools/play-online.py` |
| Dedicated, on the host computer | `python3 server.py` |
| Browser-hosted, with an internet invitation | `python3 tools/play-online.py --browser-hosted` |
| Browser-hosted, on the host computer | `python3 server.py --browser-hosted` |

For internet play, wait for **Host launcher**, open
[the local launcher](http://127.0.0.1:8000/), choose **Start game** and
**Copy invite link**. Share the complete HTTPS invitation. For local play,
open the same local launcher. Keep the terminal open and the host awake.
Stop hosting with **Ctrl+C** and wait for the owned processes to close.

In shared-disc mode, the first start builds `.cache/disc.zip` and records
the disc identity. Later starts can reuse the archive. Only share files
that you are authorized to distribute. [Joining and racing](multiplayer.md)

### Each player supplies local files

Run `python3 tools/play-online.py --disc-mode local` for an internet room
or `python3 server.py --disc-mode local` for play on the host computer.
The host can run this mode without a server game folder. Each player selects
the matching files in their browser, and the creator's browser runs the
room. Keep that tab open during play.

## Upgrade an existing installation

Stop the launcher and update the checkout you intend to run. When
upgrading from 1.0.0 or 1.1.0 to 1.2.0, reuse the pinned emulator build.
For older installations or changes to the emulator or adapter, rerun
bootstrap and the native build.
Regenerate the optional hardware renderer if you use it.

Restart hosting, reload the browser pages and share the new invitation.
Checkpoints at the same browser address migrate in place. Export a
`.sledsave` before changing browsers or addresses.

## Troubleshooting

- **Missing track or ambiguous CUE.** Check the references in the CUE and
  keep one complete disc set in the game folder.
- **Chrome cannot be found.** Set `SLED_CHROME_BIN` to the executable path,
  or choose browser-hosted mode. Check `CLOUDFLARED_BIN` for tunnel lookup.
- **Port already in use.** Stop the other launcher or preview before
  restarting. By default the runtime uses 8000, legacy relay 8004, gateway
  8005 and RetroArch relay 8006 in the internet helper.
- **Tunnel cannot connect.** Check the host's internet connection and
  `cloudflared`. The Python helper can use
  `TUNNEL_TRANSPORT_PROTOCOL=http2` for the primary connector.
- **Slow game or failed sync.** Open [Performance](browser-lobby.md#diagnostics),
  try **Balanced** or **Performance**, and confirm that all players use
  matching game data.

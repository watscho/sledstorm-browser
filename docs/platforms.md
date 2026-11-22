# Devices and browsers

The **host** starts the room and sends an invitation. Every **player** opens
the invitation in a desktop browser. A group can use one Apple Silicon Mac
to host and a mix of desktop devices to play.

| Device | Play in a browser | Host a room |
| --- | --- | --- |
| Apple Silicon Mac (M1 or later) | Use the invitation in a compatible desktop browser. | [macOS app preview](sled-storm-server.md#first-run) with a declared minimum of macOS 15, or [build and launch from source](setup.md). |
| Intel Mac | Use the invitation in a compatible desktop browser. | [Try the Python source workflow](setup.md). Intel hosting qualification is open. |
| Linux desktop | Use the invitation in a compatible desktop browser. | [Try the Python source workflow](setup.md). Linux hosting qualification is open. |
| Windows desktop | Use the invitation in a compatible desktop browser. | Join a room hosted elsewhere. Native Windows hosting and WSL remain outside the verified setup. |
| Phone, tablet or Chromebook | Mobile and Chromebook coverage remains open. Use a desktop setup for a planned multiplayer session. | These devices are outside the hosting matrix. |

## Browser and hardware

- Use a desktop browser with **WebAssembly SIMD** and **WebGL 2**. Chrome
  on macOS has the broadest gameplay coverage. Safari 27.2 reached LIVE
  with local files, a ZIP and a loopback download in Private Browsing.
  Firefox, broader cross-browser coverage and physical gamepads remain open.
- A modern four-core CPU and 8 GB of RAM are a starting point for a player.
  For a host running a dedicated room and playing on the same computer,
  start with six cores and 16 GB. A source checkout also needs several GB
  for the toolchain, disc and cache. These are estimates.
- Use a stable connection and keep the host awake. Shared downloads use
  host upload bandwidth until each guest has the game data. Choose
  **Balanced** or **Performance** if the game stutters.

## Choose a host workflow

The **app preview** bundles the server, emulator browser and tunnel tool.
Its panel exposes room, disc, player and tunnel status. The room stays
available with the panel closed and the operator can leave every seat to
browser players. Both disc policies support the dedicated room.

The **Python launcher** gives you a source checkout and control over the
emulator build. It uses a terminal and separately installed tools. Its
local-file mode uses the creator's browser to run the room, so keep that tab
open. Use the source workflow for local development or to try a host
architecture outside the packaged preview.

[Join and race](multiplayer.md) · [Exact test coverage](verification.md)

# Where to play and host

**Joining a room only takes a compatible desktop browser and the complete
invitation.** The host is the computer that runs the room. It prepares the
game files and keeps the room available while players connect. Choose a setup
based on what you want to do and which computer will host.

## Choose a setup

| Your device | Join a room | Host a room |
| --- | --- | --- |
| Apple Silicon Mac (M1 or later) | Open the invitation in a compatible desktop browser. | The [macOS app preview](sled-storm-server.md#first-run) runs on macOS 15 or later. The [Python launcher](setup.md) is the established source workflow. |
| Intel Mac | Open the invitation in a compatible desktop browser. | The [Python source workflow](setup.md) is the route to try. Intel-specific hosting qualification is open. |
| Linux desktop | Open the invitation in a compatible desktop browser. | [Build and launch from source](setup.md). Linux hosting qualification is open. |
| Windows desktop | Open the invitation in a compatible desktop browser. | Windows hosting and the WSL source setup remain unqualified. Join a room hosted on another computer. |
| Phone, tablet or Chromebook | Choose a qualified desktop setup for a planned multiplayer session. | These devices are outside the current hosting matrix. |

For a player, use a desktop browser with **WebAssembly SIMD and WebGL 2**.
Chrome on macOS has the broadest gameplay evidence. Safari 27.2 on macOS
reached LIVE in private browsing using CUE/BIN, an existing ZIP and the
loopback download fallback. Firefox, mobile devices and the full browser
matrix across physical devices remain open. See
[verification](verification.md#node-sea-macos-preview-qualification) for
the exact tests and conditions.

## Join a friend

1. Open the complete invitation in your browser. The host shares the online
   HTTPS link. The host's `127.0.0.1` address works on the host computer.
2. In **Game files**, choose the source the room offers. Use your own matching
   PAL CUE and eleven BIN tracks, choose a saved ZIP of those files, or
   download the archive if the host enables sharing. Button names vary with
   the launch path and browser.
3. Choose your graphics and controls, press **Join game**, and wait for
   synchronization. The original game's multiplayer menu is where you
   choose a rider and start a race.

A desktop browser runs the emulator locally. Start with graphics acceleration
enabled. If the game stutters, try **Balanced** or **Performance** and check
the Performance panel. See [race setup](multiplayer.md#start-a-race) and
[browser settings](browser-lobby.md).

## Host with the macOS app preview

Use an Apple Silicon Mac and a locally built or supplied internal preview.
The declared minimum is **macOS 15**. Developer ID signing, notarization,
and installation on a clean Mac are still open.

1. Extract the preview and open **Sled Storm Server.app**.
2. In the browser panel, choose the folder with your
   [PAL SLES-02194 disc files](setup.md#add-the-game-files) and select a disc
   policy.
3. Click **Start server**, then **Copy invite link** when the public address
   is ready. Use **Open game** if you want to play from the host computer.
4. Click **Stop room** to end the session or **Quit server** to stop the app.

The app bundles Node.js, the emulator's headless Chromium and `cloudflared`.
It can keep a dedicated room running with the admin tab closed and zero
players occupying seats. All four controller slots are for browser players,
including the host if they choose to play. The app keeps dedicated hosting
available under either disc policy. Under the sharing policy, downloads
verify each chunk and can resume on the same address when browser storage
is available. See [the preview guide](sled-storm-server.md) for the build,
room controls, diagnostics and replacement steps.

## Host from source

The source workflow is the established launch path on macOS and a candidate
for Linux and Intel Macs. It needs Python, Node.js/npm, Git, build tools and
a game folder. Dedicated hosting also uses Chrome or Chromium, and internet
invitations use `cloudflared`.

1. Follow the [one-time setup](setup.md#one-time-setup) and
   [disc layout](setup.md#add-the-game-files).
2. Run `python3 tools/play-online.py` from the project folder. Open the local
   launcher, start a room and copy its invitation.
3. For play on the host computer, run `python3 server.py` instead.
4. Stop the launcher with **Ctrl+C** in its terminal.

The source workflow gives you control of the checkout and emulator build.
By default it runs a dedicated room with the host disc. In the Python
launcher's `--disc-mode local` mode, every player supplies their CUE/BIN set
and the creator's browser hosts the room. Keep that tab open. See
[Python startup and shutdown](setup.md#start-and-stop) and
[local-file mode](setup.md#each-player-supplies-local-files).

## Game files and connections

Use lawfully obtained copies of **Sled Storm, PlayStation PAL SLES-02194**.
The app and source releases distribute the launcher and emulator components.
Supply the game's CUE sheet and all eleven BIN tracks separately. Enable
sharing only for files you are authorized to distribute.

Use a stable connection and keep the host awake during play. With host
downloads enabled, the host's upload carries the archive to each guest
unless that guest has a matching copy. A saved ZIP is useful when the host
restarts and gets a new Quick Tunnel address. Browser download progress
belongs to its original address. Choose the ZIP again on the new address
to reuse it. [Download and storage details](multiplayer.md#disc-downloads-and-browser-storage)

# Sled Storm Server

The internal macOS preview is a self-contained launcher for Apple Silicon
with a declared minimum of **macOS 15**. It bundles Node.js, Chromium and
`cloudflared`. Single Player runs in your browser. The Multiplayer server
runs a dedicated room with four controller seats for browser players.

Use a locally built or supplied internal `*-preview.zip`. The
[release checklist](verification.md#release-checklist) tracks Developer ID,
notarization and installation on a clean Mac. For Intel or Linux, see
[device options](platforms.md).

## First run

1. Extract the ZIP and open **Sled Storm Server.app**.
2. In **Settings**, choose the folder holding the
   [PAL CUE and eleven BIN tracks](setup.md#add-the-game-files).
3. Choose **Single Player** and click **Play** in your browser. The installed
   app works offline from the first launch. You can also choose CUE/BIN
   files or a ZIP when the game asks for them.
4. For **Multiplayer**, choose a [disc policy](#disc-policy) in **Settings**.
   The game opens in the default browser when the room is ready. Use **Join
   Room** to open it again and **Copy Invite** when the public link is ready.

Closing the window leaves the server running. Open the app again to return
to that server. The control listener stays on loopback. Send players the
private game invitation and keep it within the group.

## Disc policy

| Policy | What guests can use |
| --- | --- |
| **Players use only their own game files** | Matching CUE/BIN or a saved ZIP. The public gateway blocks downloads of the host's disc. |
| **Players may download the game files from this server** | Matching files, a saved ZIP or a host download. Enable it for files you may distribute. |

Either policy keeps the dedicated room available. The emulator on the
host still uses the host's disc. The shared download checks 8 MiB chunks
and can resume at the same address if the browser stores progress.
On a new Quick Tunnel address, select the saved ZIP again. Change the
disc folder, policy or room options while the room is stopped.

## Manage the room

| Control | Effect |
| --- | --- |
| **Start Server** | Prepare the disc, open a room and start the public tunnel. If the tunnel is unavailable, play on the host still works and Start Server can retry the address. |
| **Stop Server** | Close the room and tunnel. Single Player remains available. Starting again creates new links. |
| **Quit server** | Stop the room, tunnel and local game service. The button is beside **Stop Server**. |

When a player is connected or has a reserved controller, the panel asks
for confirmation before interrupting the room. Room options include
progression and separate cameras. With the verified PAL disc, racers
can use their own camera and original HUD.

## Run SEA from the terminal

On Apple Silicon, [prepare the pinned emulator](setup.md#one-time-setup)
and run these commands from the repository root. If you already built the
macOS app from this checkout, the SEA executable is already in `dist/sea/`.

```sh
npm ci --prefix server
npm run build:sea --prefix server
```

Open the browser panel with `./dist/sea/SledStormServer panel`. In the
panel, choose the game folder and disc policy, click **Start Server**,
and copy the invitation when the public address is ready.

To host from the terminal, point `configure` at the folder containing
your PAL CUE and BIN files. This example uses `game/` and asks each
guest to provide their own copy.

```sh
./dist/sea/SledStormServer configure --game-folder "$PWD/game" --disc-policy local-only
./dist/sea/SledStormServer panel
./dist/sea/SledStormServer start
./dist/sea/SledStormServer status
./dist/sea/SledStormServer invitation
```

The `panel` command starts the server in the background. Closing the
terminal or browser tab leaves it running. Click **Quit server** beside
**Stop Server**, or run `./dist/sea/SledStormServer quit`. If you set
`SLED_SERVER_HOME` at launch, use the same value when running `status`
or `quit`. To keep the process in a terminal, use `serve` in place of
`panel`, then run `start` from a second terminal. Press **Ctrl+C** in
the first terminal to shut it down.

## Diagnostics and updates

Run the bundle executable from a terminal to check the status, export the
app's JSON report or open the advanced server panel. Review the report
before sharing. Adjust the example path if the app lives somewhere else.

```sh
"/Applications/Sled Storm Server.app/Contents/MacOS/SledStormServer" status
"/Applications/Sled Storm Server.app/Contents/MacOS/SledStormServer" diagnostics
"/Applications/Sled Storm Server.app/Contents/MacOS/SledStormServer" panel
```

Other commands include `configure --game-folder <folder> --disc-policy
<shared-allowed|local-only>`, `start`, `invitation`, `new-game`, `stop`,
`quit` and `self-test`.
`invitation` prints private links. The CLI asks for `--force` to stop,
quit or start a new game while players occupy seats.

Stop and quit before replacing the app. The app stores its data separately.

| Location | Contents |
| --- | --- |
| `~/Library/Application Support/Sled Storm Server` | Configuration and the live instance record. |
| `~/Library/Caches/Sled Storm Server` | Prepared game-data information and emulator browser profiles. |
| `~/Library/Logs/Sled Storm Server` | Server log. |

Browser checkpoints belong to the browser and game address. Export a
`.sledsave` to back up or move a compatible checkpoint. The local game URL
`http://127.0.0.1:8000/` is also used by the Python workflow.

To remove the preview, quit the server and move its app to the Trash.
Remove the three state folders only if you want to discard settings,
cache and logs. Manage browser saves separately.

## Build it

On Apple Silicon, prepare the pinned emulator using the
[source setup](setup.md#one-time-setup), then run:

```sh
npm ci --prefix server
npm run package:macos --prefix server
npm run package:macos:zip --prefix server
```

The app and ZIP are created under `dist/macos/`. The ZIP command checks
a fresh extraction and prints its SHA-256. See the
[release workflow](verification.md#build-and-sign-a-candidate) for signing,
notarization and qualification.

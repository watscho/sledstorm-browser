# Playing with friends

## Host: start and invite

Complete the [one-time setup](setup.md), add your PAL CUE/BIN files to `game/`,
and install Chrome and `cloudflared` on the host. From the project folder:

```sh
python3 tools/play-online.py
```

1. Wait for **Host launcher** in the terminal.
2. Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/) on the host computer.
3. Choose settings and click **Start game**.
4. Click **Copy invite link** in the session toolbar and send the complete
   invitation to each friend.

The invitation automatically uses the private HTTPS tunnel address. The host
reads its disc locally. For online invitations, start the tunnel with the command above. The copy
button reports when the tunnel is unavailable.
Keep the terminal open and the computer awake.
No router port forwarding is needed.

## Friend: join

1. Open the complete invitation in a desktop browser.
2. Choose your own [display, audio and controls](browser-lobby.md) before joining.
   The invitation supplies the room's progression and camera mode.
3. Click **Join game**. The launcher checks the invitation, shows disc download
   progress and then synchronizes the game.
4. Click the game to focus keyboard input.

The default mode uses the host's disc. Friends can join without installing tools
or selecting files. If the host chose `--disc-mode local`, every player selects
their own matching CUE and all eleven BIN tracks before joining. Dedicated
rooms use the built-in BIOS. In browser-hosted rooms, everyone must use
the same BIOS file or leave it empty for HLE.

## Disc downloads and browser storage

The full disc includes all music tracks. On a permanent HTTPS hostname or
localhost, **Keep game data** is on by default where supported.
The browser reuses its copy when the disc fingerprint matches.

With a temporary Quick Tunnel in Chrome, **Keep or choose game data** is checked
by default. Press **Join game** to see the available sources:

- **Use existing ZIP** opens an individual archive, including one in Downloads.
  The launcher verifies it and shows **Game data found**. Press **Join game**
  again to play. Select that ZIP again on a new tunnel address.
- **Save a ZIP and join** opens the system save dialog. The launcher downloads
  the archive, writes it to the selected file and joins the room.

Choose **Join without saving** or uncheck **Keep or choose game data** to use a
download for the current session. ZIPs selected with **Use existing ZIP** remain
available for future sessions.
See [Hosting details](#hosting-details) and
[Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/)
for permanent hostnames.

Copies saved by earlier builds on temporary addresses can still occupy disk
space. In Chrome, open `chrome://settings/content/all`, search for
`trycloudflare.com`, and remove site data for old game addresses. This removes
their saved disc copies and other site data, such as access cookies.

## Start a race

1. Invite everyone before entering a race.
2. If PAL shows the language screen, player 1 chooses a language with the
   arrows and confirms with **S**. Wait for the title menu, then choose
   **Start → Multiplayer quick race**.
3. Each participant presses **S** to join with the default keyboard layout,
   then selects and confirms a rider.
4. Player 1 advances to course selection and starts the race.
5. Use arrows to steer, **S** to accelerate, **Enter** to pause, and **W** for
   triangle/back in menus.

The room acts like one console with up to **four controllers**. Each browser
has its own camera and original single-player HUD when **Separate cameras** is
enabled. The native pause/options menu is shared and keeps its 4:3 proportions
over each player's personal view.
PAL personal cameras support 16:9 and Enhanced 2× independently for
each player. A room can mix 4:3 and 16:9 displays. Experimental draw distance
is also personal, with **Original** as the default. See
[display settings](browser-lobby.md#before-launch).
RetroArch restores the current race state after the disc loads. The host
must stay connected in a browser-hosted room. Guests who reopen the same
invitation in the same browser and at the same address can resume their
previous racer if its controller is free. Dedicated rooms reserve
controllers for returning players.

Solo saving pauses while a guest is connected or holds a reserved race seat.
On the verified PAL disc, the creator can save again when playing alone after
the multiplayer race ends. Loading opens a new room, so share its new
invitation. See [solo sessions](browser-lobby.md#solo-sessions).

## Dedicated rooms

Install Chrome on the machine serving the game. Start the local launcher with
`python3 server.py`, or use `python3 tools/play-online.py`
to make invitations available through the private tunnel. On systems where the
launcher cannot locate Chrome, set `SLED_CHROME_BIN` to its executable path.
Dedicated rooms use shared-disc mode and the built-in BIOS.

The server starts a separate headless RetroArch runtime for each room. Play and
share the invitation as usual. The room stays online when its creator closes
their browser. The next connected player becomes room owner and keeps their
controller number. Four controller icons below the game light up as the
players synchronize. Select riders and tracks in the original game menu.

Guests can select **Return to lobby** and then **Join game** to rejoin using
the same invitation. To rejoin after closing the tab, open the invitation
again in the same browser at the same address. The browser saves a controller
credential per room. During a race, the server reserves the disconnected
controller for that credential. In the lobby, a new assignment replaces the
saved credential. If the host joined on localhost, they can return using
the room address from their own address bar. A room without any connected
players stays open for at least 60 seconds. A recent invitation check can
extend that time to let a guest finish loading their disc, up to five minutes.
The launcher has two dedicated room slots, including any empty rooms still
available for rejoining.

The dedicated runtime keeps advancing when a controller stops sending input.
It releases a lone controller's held buttons after 150 ms without input.
When multiple controllers go quiet together, the server keeps their last input
for up to 340 ms to ride out the shared delivery gap. Fresh input applies on
the next server step. The server allows up to eight seconds without input before
disconnecting a controller.
Reconnecting reuses the disc if the browser can access a matching saved copy.
Keep the hosting process and tunnel running while friends are playing.

## Stop hosting

> [!TIP]
> Press **Ctrl+C** in the hosting terminal and wait for **Online stack stopped.**
> This stops the helper's runtime, relay, gateway and tunnel. Then close the game
> tabs. Closing a tab alone does not stop the servers.

To play again, run the same command, start a fresh game, and send a new invite.
A stopped tunnel's temporary link cannot be reused.

## Choose a disc mode

| Mode | Start command | What players provide |
| --- | --- | --- |
| Host disc, dedicated room | `python3 tools/play-online.py` | Host supplies one CUE/BIN set. Guests download it automatically. |
| Host disc, browser-hosted room | `python3 tools/play-online.py --browser-hosted` | Host supplies one CUE/BIN set and keeps their browser tab open. |
| Local files, browser-hosted room | `python3 tools/play-online.py --disc-mode local` | Each player selects matching CUE/BIN files in their browser; host disc downloads are blocked. |

Both modes use the same HTTPS invitation flow, including when players share a Wi-Fi network.
The helper needs internet access. `127.0.0.1` always means the computer opening
that address; send the generated HTTPS invitation to another computer.

## Rooms and synchronization

Starting from the root launcher creates a private RetroArch Netplay room. The
full invitation grants access to a free controller slot and carries progression
and camera settings. Keep the link private. The URL fragment uses Base64 to
encode the invitation data.

Each browser runs its own emulator. Once its disc is ready, RetroArch loads
the room's current state and synchronizes controller input. Register every
racer in the game's multiplayer setup before starting. Rejoining a running
race resumes an existing racer.

Dedicated rooms save the controller credential in browser storage. In
browser-hosted rooms, a returning tab prefers its previous slot if it is
still free. Another guest can take that slot, and closing the host tab ends
the room. Both modes require matching disc data, BIOS and emulator build.

## Hosting details

The helper owns the local runtime on **8000**, private gateway on **8005**,
RetroArch relay on **8006**, legacy relay on **8004**, and the Cloudflare Quick
Tunnel. It refuses occupied ports. Its
private logs and temporary access metadata live under ignored `.cache/online/`.
Use `CLOUDFLARED_BIN` if the executable is not on PATH; the helper also recognizes
`.cache/cloudflared/cloudflared`.

The primary connector prefers QUIC and can fall back to HTTP/2 when UDP is
unavailable. Set `TUNNEL_TRANSPORT_PROTOCOL=http2` to force HTTP/2 on the
primary connector for troubleshooting. The dedicated launcher also opens a
separate HTTP/2 connector for small netplay messages. It publishes that route
when it registers. Players can use the primary connector's mirror endpoint
when the separate route is unavailable. The launcher retries the separate
connector after it exits, and players switch back as the new connection opens.
Dedicated PAL clients joining through a Quick Tunnel configure a 160 ms
WebAudio queue. During a multiplayer race, RetroArch's audio rate controller
targets three quarters of that capacity to cover short replay bursts. When
the queue runs low, a bounded resampling adjustment helps refill it.

The HTTPS gateway requires private access, serves an asset allowlist and proxies
same-origin `/netplay` WebSockets. The separate connector exposes only
`/netplay-mirror` for an authorized primary connection. Dedicated players send
and receive small game messages over both WebSockets. The first copy takes
effect and large transfers use the primary connection.
In shared mode the gateway allows the complete disc
archive; in local mode disc downloads are blocked. A custom deployment must
provide HTTPS/WSS, retain COOP/COEP headers and route only through the private
gateway. Direct LAN hosting and persistent public deployment are not provided
by this helper. Component licenses and game rights are described in
[third-party notices](../THIRD_PARTY_NOTICES.md).

See [verification](verification.md) for the scope of internet testing.

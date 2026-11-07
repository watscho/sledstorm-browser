# Playing with friends

## Host: start and invite

Complete the [one-time setup](setup.md), add your PAL CUE/BIN files to `game/`,
and install Chrome and `cloudflared` on the host. From the project folder:

```sh
python3 tools/play-online.py --dedicated
```

1. Wait for **Host launcher** in the terminal.
2. Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/) on the host computer.
3. Choose settings and click **Start game**.
4. Click **Copy link** in the session toolbar and send the complete
   invitation to each friend.

The invitation automatically uses the private HTTPS tunnel address. The host
reads its disc locally. Keep the terminal open and the computer awake.
No router port forwarding is needed.

## Friend: join

1. Open the complete invitation in a desktop browser.
2. Adjust volume, image filtering or [personal controls](browser-lobby.md#personal-controls) if desired.
3. Click **Join game** and wait for disc loading and synchronization.
4. Click the game to focus keyboard input.

The default mode uses the host's disc. Friends can join without installing tools
or selecting files. If the host chose `--disc-mode local`, every player selects
their own matching CUE and all eleven BIN tracks before joining. Dedicated
rooms use the built-in BIOS. In browser-hosted rooms, everyone must use
the same BIOS file or leave it empty for HLE.

## Disc downloads and browser storage

The full disc includes all music tracks. On localhost or a permanent HTTPS
hostname, the browser saves one copy for that address and reuses it in new rooms
as long as the disc fingerprint matches and the saved copy is still available.
When storage is unavailable, the download remains usable for the current launch.

The hosting helper creates a temporary Quick Tunnel. Each shared-disc guest
launch through a `trycloudflare.com` address downloads the disc for that session
only. A custom deployment with the same HTTPS origin can reuse browser storage
across restarts. See [Hosting details](#hosting-details) for gateway requirements
and [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/)
for permanent hostnames.

Copies saved by earlier builds on temporary addresses can still occupy disk
space. In Chrome, open `chrome://settings/content/all`, search for
`trycloudflare.com`, and remove site data for old game addresses. This removes
their saved disc copies and other site data, such as access cookies.

## Start a race

1. Invite everyone before entering a race.
2. In the original game, player 1 chooses **Start → Multiplayer quick race**.
3. Each participant presses **S** to join with the default keyboard layout,
   then selects and confirms a rider.
4. Player 1 advances to course selection and starts the race.
5. Use arrows to steer, **S** to accelerate, **Enter** to pause, and **W** for
   triangle/back in menus.

The room acts like one console with up to **four controllers**. Each browser
has its own camera and original single-player HUD when **Separate cameras** is
enabled. Native pause/options menus are shared and keep their 4:3 proportions.
RetroArch restores the current race state after the disc loads. In a
browser-hosted room, the host must stay connected and a returning player can
resume their racer if the corresponding slot is free. Dedicated rooms
reserve controllers for returning players.

## Dedicated rooms

Install Chrome on the machine serving the game. Start the local launcher with
`python3 server.py --dedicated`, or use `python3 tools/play-online.py --dedicated`
to make invitations available through the private tunnel. On systems where the
launcher cannot locate Chrome, set `SLED_CHROME_BIN` to its executable path.
Dedicated rooms use shared-disc mode and the built-in BIOS.

The server starts a separate headless RetroArch runtime for each room. Play and
share the invitation as usual. The room stays online when its creator closes
their browser. The next connected player becomes room owner and keeps their
controller number. The **Players** panel shows all four controller slots,
player names and readiness. Use **Test gamepad** to check your controller before
the race. Buttons pressed during the test are kept out of the game. Select
riders and tracks in the original game menu.

Reopen the room address from your address bar in the same browser to reclaim
your controller. A host who started on localhost can return to that localhost
address. To switch browser, device or address, use **Copy recovery link** and
keep that link private.
Disconnected controllers are reserved during an active race. In the lobby they
are reserved for 60 seconds. A room without any players closes after 60 seconds.
The dedicated runtime keeps advancing when a controller stops sending input.
It releases held buttons after 150 ms and normally disconnects the controller
after two seconds. A client applying a race snapshot gets additional time.
**Rejoin room** restores the current race state and reserved controller without
reloading the game for players who stayed connected.
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
| Host disc, dedicated room | `python3 tools/play-online.py --dedicated` | Host supplies one CUE/BIN set. Guests download it automatically. |
| Host disc, browser-hosted room | `python3 tools/play-online.py` | Host supplies one CUE/BIN set and keeps their browser tab open. |
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

Dedicated rooms tie reserved seats to a private recovery credential. In
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

The HTTPS gateway requires private access, serves an asset allowlist and proxies
same-origin `/netplay` WebSockets. In shared mode it allows the complete disc
archive; in local mode disc downloads are blocked. A custom deployment must
provide HTTPS/WSS, retain COOP/COEP headers and route only through the private
gateway. Direct LAN hosting and persistent public deployment are not provided
by this helper. Component licenses and game rights are described in
[third-party notices](../THIRD_PARTY_NOTICES.md).

See [verification](verification.md) for the scope of internet testing.

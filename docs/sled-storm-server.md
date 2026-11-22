# Sled Storm Server

Sled Storm Server is the packaged host: one application that prepares the game
files from your disc, runs the room with its own emulator, opens a public
address for your guests and is run from a page in your browser. It needs no
Python, no Node.js and no terminal.

It is an internal preview. The Python launchers in the
[quick start](../README.md#-start-invite-stop) remain the supported way to
play. What the preview does and does not do yet:

- It is built on your own Mac, for Macs with Apple silicon. It is signed
  ad hoc, not by a developer identity, and not notarized.
- The packaged room was checked with two players, in the lobby and at the
  start of one race. Longer play is checked with the Python launchers.
- The public address is a temporary one from a Cloudflare quick tunnel. Every
  start of the room gets a new one.
- A copy that came from the internet or from another Mac, and logging out
  while the server runs, have not been checked yet. See
  [Logout and copies from elsewhere](#logout-and-copies-from-elsewhere).

## Build it

The emulator must be built in this checkout first, as for the Python
launchers ([installation](setup.md)). Then:

```sh
npm ci --prefix server
npm run package:macos --prefix server
```

The first build downloads and checks the pinned Node.js, `cloudflared` and
Chromium (about 360 MB). The result is `dist/macos/Sled Storm Server.app`.

You can drag it to Applications or open it where it is: the server reads its
own parts from inside the bundle and keeps its data in your Library. A bundle
that was built on this Mac carries no quarantine mark, so macOS opens it as it
is.

## First run

Open `Sled Storm Server.app`. The server starts in the background and opens
its page in your default browser. The page connects with a one-time link that
works for one minute; opening the application again opens a new page for the
same server. Closing the page stops nothing.

On the first run the page shows **Needs setup** and asks for two things:

1. **Choose game folder** opens the system's folder dialog. Choose the folder
   that holds the disc: one CUE file and its BIN tracks. The dialog can open
   behind the browser's window; the page then says
   `The folder dialog is open. Look for it among the windows.`
2. **Disc policy.** Choose how your guests get the game:
   - "Players may download the game files from this server": your guests
     may receive the game files from your computer, or use their own.
   - "Players use only their own game files": the public address gives no
     game files away, and each guest uses their own game files or a saved
     ZIP of them. The room and the game on this computer still load the
     disc from this server.

   What a guest chooses is described under "What your guests choose".

The game folder and the disc policy can be changed only while the room is
stopped.

## Host a room

**Start server** prepares the game files, starts the room and opens the
public address. The page shows the state, the disc and the players:
`1 connected, 0 away with a controller kept` counts the players in the room
and the controllers that are kept for players who dropped out.

- **Copy invite link** copies the guests' link. Anyone who has it can join
  your room, so send it only to the people you play with. When the browser
  does not let the page copy, the link is selected for you to copy.
- **Open game** opens the room in a new tab, for a player on this computer.
  It uses the same address as the Python launchers, `http://127.0.0.1:8000`,
  so the saves that the browser keeps there are shared with them.

When the public address fails, the page says
`The public address is not available.`; the room still works on this
computer, and **Start server** tries the address again.

### What your guests choose

The Game files tab of the game's page offers each guest these choices:

- **Use my game files**: their own copy of your CUE file and all its BIN
  tracks.
- **Use saved ZIP**: one ZIP of those files, such as one that Finder's
  Compress made, or game data that the page saved earlier.
- **Download from server**: the disc from your computer. It is offered only
  under "Players may download the game files from this server", and is
  chosen first there until the guest chooses another; the page then starts
  from the guest's last choice. The disc comes in checked pieces of 8 MiB,
  kept in the guest's browser for the address while it downloads: a guest
  who reloads the invitation, or whose browser closed, continues where the
  download stopped, as long as the address is the same. A new public
  address of a Quick Tunnel starts over. Your computer sends at most four
  pieces at once, and guests' further requests wait their turn; the room
  and your own game page never wait behind them.

Whatever the choice, the files must be the same as yours, under the same
names: the page compares the disc with the room's before it joins and
refuses another one with
`These game files are not the disc this room plays. …`. The page takes any
disc this server takes from a folder, and reads a ZIP itself: a damaged,
encrypted or unsafe ZIP is refused with its reason. A compressed ZIP keeps
about the disc's size in the browser's memory while the game runs, and the
page says so; the CUE and BIN files, or an uncompressed ZIP, do not.

In Chrome and Edge the page remembers a guest's files or ZIP for the address
once it has checked them: on the next visit it uses them without asking for
the files again, or Join asks the browser for access to them again. Files
changed, moved or deleted since are refused on Join, and the guest chooses
again. Other browsers ask for the files again after the page is reloaded. The players of
one room may each use a different choice.

### Room options

- **Progress**: "All content unlocked" or "Original progression".
- **Separate cameras**: each racer gets an own view and the original HUD.

Unlocked content and separate cameras need the verified PAL disc. With any
other disc the room plays with the original progression and a shared camera,
whatever is chosen, and the page says so while the room runs. The options
are part of the room and of every invite link, so they can be changed only
while the room is stopped; the next start uses them and makes new links.

### A new game

**New game** ends the game in the room and starts a new one in the same room.
Both links stay the same. Players in the room are disconnected with the
message `The host started a new game. Open the invitation again to join.` and
join again through the same link. With players in the room the page asks
first, and the button becomes **New game anyway**.

### Stop and quit

- **Stop room** closes the room, the public address and the game on this
  computer. The server and its page keep running, and **Start server** hosts
  again in a new room with new links.
- **Quit server** ends the server.

With players in the room, or a controller kept for one, the server refuses a
stop or a quit and the page asks: the buttons become **Stop anyway** and
**Quit anyway**. A double click does not answer the question: press the
button again. While the folder dialog is open, **Quit server** still works and
closes the dialog.

### Start at launch

"Start the room when Sled Storm Server opens" is on for a new installation.
With it on, opening the application also starts the room once the game folder
and the disc policy are chosen.

## When something goes wrong

The page shows the server's own sentence under the state, for example a track
that is missing from the game folder. **Details** shows the version and the
states of the room and of both public addresses.

**Save diagnostics** makes a report and the browser saves it as
`sled-storm-server-diagnostics-<date>.json`. It holds the version and the
parts of the build, the system, the status, the configuration and the last
200 lines of the server's log. It does not hold the game folder's path, your
home folder, links, room names, tokens or public addresses: the server
replaces them before the report leaves it. Read it before you send it to
anyone.

The same report comes from a terminal, also when the server does not start
(here with the application in Applications):

```sh
"/Applications/Sled Storm Server.app/Contents/MacOS/SledStormServer" diagnostics
```

## Where it keeps its files

| Folder | What is there |
| --- | --- |
| `~/Library/Application Support/Sled Storm Server` | `config.json` (the game folder, the disc policy, the switch and the room options) and the record of the running server. |
| `~/Library/Caches/Sled Storm Server` | The game files that were prepared from your disc, and the emulator's browser profile. They are made again when they are missing. |
| `~/Library/Logs/Sled Storm Server` | `server.log`. |

The cache holds a copy of your game. Do not share that folder.

## Replacing the application

When you open another build, newer or older, while the server of a build
before it still runs:

- If nobody is in its room, that server quits, the new one starts and its
  page opens. A room that the old server hosted ends, and its invite links
  stop working.
- If somebody is in its room, the old server keeps running and its page
  opens. Quit it from that page when the game is over, then open the new
  application again.

A server keeps the page of its own build while it runs. Its game page, though,
is read from the application on the disc: a player who opens the old server's
link again after you replaced the application gets the new build's game page.
Replace the application when nobody plays. (A server of the preview builds
before this one also shows the new control page: its **New game** says
`Not found`, and its **Quit server** quits without asking about players.)

## Logout and copies from elsewhere

When you log out, macOS asks the server to end, and it quits as it does on
**Quit server**, without asking about players: the players are put out. On a
real logout on 2026-11-21 the server, hosting a room with a player, ended
within a tenth of a second, left nothing behind, and did not delay the logout.
That server had been started from a terminal; one opened by a double click
was not logged out with.

A copy that came from the internet or from another Mac is quarantined. macOS
refuses to open it until you allow it in System Settings, Privacy & Security,
**Open Anyway**; macOS then opens it by itself, and runs it from a hidden,
read-only location (App Translocation). A
quarantined copy was checked so on 2026-11-21: the server ran from that
location after the application's own launch had ended, and hosted a room
through a new game and a stop and start. Building the application on the Mac
that hosts avoids all of this.

## From a terminal

Most controls of the page are also commands of the executable inside the
bundle, `Sled Storm Server.app/Contents/MacOS/SledStormServer`; the room's
options and the switch for starting at launch are set on the page only:

| Command | What it does |
| --- | --- |
| (none) | Opens the server's page, starting the server first when needed. |
| `configure --game-folder <folder> --disc-policy <shared-allowed\|local-only>` | Saves the game folder and the disc policy: `shared-allowed` lets guests download the game files, `local-only` makes them choose their own. |
| `start` | Starts hosting. |
| `invitation` | Prints the two links: `url` for guests, `localUrl` for this computer. |
| `new-game` | Starts a new game in the room, under the same links. |
| `stop` | Stops hosting and keeps the server running. |
| `quit` | Ends the server. |
| `status` | Says whether a server runs, and its state. |
| `diagnostics` | Prints the diagnostic report. |
| `self-test` | Checks the executable and prints a report. |

`stop`, `new-game` and `quit` with players in the room do nothing, say how
many players are there and name `--force`.

## Remove it

1. **Quit server** on the page, or run the `quit` command.
2. Move `Sled Storm Server.app` to the Trash.
3. Delete the three folders in the table above.

The saves that a browser keeps for `http://127.0.0.1:8000` stay in that
browser.

# P2 slice 1: a room that the server owns

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The packaged server opens one room by itself, before any player, with four free controllers; every player joins it with the same invitation, and the room stays while the server runs.

**Architecture:** A small shared module computes the room identity from a fixed, versioned list of fields, for the browser and for the server alike, and the invitation version rises from 7 to 8. The Netplay relay gains `createRoom`, which opens a dedicated room without a browser peer, built from the logic of its existing `create` branch. The host keeps that one room: it computes the identity, starts the room with the stack, reports its state, starts a new session in the same room when the emulator is lost, and builds the invitation.

**Tech Stack:** Node.js 26.13.1 single executable, TypeScript checked only, `ws` 8.22.1, the existing web client modules, `node:test`.

**Spec:** the owner's brief "Sled Storm Server — Node SEA", sections 4, 7 and 9 (outside the repository), and `docs/sea-server-plan.md`.

## Global Constraints

- No push, no release, no published binary. No per-task commit; the owner commits.
- Code, comments and committed documents in English.
- The game disc, its hashes, private links, room identifiers and tokens stay out of Git, logs and the status.
- The worker is never a player and never takes a seat. No stand-in connection plays a creator.
- The first player to join gets a free controller; nothing depends on being on the server's computer.
- A server-owned room is not ended by an idle timeout or by any player's message.
- The server computes the room identity from the real game data, the core, the adapter, the native build, the BIOS and the room options. The disc identity algorithm does not change.
- The identity holds no delivery property: no archive hash, no chunk hashes, no disc policy, no address, no port.
- An invitation of version 7 is refused with a sentence of its own. It is never read as a version 8 one.
- `server.py` and `tools/play-online.py` keep working: a browser may still create a dedicated room on a relay that was not told to own its rooms.
- `web/app.js` grows by as little as possible; new logic goes into modules of its own.
- Saving and loading inside a server-owned room is the next slice. Until then such a room offers neither, and says nothing misleading.

## Status

All seven tasks are done and the review is closed (2026-11-20). Results and open items are in `docs/sea-server-plan.md` under P2. Changed during execution: the public link stayed `invitation()` and the local one became `localInvitation()`; a guest who arrives before the emulator listens waits instead of being refused; the relay remembers a room's name between sessions (`releaseRoom`); an empty room frees kept controllers after 60 s (`reservedMs`); the session info carries `serverRoom`.

## Review Focus

1. A player sends what a creator used to send (`create`, `host`, `release-for-load`) to a server that owns its room: nothing starts, nothing stops, and the room is untouched.
2. The emulator of the server's room is lost while players are in it: they are told why, the invitation stays the same, and a new session comes up in the same room without anyone asking.
3. The room's emulator cannot start at all: the host says so with the room named, stops trying after a bound, and the local page and the public address stay up.
4. Two clients with the same disc but different `/session-info` shapes (key order, extra fields, another archive hash) compute the same identity; any difference in disc, core, native build, BIOS or room options gives a different one.
5. A guest arrives while the room is still starting, or between two sessions: the answer tells them to try again, not that the room is gone.

---

### Task 1: One room identity for the browser and the server

**Files:**
- Create: `web/room-identity.js`, `web/room-identity.fixtures.json`, `web/room-identity.test.mjs`
- Create: `server/test/room-identity.test.ts`
- Modify: `research/network/emulator-assets.mjs` (the gateway's list of public paths), `server/src/network.ts`

**Interfaces:**
- Produces: `invitationVersion = 8`, `roomProtocol = 'retroarch-netplay-v8'`, and `roomIdentity({ disc, core, adapter, native, bios, options: { progress, camera, nativeCamera? } })` resolving to 64 hexadecimal digits. The input may carry any other field; only the listed ones count. A missing or mistyped listed field throws.
- Produces: the canonical form, the JSON text of `['sled-room-identity', 1, protocol, disc, core, adapter, [[name, hash], …sorted by name], bios, progress, camera, nativeCamera === true]`.

- [x] **Step 1:** Write the fixtures and the failing tests: `the fixtures give the recorded identities` (web and server, same file), `fields outside the list and their order do not count`, `each listed field counts`, `a missing or mistyped field is refused`, and `the gateway serves the identity module`.
- [x] **Step 2:** Run `node --test web/*.test.mjs` and `npm test --prefix server`. Expected: fail, no module.
- [x] **Step 3:** Implement with `crypto.subtle` and `TextEncoder`, which the browser and Node.js both have.
- [x] **Step 4:** Run both. Expected: pass.

### Task 2: Invitations of version 8

**Files:**
- Modify: `web/invitation.js`, `web/retroarch-netplay.js`, `web/app.js`
- Modify: `web/invitation.test.mjs`, `web/retroarch-netplay.test.mjs`

**Interfaces:**
- Consumes: Task 1's `invitationVersion` and `roomIdentity`.
- Produces: `parseInvitation` accepts versions 6 and 8; version 7 throws `This invitation was made for an earlier version of the game. Ask the host for a new link.`; `invitationUrl` writes 8 for a Netplay room. The legacy transport keeps version 6 and its identity.

- [x] **Step 1:** Change the tests first: version 8 round trip, the native camera rule on version 8, and `an invitation of the earlier version is refused in its own words`.
- [x] **Step 2:** Run `node --test web/*.test.mjs`. Expected: fail.
- [x] **Step 3:** Implement. In `web/app.js` the Netplay identity comes from `roomIdentity` with `bios` as its SHA-256 or `HLE`.
- [x] **Step 4:** Run. Expected: pass.

### Task 3: The relay opens a room without a player

**Files:**
- Modify: `research/network/retroarch-relay.mjs`, `research/network/retroarch-relay.test.mjs`

**Interfaces:**
- Produces: relay option `ownsRooms` (default false). When true, `create` and `host` are refused with `This server has one room. Open the game with its invitation link.`
- Produces: `relay.createRoom({ room, token, identity, progress, camera, nativeCamera })` returning `{ ready: Promise<void>, ended: Promise<string>, stop(reason): void, status(): { listening, players, seats, racing, expiresAt } }`. `ready` rejects with the reason when the room ends before its worker listens. Such a room has `expiresAt: null` always, and refuses `release-for-load`.
- Produces: a `check` or a `guest` for a server-owned room whose worker is not listening yet is refused with `The room is starting. Try again in a moment.`

- [x] **Step 1:** Write the failing tests: `a room opened by the server has four free controllers and its worker is no player` (ROOM-01), `four players get controllers 1 to 4 and a fifth is refused` (ROOM-02), `the room goes on when its first player leaves, and that player gets the seat back` (ROOM-03), `a server-owned room with no players has no expiry` (ROOM-04, against a browser-created room that has one), `a player whose identity differs is refused and takes no seat` (ROOM-05), `a server that owns its room starts nothing for a player` (Review Focus 1), `a guest who arrives before the worker listens is told to try again`, `the room's end is reported with its reason, also before it was ready`.
- [x] **Step 2:** Run `npm test --prefix research/network`. Expected: fail.
- [x] **Step 3:** Move the room construction out of the `create` branch into one function that both paths use.
- [x] **Step 4:** Run. Expected: pass, with every older relay test unchanged.

### Task 4: The host keeps one room

**Files:**
- Create: `server/src/room.ts`, `server/test/room.test.ts`
- Modify: `server/src/host-service.ts`, `server/src/host-server.ts`, `server/src/instance.ts`, `server/src/control.ts`, `server/src/network.ts`
- Modify: `server/test/host-service.test.ts`, `server/test/host-server.test.ts`

**Interfaces:**
- Consumes: Task 1's `roomIdentity`, Task 3's `createRoom`, `web/invitation.js`'s `invitationUrl`.
- Produces: `RoomState = 'off' | 'starting' | 'open' | 'restarting' | 'failed'` and `keepRoom({ open, log, onChange, timing? })` with `state()`, `start()`, `stop()`. `open()` opens one session and returns Task 3's handle. A session that ends is followed by a new one after 2, 4 and 8 s; a session that stayed open for 60 s earns the pauses back; after the last pause the state is `failed`.
- Produces: `HostStatus.room: RoomState`. `online` needs the room `open` and the tunnel `online`. A room that is `restarting` or `failed` makes the host `degraded` with component `room`.
- Produces: `HostService.invitation()` returning `{ url: string | null, localUrl: string } | null`: null without a room, `url` null without a public address. `GET /api/invitation` answers 200 with that object or 409 `{ error: 'No room is open.' }`.
- Produces: room options by default: `{ progress: 'all', camera: true, nativeCamera: true }` on the PAL disc, `{ progress: 'original', camera: false }` otherwise.

- [x] **Step 1:** Write the failing tests for `keepRoom` (opens, reports, restarts within its bound, fails after it, earns the pauses back, stop during a start) and for the host: `the room is open before any player and seats the first one on controller 1`, `the invitation names the server's room and works on this computer without a public address`, `a player cannot make the server start or stop a room`, `a lost emulator is followed by a new session in the same room`, `an emulator that cannot start leaves the host degraded with the room named, and the local page up`, `stopping the host ends the room's worker`. Rewrite the worker tests of P1 that created their room as a browser.
- [x] **Step 2:** Run `npm test --prefix server`. Expected: fail.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm run typecheck --prefix server && npm test --prefix server`. Expected: pass.

### Task 5: The packaged server

**Files:**
- Modify: `server/smoke/sea.test.mjs`, `server/src/main.ts` (usage text)

- [x] **Step 1:** Rewrite the two worker smoke tests for a server-owned room and add `the invitation command prints the public and the local link`. Expected: fail against the old build.
- [x] **Step 2:** Rebuild and run the smoke tests. Expected: pass.

### Task 6: The real thing, by hand

- [x] **Step 1:** The built server on the owner's disc, without the tunnel program: the room is open with no player; a player joins with the local link and reaches `LIVE` on controller 1; a second player joins on controller 2; the first leaves and the game goes on; the room is still open after two minutes without players; a version 7 link gets its own sentence.
- [x] **Step 2:** Kill the room's browser: the players are told, and a new session opens in the same room.

### Task 7: Records

- [x] **Step 1:** Update `docs/sea-server-plan.md`, `CHANGELOG.md` and `docs/README.md` if needed.
- [x] **Step 2:** Run every check on the final tree.

# P1 Slice 1: Local Host Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The packaged server prepares the user's game disc, serves the game origin on `127.0.0.1:8000` and runs the Netplay relay and the gateway in its own process, without Python.

**Architecture:** New TypeScript modules in `server/src` port what the packaged runtime needs from `server.py`: disc discovery, a canonical archive with identity, and the runtime HTTP routes. A host service starts them with the existing relay and gateway modules as one transaction and reports a state. The disc archive is virtual: the server streams ZIP headers and the user's own files, so no second copy of the disc is written.

**Tech Stack:** Node.js 26.13.1 single executable, TypeScript checked by `tsc`, esbuild bundle, `node --test`, `ws` 8.22.1.

**Spec:** `docs/sea-server-plan.md` (stage P1 and the decisions table). It summarizes the owner's brief, which is not in the repository.

## Global Constraints

- Repository code, comments, UI text and documents are in English.
- No game data, BIOS, saves, private links or user-specific absolute paths in Git. Tests use synthetic files only.
- The bundle may import Node.js built-ins only; `npm run build` already fails otherwise.
- Nothing writes under the resource root. Writable data goes to `Paths.dataRoot`, `cacheRoot`, `logRoot`, `tempRoot`.
- The local game origin is `http://127.0.0.1:8000`. That port is never replaced silently.
- The disc identity algorithm is unchanged: SHA-256 of `JSON.stringify([[name, size, sha256], …])` over the CUE and then its tracks; PAL is the SHA-1 of the first track equal to `c5506c3eb3601d68d11f2c8754e03a6b06be5f2d`.
- Large files are hashed and served as streams. No synchronous whole-file reads.
- Credentials (instance token, gateway access token) never reach a log or a status reply.
- Existing modules under `web/`, `research/` and `tools/` keep their behavior. The only edit there is one additive option in Task 6. The Python launchers keep working.
- No commits unless the owner asks. Each task ends with a checkpoint instead: its tests and `npm run typecheck --prefix server` pass.
- Run commands from the repository root. Unit tests: `npm test --prefix server`. One file: `node --test server/test/<name>.test.ts`.

## Status

All eight tasks are done and the whole-slice review is closed (2026-11-20). Results, rulings that changed an interface, and the open minor items are recorded in `docs/sea-server-plan.md` under P1. Interfaces that moved during execution: `HostStatus.game` has no disc hash, `HostState` gained `degraded`, `prepareGameData` takes a `signal`, `createHostService` takes an optional `accessToken`, and `startStack` takes an optional stop-error callback.

## Out of scope for this slice

The Quick Tunnel, the dedicated Chromium worker, server-owned rooms, the admin panel, `local-only` rooms and resumable delivery. The developer-only routes of `server.py` (`/diagnostic-state`, `/lab-state`, the RetroArch lab) and the legacy relay on port 8004 are not ported.

## Review Focus

1. Game files change after preparation while the server runs: `/disc.zip` must refuse, never send a mix of two versions. Test in Task 2 and Task 3.
2. Port 8000 is held by another program: the server reports a failed runtime with an action, leaves nothing else listening and does not touch that program. Test in Task 7.
3. A client drops a 600 MB archive download midway: the file reads stop and the server keeps serving. Test in Task 3.
4. The cache stamp or the configuration file is cut short or hand-edited: the disc is prepared again, the configuration is reported as damaged and kept, nothing crashes. Tests in Task 2 and Task 5.
5. Folder and track names with spaces and non-ASCII characters, and a CUE with CRLF line ends. Tests in Task 1 and Task 2.

---

### Task 1: Find the disc in a game folder

**Files:**
- Create: `server/src/disc-folder.ts`
- Test: `server/test/disc-folder.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DiscFile { name: string; path: string; size: number; mtimeNs: string }
  /** files[0] is the CUE; the tracks follow in CUE order. `folder` is a real path. */
  export interface DiscFolder { folder: string; files: DiscFile[] }
  export class GameFolderError extends Error {}
  export function findDisc(folder: string): Promise<DiscFolder>
  ```

- [x] **Step 1: Write the failing tests.** A helper writes a CUE and track files into a temporary directory. Cases:
  - `finds the CUE and its tracks in CUE order`: folder `…/Sled Storm диск`, CUE with CRLF line ends, tracks `Track 01.bin`, `Трек 02.bin`; expect names in order, sizes, `mtimeNs` matching `/^\d+$/`, every `path` inside the real folder.
  - `accepts an upper-case CUE extension`.
  - `rejects a folder without exactly one CUE`: none, and two; message `Expected exactly one CUE file in the game folder.`
  - `rejects a CUE without tracks or with a repeated track`.
  - `rejects tracks that are missing, not regular files or outside the folder`: missing name, a directory, `../outside.bin`, and a symlink to a file outside; message starts `The CUE file refers to a missing track or a file outside the game folder:`.
  - `rejects a missing folder`: message `The game folder does not exist.`
- [x] **Step 2: Run** `node --test server/test/disc-folder.test.ts`. Expected: fails, module not found.
- [x] **Step 3: Implement `findDisc`.** CUE names match `/\.cue$/i` among regular files. Track names come from `/^FILE "([^"]+)" BINARY\s*$/gm` on the UTF-8 text. A track is valid when its name has no `/` or `\`, and `realpath(join(folder, name))` is a regular file whose parent is `realpath(folder)`. `mtimeNs` comes from `stat(path, { bigint: true })`.
- [x] **Step 4: Run the file again.** Expected: all pass. Run `npm run typecheck --prefix server`.

### Task 2: Canonical archive and disc identity

**Files:**
- Create: `server/src/game-data.ts`
- Test: `server/test/game-data.test.ts`

**Interfaces:**
- Consumes: `DiscFolder` from Task 1.
- Produces:
  ```ts
  export const DISC_CHUNK_SIZE = 8 * 1024 * 1024;
  export interface ArchiveManifest { sha256: string; size: number; chunkSize: number; chunks: string[] }
  export interface DiscIdentity { disc: string; pal: boolean; archive: ArchiveManifest }
  export interface GameData {
    identity: DiscIdentity;
    /** True when an earlier stamp was reused and no disc file was read. */
    reused: boolean;
    /** Streams the canonical archive; rejects with GameFilesChangedError when a source differs from the stamp. */
    openArchive(): Promise<import('node:stream').Readable>;
  }
  export class GameFilesChangedError extends Error {}
  export function prepareGameData(disc: DiscFolder, cacheRoot: string,
    options?: { chunkSize?: number; onProgress?: (doneBytes: number, totalBytes: number) => void }): Promise<GameData>
  ```

**Archive format `stored-v2`.** A ZIP without compression whose bytes depend only on names, contents and order. Entries follow `disc.files`. No ZIP64, no data descriptors; fail with `The game files are too large for the archive format.` when the archive would reach 4 GiB.

| Record | Fields, little-endian |
|---|---|
| Local header | `0x04034b50`, version 20, flags `0x0800` when the name is not ASCII else 0, method 0, time 0, date `0x0021`, CRC-32, size, size, name length, extra length 0, UTF-8 name |
| Central header | `0x02014b50`, made-by `0x0314`, version 20, flags, method 0, time 0, date `0x0021`, CRC-32, size, size, name length, extra 0, comment 0, disk 0, internal 0, external `0x81a40000`, local header offset, name |
| End record | `0x06054b50`, disk 0, disk 0, entry count twice, central directory size, central directory offset, comment length 0 |

**Preparation.** Pass one reads each source once for CRC-32 (`zlib.crc32`), SHA-256, and SHA-1 of the first track. Pass two streams the archive for its SHA-256 and the SHA-256 of each `chunkSize` slice. The stamp `join(cacheRoot, 'game-data', 'archive.json')` holds `{ format: 'stored-v2', chunkSize, sources: [[name, size, mtimeNs], …], entries: [{ name, size, crc32, sha256 }, …], firstTrackSha1, identity }`. It is reused when `format`, `chunkSize` and `sources` are equal; any read or parse problem means preparing again. Write it through a temporary file and a rename.

- [x] **Step 1: Write the failing tests.** Synthetic disc: a CUE and three tracks with random bytes (5000, 3000 and 1 byte), one non-ASCII name; `chunkSize: 1024`.
  - `the identity equals the browser's`: build `{ name, size, data: new Blob([bytes]) }` for each file and compare `disc` and `pal` with `identifyDisc` imported from `../../web/disc-identity.js`.
  - `the archive bytes match the manifest`: collect `openArchive()`; expect `sha256`, `size`, `chunks.length === Math.ceil(size / 1024)` and each chunk hash.
  - `an independent reader accepts the archive`: a test-local parser walks the end record, the central directory and the local headers; expect names in order, method 0, CRC-32 equal to `zlib.crc32(content)`, identical content, flag `0x0800` only on the non-ASCII name. When `unzip` exists, `unzip -t` exits 0.
  - `the archive does not depend on file times`: change the mtimes, prepare again; expect `reused === false` and the same `archive.sha256`.
  - `an unchanged disc reuses the stamp`: second call has `reused === true` and never calls `onProgress`.
  - `a changed track is prepared again` and `a damaged stamp is prepared again` (stamp cut to half its length).
  - `the archive is refused after a source changes`: append a byte to a track after preparation; `openArchive()` rejects with `GameFilesChangedError`.
  - `the identity equals the Python launcher's` (skipped when `python3` is missing): run `python3 -c` that sets `server.ROOT` and `server.CACHE` to the temporary directory and prints `shared_identity()`; compare `disc` and `pal`.
- [x] **Step 2: Run** `node --test server/test/game-data.test.ts`. Expected: fails, module not found.
- [x] **Step 3: Implement `prepareGameData`** as described above. `openArchive()` stats every source first, then returns `Readable.from` over an async generator that yields each local header, the file through `createReadStream(path, { start: 0, end: size - 1 })`, then the central directory and the end record.
- [x] **Step 4: Run the file again.** Expected: all pass. Run the type check.

### Task 3: Runtime HTTP on the game port

**Files:**
- Create: `server/src/runtime-http.ts`
- Test: `server/test/runtime-http.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RuntimeHttpOptions {
    port: number;
    webRoot: string;
    /** Served under /emulator/. */
    emulatorRoot: string;
    /** Served as /network-core.data. */
    coreData: string;
    hardwareRenderer: boolean;
    sessionInfo: object;
    invitation(): { origin: string; path: string } | null;
    /** Null keeps the host disc private: /disc.zip answers 404. */
    archive: { size: number; open(): Promise<import('node:stream').Readable> } | null;
  }
  export interface RuntimeHttp { port: number; close(): Promise<void> }
  export function startRuntimeHttp(options: RuntimeHttpOptions): Promise<RuntimeHttp>
  ```

**Behavior, ported from `server.py`:**

| Request | Reply |
|---|---|
| `Host` other than `127.0.0.1:<port>` or `localhost:<port>` | 403 |
| Method other than GET or HEAD | 405 with `Allow: GET, HEAD` |
| Every reply | `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, `X-Content-Type-Options: nosniff` |
| `Cache-Control` | `no-store` for `/session-info`; none for `/emulator/…` and `/disc.zip`; `no-cache` for the rest |
| `/session-info`, exact raw path | JSON of `sessionInfo`. `X-Sled-Hardware-Renderer: webgl2` when `hardwareRenderer`. `X-Invite-Origin` and `X-Invite-Path` only when `invitation()` gives an origin matching `^https://[a-z0-9-]+\.trycloudflare\.com$` and a path matching `^/access/[a-f0-9]{48}$` |
| `/disc.zip` | 404 when `archive` is null. Otherwise 200, `application/zip`, `Content-Length: archive.size`, the stream. 503 when `open()` rejects |
| `/network-core.data` | the `coreData` file |
| `/emulator/<path>` | a file under `emulatorRoot` |
| anything else | a file under `webRoot`; `/` is `index.html` |

Static files: the query string is ignored; the path is percent-decoded once (400 when malformed); 404 for a NUL, a backslash, a segment that starts with a dot, a directory, a missing file, or a real path outside its root. Replies carry `Content-Length`, `Last-Modified` and a type from: `.html` text/html, `.js` and `.mjs` text/javascript, `.css` text/css, `.json` application/json, `.svg` image/svg+xml, `.png` image/png, `.jpg` and `.jpeg` image/jpeg, `.wasm` application/wasm, `.zip` application/zip, anything else application/octet-stream; text types add `; charset=utf-8`. `If-Modified-Since` at or after the file time gives 304. HEAD sends headers only.

- [x] **Step 1: Write the failing tests.** A helper builds a web root (`index.html`, `app.js`, `style.css`, `shaders/a.glsl`, `.hidden`), an emulator root (`loader.js`) and a core file, starts the server on port 0 and sends requests with `node:http` so `Host` can be set.
  - Ported from `tools/test-emulator-server.py`: `the public invitation appears only when it is well formed` (valid, then foreign origin, path `/`, and null); `the hardware renderer header follows the flag`; `a private disc is not served and a foreign host is refused` (404 with `archive: null`, body equal to the stream otherwise, 403 for `Host: foreign.example`); `uploads are refused` (POST `/diagnostic-state` gives 405).
  - New: `every reply carries the isolation headers`; `cache control follows the route`; `static files have a type, a length and a date` including `/app.js?v=1.1.0` and `/`; `a conditional request gets 304`; `HEAD sends no body`; `paths cannot leave their root` (`/../secret`, `/%2e%2e/secret`, `/emulator/%2e%2e/%2e%2e/secret`, `/a%00b`, `/a%5cb`, `/.hidden`, `/shaders`, a symlink inside the web root that points outside, `/%zz` giving 400); `the archive stops when the client goes away` (a slow endless `Readable` as the archive; destroy the client socket after the first bytes; expect the stream's `destroy` to run and a later `/session-info` to answer 200); `a changed disc gives 503` (`open()` rejects).
- [x] **Step 2: Run** `node --test server/test/runtime-http.test.ts`. Expected: fails, module not found.
- [x] **Step 3: Implement `startRuntimeHttp`.** Resolve files with `realpath` and compare against `realpath(root)`. Stream files and the archive with `pipeline` so a closed response destroys the source. `close()` closes the listener and all connections.
- [x] **Step 4: Run the file again.** Expected: all pass. Run the type check.

### Task 4: Emulator assets in the resource root

**Files:**
- Create: `server/src/emulator-assets.ts`, `server/scripts/stage-resources.mjs`
- Modify: `server/scripts/build-sea.mjs`, `server/src/network.ts`
- Test: `server/test/emulator-assets.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EmulatorAssets {
    webRoot: string; emulatorRoot: string; coreData: string; hardwareRenderer: boolean;
    /** Paths the public gateway may serve. */
    assetPaths: Set<string>;
    identity: { core: string; adapter: 'pcsx-frame-gate-v3'; native: Record<string, string> };
  }
  export class MissingAssetsError extends Error {}
  export function loadEmulatorAssets(resourceRoot: string): Promise<EmulatorAssets>
  ```
  and in `stage-resources.mjs`: `export function stageResources(target: string): Promise<{ emulator: null | { lock: string; coreData: string; nativeBuild: string } }>` (SHA-256 of the three files).

**Resource layout:** `web/index.html` and the rest of `web/`; `emulator/emulator.lock.json`; `emulator/native-build.json`; `emulator/network-core.data`; `emulator/emulatorjs/<every key of lock.files>`.

- [x] **Step 1: Write the failing tests.** A synthetic tree with a two-file lock. Cases: `a complete tree loads` (`identity.core` is `lock.files['cores/pcsx_rearmed-wasm.data']`, `identity.native` is `files` of the native build, `assetPaths` contains `/`, `/disc.zip` and `/emulator/loader.js`, `hardwareRenderer` follows `web/generated/enge-hardware.js`); `each missing piece is named` (remove one of the five in turn; expect `MissingAssetsError` whose message names it).
- [x] **Step 2: Run** `node --test server/test/emulator-assets.test.ts`. Expected: fails.
- [x] **Step 3: Implement.** `assetPaths` comes from `emulatorAssetPaths(lock, 'shared')`, exported through `server/src/network.ts`. `stageResources` copies `web/` without `*.test.mjs`; it copies the emulator pieces from `vendor/emulatorjs`, `.cache/emulator-network-core.data`, `.cache/emulator-native-build.json` and `emulator.lock.json` only when all of them exist, and otherwise stages no `emulator/` directory. `build-sea.mjs` calls it for `dist/sea/resources` and writes the result as the manifest's `emulator` value.
- [x] **Step 4: Run the file again**, then `npm run build:sea --prefix server` and `ls dist/sea/resources/web/index.html`. Expected: tests pass; the file exists; no `*.test.mjs` under `dist/sea/resources/web`.

### Task 5: Configuration store and the `configure` command

**Files:**
- Create: `server/src/config-store.ts`
- Modify: `server/src/control.ts`, `server/src/main.ts`
- Test: `server/test/config-store.test.ts`

**Interfaces:**
- Consumes: `findDisc` from Task 1, `Paths`.
- Produces:
  ```ts
  export type DiscPolicy = 'local-only' | 'shared-allowed';
  export interface HostConfig { version: 1; gameFolder: string | null; discPolicy: DiscPolicy | null }
  export const defaultConfig: HostConfig;
  /** `problem` is a sentence for the user, or null. A problem never changes the file. */
  export function readConfig(paths: Paths): Promise<{ config: HostConfig; problem: string | null }>
  export function writeConfig(paths: Paths, config: HostConfig): Promise<void>
  ```
  and in `control.ts`: `export function configure(paths: Paths, argv: string[]): Promise<number>`.

The file is `join(paths.dataRoot, 'config.json')`, mode 0600, written through a temporary file and a rename. `writeConfig` first renames an existing file that `readConfig` reports a problem for to `config.json.bad`.

- [x] **Step 1: Write the failing tests.** `a missing file gives the defaults without a problem`; `a written configuration reads back and is private` (mode 0600, no temporary file left); `damaged content is reported and kept` (`not json`, `[]`, `{"version":1,"gameFolder":7}`, `{"version":1,"gameFolder":"relative/path","discPolicy":null}`, an unknown policy; expect defaults, a problem, and the file bytes unchanged); `a newer version is reported and kept` (`{"version":2}`; problem mentions `newer version`); `writing over a damaged file keeps it as config.json.bad`.
  For `configure`: `it stores a valid folder and policy` (prints `{"event":"configured",…,"tracks":2}`; a relative folder is resolved); `it refuses a folder without a disc, a missing option and an unknown policy` (exit code 2, the file untouched).
- [x] **Step 2: Run** `node --test server/test/config-store.test.ts`. Expected: fails.
- [x] **Step 3: Implement.** `gameFolder` must be an absolute path or null. `configure` accepts `--game-folder <path>` and `--disc-policy <policy>`, both required. Add `configure` to the dispatch and the usage text in `main.ts`.
- [x] **Step 4: Run the file again.** Expected: all pass. Run the type check.

### Task 6: Relay origins as an option

**Files:**
- Modify: `research/network/retroarch-relay.mjs:16-21`, `server/src/network.ts`
- Test: `research/network/retroarch-relay.test.mjs`

**Interfaces:**
- Produces: `createRetroArchRelay({ port = 8006, startDedicated, origins = ['http://127.0.0.1:8000', 'http://localhost:8000'] } = {})`; `NetplayRelayOptions.origins?: string[]`.

- [x] **Step 1: Write the failing test** `the relay accepts only its configured origins`: a relay on port 0 with `origins: ['http://127.0.0.1:8123']`; a client with that origin opens; a client with `http://127.0.0.1:8000` gets an error matching `/403/`.
- [x] **Step 2: Run** `npm test --prefix research/network`. Expected: the new test fails, 19 pass.
- [x] **Step 3: Implement** the option; `verifyClient` uses `origins.includes(origin)`.
- [x] **Step 4: Run again.** Expected: 20 pass.

### Task 7: Host service and `serve`

**Files:**
- Create: `server/src/stack.ts`, `server/src/host-service.ts`
- Modify: `server/src/serve.ts`, `server/src/host-server.ts`, `server/src/instance.ts`, `server/src/control.ts`
- Test: `server/test/stack.test.ts`, `server/test/host-service.test.ts`, `server/test/host-server.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 6.
- Produces:
  ```ts
  // stack.ts
  export interface StackStep { name: string; start(): Promise<() => Promise<void>> }
  export class StackStartError extends Error { readonly component: string }
  /** Starts the steps in order. When one fails, stops the started ones in reverse and throws. Resolves to an idempotent stop. */
  export function startStack(steps: StackStep[]): Promise<() => Promise<void>>

  // host-service.ts
  export type HostState = 'needs_setup' | 'idle' | 'preparing' | 'starting' | 'online' | 'failed' | 'stopping';
  export type HostComponent = 'config' | 'emulator' | 'game-data' | 'runtime' | 'netplay' | 'gateway';
  export interface HostStatus {
    state: HostState;
    problem: { component: HostComponent; message: string } | null;
    game: { disc: string; pal: boolean; archiveBytes: number; tracks: number } | null;
    localUrl: string | null;
    gatewayPort: number | null;
    tunnel: 'off';
  }
  export interface HostService { status(): HostStatus; start(): Promise<HostStatus>; stop(): Promise<void> }
  export function createHostService(options: { paths: Paths; log: Log; gamePort?: number; netplayPort?: number }): HostService
  ```
  `gamePort` defaults to 8000 and `netplayPort` to 8006. `startHostServer` gains `status: () => HostStatus`; `/api/status` adds `host`. `instance.ts` gains `fetchStatus(record): Promise<{ host?: HostStatus } | null>`; the `status` command prints `host`.

**`start()`** never rejects for an expected problem; it resolves to the status. While a start is running it returns the same promise; when online it resolves at once.

| Order | Step | On failure |
|---|---|---|
| 1 | Read the configuration. A problem, no folder or no policy: `needs_setup`, component `config` | n/a |
| 2 | Policy other than `shared-allowed`: `needs_setup`, component `config`, message `Rooms that use each player's own game files are not available in this build yet. Choose shared-allowed to host.` | n/a |
| 3 | `loadEmulatorAssets`: `failed`, component `emulator` | n/a |
| 4 | State `preparing`: `findDisc`, `prepareGameData`: `failed`, component `game-data` | n/a |
| 5 | State `starting`: `startStack` with runtime (game port), netplay (relay with origins of the game port) and gateway (port 0) | `failed` with that component; earlier ones are stopped |
| 6 | State `online`; `localUrl` is `http://127.0.0.1:<gamePort>/` | n/a |

`EADDRINUSE` on the game port gives `Port <port> is in use by another program. Sled Storm needs it for the local game page. Quit that program, then start the server again.`; on the Netplay port the middle sentence is `Sled Storm needs it for multiplayer.` The session info is `{ disc, pal, archive, discMode: 'shared', roomCheck: true, core, adapter, native }` in that key order. The gateway gets `upstream: gamePort`, `netplay: netplayPort`, a fresh 48-hex access token, `discMode: 'shared'`, the asset paths, `maxPayload: 8 * 1024 * 1024`, `mirrorPort: 0`. `stop()` is idempotent and ends in `idle`.

`serve` creates the service after the instance record is written, calls `start()` without waiting, and stops the service before the control listener. It reads `SLED_SERVER_GAME_PORT` and `SLED_SERVER_NETPLAY_PORT` (integers from 1024 to 65535) for tests only; the web client itself assumes 8000 and 8006.

- [x] **Step 1: Write the failing tests.**
  - `stack.test.ts`: `a failure at any position stops the started steps in reverse` (three recording steps; fail the first, second and third in turn; expect the stop order and `StackStartError.component`); `stop runs once and continues past a step that fails to stop`.
  - `host-service.test.ts`, with synthetic assets, a synthetic disc and free ports from `net`: `an unconfigured server needs setup`; `a damaged configuration needs setup`; `local-only waits for a later stage`; `missing emulator assets fail the emulator component`; `a folder without a disc fails game data`; `a configured server comes online` (`/session-info` body equals the expected object and key order, `/disc.zip` hashes to `archive.sha256`, a WebSocket to the Netplay port with the game origin and `role: 'check'` closes with 1008, `GET /disc.zip` on `gatewayPort` without the access cookie is 401); `a busy game port fails the runtime and leaves nothing listening` (hold the port with `net.createServer`; expect the message, the holder still listening, and a connection to the Netplay port refused); `a busy Netplay port releases the game port`; `stop is idempotent and start works again`; `the status never contains the access token` (`JSON.stringify(status)` has no 48-hex run).
  - `host-server.test.ts`: `/api/status` includes `host` from the `status` callback.
- [x] **Step 2: Run** `node --test server/test/stack.test.ts server/test/host-service.test.ts`. Expected: fails.
- [x] **Step 3: Implement** `startStack`, `createHostService`, and the `serve`, `host-server`, `instance` and `control` changes.
- [x] **Step 4: Run** `npm test --prefix server` and the type check. Expected: all pass.

### Task 8: Packaged checks and records

**Files:**
- Modify: `server/smoke/sea.test.mjs`, `docs/sea-server-plan.md`, `CHANGELOG.md`

- [x] **Step 1: Add smoke tests** that run the built executable: `the bundle carries the web client and no test files`; `an unconfigured server reports needs_setup` (launch, `status`, quit); `a configured server serves the game origin` (stage with a synthetic `emulator/` tree and a synthetic disc in a folder with spaces and non-ASCII characters; `configure`; launch with the two port variables; `/session-info` and `/disc.zip` agree on the archive SHA-256; `status` shows `online`; `quit`; both ports refuse connections).
- [x] **Step 2: Run** `npm run build:sea --prefix server && npm run smoke --prefix server`. Expected: all pass.
- [x] **Step 3: Check the real disc by hand.** Prepare the `game/` folder with a development run, note the time, and compare `disc` and `pal` with `shared_identity()` from `server.py` run against a scratch cache. Record both results; the hashes stay out of Git.
- [x] **Step 4: Check a browser by hand.** Serve the real `web/` with synthetic emulator files on port 8000, open the page, and confirm that it renders, that `crossOriginIsolated` is true and that no static request fails.
- [x] **Step 5: Record** the new decisions, the slice status and the verification log in `docs/sea-server-plan.md`, and the change in `CHANGELOG.md` under Unreleased.
- [x] **Step 6: Run everything:** the baseline commands from `CONTRIBUTING.md`, then `npm run typecheck`, `npm test`, `npm run build:sea`, `npm run smoke` for `server`. Expected: all pass.

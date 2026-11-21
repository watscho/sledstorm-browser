# P1 slice 3: dedicated emulator on a shipped Chromium

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The packaged server runs the room emulator in a Chromium that ships inside it, and a really built emulator plays a room end to end without Python and without an installed Chrome.

**Architecture:** The existing `research/network/dedicated-runtime.mjs` stays the one place that drives the browser over private pipes; it gains a page address, extra switches, a profile directory and a forced end. The server gives the Netplay relay a `startDedicated` that runs the shipped browser, keeps count of its workers and waits for them when it stops. Rooms are still created by a browser's `create` request, exactly as with `server.py --dedicated`; server-owned rooms are P2.

**Tech Stack:** Node.js 26.13.1 single executable, TypeScript checked only, `ws` 8.22.1, an unmodified open-source Chromium build, `node:test`.

**Spec:** the owner's brief "Sled Storm Server — Node SEA" (outside the repository) and `docs/sea-server-plan.md`.

## Global Constraints

- No push, no release, no published binary. No per-task commit; the owner commits.
- Code, comments and committed documents in English.
- The game disc, its hashes, private links and user paths stay out of Git, logs and the status.
- The packaged server never looks for an installed browser. A path override exists for development only.
- The browser's debugging transport stays a private pipe. No debugging port is opened.
- Every worker has an owner, a startup deadline, an explicit stop with a bounded wait and a forced end.
- No automated test starts the real Chromium or uses the network. The real browser, the real emulator and the owner's disc are used by hand only. The fetch script asks the browser for its version once, when it unpacks it.
- `server.py` and `tools/play-online.py` keep working: every new parameter of the shared runtime has the old behavior as its default.
- The web client is not changed in this slice.

## Status

All six tasks are done (2026-11-20). Results and open items are in `docs/sea-server-plan.md` under P1. Added during execution, each after a measurement on the shipped browser: the resolver rule that leaves the worker only the loopback address, the `env` option of the runtime with `BREAKPAD_DUMP_LOCATION`, and a failed start that is reported only after its cleanup. The stand-in also has a `silent` entry. The names in Task 3 changed slightly: the worker option is `{ browser, graceMs }`. The review's findings and its seven minor items were closed afterwards; see the same document.

## Facts measured before planning

- Chrome for Testing 158.0.8127.36 is Google-branded and carries proprietary codecs; its publisher states no terms for shipping it inside another product. `chrome-headless-shell` is the old headless mode, which the runtime was never run on.
- Chromium's own continuous builds are in the `chromium-browser-snapshots` bucket. `Mac_Arm/1727462/chrome-mac.zip` is ten commits before the branch point of milestone 158 (1727472): 180,339,357 bytes, published 2026-10-27, version 158.0.8127.0, 373 MB unpacked in 348 files and 5 symbolic links, ad-hoc signed, with no license file inside the bundle.
- Its SHA-256, computed here, is `eef8e2efe4944252329c3b273e78629a93cf5b30a26dcce68259d0910202012d`; the MD5 of the same bytes equals the one in the bucket's object record.
- With the runtime's own switches and the pipe transport it started in 2.5 s and reported WebGL 2 on the ANGLE Metal renderer, WebAssembly SIMD, a running `AudioContext`, MP3 and Ogg Vorbis but no AAC. The installed Chrome 157 gave the same answers plus AAC.
- When the process that holds the pipes is killed, the browser and all of its helpers are gone within 3 s. The profile directory stays.
- The Homebrew Python on this machine is 3.15.2, so the emulator build needs no Python download.

## Review Focus

1. The server is killed while a room runs: no browser process is left, and the next start removes the profile it left.
2. A browser that ignores a polite stop: stopping the host and quitting still end within a bound, and the process is gone.
3. A build without the browser, or with one that cannot be executed: hosting fails with the emulator named, and nothing is left listening.
4. The worker dies in the middle of a room: the room closes with a reason, the host stays online, and the next room can start.
5. The host is stopped while a worker is still starting: no process and no profile directory remain.

---

### Task 1: The shared runtime takes its page, switches and profile place, and ends for certain

**Files:**
- Modify: `research/network/dedicated-runtime.mjs`
- Create: `research/network/fake-browser.mjs` (stand-in that speaks the pipe protocol and plays the worker)
- Create: `research/network/dedicated-runtime.test.mjs`
- Modify: `research/network/package.json` (test list)

**Interfaces:**
- Produces: `launchDedicatedRuntime(chrome, setup, signal, { url = 'http://127.0.0.1:8000/', args = [], profileRoot = tmpdir(), graceMs = 5000 } = {})` resolving to `{ exited: Promise<void> }` as today.
- Produces: `fake-browser.mjs --script-file <json>`, with `{ record, netplayPort, launches: [{ neverConnect?, neverListen?, exitAfterMs?, ignoreTerm?, failCommand? }] }`. It appends `{ event: 'start', pid, args }` and `{ event: 'navigate', pid, url, setup }` lines to `record`, and exits when its command pipe closes.

- [x] **Step 1:** Write the stand-in and the failing tests: `starts the browser with its switches, a profile of its own and the given page`, `the page defaults to the launcher's address`, `an abort ends the browser and removes the profile`, `a browser that ignores the stop is killed after the grace`, `a refused command rejects and leaves nothing`, `an abort before the start leaves no profile`, `a browser that cannot be started rejects and leaves no profile`, `a browser that ends by itself resolves exited`.
- [x] **Step 2:** Run `npm test --prefix research/network`. Expected: the new tests fail on the missing options and the missing forced end.
- [x] **Step 3:** Implement the options and the forced end; the timer does not keep the process alive.
- [x] **Step 4:** Run `npm test --prefix research/network`. Expected: all pass.

### Task 2: Pin, fetch and stage Chromium

**Files:**
- Modify: `server/toolchain.lock.json` (`chromium` entry: source, position, version, commit, archive URL, file, SHA-256)
- Create: `server/scripts/fetch-chromium.mjs`
- Modify: `server/scripts/stage-resources.mjs`, `server/scripts/build-sea.mjs`
- Modify: `server/test/pins.test.ts`, `server/smoke/sea.test.mjs`

**Interfaces:**
- Produces: `pinnedChromium()` resolving to `{ application, executable, version, position, platform, archiveSha256 }` or null on a platform without a pin. The archive is verified before it is unpacked with `ditto`, and the unpacked browser must report the pinned version.
- Produces: resource `chromium/Chromium.app`, and `chromium: { version, position, archiveSha256, executableSha256 }` in `runtime-manifest.json`.

- [x] **Step 1:** Write the failing tests: pins test `the Chromium pin names one exact build` (HTTPS URL inside the snapshots bucket, numeric position inside the URL, 64-digit SHA-256, a version), and smoke test `the bundle carries the pinned Chromium` (the staged browser reports the pinned version; the manifest matches the lock).
- [x] **Step 2:** Run both. Expected: fail, no pin and no staged browser.
- [x] **Step 3:** Add the pin, the fetch script and the staging step. Copies keep symbolic links and use copy-on-write clones.
- [x] **Step 4:** Run `npm test --prefix server`, `npm run package:macos --prefix server` and the smoke test. Expected: pass.

### Task 3: The host runs workers on the shipped browser

**Files:**
- Create: `server/src/dedicated.ts`
- Modify: `server/src/paths.ts` (`profileRoot`), `server/src/network.ts`, `server/src/host-service.ts`
- Modify: `server/test/paths.test.ts`, `server/test/host-service.test.ts`; create `server/test/dedicated.test.ts`

**Interfaces:**
- Consumes: Task 1's `launchDedicatedRuntime` and stand-in.
- Produces: `Paths.profileRoot` = `<cacheRoot>/browser-profiles`.
- Produces: `shippedBrowser(paths)` = `<resourceRoot>/chromium/Chromium.app/Contents/MacOS/Chromium`; `chosenBrowser({ sea, env, paths })` returning the `SLED_SERVER_CHROME` path only outside the packaged executable; `WORKER_SWITCHES`.
- Produces: `createWorkers({ browser, url, profileRoot, log, graceMs? })` with `start(setup, signal)` for the relay, `count()` and `settled()` that resolves when every worker is gone.
- Produces: `createHostService({ …, worker?: { browser: string; graceMs?: number } | null })`. Absent: the shipped browser. Null: no worker and no `dedicated` mark, for tests of the other parts.

- [x] **Step 1:** Write the failing tests: `the browser override is honored only outside the packaged executable`; `session info marks the host as dedicated, after the build identity`; `a room request starts the worker on the game page and the room accepts its creator`; `stopping the host ends the worker and removes its profile`; `stopping the host while a worker starts leaves nothing`; `a worker that dies takes its room and not the host`; `a worker that ignores the stop is killed`; `a build without the browser cannot host`; `profiles left by a killed server are removed at the next start`.
- [x] **Step 2:** Run `npm test --prefix server`. Expected: the new tests fail.
- [x] **Step 3:** Implement. A missing or non-executable browser fails the start with component `emulator` and the message `This build is missing the emulator browser.` The Netplay step stops its rooms and then waits for `settled()`.
- [x] **Step 4:** Run `npm run typecheck --prefix server && npm test --prefix server`. Expected: pass.

### Task 4: The packaged server, with a stand-in browser

**Files:**
- Modify: `server/src/serve.ts`, `server/smoke/sea.test.mjs`

- [x] **Step 1:** Write the failing smoke tests: `a room reaches its worker through the packaged server` and `neither quit nor a killed server leaves a worker behind`. Every staged copy has the real browser removed; the stand-in is installed on request.
- [x] **Step 2:** Run the smoke tests. Expected: fail.
- [x] **Step 3:** Wire `chosenBrowser` into `serve`.
- [x] **Step 4:** Rebuild and run the smoke tests. Expected: pass.

### Task 5: The real thing, by hand

- [x] **Step 1:** Build the emulator as `docs/setup.md` says, then `npm run package:macos --prefix server`. Expected: the manifest names the emulator and Chromium.
- [x] **Step 2:** Start the built executable on the owner's disc with tunnels switched off by an unreachable program path, create a room from a second Chromium driven over a pipe, and wait until the page reports a synchronized game.
- [x] **Step 3:** Record: time until the worker listens, the worker's executable path, its connections outside loopback, memory, what `quit` and a killed server leave behind, and the package size unpacked and compressed.

### Task 6: Records

- [x] **Step 1:** Update `docs/sea-server-plan.md` (decisions, slice results, what was not verified, verification log, build section), `CHANGELOG.md`, `THIRD_PARTY_NOTICES.md` and `docs/README.md` if it lists the plans.
- [x] **Step 2:** Run every check on the final tree.

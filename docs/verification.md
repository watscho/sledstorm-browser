# Release checklist and verification

## Current status

The **1.2.0 Python source launcher** is the established workflow. The
**Apple Silicon server app** is an internal preview. The arm64 bundle
declares macOS 15.0 based on the bundled `cloudflared` deployment target.
Test coverage below applies to the environment and workflow listed.

## Release checklist

### Completed for the internal preview

- [x] Build the SEA application and package it with pinned Chromium,
  `cloudflared`, the prepared emulator and the required notices.
- [x] Inspect a fresh ZIP extraction under RELEASE-01 and run the SEA
  self-test. Rehearse Hardened Runtime signing.
- [x] Check the real room lifecycle, Safari local play, app replacement
  with a compatible autosave, and synthetic resumable transfers over
  Quick Tunnel on one Mac.

### Open for public release

- [ ] Build the pinned native runtime from the exact release revision in
  release CI. Sign with Developer ID. Verify the hardened SEA and Chromium
  actually run with the selected entitlements. Check the bundled Chromium
  identifier alongside a separate Chromium installation.
- [ ] Submit to Apple, review the notarization log, staple the accepted
  ticket, and run RELEASE-01 and ticket validation on the final ZIP.
- [ ] Install the quarantined ZIP on a clean Apple Silicon Mac. Check Finder
  launch and reopen, Gatekeeper including an offline first open, and
  native selection of a folder in Documents. Record consent, cancellation,
  invalid-folder rejection and TCC behavior separately.
- [ ] Check stop, quit and replacement on that Mac. Exercise sleep/wake,
  startup and recovery without internet, logout after Finder launch,
  and persistence of config, cache and compatible saves.
- [ ] Complete races with two, three and four physical players, including
  separate internet connections and a server operator who uses no
  controller. Check independent input, camera and HUD, shared pause,
  in-race rejoin, ownership transfer and restoration of an older
  compatible `.sledsave`. Record both runtime load and audio behavior.
- [ ] Qualify Firefox, native browser writes to a full volume and
  interruption during shutdown. Check gameplay and room responsiveness
  while a guest on another network downloads.
- [ ] Review bundled licenses and corresponding source, publish the exact
  qualified revision, and record the final SHA-256 and test matrix.

For each manual run, record macOS and browser versions, device count,
browser profile, network topology, disc policy, and the exact build.
Use lawfully obtained local copies for physical-device races and synthetic
files for public transfer checks. Record console steps/s, browser
animation pacing, painted FPS and input latency as separate measurements.

## Build and sign a candidate

Use Apple Silicon. Prepare the pinned emulator in the checkout using the
[source build steps](setup.md#one-time-setup), then run:

```sh
npm ci --prefix server
npm run verify --prefix server
npm run package:macos:zip --prefix server
```

The ZIP builder checks a fresh extraction for pinned inputs, required
resources and notices, an in-bundle inventory and signature validity.
Release archives contain runtime and notice files. Keep disc and BIOS
data, saves, caches, profiles, logs, configuration and credentials out.
Outputs are in `dist/macos/`.

| Command suffix for `npm run package:macos:zip --prefix server` | Input and output |
| --- | --- |
| `-- --rehearse` | Preview ZIP to an ad-hoc Hardened Runtime rehearsal ZIP. |
| `-- --sign` | Preview ZIP to a Developer ID signed ZIP. Set `SLED_MACOS_SIGNING_IDENTITY` to a valid identity's SHA-1 fingerprint. |
| `-- --notarize` | Signed ZIP to a ZIP containing the stapled app. Set `SLED_MACOS_NOTARY_PROFILE` to a configured `notarytool` Keychain profile. |

Use the organization's secret store for certificate and notary
credentials. The signing script handles nested code, secure timestamps
and the required JIT entitlements. Build from a clean revision for
notarization. Test the signed Chromium runtime before submission and
confirm Gatekeeper using the final stapled archive. The notarization
command records Apple's result and checks the final extraction using
RELEASE-01, `stapler validate` and `syspolicy_check distribution`.

## Node SEA macOS preview qualification

The recorded 1.1.0 candidate is from clean revision `f611aa8`, tested on one
Apple M1 Pro with macOS 27.2.1 (26B131). It passed all 11 checks in
`npm run verify --prefix server`, including 30 packaged smoke tests.
Both ZIP extractions passed RELEASE-01 and all five SEA self-tests.

| Archive suffix | Recorded SHA-256 |
| --- | --- |
| `-preview.zip` | `e19437a1e3adf678981dc33dab9cdeb6d64c3efd299b8d722e9e71f3c4a5762e` |
| `-rehearsal.zip` | `8c0aad980c96dbc35c6503360b7ed6699896916a182051a6171af3bdf1456943` |

The rehearsal validated 18 hardened signatures. Chromium in that
ad-hoc rehearsal hit a dyld Team ID restriction. The regular preview
ran Chromium for a real PAL room.

| Check | Result and scope |
| --- | --- |
| App lifecycle and saves | On the development Mac, LaunchServices reopened the same room with the admin tab closed. Stop and Quit released owned listeners and processes. Replacement kept config and cache. Safari restored a pre-replacement autosave and returned to LIVE. A manual save attempt reported a changed room state. |
| Safari and folder selection | Safari 27.2 Private Browsing reached LIVE on loopback with CUE/BIN, a stored ZIP and the server download. Canceling a second ZIP choice kept the checked ZIP. The native admin folder chooser opened and closed on Quit. Selection, cancellation and TCC on a clean Mac remain open. |
| Native rebuild and disk pressure | The pinned build compiled. Generated JS matched the candidate and WASM matched after normalizing four build timestamp strings. A full 24 MiB HFS+ test image produced `ENOSPC`; the ZIP helper kept the earlier file and memory archive through a filesystem adapter. |
| DATA-05 and DATA-06 | Across real HTTPS Quick Tunnel, Chromium reused two of nine parts after interruption and requested the other seven. After one saved part was corrupted, it requested only that part. The portable ZIP matched the manifest's SHA-256. |
| DATA-08 | A second HTTPS origin started with zero kept parts and accepted the exported ZIP without fetching chunks. |
| Public transfer limits | A 24-request burst returned HTTP 503 with `Retry-After: 2` on overflow. Metadata returned in 199 ms while the room stayed open. Separate checks confirmed four active slots and sixteen waiting. Injected 504s stopped at 2,601 ms with a 2,500 ms test budget. |

The synthetic public transfer used Chromium 158.0.8127.0 and
`cloudflared` 2026.10.7, one internet connection and a stand-in dedicated
worker. This establishes data transfer through a live tunnel. The
remaining gameplay and separate-device tests are listed above.

## 1.1.0 verification summary

The 1.1.0 source release was checked on one Mac. Browser logic, relay,
launcher HTTP, native viewport isolation and real IndexedDB checks
passed. Chrome restored real manual and automatic checkpoints in fresh
dedicated rooms. Graphics presets, diagnostics and the save library
were exercised. Browser and core timing were measured separately.

## 1.0.0 verification summary

Chrome on macOS exercised remembered ZIP handles and permission
renewal. Browser, Netplay, HTTP and native viewport tests passed.
The earlier verification record describes the hardware and network
limits of the source release.

## 0.9.0 verification summary

The 0.9-series record documents the original PAL multiplayer
qualification, including dedicated and browser-hosted Pine Valley runs
and follow-up fixes for personal-camera rendering during the opening
sweep, lap crossings and race finish. These runs do not establish current
cross-device coverage.

[Historical test reports and engineering plans](README.md#engineering-history)
remain available in Git.

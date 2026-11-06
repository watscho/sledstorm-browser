import { BrowserSession } from '/session-client.js';
import { FrameSync } from './frame-sync.js';
import { canonicalStateDigest, encodeState, decodeState, captureState } from './core-state.js';
import { unlockPal } from './pal-profile.js';
import { selectedDisc } from '/local-disc.js';
import { identifyDisc } from './disc-identity.js';

const launch = document.querySelector('#launch');
const status = document.querySelector('#status');
let biosUrl;
let session, sync;
let roomOptions, launchInfo;
const readInvitation = () => {
  if (!location.hash) return null;
  try {
    const value = JSON.parse(atob(location.hash.slice(1)));
    if (value.v !== 6 || !/^[a-f0-9]{24}$/.test(value.room) || !/^[a-f0-9]{64}$/.test(value.token)
      || !['all', 'original'].includes(value.progress) || typeof value.camera !== 'boolean') throw new Error();
    return value;
  } catch { throw new Error('Invalid or outdated invitation. Ask the host for a new complete link.'); }
};
let invitation;
try {
  invitation = readInvitation();
  if (invitation) {
    document.querySelector('#progress').value = invitation.progress;
    document.querySelector('#camera').checked = invitation.camera;
    document.querySelector('#progress').disabled = document.querySelector('#camera').disabled = true;
    launch.textContent = 'Join game';
  }
} catch (error) { status.textContent = error.message; launch.disabled = true; }
const solo = new URLSearchParams(location.search).has('solo');
const lab = new URLSearchParams(location.search).has('lab') && location.port === '8000'
  && ['127.0.0.1', 'localhost'].includes(location.hostname);
const diagnostics = new URLSearchParams(location.search).has('diagnostics');
const developerTools = new URLSearchParams(location.search).has('dev');
const showStatus = text => { status.textContent = text; };
const launcherInfo = fetch('/session-info').then(async response => {
  if (!response.ok) throw new Error('Could not read launcher settings.');
  const info = await response.json();
  document.querySelector('#disc-settings').hidden = info.discMode !== 'local';
  if (info.discMode === 'local') showStatus('Choose your local CUE and all BIN tracks. Each browser needs matching files.');
  return info;
});
launcherInfo.catch(error => { showStatus(error.message); launch.disabled = true; });
launch.addEventListener('click', async () => {
  launch.disabled = true;
  roomOptions = { progress: document.querySelector('#progress').value, camera: document.querySelector('#camera').checked };
  let discFiles;
  try {
    launchInfo = { ...await launcherInfo };
    if (launchInfo.discMode === 'local') {
      discFiles = await selectedDisc(document.querySelector('#disc-files').files);
      if (!discFiles) throw new Error('Select your CUE and all eleven BIN tracks.');
      Object.assign(launchInfo, await identifyDisc(discFiles, showStatus));
    }
    if (!solo && roomOptions.progress === 'all' && !launchInfo.pal) throw new Error('The unlock preset requires the verified PAL SLES-02194 disc. Select Original progression.');
    if (!solo && roomOptions.camera && !launchInfo.pal) throw new Error('Separate camera hooks require the verified PAL SLES-02194 disc.');
  } catch (error) { showStatus(error.message); launch.disabled = false; return; }
  const bios = document.querySelector('#bios').files[0];
  for (const input of document.querySelectorAll('#setup input, #setup select')) input.disabled = true;
  if (bios) biosUrl = URL.createObjectURL(bios);
  Object.assign(window, {
    EJS_player: '#game',
    EJS_core: 'pcsx_rearmed',
    EJS_gameName: discFiles ? discFiles[0].name : 'Sled Storm Europe',
    EJS_gameUrl: discFiles ? discFiles[0].data : '/disc.zip',
    EJS_externalFiles: discFiles ? Object.fromEntries(discFiles.slice(1).map(file => ['/' + file.name, file.data])) : {},
    EJS_pathtodata: '/emulator/',
    EJS_biosUrl: biosUrl || '',
    EJS_disableCue: true,
    EJS_startOnLoaded: true,
    EJS_threads: false,
    EJS_language: 'en-US',
    EJS_disableAutoLang: false,
    EJS_color: '#8bd9ec',
    EJS_volume: Number(document.querySelector('#volume').value) / 100,
    EJS_paths: solo ? {} : { 'pcsx_rearmed-wasm.data': '/network-core.data' },
    EJS_disableLocalStorage: !solo,
    EJS_disableDatabases: !solo,
    EJS_defaultOptions: solo ? {} : { pcsx_rearmed_multitap1: 'enabled', pcsx_rearmed_multitap2: 'disabled', rewindEnabled: 'disabled' },
    EJS_Buttons: solo ? {} : Object.fromEntries(['playPause', 'play', 'pause', 'restart', 'saveState', 'loadState', 'cheat', 'settings', 'saveSavFiles', 'loadSavFiles', 'quickSave', 'quickLoad', 'contextMenu', 'gamepad'].map(key => [key, false])),
    EJS_ready: () => {
      const originalConfig = window.EJS_GameManager.prototype.getRetroArchCfg;
      window.EJS_GameManager.prototype.getRetroArchCfg = function (...args) {
        return originalConfig.apply(this, args) + `\nvideo_smooth = "${document.querySelector('#image').value === 'smooth'}"\n`;
      };
      if (!solo) {
        // Rooms start from identical empty cards, without reading or modifying
        // the user's persistent single-player memory cards.
        window.EJS_GameManager.prototype.mountFileSystems = async function () {
          this.mkdir('/data'); this.mkdir('/data/saves');
        };
      }
    },
    EJS_onGameStart: () => {
      if (lab) restoreLab().catch(error => showStatus(error.message));
      else if (solo) showStatus('Emulator started. Click the game to focus your controls.');
      else connectRoom(bios).catch(error => { showStatus(error.message); session?.fail(error.message); });
      startBenchmark();
    },
  });
  document.querySelector('#game').classList.add('active');
  document.querySelector('#game').scrollIntoView({ block: 'start' });
  status.textContent = 'Loading emulator and disc…';
  const script = document.createElement('script');
  script.src = '/emulator/loader.js';
  script.onerror = () => {
    status.textContent = 'Could not load the emulator. Restart the page and check the local server.';
  };
  document.body.append(script);
});

async function restoreLab() {
  const { Module: module, gameManager } = window.EJS_emulator;
  module.sledBeforeFrame = () => false;
  gameManager.setKeyboardEnabled(false);
  // The fixture was paused by controller 2; the native menu keeps its owner.
  gameManager.simulateInput = (_seat, button, pressed) => gameManager.functions.simulateInput(1, button, pressed);
  gameManager.getFrameNum = () => module._sled_frame_count();
  const response = await fetch('/lab-state');
  if (!response.ok) throw new Error('Local camera fixture is missing. Save a diagnostic race snapshot first.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  canonicalStateDigest(bytes); // Reject a state from a different pinned core.
  const payload = bytes.subarray(16, 16 + 0x440000);
  const pointer = module._malloc(payload.length);
  try {
    module.HEAPU8.set(payload, pointer);
    if (!module._retro_unserialize(pointer, payload.length)) throw new Error('Camera fixture could not be restored.');
  } finally { module._free(pointer); }
  module._sled_view_configure(Number(new URLSearchParams(location.search).get('seat')) || 0,
    new URLSearchParams(location.search).has('hud') ? 3 : 1);
  module.sledBeforeFrame = () => true;
  showStatus('Local camera laboratory · saved two-player race · Enter to unpause. No network room.');
}

async function connectRoom(bios) {
  const emulator = window.EJS_emulator;
  // This assignment runs before the first scheduled core frame.
  emulator.Module.sledBeforeFrame = () => false;
  if (emulator.Module.sledFrameGateVersion !== 3 || !emulator.Module._sled_frame_count) {
    emulator.gameManager.toggleMainLoop(0);
    throw new Error('Native frame hooks are missing. Run python3 tools/build-emulator.py, restart the server, and reload.');
  }
  showStatus('Connecting session…');
  emulator.gameManager.getState = () => captureState(emulator.Module, emulator.gameManager.functions.saveStateInfo);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  session = new BrowserSession(showStatus, {
    endpoint: location.port === '8000' ? `${protocol}//${location.hostname}:8004` : `${protocol}//${location.host}/relay`,
    onSnapshotRequest: async tick => ({ data: encodeState(await sync.snapshot(tick)), checks: [...session.digests] }),
    onSnapshot: async message => {
      const bytes = decodeState(message.data);
      const expected = canonicalStateDigest(bytes);
      const volume = emulator.volume;
      emulator.setVolume(0);
      let closestState;
      try {
        await sync.restore(bytes, message.tick, state => {
          const matches = canonicalStateDigest(state) === expected;
          if (!matches && !closestState) {
            let sameRam = true;
            for (let i = 0x9035; i < 0x209035; i++) if (state[i] !== bytes[i]) { sameRam = false; break; }
            if (sameRam) closestState = state;
          }
          return matches;
        });
      } catch (error) {
        const restored = closestState || emulator.gameManager.getState();
        if (location.port === '8000' && ['127.0.0.1', 'localhost'].includes(location.hostname)) {
          await Promise.all([fetch('/diagnostic-state?frame=999&seat=2', { method: 'POST', body: bytes }),
            fetch('/diagnostic-state?frame=999&seat=3', { method: 'POST', body: restored })]);
        }
        throw error;
      } finally { emulator.setVolume(volume); }
    },
  });
  const response = await fetch('/session-info');
  const info = launchInfo;
  const invitePath = response.headers.get('x-invite-path') || '/';
  const biosHash = bios ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await bios.arrayBuffer())), x => x.toString(16).padStart(2, '0')).join('') : 'HLE';
  const identity = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([info, biosHash, roomOptions, 'fresh-cards-multitap-v3'])))), x => x.toString(16).padStart(2, '0')).join('');
  sync = new FrameSync({ module: emulator.Module, manager: emulator.gameManager, session,
    beforeFrame: () => {
      if (roomOptions.progress === 'all') unlockPal(new Uint8Array(emulator.Module.HEAPU8.buffer, emulator.Module._sled_ram_pointer(), 0x200000));
    },
    onStatus: () => showStatus(`Controller ${session.slot + 1} · ${session.members || 1}/4 connected · synchronized frame ${sync.tick}`),
    digest: () => {
      const bytes = emulator.gameManager.getState();
      const frame = sync?.tick || 0;
      if (diagnostics && frame <= 1000) {
        fetch(`/diagnostic-state?frame=${frame}&seat=${session.slot || 0}`, { method: 'POST', body: bytes }).catch(() => {});
      }
      return canonicalStateDigest(bytes);
    },
  });
  const liveVolume = emulator.volume;
  sync.onReplayChange = replaying => emulator.setVolume(replaying ? 0 : liveVolume);
  await session.connect(identity, invitation, room => {
    const url = new URL(location.href);
    url.pathname = invitePath;
    url.search = '';
    url.hash = btoa(JSON.stringify({ v: 6, room: room.room, token: room.token, ...roomOptions }));
    history.replaceState(null, '', url);
    document.querySelector('#invite').value = url.href;
    document.querySelector('#sharing').hidden = false;
  });
  if (invitation) {
    document.querySelector('#invite').value = location.href;
    document.querySelector('#sharing').hidden = false;
  }
  emulator.Module._sled_view_configure(session.slot, roomOptions.camera ? 3 : 0);
  sync.start();
  showStatus(`Controller ${session.slot + 1} connected. Enter the game's multiplayer menu to race together.`);
}

document.querySelector('#copy-invite').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(document.querySelector('#invite').value); showStatus('Invitation copied.'); }
  catch { document.querySelector('#invite').select(); showStatus('Select and copy the invitation link.'); }
});

// Opt-in probe: count emulated frames, rather than browser animation callbacks.
function startBenchmark() {
  const output = document.createElement('pre');
  output.id = 'benchmark';
  output.setAttribute('aria-label', 'Emulator benchmark');
  document.querySelector('#game').after(output);
  if (developerTools && location.port === '8000') {
    const save = document.createElement('button');
    save.id = 'save-diagnostic';
    save.textContent = 'Save local diagnostic snapshot';
    save.addEventListener('click', async () => {
      if (!session?.active || session.replaying) { showStatus('Wait until the session is synchronized.'); return; }
      const response = await fetch('/diagnostic-state?frame=1000&seat=3', { method: 'POST', body: window.EJS_emulator.gameManager.getState() });
      if (!response.ok) { showStatus('Could not save the local snapshot.'); return; }
      save.textContent = 'Saved local diagnostic snapshot'; save.disabled = true;
    });
    output.after(save);
  }
  let previousFrame;
  let previousTime;
  setInterval(() => {
    try {
      const emulator = window.EJS_emulator;
      const frame = Number(emulator.gameManager.getFrameNum());
      if (!Number.isFinite(frame)) throw new Error('Core returned an invalid frame counter');
      const now = performance.now();
      const hz = previousTime && frame >= previousFrame
        ? ((frame - previousFrame) * 1000 / (now - previousTime)).toFixed(1) : 'warming up';
      const heap = emulator.Module?.HEAPU8?.byteLength;
      output.textContent = `PCSX-ReARMed · ${hz} emulated frames/s · frame ${frame}\n`
        + `Wasm memory: ${heap ? (heap / 1048576).toFixed(0) + ' MiB' : 'unavailable'} · tab ${document.visibilityState}\n`
        + (sync ? `Network frame ${sync.tick} · verified ${session.verified} · ${session.replaying ? 'replaying' : 'live'}${sync.failure ? ' · ' + sync.failure : ''}\n` : '')
        + (lab || roomOptions?.camera ? `Camera replay: ${[0, 1, 2, 3, 4, 5].map(field => moduleViewStatus(emulator.Module, field)).join(' / ')}\n` : '')
        + 'PAL target: 50 frames/s. Audio and race pacing require separate checks.';
      previousFrame = frame;
      previousTime = now;
    } catch (error) {
      output.textContent = `Benchmark unavailable: ${error.message}`;
    }
  }, 2000);
}
function moduleViewStatus(module, field) { return module._sled_view_status?.(field) ?? 'unavailable'; }
window.addEventListener('pagehide', () => {
  session?.fail('Page closed');
  if (biosUrl) URL.revokeObjectURL(biosUrl);
});

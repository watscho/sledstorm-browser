import { BrowserSession } from '/session-client.js';
import { FrameSync } from './frame-sync.js';
import { canonicalStateDigest, encodeState, decodeState, captureState, restoreCoreState } from './core-state.js';
import { unlockPal } from './pal-profile.js';
import { selectedDisc } from '/local-disc.js';
import { identifyDisc } from './disc-identity.js';
import { parseInvitation, invitationUrl, onlineInvitationUrl } from './invitation.js';
import { checkNetplayInvitation, prepareNetplay, driveRetroPad } from './retroarch-netplay.js';
import { initLobby } from './lobby-ui.js';
import {
  canChooseGameArchive, openGameArchive, chooseGameArchiveDestination, matchingGameArchive, saveGameArchive,
} from './game-data-folder.js';

const launch = document.querySelector('#launch');
const status = document.querySelector('#status');
const game = document.querySelector('#game');
const controllerSlots = document.querySelector('#room-seats');
const gameDataSettings = document.querySelector('#game-data-settings');
const keepGameData = document.querySelector('#keep-game-data');
const gameDataHelp = document.querySelector('#game-data-help');
const gameDataState = document.querySelector('#game-data-state');
const changeGameData = document.querySelector('#change-game-data');
const gameDataDialog = document.querySelector('#game-data-dialog');
const gameDataDialogStatus = document.querySelector('#game-data-dialog-status');
const gameDataDialogActions = [...gameDataDialog.querySelectorAll('button[data-source]')];
const quickTunnel = location.hostname.endsWith('.trycloudflare.com');
let discardGameData;
let archiveSelection;
let biosUrl;
let session, sync;
let sharedRoom;
let roomOptions, launchInfo;
let viewChecks = 0;
let invitation, invitationError;
const lobby = initLobby();
try {
  invitation = parseInvitation(location.hash);
  if (invitation) {
    document.querySelector('#progress').value = invitation.progress;
    document.querySelector('#camera').checked = invitation.camera;
    document.querySelector('#progress').disabled = document.querySelector('#camera').disabled = true;
    lobby.guest();
  }
} catch (error) { invitationError = error; status.textContent = error.message; }
const solo = new URLSearchParams(location.search).has('solo');
const dedicatedWorker = location.origin === 'http://127.0.0.1:8000' && window.sledDedicatedWorker;
if (dedicatedWorker) {
  document.querySelector('#progress').value = dedicatedWorker.progress;
  document.querySelector('#camera').checked = dedicatedWorker.camera;
}
const lab = new URLSearchParams(location.search).has('lab') && location.port === '8000'
  && ['127.0.0.1', 'localhost'].includes(location.hostname);
const localConsole = new URLSearchParams(location.search).has('console') && location.port === '8000'
  && ['127.0.0.1', 'localhost'].includes(location.hostname);
const retroArch = !solo && !lab && !localConsole && (invitation ? invitation.v === 7 :
  new URLSearchParams(location.search).get('transport') !== 'legacy');
let retroRoom;
const diagnostics = new URLSearchParams(location.search).has('diagnostics');
const developerTools = new URLSearchParams(location.search).has('dev');
const showStatus = text => {
  status.textContent = text;
  if (game.classList.contains('joining-room')) game.dataset.joinProgress = text;
};
function describeGameData() {
  let help;
  let state = '';
  if (!quickTunnel) {
    help = keepGameData.checked
      ? 'The first download is kept in this browser for future rooms at this address.'
      : 'Play without saving. An existing browser copy is used once, then cleared.';
  } else if (archiveSelection) {
    state = archiveSelection.file ? 'Game data found' : 'Save location selected';
    help = archiveSelection.file
      ? `“${archiveSelection.file.name}” is ready to use.`
      : `Game data will be saved as “${archiveSelection.destination.name}”.`;
  } else {
    help = keepGameData.checked
      ? 'Use a saved ZIP or save a new copy when you join.'
      : 'Game data will be downloaded for this session.';
  }
  gameDataState.textContent = state;
  gameDataState.hidden = !state;
  gameDataState.classList.toggle('is-ready', Boolean(archiveSelection?.file));
  gameDataHelp.textContent = help;
  changeGameData.hidden = !archiveSelection;
}

keepGameData.addEventListener('change', () => describeGameData());
function showGameDataDialog() {
  gameDataDialogStatus.textContent = '';
  gameDataDialog.returnValue = '';
  gameDataDialog.showModal();
}
changeGameData.addEventListener('click', showGameDataDialog);
gameDataDialog.addEventListener('close', () => {
  if (gameDataDialog.returnValue !== 'session') return;
  keepGameData.checked = false;
  describeGameData();
  launch.click();
});
for (const button of gameDataDialogActions) {
  button.addEventListener('click', async () => {
    const source = button.dataset.source;
    let startAfterSelection = false;
    for (const action of gameDataDialogActions) action.disabled = true;
    gameDataDialogStatus.textContent = '';
    try {
      // Start the native picker in the click handler to preserve user activation.
      if (source === 'open') {
        const file = await openGameArchive();
        gameDataDialogStatus.textContent = 'Verifying the selected ZIP…';
        if (!await matchingGameArchive(file, availableArchive))
          throw new Error('This ZIP does not match the room. Choose a different ZIP or save a new copy.');
        archiveSelection = { file };
      } else {
        archiveSelection = { destination: await chooseGameArchiveDestination(availableArchive) };
        keepGameData.checked = true;
        startAfterSelection = true;
      }
      gameDataDialog.close();
      describeGameData();
      showStatus('');
    } catch (error) {
      if (error.name !== 'AbortError') gameDataDialogStatus.textContent = error.message;
    } finally {
      for (const action of gameDataDialogActions) action.disabled = false;
    }
    if (startAfterSelection) launch.click();
  });
}
let availableArchive;
const launcherInfo = fetch('/session-info').then(async response => {
  if (!response.ok) throw new Error('Could not read launcher settings.');
  const info = await response.json();
  lobby.discMode(info.discMode);
  if (invitation && !solo && info.discMode === 'shared' &&
      (quickTunnel ? canChooseGameArchive && info.archive : Boolean(window.caches))) {
    if (quickTunnel) availableArchive = info.archive;
    describeGameData();
    gameDataSettings.hidden = false;
    if (!quickTunnel) document.querySelector('#keep-game-data-label').textContent = 'Keep game data';
    document.querySelector('#launch-hint').hidden = true;
  }
  if (!invitationError) {
    launch.disabled = false;
    showStatus('');
  }
  return info;
});
launcherInfo.catch(error => { showStatus(error.message); launch.disabled = true; });
if (dedicatedWorker) launcherInfo.then(() => launch.click()).catch(() => {});
async function sharedDiscFile({ disc: fingerprint }, keep) {
  const url = '/disc.zip';
  // Each Quick Tunnel hostname has its own storage that later tunnels cannot clear.
  const cacheAllowed = fingerprint && !quickTunnel;
  let cache;
  if (archiveSelection?.file) {
    try {
      await archiveSelection.file.slice(0, 1).arrayBuffer();
      return archiveSelection.file;
    } catch (error) {
      console.warn('Could not read the selected ZIP.', error);
    }
  }
  if (cacheAllowed) try {
    cache = await window.caches.open('sledstorm-disc-v1');
    const saved = await cache.match(url);
    if (saved?.headers.get('x-sledstorm-disc') === fingerprint) {
      showStatus('Reading cached game data…');
      const blob = await saved.blob();
      if (blob.size > 0) {
        if (!keep) discardGameData = async () => {
          const current = await cache.match(url);
          if (current?.headers.get('x-sledstorm-disc') === fingerprint) await cache.delete(url);
        };
        return new File([blob], 'disc.zip');
      }
    }
  } catch {
    // Private browsing or cleared storage can make the cached copy unavailable.
  }

  showStatus('Downloading game data…');
  const transfer = new AbortController();
  let deadline, blob, expectedSize;
  const resetDeadline = () => {
    clearTimeout(deadline);
    deadline = setTimeout(() => transfer.abort(), 45_000);
  };
  try {
    resetDeadline();
    const response = await fetch(url, { cache: 'no-store', signal: transfer.signal });
    if (response.status !== 200) throw new Error('Could not download the game disc. Reload the invitation to try again.');
    expectedSize = Number(response.headers.get('content-length'));
    let received = 0, lastUpdate = 0;
    const stream = response.body?.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        received += chunk.byteLength;
        const now = performance.now();
        if (now - lastUpdate >= 350) {
          resetDeadline();
          lastUpdate = now;
          const progress = expectedSize ? `${Math.min(100, Math.floor(received * 100 / expectedSize))}%`
            : `${Math.floor(received / 1048576)} MiB`;
          showStatus(`Downloading game data · ${progress}`);
        }
        controller.enqueue(chunk);
      },
    }));
    blob = stream ? await new Response(stream).blob() : await response.blob();
  } catch (error) {
    if (transfer.signal.aborted) throw new Error('Game data stopped downloading. Reload the invitation to try again.');
    if (error instanceof TypeError) throw new Error('The game data download was interrupted. Reload the invitation to try again.');
    throw error;
  } finally {
    clearTimeout(deadline);
  }
  if (!blob.size || (expectedSize && blob.size !== expectedSize)) {
    throw new Error('The game disc download is incomplete. Reload the invitation to try again.');
  }
  if (keep && archiveSelection?.destination) {
    showStatus('Saving game data…');
    try {
      await saveGameArchive(archiveSelection.destination, blob);
    } catch (error) {
      console.warn('Could not save Sled Storm game data.', error);
    }
  }
  if (keep && cache) {
    showStatus('Saving game data in this browser…');
    try {
      await cache.put(url, new Response(blob, { headers: { 'x-sledstorm-disc': fingerprint } }));
    } catch {
      // The current download is still playable when the browser denies storage.
    }
  }
  return new File([blob], 'disc.zip');
}

launch.addEventListener('click', async () => {
  const keep = gameDataSettings.hidden || keepGameData.checked;
  if (quickTunnel && !gameDataSettings.hidden && keep && !archiveSelection) {
    showGameDataDialog();
    return;
  }
  launch.disabled = true;
  changeGameData.disabled = true;
  roomOptions = { progress: document.querySelector('#progress').value, camera: document.querySelector('#camera').checked };
  let discFiles;
  try {
    launchInfo = { ...await launcherInfo };
    const nativeCamera = dedicatedWorker?.nativeCamera ?? (invitation
      ? invitation.nativeCamera === true
      : new URLSearchParams(location.search).get('nativeCamera') !== '0');
    if (retroArch && launchInfo.dedicated && roomOptions.camera && nativeCamera) roomOptions.nativeCamera = true;
    if (invitation?.nativeCamera && !roomOptions.nativeCamera) throw new Error('This room requires the dedicated native camera.');
    if (retroArch && launchInfo.dedicated && document.querySelector('#bios').files.length)
      throw new Error('Dedicated rooms use the built-in BIOS. Remove the custom BIOS before joining.');
    if (retroArch && invitation && launchInfo.roomCheck) {
      showStatus('Checking the invitation…');
      await checkNetplayInvitation(invitation);
    }
    if (launchInfo.discMode === 'local') {
      discFiles = await selectedDisc(document.querySelector('#disc-files').files);
      if (!discFiles) throw new Error('Select your CUE and all eleven BIN tracks.');
      Object.assign(launchInfo, await identifyDisc(discFiles, showStatus));
    }
    if (!solo && roomOptions.progress === 'all' && !launchInfo.pal) throw new Error('The unlock preset requires the verified PAL SLES-02194 disc. Select Original progression.');
    if (!solo && roomOptions.camera && !launchInfo.pal) throw new Error('Separate camera hooks require the verified PAL SLES-02194 disc.');
  } catch (error) {
    showStatus(error.message);
    launch.disabled = changeGameData.disabled = false;
    return;
  }
  const bios = document.querySelector('#bios').files[0];
  for (const input of document.querySelectorAll('#setup input, #setup select')) input.disabled = true;
  if (retroArch && invitation) game.classList.add('joining-room');
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
    EJS_volume: dedicatedWorker || (retroArch && invitation) ? 0 : Number(document.querySelector('#volume').value) / 100,
    EJS_paths: solo ? {} : { 'pcsx_rearmed-wasm.data': '/network-core.data' },
    EJS_disableLocalStorage: !solo,
    EJS_disableDatabases: !solo,
    EJS_defaultOptions: solo ? {} : { pcsx_rearmed_multitap: 'port 1', rewindEnabled: 'disabled' },
    EJS_Buttons: solo ? {} : Object.fromEntries(['playPause', 'play', 'pause', 'restart', 'saveState', 'loadState', 'cheat', 'settings', 'saveSavFiles', 'loadSavFiles', 'quickSave', 'quickLoad', 'contextMenu', 'gamepad'].map(key => [key, false])),
    EJS_ready: () => {
      const originalConfig = window.EJS_GameManager.prototype.getRetroArchCfg;
      window.EJS_GameManager.prototype.getRetroArchCfg = function (...args) {
        return originalConfig.apply(this, args) + `\nvideo_smooth = "${document.querySelector('#image').value === 'smooth'}"\n`;
      };
      if (retroArch) {
        const instance = window.EJS_emulator;
        instance.on('exit', () => retroRoom?.socket.close());
        const prototype = Object.getPrototypeOf(instance);
        const start = prototype.startGame;
        prototype.startGame = async function (...args) {
          try {
            showStatus(invitation ? 'Joining race…' : 'Starting room…');
            const { identity, shareInvitation } = await invitationSettings(bios);
            retroRoom = await prepareNetplay(this, {
              invitation, identity, onInvite: shareInvitation, onClose: netplayFailed,
              onRoster: renderControllerSlots,
              dedicated: launchInfo.dedicated, worker: dedicatedWorker, options: roomOptions,
            });
            start.apply(this, args);
          } catch (error) { netplayFailed(error.message); }
        };
      }
      if (!solo) {
        // Rooms start from identical empty cards, without reading or modifying
        // the user's persistent single-player memory cards.
        window.EJS_GameManager.prototype.mountFileSystems = async function () {
          this.mkdir('/data'); this.mkdir('/data/saves');
        };
      }
    },
    EJS_onGameStart: () => {
      discardGameData?.().catch(error => console.warn('Could not remove the saved Sled Storm archive.', error));
      discardGameData = undefined;
      if (localConsole) startLocalConsole().catch(error => showStatus(error.message));
      else if (lab) restoreLab().catch(error => showStatus(error.message));
      else if (solo) showStatus('Emulator started. Click the game to focus your controls.');
      else if (retroArch) startRetroArchRoom();
      else connectRoom(bios).catch(error => { showStatus(error.message); session?.fail(error.message); });
      startBenchmark();
    },
  });
  lobby.start();
  document.querySelector('#game').classList.add('active');
  document.querySelector('#game').scrollIntoView({ block: 'start' });
  showStatus('Loading emulator and disc…');
  if (!solo && launchInfo.discMode === 'shared') {
    try {
      window.EJS_gameUrl = dedicatedWorker ? '/disc.zip' : await sharedDiscFile(launchInfo, keep);
    } catch (error) {
      if (retroArch) netplayFailed(error.message);
      else showStatus(error.message);
      return;
    }
    showStatus('Starting emulator…');
  }
  const script = document.createElement('script');
  script.src = '/emulator/loader.js';
  script.onerror = () => {
    showStatus('Could not load the emulator. Reload the invitation and try again.');
  };
  document.body.append(script);
});

async function startLocalConsole() {
  const { Module: module, gameManager: manager } = window.EJS_emulator;
  module.sledBeforeFrame = () => false;
  if (new URLSearchParams(location.search).has('fixture')) await restoreFixture(module);
  module.sledBeforeFrame = () => true;
  manager.setKeyboardEnabled(false);
  manager.getFrameNum = () => module._sled_frame_count();
  manager.getState = () => captureState(module, manager.functions.saveStateInfo);
  qualifyView(module, manager);
  let seat = 0;
  manager.simulateInput = (_seat, button, pressed) => manager.functions.simulateInput(seat, button, pressed);
  const label = document.createElement('label');
  label.textContent = 'Diagnostic controller and camera';
  const select = document.createElement('select'); select.id = 'diagnostic-controller';
  for (let slot = 0; slot < 4; slot++) select.add(new Option(`Controller ${slot + 1}`, String(slot)));
  select.addEventListener('change', () => {
    for (let button = 0; button < 16; button++) manager.functions.simulateInput(seat, button, 0);
    seat = Number(select.value); module._sled_view_configure(seat, roomOptions.camera ? 3 : 0);
  });
  label.append(select); document.querySelector('#game').before(label);
  module._sled_view_configure(seat, roomOptions.camera ? 3 : 0);
  module.sledCoreBefore = () => {
    if (roomOptions.progress === 'all') unlockPal(new Uint8Array(module.HEAPU8.buffer, module._sled_ram_pointer(), 0x200000));
    return true;
  };
  showStatus('Local diagnostic console · no network room. Select each controller to join the native race.');
}

async function restoreLab() {
  const { Module: module, gameManager } = window.EJS_emulator;
  module.sledBeforeFrame = () => false;
  gameManager.setKeyboardEnabled(false);
  // The fixture was paused by controller 2; the native menu keeps its owner.
  gameManager.simulateInput = (_seat, button, pressed) => gameManager.functions.simulateInput(1, button, pressed);
  gameManager.getFrameNum = () => module._sled_frame_count();
  await restoreFixture(module);
  qualifyView(module, gameManager);
  module._sled_view_configure(Number(new URLSearchParams(location.search).get('seat')) || 0,
    (new URLSearchParams(location.search).has('hud') ? 3 : 1) |
    (new URLSearchParams(location.search).has('nativeView') ? 4 : 0) |
    (new URLSearchParams(location.search).has('nativeControl') ? 8 : 0) |
    (new URLSearchParams(location.search).has('nativeAssets') ? 16 : 0));
  module.sledBeforeFrame = () => true;
  showStatus('Local camera laboratory · saved two-player race · Enter to unpause. No network room.');
}

async function restoreFixture(module) {
  const response = await fetch('/lab-state');
  if (!response.ok) throw new Error('Local camera fixture is missing. Save a diagnostic race snapshot first.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  canonicalStateDigest(bytes); // Reject a state from a different pinned core.
  restoreCoreState(module, bytes);
}

async function invitationSettings(bios) {
  const info = launchInfo;
  const biosHash = bios ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await bios.arrayBuffer())), x => x.toString(16).padStart(2, '0')).join('') : 'HLE';
  const identity = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([info, biosHash, roomOptions, retroArch ? 'retroarch-netplay-v7' : 'fresh-cards-multitap-port1-v4'])))), x => x.toString(16).padStart(2, '0')).join('');
  const shareInvitation = room => {
    history.replaceState(null, '', invitationUrl(location.href, '/', room, roomOptions));
    sharedRoom = room;
    document.querySelector('#copy-invite').hidden = false;
  };
  return { identity, shareInvitation };
}

function netplayFailed(message) {
  if (retroRoom?.failed) return;
  if (retroRoom) {
    retroRoom.failed = true;
    game.classList.remove('catching-up');
    clearTimeout(retroRoom.syncDeadline);
    retroRoom.socket.close();
    window.EJS_emulator.Module.sledBeforeFrame = () => false;
    renderControllerSlots({ seats: [] });
  }
  if (invitation || (launchInfo?.dedicated && sharedRoom)) {
    game.classList.add('joining-room', 'join-failed');
  }
  showStatus(message);
}

function renderControllerSlots({ seats }) {
  if (!retroArch || dedicatedWorker) return;
  controllerSlots.hidden = false;
  for (const [slot, item] of Array.from(controllerSlots.children).entries()) {
    const connected = seats.some(seat => seat.slot === slot && seat.status === 'connected');
    item.classList.toggle('is-connected', connected);
    item.firstElementChild.textContent = `Controller ${slot + 1} ${connected ? 'connected' : 'disconnected'}`;
  }
}

function startRetroArchRoom() {
  const emulator = window.EJS_emulator;
  const { Module: module, gameManager: manager } = emulator;
  const { slot } = retroRoom;
  module.sledDedicatedClient = launchInfo.dedicated && !dedicatedWorker;
  const drive = dedicatedWorker ? () => {} : driveRetroPad(emulator, lobby.inputOptions());
  // Asset and HUD hooks affect the emulated console. The headless runtime
  // applies the same hooks as every player while skipping local rendering.
  const view = roomOptions.camera ? 2 | (roomOptions.nativeCamera ? 16 : 0) : 0;
  module._sled_view_configure(slot, view && !dedicatedWorker ? view | 1 | (roomOptions.nativeCamera ? 4 : 0) : view);
  qualifyView(module, manager);
  if (!dedicatedWorker) retroRoom.syncDeadline = setTimeout(
    () => netplayFailed('RetroArch could not synchronize with the room.'),
    20_000,
  );
  if (!dedicatedWorker) showStatus('Synchronizing with the room…');
  let ready = false;
  let stalledSince = null;
  let behindSince = null;
  let waiting = false;
  let reportedRace = false;
  module.sledBeforeFrame = () => { drive(); return true; };
  module.sledCoreBefore = () => {
    if (roomOptions.progress === 'all') unlockPal(new Uint8Array(module.HEAPU8.buffer, module._sled_ram_pointer(), 0x200000));
    return true;
  };
  module.sledAfterFrame = () => {
    if (retroRoom.failed) return;
    if (dedicatedWorker) {
      if (!launchInfo.pal || retroRoom.socket.readyState !== WebSocket.OPEN) return;
      const ram = new DataView(module.HEAPU8.buffer, module._sled_ram_pointer(), 0x200000);
      const players = ram.getUint32(0xd6a10, true);
      const racing = ram.getUint32(0xd6980, true) === 1 && players >= 2 && players <= 4;
      if (racing !== reportedRace) {
        reportedRace = racing;
        retroRoom.socket.send(racing ? 'race' : 'lobby');
      }
      return;
    }
    if (ready) {
      if (module.sledDedicatedClient) {
        const behind = module._sled_netplay_status(5);
        const now = performance.now();
        if (behind < 12) behindSince = null;
        else behindSince ??= now;
        // Ignore short frame bursts. A larger backlog still needs immediate recovery.
        const catchingUp = module.sledCatchup
          ? behind > 6
          : behind >= 35 || (behindSince !== null && now - behindSince >= 400);
        if (catchingUp !== Boolean(module.sledCatchup)) {
          module.sledCatchup = catchingUp;
          game.classList.toggle('catching-up', catchingUp);
          emulator.setVolume(catchingUp ? 0 : Number(document.querySelector('#volume').value) / 100);
        }
      }
      if (module._sled_netplay_status(4)) {
        stalledSince ??= performance.now();
        if (!waiting && performance.now() - stalledSince >= 1000) {
          waiting = true;
          showStatus('Waiting for another player to resume. The room is still connected.');
        }
      } else {
        stalledSince = null;
        if (waiting) showStatus('');
        waiting = false;
      }
      return;
    }
    if (module._sled_netplay_status(0) === (1 << slot)) {
      ready = true;
      clearTimeout(retroRoom.syncDeadline);
      game.classList.remove('joining-room');
      if (invitation) emulator.setVolume(Number(document.querySelector('#volume').value) / 100);
      showStatus('');
      retroRoom.publish();
      retroRoom.markSynchronized?.();
    }
  };
}

async function connectRoom(bios) {
  const emulator = window.EJS_emulator;
  // This assignment runs before the first scheduled core frame.
  emulator.Module.sledBeforeFrame = () => false;
  if (emulator.Module.sledFrameGateVersion !== 3 || !emulator.Module._sled_frame_count) {
    emulator.gameManager.toggleMainLoop(0);
    throw new Error('Native frame hooks are missing. Run python3 tools/build-emulator.py, restart the server, and reload.');
  }
  if (invitation) game.classList.add('joining-room');
  showStatus('Connecting session…');
  emulator.gameManager.getState = () => captureState(emulator.Module, emulator.gameManager.functions.saveStateInfo);
  qualifyView(emulator.Module, emulator.gameManager);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  session = new BrowserSession(message => {
    if (session?.error && game.classList.contains('joining-room')) {
      game.classList.add('join-failed');
    }
    showStatus(message);
  }, {
    ...lobby.inputOptions(),
    endpoint: location.port === '8000' ? `${protocol}//${location.hostname}:8004` : `${protocol}//${location.host}/relay`,
    onSnapshotRequest: async tick => ({ data: encodeState(await sync.snapshot(tick)), checks: [...session.digests] }),
    onSnapshot: async message => {
      const bytes = decodeState(message.data);
      const expected = canonicalStateDigest(bytes);
      try {
        sync.restore(bytes, message.tick, expected);
      } catch (error) {
        if (diagnostics && location.port === '8000' && ['127.0.0.1', 'localhost'].includes(location.hostname)) {
          await Promise.all([fetch('/diagnostic-state?frame=999&seat=2', { method: 'POST', body: bytes }),
            fetch('/diagnostic-state?frame=999&seat=3', { method: 'POST', body: emulator.gameManager.getState() })]);
        }
        throw error;
      }
    },
  });
  const { identity, shareInvitation } = await invitationSettings(bios);
  sync = new FrameSync({ externalInput: true, module: emulator.Module, manager: emulator.gameManager, session,
    beforeFrame: () => {
      if (roomOptions.progress === 'all') unlockPal(new Uint8Array(emulator.Module.HEAPU8.buffer, emulator.Module._sled_ram_pointer(), 0x200000));
    },
    onStatus: refreshRoomStatus,
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
  await session.connect(identity, invitation, shareInvitation);
  if (invitation) shareInvitation(invitation);
  emulator.Module._sled_view_configure(session.slot, roomOptions.camera ? 3 : 0);
  sync.start();
  refreshRoomStatus();
}

function qualifyView(module, manager) {
  if (!developerTools && !new URLSearchParams(location.search).has('verifyView')) return;
  let previous, sampledAt = -Infinity;
  module.sledViewBefore = () => {
    const frame = module._sled_frame_count();
    if (frame - sampledAt < 250) { previous = undefined; return; }
    sampledAt = frame;
    previous = canonicalStateDigest(captureState(module, manager.functions.saveStateInfo));
  };
  module.sledViewAfter = () => {
    if (previous === undefined) return;
    const digest = canonicalStateDigest(captureState(module, manager.functions.saveStateInfo));
    if (digest !== previous) {
      const error = 'Camera presentation changed console state. Session stopped.';
      module.sledBeforeFrame = () => false;
      session?.fail(error); showStatus(error);
      throw new Error(error);
    }
    viewChecks++;
  };
}

function refreshRoomStatus() {
  if (!session?.active || !sync || sync.failure) return;
  const replayStart = session.replayStart ?? 0;
  const replayLength = session.replayTarget - replayStart;
  const percent = replayLength > 0 ? Math.min(100, Math.floor((sync.tick - replayStart) * 100 / replayLength)) : 0;
  if (game.classList.contains('joining-room')) {
    if (sync.tick > session.replayTarget) {
      game.classList.remove('joining-room');
      delete game.dataset.joinProgress;
    } else {
      game.dataset.joinProgress = percent > 0 && percent < 100 ? `Synchronizing with the room… ${percent}%` : 'Synchronizing with the room…';
    }
  }
  if (session.replaying) showStatus(`Synchronizing game · ${percent}%`);
  else if (session.syncing) showStatus('Waiting for a joining player to synchronize. The race resumes automatically.');
  else showStatus('');
}

function copyRoomLink(id, getUrl) {
  let copiedTimer;
  const target = document.querySelector(id);
  const label = target.textContent;
  const title = target.title;
  target.addEventListener('click', async event => {
    const button = event.currentTarget;
    let url;
    try { url = await getUrl(); }
    catch (error) { showStatus(error.message || 'Could not get an invitation.'); return; }
    if (!url) return;
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; }
    catch {
      // Keep the URL off screen even when the asynchronous clipboard is unavailable.
      const previousFocus = document.activeElement;
      const field = document.createElement('textarea');
      field.value = url;
      field.setAttribute('aria-hidden', 'true'); field.tabIndex = -1;
      field.style.cssText = 'position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none';
      document.body.append(field); field.select();
      try { copied = document.execCommand('copy'); } catch { /* Report failure below. */ }
      finally { field.remove(); previousFocus?.focus({ preventScroll: true }); }
    }
    clearTimeout(copiedTimer);
    button.textContent = copied ? 'Copied ✓' : 'Try again';
    button.title = copied ? 'Link copied to clipboard' : 'Could not copy. Allow clipboard access and try again.';
    if (!copied) showStatus('Could not copy the link. Allow clipboard access and try again.');
    copiedTimer = setTimeout(() => {
      button.textContent = label; button.title = title;
    }, 2500);
  });
}
copyRoomLink('#copy-invite', async () => {
  if (!sharedRoom) return '';
  const response = await fetch('/session-info', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not read invitation settings.');
  return onlineInvitationUrl(location.href, response.headers.get('x-invite-path'),
    sharedRoom, roomOptions, response.headers.get('x-invite-origin'));
});

// Opt-in probe: count emulated frames, rather than browser animation callbacks.
function startBenchmark() {
  const output = document.createElement('pre');
  output.id = 'benchmark';
  output.setAttribute('aria-label', 'Emulator benchmark');
  const details = document.createElement('details');
  details.id = 'technical-details'; details.open = developerTools || lab || localConsole;
  const summary = document.createElement('summary'); summary.textContent = 'Technical details';
  details.append(summary, output); document.querySelector('.game-bottom').after(details);
  if (developerTools && location.port === '8000') {
    const save = document.createElement('button');
    save.id = 'save-diagnostic';
    save.textContent = 'Save local diagnostic snapshot';
    save.addEventListener('click', async () => {
      if (!localConsole && (!session?.active || session.replaying)) { showStatus('Wait until the session is synchronized.'); return; }
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
      refreshRoomStatus();
      const emulator = window.EJS_emulator;
      const frame = Number(emulator.gameManager.getFrameNum());
      if (!Number.isFinite(frame)) throw new Error('Core returned an invalid frame counter');
      const now = performance.now();
      const hz = previousTime && frame >= previousFrame
        ? ((frame - previousFrame) * 1000 / (now - previousTime)).toFixed(1) : 'warming up';
      const heap = emulator.Module?.HEAPU8?.byteLength;
      output.textContent = (session?.active ? `Controller ${session.slot + 1} · ${session.members || 1}/4 connected · synchronized frame ${sync.tick}\n` : '')
        + (retroRoom ? `RetroArch Netplay · Controller ${retroRoom.slot + 1}${retroRoom.owner ? ' · Room owner' : ''} · ${emulator.Module._sled_netplay_status(1)}/4 playing · synchronized frame ${emulator.Module._sled_netplay_status(2)}${emulator.Module.sledDedicatedClient ? ` · ${emulator.Module._sled_netplay_status(5)} frames behind` : ''}\n` : '')
        + `PCSX-ReARMed · ${hz} emulated frames/s · frame ${frame}\n`
        + `Wasm memory: ${heap ? (heap / 1048576).toFixed(0) + ' MiB' : 'unavailable'} · tab ${document.visibilityState}\n`
        + (sync ? `Network frame ${sync.tick} · verified ${session.verified} · ${session.replaying ? 'replaying' : 'live'}${sync.failure ? ' · ' + sync.failure : ''}\n` : '')
        + (lab || roomOptions?.camera ? `Camera replay: ${[0, 1, 2, 3, 4, 5, 6, 7].map(field => moduleViewStatus(emulator.Module, field)).join(' / ')}\n` : '')
        + (developerTools ? `Presentation isolation: ${viewChecks} state checks passed\n` : '')
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
  retroRoom?.socket.close();
  if (biosUrl) URL.revokeObjectURL(biosUrl);
});

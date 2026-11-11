import { BrowserSession } from '/session-client.js';
import { FrameSync } from './frame-sync.js';
import { canonicalStateDigest, encodeState, decodeState, captureState, restoreCoreState } from './core-state.js';
import { unlockPal } from './pal-profile.js';
import { selectedDisc } from '/local-disc.js';
import { identifyDisc } from './disc-identity.js';
import { parseInvitation, invitationUrl, onlineInvitationUrl } from './invitation.js';
import { checkNetplayInvitation, prepareNetplay, driveRetroPad } from './retroarch-netplay.js';
import { enableSessionDisplay, loadDisplayShaders } from './display.js';
import { openSoloSave, takeLoadRequest, trackSoloSave } from './solo-save.js';
import { initLobby } from './lobby-ui.js';
import {
  canChooseGameArchive, openGameArchive, chooseGameArchiveDestination, matchingGameArchive, saveGameArchive,
  rememberGameArchive, restoreGameArchive, reopenGameArchive,
} from './game-data-folder.js';

const launch = document.querySelector('#launch');
const discInput = document.querySelector('#disc-files');
const biosInput = document.querySelector('#bios');
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
let roomSynchronized = false;
let roomMessage = status.textContent;
let actionNotice = '';
let noticeTimer;
const lobby = initLobby(showActionNotice, () => {
  location.reload();
});
const loadRequestId = /^#load=([0-9a-f-]{36})$/.exec(location.hash)?.[1];
if (loadRequestId) history.replaceState(null, '', location.pathname + location.search);
try {
  invitation = parseInvitation(location.hash);
  if (invitation) {
    document.querySelector('#progress').value = invitation.progress;
    document.querySelector('#camera').checked = invitation.camera;
    document.querySelector('#progress').disabled = document.querySelector('#camera').disabled = true;
    lobby.guest();
  }
} catch (error) { invitationError = error; showStatus(error.message); }
const dedicatedWorker = location.origin === 'http://127.0.0.1:8000' && window.sledDedicatedWorker;
if (dedicatedWorker) {
  document.querySelector('#progress').value = dedicatedWorker.progress;
  document.querySelector('#camera').checked = dedicatedWorker.camera;
}
const lab = new URLSearchParams(location.search).has('lab') && location.port === '8000'
  && ['127.0.0.1', 'localhost'].includes(location.hostname);
const localConsole = new URLSearchParams(location.search).has('console') && location.port === '8000'
  && ['127.0.0.1', 'localhost'].includes(location.hostname);
const hardwarePreview = localConsole && new URLSearchParams(location.search).get('renderer') === 'hardware';
const canSaveSolo = !invitation && !invitationError && !dedicatedWorker && !lab && !localConsole;
const retroArch = !lab && !localConsole && (invitation ? invitation.v === 7 :
  new URLSearchParams(location.search).get('transport') !== 'legacy');
let refreshSoloSave;
let unverifiedSharedRoom = false;
function noteOtherPlayer() {
  if (!launchInfo.pal) unverifiedSharedRoom = true;
}
let retroRoom;
const diagnostics = new URLSearchParams(location.search).has('diagnostics');
const developerTools = new URLSearchParams(location.search).has('dev');
function renderStatus() {
  const message = roomMessage || actionNotice;
  const live = roomSynchronized && !message;
  const label = live ? 'LIVE' : message;
  if (status.textContent !== label) status.textContent = label;
  status.classList.toggle('is-live', live);
}
function showStatus(text) {
  roomMessage = text;
  renderStatus();
  if (game.classList.contains('joining-room')) game.dataset.joinProgress = text;
}
function showActionNotice(text) {
  clearTimeout(noticeTimer);
  actionNotice = text;
  renderStatus();
  noticeTimer = setTimeout(() => {
    actionNotice = '';
    renderStatus();
  }, 4000);
}
function describeGameData() {
  let help;
  let state = '';
  if (!quickTunnel) {
    help = keepGameData.checked
      ? 'The first download is kept in this browser for future rooms at this address.'
      : 'Play without saving. An existing browser copy is used once, then cleared.';
  } else if (archiveSelection) {
    state = archiveSelection.file ? 'Game data ready' : archiveSelection.handle ? 'ZIP selected' : 'Save location selected';
    help = archiveSelection.file
      ? `“${archiveSelection.file.name}” is ready to use.`
      : archiveSelection.handle
        ? `“${archiveSelection.handle.name}” is selected. Press Join game to allow file access again.`
        : `Game data will be saved as “${archiveSelection.destination.name}”.`;
  } else {
    help = keepGameData.checked
      ? 'Use a saved ZIP or save a new copy when you join.'
      : 'Game data will be downloaded for this session.';
  }
  gameDataState.textContent = state;
  gameDataState.hidden = !state;
  gameDataState.classList.toggle('is-ready', Boolean(archiveSelection?.file));
  const selected = Boolean(archiveSelection?.file || archiveSelection?.handle);
  launch.classList.toggle('is-ready', selected);
  if (invitation) document.querySelector('#launch-label').textContent = archiveSelection?.file
    ? 'Join game · Ready' : selected ? 'Join game · ZIP selected' : 'Join game';
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
  keepGameData.dispatchEvent(new Event('change', { bubbles: true }));
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
        const selection = await openGameArchive();
        gameDataDialogStatus.textContent = 'Verifying the selected ZIP…';
        if (!await matchingGameArchive(selection.file, availableArchive))
          throw new Error('This ZIP does not match the room. Choose a different ZIP or save a new copy.');
        archiveSelection = selection;
        await rememberGameArchive(availableArchive, selection.handle);
      } else {
        archiveSelection = { destination: await chooseGameArchiveDestination(availableArchive) };
        keepGameData.checked = true;
        keepGameData.dispatchEvent(new Event('change', { bubbles: true }));
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
let hardwareRendererAvailable = false;
let netplayDelivery, netplayMirrorOrigin;
const launcherInfo = fetch('/session-info').then(async response => {
  if (!response.ok) throw new Error('Could not read launcher settings.');
  hardwareRendererAvailable = response.headers.get('X-Sled-Hardware-Renderer') === 'webgl2';
  // Keep transport discovery separate from the launcher info used for room compatibility.
  netplayDelivery = quickTunnel && response.headers.get('X-Sled-Netplay-Delivery');
  netplayMirrorOrigin = response.headers.get('X-Sled-Netplay-Mirror-Origin');
  const info = await response.json();
  lobby.discMode(info.discMode);
  const nativeCamera = retroArch &&
    (invitation ? invitation.nativeCamera : new URLSearchParams(location.search).get('nativeCamera') !== '0');
  lobby.widescreenAvailable(lab || (invitation ? Boolean(nativeCamera) : info.pal || info.discMode === 'local'));
  if (invitation && info.discMode === 'shared' &&
      (quickTunnel ? canChooseGameArchive && info.archive : Boolean(window.caches))) {
    if (quickTunnel) {
      availableArchive = info.archive;
      archiveSelection = await restoreGameArchive(availableArchive);
    }
    describeGameData();
    gameDataSettings.hidden = false;
    if (!quickTunnel) document.querySelector('#keep-game-data-label').textContent = 'Keep game data';
    document.querySelector('#launch-hint').hidden = true;
  }
  if (!invitationError) {
    launch.disabled = Boolean(canSaveSolo && loadRequestId);
    showStatus(launch.disabled ? 'Loading saved game…' : '');
  }
  return info;
});
launcherInfo.catch(error => { showStatus(error.message); launch.disabled = true; });
if (dedicatedWorker) launcherInfo.then(() => launch.click()).catch(() => {});
if (canSaveSolo && loadRequestId) {
  launcherInfo.then(async () => {
    try {
      const request = await takeLoadRequest(loadRequestId);
      if (!request) throw new Error('This load request has expired.');
      for (const [id, value] of Object.entries(request.settings)) {
        const input = document.getElementById(id);
        if (input.type === 'checkbox') input.checked = value;
        else input.value = value;
      }
      launch.disabled = false;
      await startGame(request);
    } catch (error) {
      launch.disabled = false;
      showStatus(error.message);
    }
  }).catch(() => {});
}
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
    expectedSize = Number(response.headers.get('x-sledstorm-disc-size') ?? response.headers.get('content-length'));
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
      const handle = archiveSelection.destination;
      archiveSelection = { file: await handle.getFile(), handle };
      await rememberGameArchive(availableArchive, handle);
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

launch.addEventListener('click', () => startGame());

async function startGame(loadRequest) {
  if (launch.disabled) return;
  const keep = gameDataSettings.hidden || keepGameData.checked;
  if (archiveSelection?.handle && !archiveSelection.file) {
    launch.disabled = true;
    try {
      archiveSelection = await reopenGameArchive(archiveSelection.handle, availableArchive);
      describeGameData();
    } catch (error) {
      showStatus(error.message);
      return;
    } finally { launch.disabled = false; }
  }
  if (quickTunnel && !gameDataSettings.hidden && keep && !archiveSelection) {
    showGameDataDialog();
    return;
  }
  launch.disabled = true;
  changeGameData.disabled = true;
  roomOptions = {
    progress: document.querySelector('#progress').value,
    camera: document.querySelector('#camera').checked,
  };
  const image = document.querySelector('#image').value;
  let widescreen = document.querySelector('#aspect').value === 'wide';
  let discFiles;
  const renderEnhanced = !dedicatedWorker && document.querySelector('#enhanced-render').checked;
  const drawDistanceInput = document.querySelector('#draw-distance');
  const drawDistance = drawDistanceInput.disabled || dedicatedWorker ? 0 : Number(drawDistanceInput.value);
  let shaders, soloStorage, enableHardwarePreview;
  const bios = loadRequest?.bios ?? biosInput.files[0];
  const files = loadRequest?.files ?? [...discInput.files];
  let resumeSnapshot = loadRequest?.state;
  try {
    launchInfo = { ...await launcherInfo };
    const nativeCamera = dedicatedWorker?.nativeCamera ?? (invitation
      ? invitation.nativeCamera === true
      : new URLSearchParams(location.search).get('nativeCamera') !== '0');
    if (retroArch && roomOptions.camera && nativeCamera) roomOptions.nativeCamera = true;
    if (invitation?.nativeCamera && !roomOptions.nativeCamera) throw new Error('This room requires the native PAL camera.');
    if (retroArch && launchInfo.dedicated && bios)
      throw new Error('Dedicated rooms use the built-in BIOS. Remove the custom BIOS before joining.');
    if (retroArch && invitation && launchInfo.roomCheck) {
      showStatus('Checking the invitation…');
      await checkNetplayInvitation(invitation);
    }
    if (launchInfo.discMode === 'local') {
      discFiles = await selectedDisc(files);
      if (!discFiles) throw new Error('Select your CUE and all eleven BIN tracks.');
      Object.assign(launchInfo, await identifyDisc(discFiles, showStatus));
    }
    if (loadRequest && (loadRequest.disc !== launchInfo.disc || loadRequest.core !== launchInfo.core))
      throw new Error('The saved game no longer matches this disc or emulator.');
    loadRequest = undefined;
    if (roomOptions.progress === 'all' && !launchInfo.pal) throw new Error('The unlock preset requires the verified PAL SLES-02194 disc. Select Original progression.');
    if (roomOptions.camera && !launchInfo.pal) throw new Error('Separate camera hooks require the verified PAL SLES-02194 disc.');
    if (!launchInfo.pal && !lab) widescreen = false;
    shaders = dedicatedWorker ? {} : await loadDisplayShaders();
    const accelerated = retroArch && launchInfo.dedicated && hardwareRendererAvailable && renderEnhanced
      && new URLSearchParams(location.search).get('renderer') !== 'software';
    if ((hardwarePreview || accelerated) && widescreen && launchInfo.pal) {
      try { ({ enableHardwarePreview } = await import('./hardware-preview.js')); }
      catch { if (hardwarePreview) showActionNotice('WebGL2 preview files are unavailable. Using the software renderer.'); }
    }
    if (canSaveSolo) {
      try {
        soloStorage = await openSoloSave(launchInfo, bios);
      } catch { showActionNotice('Browser saves are unavailable.'); }
    }
  } catch (error) {
    showStatus(error.message);
    launch.disabled = changeGameData.disabled = false;
    return;
  }
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
    EJS_paths: { 'pcsx_rearmed-wasm.data': '/network-core.data' },
    EJS_disableLocalStorage: true,
    EJS_disableDatabases: true,
    EJS_shaders: shaders,
    EJS_defaultOptions: {
      pcsx_rearmed_multitap: 'port 1', rewindEnabled: 'disabled',
      ...(dedicatedWorker && { vsync: 'disabled' }),
    },
    EJS_Buttons: Object.fromEntries(['playPause', 'play', 'pause', 'restart', 'saveState', 'loadState', 'cheat', 'settings', 'saveSavFiles', 'loadSavFiles', 'quickSave', 'quickLoad', 'contextMenu', 'gamepad'].map(key => [key, false])),
    EJS_ready: () => {
      const originalConfig = window.EJS_GameManager.prototype.getRetroArchCfg;
      // The WebAudio driver handles a full queue between emulator steps.
      // OpenAL can suspend a step while the core is still preparing a frame.
      const webAudio = (window.AudioContext || window.webkitAudioContext) &&
        ((retroArch && launchInfo.dedicated) || (hardwarePreview && enableHardwarePreview));
      window.EJS_GameManager.prototype.getRetroArchCfg = function (...args) {
        let config = originalConfig.apply(this, args);
        if (dedicatedWorker) {
          // Pace the headless room at the core's rate independently of display refresh.
          config = config.replace(/^video_vsync\s*=[^\r\n]*/m, 'video_vsync = false');
          config += '\nvrr_runloop_enable = true\n';
        }
        if (webAudio && retroArch && launchInfo.dedicated && quickTunnel) {
          // PAL clients need room for both late input batches and the replay they trigger.
          const audioLatency = launchInfo.pal ? 160 : 128;
          config = config.replace(/^audio_latency\s*=[^\r\n]*/m, `audio_latency = ${audioLatency}`);
        }
        return config + '\nvideo_smooth = "false"\n'
          + (webAudio ? 'audio_driver = "rwebaudio"\n' : '');
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
              dedicated: launchInfo.dedicated, worker: dedicatedWorker, widescreen, options: roomOptions,
              netplayDelivery, mirrorOrigin: netplayMirrorOrigin,
              snapshot: launchInfo.dedicated && !dedicatedWorker ? resumeSnapshot : undefined,
            });
            start.apply(this, args);
          } catch (error) { netplayFailed(error.message); }
        };
      }
      // Room state uses fresh memory cards. Progress resumes from the browser snapshot.
      window.EJS_GameManager.prototype.mountFileSystems = async function () {
        this.mkdir('/data'); this.mkdir('/data/saves');
      };
    },
    EJS_onGameStart: () => {
      const module = window.EJS_emulator.Module;
      module.sledEnhancedGraphics = renderEnhanced;
      window.EJS_emulator.Module.sledWidescreen = !dedicatedWorker && widescreen;
      window.EJS_emulator.Module.sledDrawDistance = launchInfo.pal ? drawDistance : 0;
      if (!dedicatedWorker) enableSessionDisplay(window.EJS_emulator, image, shaders, showActionNotice, lobby.rememberFilter);
      if (enableHardwarePreview) {
        try {
          const sharpTextures = hardwarePreview && new URLSearchParams(location.search).get('textures') === 'sharp';
          enableHardwarePreview(module, game, { sharpTextures, scale: hardwarePreview ? 4 : 2 });
          module.sledEnhancedGraphics = true;
        } catch (error) {
          console.warn('Could not initialize the WebGL2 preview.', error);
          showActionNotice('WebGL2 is unavailable. Using the software renderer.');
        }
      }
      discardGameData?.().catch(error => console.warn('Could not remove the saved Sled Storm archive.', error));
      discardGameData = undefined;
      if (localConsole) startLocalConsole().catch(error => showStatus(error.message));
      else if (lab) restoreLab().catch(error => showStatus(error.message));
      else {
        const emulator = window.EJS_emulator;
        const module = emulator.Module;
        try {
          // A dedicated client receives the restored state through Netplay.
          const snapshot = dedicatedWorker?.snapshot ? decodeState(dedicatedWorker.snapshot)
            : retroArch && launchInfo.dedicated ? undefined : resumeSnapshot;
          if (dedicatedWorker) delete dedicatedWorker.snapshot;
          if (snapshot) restoreCoreState(module, snapshot);
          resumeSnapshot = undefined;
        } catch (error) {
          if (retroArch) netplayFailed(error.message);
          else { module.sledBeforeFrame = () => false; showStatus(error.message); }
          return;
        }
        if (soloStorage) refreshSoloSave = trackSoloSave(emulator, soloStorage,
          () => roomSynchronized && !unverifiedSharedRoom && (retroArch
            ? !retroRoom?.failed && retroRoom?.soleController && !module.sledCatchup && module._sled_netplay_status(1) === 1
            : session?.active && session.members === 1 && !session.syncing && !session.replaying) &&
            !isMultiplayerRace(module),
          lobby.saveBeforeExit, showActionNotice, async (state, storage, canSave) => {
            const settings = {
              progress: roomOptions.progress, camera: roomOptions.camera,
              aspect: widescreen ? 'wide' : 'original', 'enhanced-render': renderEnhanced,
              'draw-distance': drawDistance,
              volume: document.querySelector('#volume').value,
            };
            const request = await storage.prepareLoad(state, { files, settings });
            try {
              if (!canSave()) throw new Error('Wait until you are playing alone to load a save.');
              if (retroArch && launchInfo.dedicated) await retroRoom.releaseForLoad();
            } catch (error) {
              await request.cancel().catch(() => {});
              throw error;
            }
            const destination = new URL(location.href);
            destination.hash = 'load=' + request.id;
            history.replaceState(null, '', destination.href);
            location.reload();
          });
        if (retroArch) startRetroArchRoom();
        else connectRoom(bios).catch(error => { showStatus(error.message); session?.fail(error.message); });
      }
      startBenchmark();
    },
  });
  lobby.start();
  game.classList.add('active');
  game.classList.toggle('race-widescreen', widescreen);
  document.querySelector('#game-stage').scrollIntoView({ block: 'start' });
  showStatus('Loading emulator and disc…');
  if (launchInfo.discMode === 'shared') {
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
}

async function startLocalConsole() {
  const emulator = window.EJS_emulator;
  const { Module: module, gameManager: manager } = emulator;
  module.sledBeforeFrame = () => false;
  if (new URLSearchParams(location.search).has('fixture')) await restoreFixture(module);
  module.sledBeforeFrame = () => true;
  manager.setKeyboardEnabled(false);
  manager.getFrameNum = () => module._sled_frame_count();
  manager.getState = () => captureState(module, manager.functions.saveStateInfo);
  qualifyView(module, manager);
  let seat = 0;
  const configureView = () => {
    const camera = roomOptions.camera ? (hardwarePreview ? 23 : 3) : 0;
    module._sled_view_configure(seat, camera | (hardwarePreview && seat === 0 ? 32 : 0));
  };
  manager.simulateInput = (_seat, button, pressed) => manager.functions.simulateInput(seat, button, pressed);
  const label = document.createElement('label');
  label.textContent = 'Diagnostic controller and camera';
  const select = document.createElement('select'); select.id = 'diagnostic-controller';
  for (let slot = 0; slot < 4; slot++) select.add(new Option(`Controller ${slot + 1}`, String(slot)));
  select.addEventListener('change', () => {
    for (let button = 0; button < 16; button++) manager.functions.simulateInput(seat, button, 0);
    seat = Number(select.value);
    configureView();
  });
  label.append(select); document.querySelector('#game').before(label);
  configureView();
  if (hardwarePreview) module.sledBeforeFrame = driveRetroPad(emulator, lobby.inputOptions(), () => seat);
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
    lobby.invitationChanged();
    sharedRoom = room;
    document.querySelector('#copy-invite').hidden = false;
  };
  return { identity, shareInvitation };
}

function netplayFailed(message) {
  if (retroRoom?.failed) return;
  roomSynchronized = false;
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

function renderControllerSlots({ seats }, localSlot) {
  if (!retroArch || dedicatedWorker) return;
  if (retroRoom) {
    const hasOtherSeat = seats.some(seat => seat.slot !== localSlot && seat.status !== 'empty');
    retroRoom.soleController = !hasOtherSeat && seats.some(seat => seat.slot === localSlot && seat.status === 'connected');
    if (hasOtherSeat) noteOtherPlayer();
    refreshSoloSave?.();
  }
  controllerSlots.hidden = false;
  for (const [slot, item] of Array.from(controllerSlots.children).entries()) {
    const connected = seats.some(seat => seat.slot === slot && seat.status === 'connected');
    const local = slot === localSlot;
    item.classList.toggle('is-connected', connected);
    item.classList.toggle('is-local', local);
    const label = `Controller ${slot + 1} · ${local ? 'You' : connected ? 'Connected' : 'Disconnected'}`;
    item.firstElementChild.textContent = item.title = label;
  }
}

function isMultiplayerRace(module) {
  if (!launchInfo.pal) return false;
  const ram = new DataView(module.HEAPU8.buffer, module._sled_ram_pointer(), 0x200000);
  const players = ram.getUint32(0xd6a10, true);
  return ram.getUint32(0xd6980, true) === 1 && players >= 2 && players <= 4;
}

function isLiveMultiplayerRace(module) {
  if (!isMultiplayerRace(module)) return false;
  const ram = new DataView(module.HEAPU8.buffer, module._sled_ram_pointer(), 0x200000);
  // The first racer's PAL race clock starts after the countdown.
  return !ram.getUint32(0xc3ca0, true) && !ram.getUint32(0xc34e0, true) && ram.getInt32(0xdb198, true) > 0;
}

function startRetroArchRoom() {
  const emulator = window.EJS_emulator;
  const { Module: module, gameManager: manager } = emulator;
  const { slot } = retroRoom;
  if (controllerSlots.hidden) renderControllerSlots({ seats: [] }, slot);
  module.sledDedicatedClient = launchInfo.dedicated && !dedicatedWorker;
  const drive = dedicatedWorker ? () => {} : driveRetroPad(emulator, lobby.inputOptions());
  // Asset and HUD hooks affect the emulated console. The headless runtime
  // applies the same hooks as every player while skipping local rendering.
  const view = roomOptions.camera ? 2 | (roomOptions.nativeCamera ? 16 : 0) : 0;
  const soloView = launchInfo.pal && slot === 0 &&
    (module.sledWidescreen || module.sledEnhancedGraphics || module.sledDrawDistance) ? 32 : 0;
  const personalView = view && !dedicatedWorker ? 1 | (roomOptions.nativeCamera ? 4 : 0) : 0;
  module._sled_view_configure(slot, view | personalView | soloView);
  qualifyView(module, manager);
  if (!dedicatedWorker) retroRoom.syncDeadline = setTimeout(
    () => netplayFailed('RetroArch could not synchronize with the room.'),
    20_000,
  );
  if (!dedicatedWorker) showStatus(invitation ? 'Synchronizing with the room…' : 'Starting game…');
  let ready = false;
  let stalledSince = null;
  let behindSince = null;
  let behindFloor = 0;
  let renderBehindSince = null;
  let catchingUpSince = null;
  let showCatchup = false;
  let waiting = false;
  let reportedRace = false;
  const catchupBacklog = 12;
  if (dedicatedWorker && launchInfo.pal) module.sledCanRetainSteering = () => isLiveMultiplayerRace(module);
  if (module.sledDedicatedClient && launchInfo.pal && quickTunnel) {
    let confirmedThrough, confirmedAt, pacedBudget;
    const predictionCap = 18;
    const liveRace = () => ready && !document.hidden && !module.sledCatchup && isLiveMultiplayerRace(module);
    module.sledCanSliceReplay = liveRace;
    module.sledPredictionLimit = unreadFrame => {
      if (!liveRace()) {
        confirmedThrough = undefined;
        return 0;
      }
      const now = performance.now();
      if (unreadFrame !== confirmedThrough) {
        const progress = unreadFrame - (confirmedThrough ?? unreadFrame);
        const partialRecovery = progress > 0 && progress <= 3 &&
          (pacedBudget || now - confirmedAt >= 40);
        const lead = partialRecovery ? module._sled_netplay_status(2) - unreadFrame : 0;
        pacedBudget = lead >= 2 ? lead + 1 : 0;
        confirmedThrough = unreadFrame;
        confirmedAt = now;
      }
      const age = now - confirmedAt;
      // Keep paced progress when a small batch leaves earlier steps unconfirmed.
      if (pacedBudget) return Math.min(predictionCap, pacedBudget + Math.floor(age / 30));
      // Keep ordinary rollback short. Widen the window when confirmations pause,
      // bounded by the existing outage budget and the 18-step ceiling.
      const missedSteps = Math.max(0, Math.floor(age / 20) - 1);
      return Math.min(2 + 2 * missedSteps, 6 + missedSteps, predictionCap);
    };
  }
  module.sledBeforeFrame = () => {
    if (module.sledPaintWideFrame) {
      module.sledPaintWideFrame = false;
      // Give the compositor a turn before starting more emulation.
      if (ready && !document.hidden && !module.sledCatchup && module._sled_netplay_status(5) < catchupBacklog) return false;
    }
    drive();
    return true;
  };
  module.sledCoreBefore = () => {
    if (roomOptions.progress === 'all') unlockPal(new Uint8Array(module.HEAPU8.buffer, module._sled_ram_pointer(), 0x200000));
    return true;
  };
  module.sledAfterFrame = () => {
    if (retroRoom.failed) return;
    if (dedicatedWorker) {
      if (!launchInfo.pal || retroRoom.socket.readyState !== WebSocket.OPEN) return;
      const racing = isMultiplayerRace(module);
      if (racing !== reportedRace) {
        reportedRace = racing;
        retroRoom.socket.send(racing ? 'race' : 'lobby');
      }
      return;
    }
    if (ready) {
      const wasShowingCatchup = showCatchup;
      const wasWaiting = waiting;
      const now = performance.now();
      if (module.sledDedicatedClient) {
        if (launchInfo.pal && quickTunnel) module.sledNetplayAudioReserve = isMultiplayerRace(module);
        const behind = module._sled_netplay_status(5);
        const canRelieveRender = !document.hidden && game.classList.contains('hardware-preview-active') &&
          Boolean(module.sledShouldHoldWideFrame);
        if (!canRelieveRender || behind < catchupBacklog) renderBehindSince = null;
        else renderBehindSince ??= now;
        const renderRelief = canRelieveRender && !module.sledCatchup &&
          (module.sledRenderRelief ? behind > 8
            : behind >= 16 || (renderBehindSince !== null && now - renderBehindSince >= 120));
        if (behind < catchupBacklog) {
          behindSince = null;
        } else if (behindSince === null || (renderRelief && behind <= behindFloor - 2)) {
          // Give lighter rendering time to work while the client is gaining frames.
          behindSince = now;
          behindFloor = behind;
        }
        const recoveryTimeout = renderRelief ? 600 : 400;
        const catchingUp = module.sledCatchup
          ? behind > 6
          : behind >= 35 || (behindSince !== null && now - behindSince >= recoveryTimeout);
        module.sledRenderRelief = renderRelief && !catchingUp ? (behind >= 14 ? 2 : 1) : 0;
        if (catchingUp !== Boolean(module.sledCatchup)) {
          module.sledCatchup = catchingUp;
          catchingUpSince = catchingUp ? now : null;
          emulator.setVolume(catchingUp ? 0 : Number(document.querySelector('#volume').value) / 100);
        }
        showCatchup = catchingUpSince !== null && now - catchingUpSince >= 1000;
        if (showCatchup !== wasShowingCatchup) game.classList.toggle('catching-up', showCatchup);
      }
      if (module._sled_netplay_status(4)) {
        stalledSince ??= now;
        if (!waiting && now - stalledSince >= 1000) {
          waiting = true;
        }
      } else {
        stalledSince = null;
        waiting = false;
      }
      if (refreshSoloSave) {
        if (!launchInfo.pal && module._sled_netplay_status(1) > 1) noteOtherPlayer();
        refreshSoloSave();
      }
      if (wasWaiting !== waiting || wasShowingCatchup !== showCatchup) {
        showStatus(showCatchup ? 'Catching up to the live race…'
          : waiting ? 'Waiting for the room to resume…' : '');
      }
      return;
    }
    if (module._sled_netplay_status(0) === (1 << slot)) {
      ready = true;
      roomSynchronized = true;
      clearTimeout(retroRoom.syncDeadline);
      game.classList.remove('joining-room');
      if (invitation) emulator.setVolume(Number(document.querySelector('#volume').value) / 100);
      showStatus('');
      retroRoom.publish();
      retroRoom.markSynchronized?.();
      refreshSoloSave?.();
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
    if (session?.error) {
      roomSynchronized = false;
      refreshSoloSave?.();
      if (game.classList.contains('joining-room')) game.classList.add('join-failed');
    }
    showStatus(message);
  }, {
    ...lobby.inputOptions(),
    endpoint: location.port === '8000' ? `${protocol}//${location.hostname}:8004` : `${protocol}//${location.host}/relay`,
    onSnapshotRequest: async tick => {
      noteOtherPlayer();
      refreshSoloSave?.();
      return { data: encodeState(await sync.snapshot(tick)), checks: [...session.digests] };
    },
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
  const module = emulator.Module;
  const soloView = launchInfo.pal && session.slot === 0 &&
    (module.sledWidescreen || module.sledEnhancedGraphics || module.sledDrawDistance) ? 32 : 0;
  module._sled_view_configure(session.slot, (roomOptions.camera ? 3 : 0) | soloView);
  sync.start();
  refreshRoomStatus();
}

function qualifyView(module, manager) {
  if (!developerTools && !new URLSearchParams(location.search).has('verifyView')) return;
  module.sledViewDiagnostics = true;
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
  if (session.members > 1) noteOtherPlayer();
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
  else {
    roomSynchronized = !game.classList.contains('joining-room');
    showStatus(roomSynchronized ? '' : 'Synchronizing with the room…');
  }
  refreshSoloSave?.();
}

function copyRoomLink(id, getUrl) {
  let copiedTimer;
  const target = document.querySelector(id);
  const tooltip = target.dataset.tooltip;
  target.addEventListener('click', async event => {
    const button = event.currentTarget;
    let url;
    try { url = await getUrl(); }
    catch (error) { showActionNotice(error.message || 'Could not get an invitation.'); return; }
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
    button.toggleAttribute('data-copied', copied);
    button.dataset.tooltip = copied ? 'Link copied' : 'Could not copy link';
    showActionNotice(copied ? 'Invite link copied.' : 'Could not copy the link. Allow clipboard access and try again.');
    copiedTimer = setTimeout(() => {
      button.removeAttribute('data-copied');
      button.dataset.tooltip = tooltip;
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
      const { Module: module, gameManager: manager } = window.EJS_emulator;
      const synchronized = retroArch
        ? roomSynchronized && retroRoom && !retroRoom.failed && !module.sledCatchup && !module.sledReplayPending &&
          !module._sled_netplay_status(3) && module._sled_netplay_status(0) === (1 << retroRoom.slot)
        : session?.active && !session.replaying;
      if (!localConsole && !synchronized) { showStatus('Wait until the session is synchronized.'); return; }
      save.disabled = true;
      try {
        const state = retroArch ? captureState(module, manager.functions.saveStateInfo) : manager.getState();
        const response = await fetch('/diagnostic-state?frame=1000&seat=3', { method: 'POST', body: state });
        if (!response.ok) throw new Error('Snapshot upload failed.');
        save.textContent = 'Saved local diagnostic snapshot';
      } catch {
        save.disabled = false;
        showActionNotice('Could not save the local snapshot.');
      }
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

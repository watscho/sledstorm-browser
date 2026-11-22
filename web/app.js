import { BrowserSession } from '/session-client.js';
import { FrameSync } from './frame-sync.js';
import { canonicalStateDigest, encodeState, decodeState, captureState, restoreCoreState } from './core-state.js';
import { unlockPal } from './pal-profile.js';
import { sessionDiscMode } from '/local-disc.js';
import { offeredSources, initialSource, copyDisc, rememberCopy, restoreCopy, reopenCopy } from './disc-source.js';
import { parseInvitation, invitationUrl, onlineInvitationUrl } from './invitation.js';
import { invitationVersion, roomIdentity } from './room-identity.js';
import { loadInRoom, takeRejoin } from './room-restore.js';
import { checkNetplayInvitation, prepareNetplay, driveRetroPad } from './retroarch-netplay.js';
import { enableSessionDisplay, loadDisplayShaders } from './display.js';
import { openSoloSave, takeLoadRequest, trackSoloSave } from './solo-save.js';
import { initLobby } from './lobby-ui.js';
import { createSaveManager } from './save-manager.js';
import { enablePerformanceDiagnostics } from './performance-ui.js';
import { downloadDisc } from './disc-download.js';
import {
  canChooseGameArchive, chooseGameArchiveDestination, saveGameArchive, gameDataStore, canKeepCopies, pickCopy,
  askToKeepStorage, unsavedGameDataNotice,
} from './game-data-folder.js';

const launch = document.querySelector('#launch');
const discInputs = { files: document.querySelector('#disc-files'), zip: document.querySelector('#disc-zip') };
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
// Where a Quick Tunnel's download is saved as a ZIP, chosen in the game data dialog (D91).
let zipDestination;
let biosUrl;
let session, sync;
let sharedRoom;
let roomOptions, launchInfo;
let viewChecks = 0;
let invitation, invitationError;
let roomSynchronized = false;
let waitingForRoom = false;
let roomMessage = status.textContent;
let actionNotice = '';
let noticeTimer;
// A browser copy or a ZIP that could not be kept, told once the game runs (D104).
let gameDataNotice = '';
const lobby = initLobby(showActionNotice, () => {
  location.reload();
});
const saveManager = createSaveManager(showActionNotice);
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
const canManageSaves = !invitationError && !dedicatedWorker && !lab && !localConsole;
// A load into a server's room reloads the page, which then comes back to the room by its invitation.
const pendingLoadId = canSaveSolo ? loadRequestId : invitation && canManageSaves ? takeRejoin() : undefined;
const retroArch = !lab && !localConsole && (invitation ? invitation.v === invitationVersion :
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
  // Until the room is LIVE the status shows its progress, which would hide the notice.
  if (live && gameDataNotice) return tellGameDataNotice();
  const label = live ? 'LIVE' : message;
  if (status.textContent !== label) status.textContent = label;
  status.classList.toggle('is-live', live);
}
function showStatus(text) {
  roomMessage = text;
  renderStatus();
  if (game.classList.contains('joining-room')) game.dataset.joinProgress = text;
}
function tellGameDataNotice() {
  if (!gameDataNotice) return;
  const text = gameDataNotice;
  gameDataNotice = '';
  showActionNotice(text);
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
  } else if (zipDestination) {
    state = 'Save location selected';
    help = `Game data will be saved as “${zipDestination.name}”.`;
  } else {
    help = keepGameData.checked
      ? 'Use a saved ZIP or save a new copy when you join.'
      : 'Game data will be downloaded for this session.';
  }
  gameDataState.textContent = state;
  gameDataState.hidden = !state;
  gameDataHelp.textContent = help;
  changeGameData.hidden = !zipDestination;
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
  // The dialog belongs to the download: its joins start from it, whatever was chosen meanwhile.
  lobby.selectDiscSource('download');
  launch.click();
});
for (const button of gameDataDialogActions) {
  button.addEventListener('click', async () => {
    const source = button.dataset.source;
    let startAfterSelection = false, picked;
    for (const action of gameDataDialogActions) action.disabled = true;
    gameDataDialogStatus.textContent = '';
    try {
      // Start the native picker in the click handler to preserve user activation.
      // "Use existing ZIP" chooses the saved ZIP source, which takes any copy of the room's disc (D91).
      if (source === 'open') picked = await pickCopy('zip');
      else {
        zipDestination = await chooseGameArchiveDestination(availableArchive);
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
    // The dialog is closed by then: a ZIP that is not the room's disc is told where the choice is made.
    if (picked && !await chooseCopy('zip', picked)) lobby.showDiscChoice();
    if (startAfterSelection) {
      lobby.selectDiscSource('download');
      launch.click();
    }
  });
}

// The copies of the disc a player chose on this visit, one per source (D87, D88): the files read so far
// (`files`, absent while the browser must ask for access again), the picker's handles where there are
// any, and the check against the room's disc (`check`, then `disc` or `refused`). A refusal is final for
// that copy: the player chooses again, and no other source is tried.
const copies = { files: null, zip: null };
const launchWord = () => invitation ? 'Join game' : 'Start game';
const chosenName = files => files.length === 1 ? `“${files[0].name}”` : `${files.length} files`;
function describeCopy(kind) {
  const copy = copies[kind];
  const what = kind === 'zip' ? 'the saved ZIP' : 'your game files';
  let state = {};
  if (copy?.refused) state = { text: copy.refused };
  else if (copy && !copy.files) state = { status: 'access', text: `Press ${launchWord()} to allow access to ${what} again.` };
  else if (copy?.disc) state = {
    status: 'ready', text: `${chosenName(copy.files)} · checked.`,
    // A deflated ZIP keeps the disc's size in the browser's blob store while the game runs (D86, D90).
    note: copy.disc.held > 0 ? `This ZIP is compressed: the browser keeps about ${Math.ceil(copy.disc.held / 1e6)} MB of it in memory while the game runs. Your CUE and BIN files, or an uncompressed ZIP such as the game data saved from a host, avoid that.` : '',
  };
  else if (copy?.check) state = { status: 'checking', text: `Checking ${what}…` };
  else if (copy) state = { status: 'ready', text: `${chosenName(copy.files)} from your last game.` };
  lobby.describeDisc(kind, state);
}
/** Whether `copy` is still what the player chose: a check of a copy left behind speaks no more. */
const isChosen = (kind, copy) => copies[kind] === copy && lobby.discSource() === kind;
/** Checks a copy against the room's disc once (D89); a copy chosen through the picker is then remembered (D88). */
function checkCopy(kind, copy, info) {
  copy.check ??= copyDisc(copy.files, info, text => { if (isChosen(kind, copy)) showStatus(text); }).then(async disc => {
    copy.disc = disc;
    // The address keeps one copy: the one chosen when its check ends, never one the player left since.
    if (copy.handles && isChosen(kind, copy)) await rememberCopy(gameDataStore, { kind, handles: copy.handles, disc: disc.disc });
    return disc;
  }, error => {
    copy.refused = error.message;
    throw error;
  }).finally(() => { if (copies[kind] === copy) describeCopy(kind); });
  describeCopy(kind);
  return copy.check;
}
/**
 * A copy the player just chose: it is chosen as the source and checked at once, so a wrong disc is told
 * before Join. True when the copy is the room's disc. The status line is left alone once a start began
 * (the launch button is then disabled) or the player chose something else.
 */
async function chooseCopy(kind, { files, handles }) {
  const copy = { files, handles };
  copies[kind] = copy;
  lobby.selectDiscSource(kind);
  try {
    await checkCopy(kind, copy, await launcherInfo);
    if (isChosen(kind, copy) && !launch.disabled) showStatus('');
    return true;
  } catch (error) {
    if (isChosen(kind, copy) && !launch.disabled) showStatus(error.message);
    return false;
  }
}
/**
 * Asks the browser again for a remembered copy's files; call it before any other await of a click (D88).
 * A copy whose file is gone is refused, so the player chooses again; a refused access may be retried.
 */
async function renewCopy(kind, button) {
  const copy = copies[kind];
  if (!copy || copy.files || copy.refused) return;
  try { copy.files = await reopenCopy({ kind, handles: copy.handles }, button); }
  catch (error) {
    if (error.gone) copy.refused = error.message;
    throw error;
  } finally { describeCopy(kind); }
}
// A new choice of source clears what the status line still says about the last one.
document.querySelector('#disc-source').addEventListener('change', event => {
  if (event.target.name === 'disc-source' && !launch.disabled) showStatus('');
});
for (const [kind, input] of Object.entries(discInputs)) {
  document.querySelector(`#choose-disc-${kind}`).addEventListener('click', async () => {
    if (!canKeepCopies) { input.click(); return; }
    try { chooseCopy(kind, await pickCopy(kind)); }
    catch (error) { if (error.name !== 'AbortError') showStatus(error.message); }
  });
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) chooseCopy(kind, { files });
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
  info.discMode = sessionDiscMode(info, response.headers.get('X-Sled-Disc'));
  // The dedicated worker, and the lab and the console where the server gives its disc, load the server's disc.
  const fixedDisc = dedicatedWorker || ((lab || localConsole) && info.discMode === 'shared');
  const offered = fixedDisc ? [] : offeredSources(info);
  const restored = !fixedDisc && canKeepCopies ? await restoreCopy(gameDataStore, info) : null;
  if (restored) copies[restored.kind] = { files: restored.files, handles: restored.handles };
  lobby.discSources(offered, initialSource(offered, lobby.lastDiscSource(), restored?.kind), canKeepCopies);
  for (const kind of Object.keys(copies)) describeCopy(kind);
  const nativeCamera = retroArch &&
    (invitation ? invitation.nativeCamera : new URLSearchParams(location.search).get('nativeCamera') !== '0');
  lobby.widescreenAvailable(lab || (invitation ? Boolean(nativeCamera) : info.pal || info.discMode === 'local'));
  if (invitation && offered.includes('download') &&
      (quickTunnel ? canChooseGameArchive && info.archive : Boolean(window.caches))) {
    availableArchive = info.archive;
    describeGameData();
    gameDataSettings.hidden = false;
    if (!quickTunnel) document.querySelector('#keep-game-data-label').textContent = 'Keep game data';
    document.querySelector('#launch-hint').hidden = true;
  }
  if (!invitationError) {
    launch.disabled = Boolean(pendingLoadId);
    showStatus(launch.disabled ? 'Loading saved game…' : '');
  }
  document.querySelector('#saved-games').hidden = !canManageSaves;
  return info;
});
launcherInfo.catch(error => { showStatus(error.message); launch.disabled = true; });
document.querySelector('#saved-games').addEventListener('click', async event => {
  if (!canManageSaves || saveManager.isOpen()) return;
  const button = event.currentTarget;
  button.disabled = true;
  let storage;
  try {
    // The saves of the disc that the chosen source gives (D87); the server's download is the session's disc.
    const source = lobby.discSource();
    await renewCopy(source, 'Saved games');
    const info = { ...await launcherInfo };
    const copy = copies[source];
    if ((source === 'files' || source === 'zip') && !copy) {
      lobby.showDiscChoice();
      throw new Error('Choose your game files or a saved ZIP in Game files first.');
    }
    const files = copy?.files ?? [];
    if (copy) {
      const disc = await checkCopy(source, copy, info);
      Object.assign(info, { disc: disc.disc, pal: disc.pal });
    }
    storage = await openSoloSave(info, biosInput.files[0]);
    await saveManager.open({
      storage, mode: 'load', playing: false, opener: button, canCapture: () => false,
      // A server's room loads a save for the player who is alone in it, so not before joining.
      canLoad: () => !launch.disabled && !info.serverRoom,
      unavailableReason: () => info.serverRoom
        ? 'Join the room to load a save. Saves load from the game menu while you play alone.' : '',
      keepsRoom: () => info.serverRoom === true,
      onClose: () => storage.close(),
      async load(record) {
        const settings = {
          progress: record.settings?.progress ?? document.querySelector('#progress').value,
          camera: record.settings?.camera ?? document.querySelector('#camera').checked,
          'graphics-preset': lobby.graphics().preset, image: document.querySelector('#image').value,
          aspect: document.querySelector('#aspect').value,
          'enhanced-render': document.querySelector('#enhanced-render').checked,
          'draw-distance': Number(document.querySelector('#draw-distance').value),
          volume: document.querySelector('#volume').value,
        };
        await navigateToSoloSave(record, storage, files, settings);
      },
    });
    showStatus('');
  } catch (error) { storage?.close(); showActionNotice(error.message || 'Could not open saved games.'); }
  finally { button.disabled = false; }
});
if (dedicatedWorker) launcherInfo.then(() => launch.click()).catch(() => {});
if (pendingLoadId) {
  launcherInfo.then(async () => {
    try {
      const request = await takeLoadRequest(pendingLoadId);
      if (!request) throw new Error('This load request has expired.');
      // A server's room already runs the saved game. The page comes back to it and sends no state.
      if (invitation) request.state = undefined;
      for (const [id, value] of Object.entries(request.settings)) {
        const input = document.getElementById(id);
        if (input.type === 'checkbox') input.checked = value;
        else input.value = value;
      }
      lobby.restoreGraphics();
      launch.disabled = false;
      await startGame(request);
    } catch (error) {
      launch.disabled = false;
      showStatus(error.message);
    }
  }).catch(() => {});
}
async function sharedDiscFile(info, keep) {
  const fingerprint = info.disc;
  const url = '/disc.zip';
  // Each Quick Tunnel hostname has its own storage that later tunnels cannot clear.
  const cacheAllowed = fingerprint && !quickTunnel;
  let cache;
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

  // "Download from server": the server's chunks, each checked before it counts and kept as a part in this origin's
  // private file system, so a reload fetches only what is missing; the whole /disc.zip where the server has no
  // chunk routes (D96 to D98). Where the download is meant to stay, the browser is asked not to clear it under storage
  // pressure; never on a Quick Tunnel, whose storage no later address can reach (D103).
  if (keep && cacheAllowed) askToKeepStorage();
  const { file, discard } = await downloadDisc(info, { report: showStatus });
  // The parts are a staging area: they go once the emulator holds the disc, whatever is kept below (D99).
  const earlier = discardGameData;
  discardGameData = earlier ? async () => { try { await earlier(); } finally { await discard(); } } : discard;
  if (keep && zipDestination) {
    showStatus('Saving game data…');
    let saved = false;
    try {
      await saveGameArchive(zipDestination, file);
      saved = true;
      // The saved file is the exact copy of the room's archive: the next visit preselects it as the saved ZIP (D91).
      await rememberCopy(gameDataStore, { kind: 'zip', handles: [zipDestination], disc: fingerprint });
      // ...and the saved ZIP is the choice the next visit starts from (D87 puts the last choice first).
      lobby.rememberDiscSource('zip');
    } catch (error) {
      console.warn('Could not save Sled Storm game data.', error);
      if (!saved) gameDataNotice = unsavedGameDataNotice('zip', error);
    }
  }
  if (keep && cache) {
    showStatus('Saving game data in this browser…');
    try {
      await cache.put(url, new Response(file, { headers: { 'x-sledstorm-disc': fingerprint } }));
    } catch (error) {
      // The current download is still playable when the browser denies storage; the player is told it was not kept.
      gameDataNotice = unsavedGameDataNotice('browser', error);
    }
  }
  return file;
}

launch.addEventListener('click', () => startGame());

async function navigateToSoloSave(record, storage, files, settings, release) {
  const request = await storage.prepareLoad(record, { files, settings });
  try { await release?.(); }
  catch (error) { await request.cancel().catch(() => {}); throw error; }
  const destination = new URL(location.href);
  destination.hash = 'load=' + request.id;
  history.replaceState(null, '', destination.href);
  location.reload();
}

async function startGame(loadRequest) {
  if (launch.disabled) return;
  // The disc comes from the chosen source (D87): a load request's own files, the player's files or ZIP,
  // or the server's download, which a page whose disc is fixed always uses.
  const source = loadRequest ? (loadRequest.files?.length ? 'request' : 'download') : lobby.discSource() ?? 'download';
  const copy = copies[source];
  // A refusal is final for that copy (D89): say it again where the player chooses another, before any request.
  if (copy?.refused) {
    lobby.showDiscChoice();
    showStatus(copy.refused);
    return;
  }
  if (copy && !copy.files) {
    // Renew access first, while the click's activation lasts (D88).
    launch.disabled = true;
    try { await renewCopy(source, launchWord()); }
    catch (error) {
      if (error.gone) lobby.showDiscChoice();
      showStatus(error.message);
      return;
    } finally { launch.disabled = false; }
  }
  if ((source === 'files' || source === 'zip') && !copy) {
    lobby.showDiscChoice();
    showStatus(`Choose your game files or a saved ZIP to ${invitation ? 'join' : 'start'}.`);
    return;
  }
  const keep = gameDataSettings.hidden || keepGameData.checked;
  if (source === 'download' && quickTunnel && !gameDataSettings.hidden && keep && !zipDestination) {
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
  let discFiles, discArchive;
  const renderEnhanced = !dedicatedWorker && document.querySelector('#enhanced-render').checked;
  const drawDistanceInput = document.querySelector('#draw-distance');
  const drawDistance = drawDistanceInput.disabled || dedicatedWorker ? 0 : Number(drawDistanceInput.value);
  let shaders, soloStorage, enableHardwarePreview;
  const bios = loadRequest?.bios ?? biosInput.files[0];
  const files = loadRequest?.files ?? copy?.files ?? [];
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
    // Until the player of a load is back the room answers nobody else, so that player does not ask first.
    if (retroArch && invitation && launchInfo.roomCheck && !pendingLoadId) {
      showStatus('Checking the invitation…');
      await checkNetplayInvitation(invitation);
    }
    // The exact copy of the room's archive goes to the emulator as /disc.zip does, with the session info's
    // identity (D74); any other disc is handed over as separate files, identified and checked (D89).
    const disc = source === 'request' ? await copyDisc(files, launchInfo, showStatus)
      : copy ? await checkCopy(source, copy, launchInfo) : null;
    // Under local-only the page never asks for the server's disc (DATA-01).
    if (!disc && launchInfo.discMode !== 'shared') throw new Error(`Choose your game files or a saved ZIP to ${invitation ? 'join' : 'start'}.`);
    if (disc?.archive) discArchive = disc.archive;
    else if (disc) discFiles = disc.files;
    if (disc) Object.assign(launchInfo, { disc: disc.disc, pal: disc.pal });
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
    if (canSaveSolo || (canManageSaves && retroArch && launchInfo.serverRoom)) {
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
    EJS_gameUrl: discFiles ? discFiles[0].data : discArchive ?? '/disc.zip',
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
        // Match EmulatorJS's exit-time unmount with a real, fresh RAM mount.
        // The pinned Emscripten build exposes FS but not FS.filesystems.
        // Its root mount is MEMFS; reuse that type for a separate fresh mount.
        const memoryFilesystem = this.FS.lookupPath('/').node.mount.type;
        this.FS.mount(memoryFilesystem, {}, '/data/saves');
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
      // Without a room nothing waits to be LIVE: what was not kept is told now.
      if (lab || localConsole) tellGameDataNotice();
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
              // A server's room says who may save and load: the player it belongs to, while it offers a load.
              && (!launchInfo.serverRoom || Boolean(retroRoom.restore && retroRoom.owner))
            : session?.active && session.members === 1 && !session.syncing && !session.replaying) &&
            !isMultiplayerRace(module),
          lobby.saveBeforeExit, showActionNotice, async (record, storage, canSave) => {
            // A server's room keeps its options, whatever the save was made with.
            const saved = retroRoom?.restore ? undefined : record.settings;
            const settings = {
              progress: saved?.progress ?? roomOptions.progress,
              camera: saved?.camera ?? roomOptions.camera,
              'graphics-preset': lobby.graphics().preset, image: document.querySelector('#live-filter').value,
              aspect: widescreen ? 'wide' : 'original', 'enhanced-render': renderEnhanced,
              'draw-distance': drawDistance,
              volume: document.querySelector('#volume').value,
            };
            if (retroRoom?.restore) {
              if (!canSave()) throw new Error('Wait until you are playing alone to load a save.');
              await loadInRoom(retroRoom, storage, record, { files, settings });
              return;
            }
            await navigateToSoloSave(record, storage, files, settings, async () => {
              if (!canSave()) throw new Error('Wait until you are playing alone to load a save.');
              if (retroArch && launchInfo.dedicated) await retroRoom.releaseForLoad();
            });
          }, saveManager, () => ({ progress: roomOptions.progress, camera: roomOptions.camera }), () => {
            if (!roomSynchronized || module.sledCatchup) return 'Wait for the room to finish synchronizing before saving or loading.';
            if (retroArch ? !retroRoom?.soleController : session?.members > 1)
              return 'Saving and loading are paused while another player is connected or reserved.';
            if (isMultiplayerRace(module)) return 'Return to the solo menus to save or load. Multiplayer races and attract demos pause saving.';
            if (launchInfo.serverRoom) return 'Saving and loading are not available in this room right now.';
            return 'Start a new synchronized solo room to save or load a checkpoint.';
          }, () => Boolean(retroRoom?.restore));
        if (retroArch) startRetroArchRoom();
        else connectRoom(bios).catch(error => { showStatus(error.message); session?.fail(error.message); });
      }
      if (!dedicatedWorker) {
        startPerformanceDiagnostics();
        startBenchmark();
      }
    },
  });
  lobby.start();
  game.classList.add('active');
  game.classList.toggle('race-widescreen', widescreen);
  document.querySelector('#game-stage').scrollIntoView({ block: 'start' });
  showStatus('Loading emulator and disc…');
  if (!discFiles && !discArchive) {
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
  // A Netplay room is identified by a fixed list of fields, the same one its server uses. The legacy
  // transport keeps hashing the whole launcher reply.
  const identity = retroArch ? await roomIdentity({ ...info, bios: biosHash, options: roomOptions })
    : Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([info, biosHash, roomOptions, 'fresh-cards-multitap-port1-v4'])))), x => x.toString(16).padStart(2, '0')).join('');
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
      waitingForRoom = waiting;
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

function startPerformanceDiagnostics() {
  enablePerformanceDiagnostics(() => {
    const emulator = window.EJS_emulator;
    const module = emulator.Module;
    const netplay = field => module._sled_netplay_status?.(field) ?? 0;
    const networked = !lab && !localConsole;
    return {
      target: launchInfo.pal ? 50 : 60,
      mode: networked ? (launchInfo.dedicated ? 'dedicated' : 'browser-hosted') : 'local',
      frame: retroArch && networked ? netplay(2) : Number(emulator.gameManager.getFrameNum()),
      confirmedFrame: retroArch && networked ? netplay(6) : undefined,
      connected: !networked || (retroArch ? Boolean(retroRoom && !retroRoom.failed && retroRoom.socket.readyState === WebSocket.OPEN) : Boolean(session?.active)),
      synchronized: !networked || roomSynchronized,
      hidden: document.hidden,
      catchingUp: Boolean(module.sledCatchup || module.sledReplayPending || session?.replaying),
      waiting: Boolean(retroArch ? waitingForRoom : session?.syncing),
      behindFrames: retroArch && module.sledDedicatedClient ? netplay(5) : 0,
      hardware: game.classList.contains('hardware-preview-active'),
      enhanced: Boolean(module.sledEnhancedGraphics), widescreen: Boolean(module.sledWidescreen),
      drawDistance: module.sledDrawDistance || 0,
      filter: document.querySelector('#live-filter').value,
      preset: lobby.graphics().preset,
      memoryBytes: module.HEAPU8?.byteLength,
    };
  }, showActionNotice);
}

// Raw console-step probe retained under the friendly performance panel.
function startBenchmark() {
  const output = document.createElement('pre');
  output.id = 'benchmark';
  output.setAttribute('aria-label', 'Emulator benchmark');
  const details = document.createElement('details');
  details.id = 'technical-details'; details.open = developerTools || lab || localConsole;
  const summary = document.createElement('summary'); summary.textContent = 'Technical details';
  details.append(summary, output); document.querySelector('#performance-panel').append(details);
  if (details.open) document.querySelector('#performance-panel').open = true;
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

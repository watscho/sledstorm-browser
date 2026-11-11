import { captureState } from './core-state.js';
export { openSoloSave, takeLoadRequest } from './save-storage.js';

async function capturePreview(emulator) {
  const wide = await emulator.Module.sledWideGpuScreenshot?.();
  const bytes = wide ?? await emulator.gameManager.screenshot();
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  try {
    const bounds = emulator.Module.canvas?.getBoundingClientRect();
    const aspect = wide ? 16 / 9 : bounds?.width && bounds?.height ? bounds.width / bounds.height : 4 / 3;
    const canvas = document.createElement('canvas');
    canvas.width = 384; canvas.height = Math.round(384 / Math.max(1, Math.min(2.5, aspect)));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#081322'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.78));
    return jpeg ? new Uint8Array(await jpeg.arrayBuffer()) : new Uint8Array();
  } finally { bitmap.close(); }
}

export function trackSoloSave(emulator, storage, canSave, beforeExit, notify, restore, manager, settings, unavailableReason) {
  const button = document.querySelector('#solo-save');
  const loadButton = document.querySelector('#solo-load');
  const exitHelp = document.querySelector('#exit-help');
  let pending, stopped = false;
  let displayedAvailability;
  let loading = false;
  async function capture() {
    if (loading || !canSave()) throw new Error('Wait until you are playing alone to save a checkpoint.');
    const { Module, gameManager } = emulator;
    const savedAt = Date.now();
    const state = captureState(Module, gameManager.functions.saveStateInfo);
    const gameSettings = settings();
    let timeout, preview;
    try {
      preview = await Promise.race([capturePreview(emulator), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Preview timed out')), 3500);
      })]);
    } catch { preview = new Uint8Array(); }
    finally { clearTimeout(timeout); }
    return { state, preview, savedAt, settings: gameSettings };
  }
  async function save() {
    if (pending) await pending.catch(() => {});
    if (loading || !canSave()) return false;
    const write = (async () => {
      const source = await capture();
      if (loading || !canSave()) return false;
      await storage.writeAuto(source);
      return true;
    })();
    pending = write;
    try { return await write; }
    finally { if (pending === write) pending = undefined; }
  }
  const refresh = () => {
    const available = Boolean(canSave());
    if (displayedAvailability === available) return;
    displayedAvailability = available;
    button.hidden = !available;
    loadButton.hidden = false;
    exitHelp.textContent = available
      ? 'Your game is saved before returning to the lobby.'
      : 'Your controller will disconnect. Others can continue if they are still connected.';
    manager.updateAvailability();
  };
  const open = mode => manager.open({
    storage, mode, playing: true, opener: mode === 'save' ? button : loadButton,
    canCapture: () => !loading && canSave(), canLoad: () => !loading && canSave(),
    unavailableReason,
    capture: async () => { if (pending) await pending; return capture(); },
    async load(record) {
      if (loading || !canSave()) throw new Error('Wait until you are playing alone to load a save.');
      await save();
      if (!canSave()) throw new Error('The room changed. Wait until you are playing alone to load a save.');
      loading = true;
      try { await restore(record, storage, canSave); }
      catch (error) { loading = false; refresh(); throw error; }
    },
  });
  button.addEventListener('click', () => open('save'));
  loadButton.addEventListener('click', () => open('load'));
  beforeExit(save);
  const autosave = () => {
    if (!stopped && !pending && !loading && !manager.isOpen()) save().catch(error => notify(error.name === 'QuotaExceededError'
      ? 'Autosave storage is full. Open Saved games to export a backup.' : 'Could not autosave the game. Open Saved games to try a manual save.'));
  };
  const interval = setInterval(() => { if (!document.hidden) autosave(); }, 15000);
  const visibility = () => { if (document.hidden) autosave(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', () => { stopped = true; clearInterval(interval); document.removeEventListener('visibilitychange', visibility); }, { once: true });
  return refresh;
}

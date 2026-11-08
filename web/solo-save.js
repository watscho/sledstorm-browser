import { captureState, validateStateFormat } from './core-state.js';

function openSaves() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sledstorm-solo', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other tabs to update save storage.'));
  });
}

function sessionRecord(db, key, record) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', record ? 'readwrite' : 'readonly');
    const store = transaction.objectStore('sessions');
    const request = record ? store.put(record, key) : store.get(key);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

function removeRequest(db, id, read = false) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', 'readwrite');
    const store = transaction.objectStore('sessions');
    const key = `load:${id}`;
    const request = read ? store.get(key) : null;
    store.delete(key);
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function takeLoadRequest(id) {
  const db = await openSaves();
  try { return await removeRequest(db, id, true); }
  finally { db.close(); }
}

export async function openSoloSave({ disc, core }, bios) {
  if (!disc || !core) throw new Error('Missing game or emulator identity.');
  const biosKey = bios
    ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await bios.arrayBuffer())),
        byte => byte.toString(16).padStart(2, '0')).join('')
    : 'hle';
  const key = [disc, core, biosKey].join(':');
  const db = await openSaves();
  return {
    async readSnapshot() {
      for (const slot of [`${key}:quick`, key]) {
        const record = await sessionRecord(db, slot);
        if (!(record?.state instanceof Uint8Array)) continue;
        try { validateStateFormat(record.state); }
        catch { continue; }
        return record;
      }
    },
    write: (state, manual) => sessionRecord(db, manual ? `${key}:quick` : key, { state, savedAt: Date.now() }),
    async prepareLoad(state, options) {
      const id = crypto.randomUUID();
      await sessionRecord(db, `load:${id}`, { ...options, state, disc, core, bios });
      return { id, cancel: () => removeRequest(db, id) };
    },
  };
}

export function trackSoloSave(emulator, storage, canSave, beforeExit, notify, restore) {
  const button = document.querySelector('#solo-save');
  const loadButton = document.querySelector('#solo-load');
  const exitHelp = document.querySelector('#exit-help');
  let pending;
  let displayedAvailability;
  let loading = false;
  async function save(manual = false) {
    if (pending) await pending.catch(() => {});
    if (loading || !canSave()) return false;
    const { Module, gameManager } = emulator;
    const state = captureState(Module, gameManager.functions.saveStateInfo);
    const write = storage.write(state, manual);
    pending = write;
    try { await write; return true; }
    finally { if (pending === write) pending = undefined; }
  }
  const refresh = () => {
    const available = Boolean(canSave());
    if (displayedAvailability === available) return;
    displayedAvailability = available;
    button.hidden = loadButton.hidden = !available;
    exitHelp.textContent = available
      ? 'Your game is saved before returning to the lobby.'
      : 'Your controller will disconnect. Others can continue if they are still connected.';
  };
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { if (await save(true)) notify('Game saved.'); }
    catch { notify('Could not save the game.'); }
    finally { button.disabled = false; }
  });
  loadButton.addEventListener('click', async () => {
    if (loading || !canSave()) return;
    loading = loadButton.disabled = true;
    let navigating = false;
    try {
      if (pending) await pending.catch(() => {});
      const record = await storage.readSnapshot();
      if (!record) { notify('No saved game yet.'); return; }
      if (!canSave()) { notify('Wait until you are playing alone to load a save.'); return; }
      await restore(record.state, storage, canSave);
      navigating = true;
    } catch (error) {
      notify(error.message || 'Could not load the saved game.');
    } finally {
      if (!navigating) loading = loadButton.disabled = false;
    }
  });
  beforeExit(save);
  const autosave = () => {
    if (!pending) save().catch(() => notify('Could not save the game.'));
  };
  setInterval(() => { if (!document.hidden) autosave(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(); });
  return refresh;
}

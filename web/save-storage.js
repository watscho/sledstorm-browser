import { validateStateFormat } from './core-state.js';
import { AUTO_SLOTS, MANUAL_SLOTS, checkedIdentity, checkCompatibility, identityKey, saveDigest, saveName, gameSettings, previewSize } from './save-file.js';

export function openSaveDatabase(name = 'sledstorm-solo') {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    let failed = false;
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onerror = () => reject(request.error);
    request.onblocked = () => { failed = true; reject(new Error('Close other game tabs, then open saved games again.')); };
    request.onsuccess = () => {
      if (failed) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

// Metadata and large state payloads have separate key ranges in the existing
// store. Old open game tabs cannot block a schema upgrade, and listing slots
// never clones every multi-megabyte console state.
function transaction(db, mode, work) {
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction('sessions', mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); }
    catch (error) {
      if (error.name !== 'TypeError') { reject(error); return; }
      tx = db.transaction('sessions', mode);
    }
    let result, failure;
    const fail = error => { failure = error; tx.abort(); };
    const on = (request, callback) => {
      request.onsuccess = () => { try { callback(request.result); } catch (error) { fail(error); } };
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new Error('The save could not be written. Existing saves were kept.'));
    tx.onerror = () => {};
    try { work(tx.objectStore('sessions'), on, value => { result = value; }, fail); }
    catch (error) { fail(error); }
  });
}

const conflict = () => new Error('This slot changed in another tab. Select it again before continuing.');
const newest = (a, b) => b.savedAt - a.savedAt || b.createdAt - a.createdAt || b.id.localeCompare(a.id);

export async function openSoloSave({ disc, core, adapter = 'pcsx-frame-gate-v3' }, bios, { databaseName } = {}) {
  const identity = checkedIdentity({ disc, core, adapter, bios: bios ? await saveDigest(await bios.arrayBuffer()) : 'hle' });
  const db = await openSaveDatabase(databaseName);
  try { return await createSaveLibrary(db, identity, bios); }
  catch (error) { db.close(); throw error; }
}

export async function createSaveLibrary(db, suppliedIdentity, bios) {
  const identity = checkedIdentity(suppliedIdentity);
  const key = identityKey(identity);
  const legacyKey = [identity.disc, identity.core, identity.bios].join(':');
  const metaPrefix = key + ':v2:meta:';
  const dataPrefix = key + ':v2:data:';
  const range = () => IDBKeyRange.bound(metaPrefix, metaPrefix + '\uffff');
  const listeners = new Set();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('sledstorm-saves-v2') : null;
  let closed = false;
  let migrationWarning = '';
  const notifyLocal = () => { for (const listener of listeners) listener(); };
  if (channel) channel.onmessage = event => { if (event.data === key) notifyLocal(); };
  function changed() {
    notifyLocal();
    if (!closed) channel?.postMessage(key);
  }
  function alive() { if (closed) throw new Error('Save storage was closed. Open saved games again.'); }
  function checkedId(id) {
    if (typeof id !== 'string' || !/^(manual:[1-6]|auto:(legacy|[a-f0-9-]{36}))$/.test(id)) throw new Error('Invalid save slot.');
    return id;
  }
  async function prepared(source, id, kind, slot) {
    if (source.identity) checkCompatibility(source.identity, identity);
    validateStateFormat(source.state);
    const preview = source.preview ?? new Uint8Array();
    previewSize(preview);
    const savedAt = source.savedAt ?? Date.now();
    if (!Number.isSafeInteger(savedAt) || savedAt <= 0 || savedAt > Date.UTC(2200, 0, 1)) throw new Error('Invalid save date.');
    return {
      id, identity, kind, slot, revision: crypto.randomUUID(),
      name: saveName(source.name, kind === 'auto' ? 'Autosave' : 'Slot ' + slot),
      savedAt, createdAt: source.createdAt || Date.now(), preview,
      settings: gameSettings(source.settings), bytes: source.state.length,
      sha256: await saveDigest(source.state),
    };
  }

  async function migrate() {
    const marker = key + ':v2:migrated';
    const old = await transaction(db, 'readonly', (store, on, done) => {
      on(store.get(marker), migrated => {
        if (migrated) { done(null); return; }
        on(store.get(legacyKey + ':quick'), manual => on(store.get(legacyKey), auto => done({ manual, auto })));
      });
    });
    if (!old) return;
    const converted = [];
    for (const kind of ['manual', 'auto']) {
      const source = old[kind];
      if (!source) continue;
      try {
        const id = kind === 'manual' ? 'manual:1' : 'auto:legacy';
        const metadata = await prepared({ ...source, name: kind === 'manual' ? 'Previous manual save' : 'Autosave' }, id, kind, kind === 'manual' ? 1 : null);
        converted.push({ metadata, state: source.state });
      } catch { migrationWarning = 'An older save could not be read. Its original data was kept unchanged.'; }
    }
    await transaction(db, 'readwrite', (store, on) => {
      on(store.get(marker), migrated => {
        if (migrated) return;
        for (const { metadata, state } of converted) {
          store.put(metadata, metaPrefix + metadata.id);
          store.put(state, dataPrefix + metadata.id);
        }
        // Keep the legacy entries as a rollback copy for earlier wrappers.
        store.put(true, marker);
      });
    });
  }
  try { await migrate(); }
  catch (error) { channel?.close(); throw error; }

  const library = {
    identity,
    warning: migrationWarning,
    close() { closed = true; channel?.close(); listeners.clear(); db.close(); },
    subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    async list() {
      alive();
      return transaction(db, 'readonly', (store, on, done) => on(store.getAll(range()), records => done(records.sort(newest))));
    },
    async read(id, expectedRevision) {
      alive(); checkedId(id);
      const record = await transaction(db, 'readonly', (store, on, done) => on(store.get(metaPrefix + id), metadata => {
        if (!metadata) throw new Error('This save is no longer available. Select another slot.');
        if (expectedRevision !== undefined && metadata.revision !== expectedRevision) throw conflict();
        on(store.get(dataPrefix + id), state => done({ ...metadata, state }));
      }));
      checkCompatibility(record.identity, identity);
      validateStateFormat(record.state);
      if (await saveDigest(record.state) !== record.sha256) throw new Error('This stored save is damaged. Import a backup or choose another slot.');
      return record;
    },
    async writeManual(slot, source, expectedRevision = null) {
      alive();
      if (!Number.isInteger(slot) || slot < 1 || slot > MANUAL_SLOTS) throw new Error('Choose a manual slot from 1 to 6.');
      const metadata = await prepared(source, 'manual:' + slot, 'manual', slot);
      const result = await transaction(db, 'readwrite', (store, on, done) => on(store.get(metaPrefix + metadata.id), previous => {
        if ((previous?.revision ?? null) !== expectedRevision) throw conflict();
        metadata.createdAt = previous?.createdAt ?? metadata.createdAt;
        store.put(metadata, metaPrefix + metadata.id);
        store.put(source.state, dataPrefix + metadata.id);
        done(metadata);
      }));
      changed();
      return result;
    },
    async writeAuto(source) {
      alive();
      const metadata = await prepared({ ...source, name: 'Autosave' }, 'auto:' + crypto.randomUUID(), 'auto', null);
      await transaction(db, 'readwrite', (store, on) => on(store.getAll(range()), records => {
        store.put(metadata, metaPrefix + metadata.id);
        store.put(source.state, dataPrefix + metadata.id);
        for (const record of [...records.filter(item => item.kind === 'auto'), metadata].sort(newest).slice(AUTO_SLOTS)) {
          store.delete(metaPrefix + record.id); store.delete(dataPrefix + record.id);
        }
      }));
      changed();
      return metadata;
    },
    async rename(id, name, expectedRevision) {
      alive(); checkedId(id);
      const result = await transaction(db, 'readwrite', (store, on, done) => on(store.get(metaPrefix + id), previous => {
        if (!previous || previous.kind !== 'manual' || previous.revision !== expectedRevision) throw conflict();
        const metadata = { ...previous, name: saveName(name), revision: crypto.randomUUID() };
        store.put(metadata, metaPrefix + id); done(metadata);
      }));
      changed(); return result;
    },
    async remove(id, expectedRevision) {
      alive(); checkedId(id);
      const backup = await transaction(db, 'readwrite', (store, on, done) => on(store.get(metaPrefix + id), metadata => {
        if (!metadata || metadata.kind !== 'manual' || metadata.revision !== expectedRevision) throw conflict();
        on(store.get(dataPrefix + id), state => {
          store.put(metadata, key + ':v2:trash:meta'); store.put(state, key + ':v2:trash:data');
          store.delete(metaPrefix + id); store.delete(dataPrefix + id);
          done({ ...metadata, state });
        });
      }));
      changed(); return backup;
    },
    async deletedInfo() {
      alive();
      return transaction(db, 'readonly', (store, on, done) => on(store.get(key + ':v2:trash:meta'), done));
    },
    async undoDelete(expectedRevision, destination) {
      alive();
      const metadata = await transaction(db, 'readwrite', (store, on, done) => on(store.get(key + ':v2:trash:meta'), previous => {
        if (!previous || previous.revision !== expectedRevision) throw new Error('There is no matching deletion to undo.');
        const slot = destination ?? previous.slot;
        if (!Number.isInteger(slot) || slot < 1 || slot > MANUAL_SLOTS) throw new Error('Choose a manual slot from 1 to 6.');
        const id = 'manual:' + slot;
        on(store.get(metaPrefix + id), occupied => {
          if (occupied) throw new Error('The original slot is in use. Choose an empty slot before restoring this backup.');
          on(store.get(key + ':v2:trash:data'), state => {
            validateStateFormat(state);
            const restored = { ...previous, id, slot, revision: crypto.randomUUID() };
            store.put(restored, metaPrefix + id); store.put(state, dataPrefix + id);
            store.delete(key + ':v2:trash:meta'); store.delete(key + ':v2:trash:data'); done(restored);
          });
        });
      }));
      changed(); return metadata;
    },
    async prepareLoad(record, options) {
      alive();
      checkCompatibility(record.identity, identity);
      validateStateFormat(record.state);
      const id = crypto.randomUUID();
      await transaction(db, 'readwrite', store => store.put({
        files: options.files, settings: options.settings, state: record.state,
        disc: identity.disc, core: identity.core, bios, expiresAt: Date.now() + 300000,
      }, 'load:' + id));
      return { id, cancel: () => transaction(db, 'readwrite', store => store.delete('load:' + id)) };
    },
  };
  return library;
}

export async function takeLoadRequest(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) return;
  const db = await openSaveDatabase();
  try {
    return await transaction(db, 'readwrite', (store, on, done) => on(store.get('load:' + id), record => {
      store.delete('load:' + id);
      done(record && (!record.expiresAt || record.expiresAt >= Date.now()) ? record : undefined);
    }));
  } finally { db.close(); }
}

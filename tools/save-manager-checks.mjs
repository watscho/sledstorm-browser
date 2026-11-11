import { openSaveDatabase, createSaveLibrary, takeLoadRequest } from '/save-storage.js';
import { encodeSaveFile, decodeSaveFile, STATE_BYTES } from '/save-file.js';
import { createSaveManager } from '/save-manager.js';
import { initLobby } from '/lobby-ui.js';

const identity = { disc: '1'.repeat(64), core: '2'.repeat(64), bios: 'hle', adapter: 'pcsx-frame-gate-v3' };
const $ = id => document.getElementById(id);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const rejects = async (action, text) => {
  let error;
  try { await action(); } catch (caught) { error = caught; }
  assert(error && error.message.includes(text), 'Expected rejection: ' + text);
};
const result = message => { const li = document.createElement('li'); li.textContent = 'PASS · ' + message; $('checks-results').append(li); };
const state = marker => {
  const bytes = new Uint8Array(STATE_BYTES);
  bytes.set(new TextEncoder().encode('RASTATE'));
  bytes.set(new TextEncoder().encode('STv4 PCSXra f29871d'), 16);
  new DataView(bytes.buffer).setUint32(0x29934d, 1, true); bytes[0x20000] = marker;
  return bytes;
};
const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 216;
const context = canvas.getContext('2d');
const gradient = context.createLinearGradient(0, 0, 384, 216); gradient.addColorStop(0, '#759ec2'); gradient.addColorStop(1, '#17293e');
context.fillStyle = gradient; context.fillRect(0, 0, 384, 216);
context.fillStyle = '#e9f7ff'; context.beginPath(); context.moveTo(0, 180); context.lineTo(145, 38); context.lineTo(230, 140); context.lineTo(320, 75); context.lineTo(384, 158); context.lineTo(384, 216); context.lineTo(0, 216); context.fill();
const preview = new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8))).arrayBuffer());
const source = (marker, savedAt = Date.now()) => ({ identity, state: state(marker), preview, savedAt, settings: { progress: 'original', camera: true }, name: 'Pine Valley checkpoint' });
const original = new DOMParser().parseFromString(await (await fetch('/launcher.html')).text(), 'text/html');
document.body.append(document.importNode(original.getElementById('save-manager'), true));
const manager = createSaveManager(text => { $('checks-notice').textContent = text; });
const launcher = document.createElement('div'); launcher.hidden = true;
for (const child of [...original.getElementById('app-shell').children, ...original.body.children].filter(child => child.id !== 'app-shell')) {
  if (child.tagName === 'SCRIPT' || child.id === 'save-manager') continue;
  launcher.append(document.importNode(child, true));
}
document.body.append(launcher);
initLobby(() => {}, () => {});
let library, secondary, multiplayer = false;

function tx(db, work) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', 'readwrite');
    work(transaction.objectStore('sessions'));
    transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
  });
}

$('run-checks').addEventListener('click', async () => {
  $('run-checks').disabled = true; $('checks-results').replaceChildren(); $('checks-status').textContent = 'Running…';
  library?.close(); secondary?.close();
  try {
    assert(!$('saves-slots').hidden && $('tab-game').getAttribute('aria-selected') === 'true', 'Lobby tabs must not control save-library panels');
    result('Launcher navigation and the save-library tabs have independent panels.');
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('sledstorm-solo'); request.onsuccess = resolve; request.onerror = () => reject(request.error);
    });
    const db = await openSaveDatabase();
    const key = [identity.disc, identity.core, identity.bios].join(':');
    await tx(db, store => {
      store.put({ state: state(37), savedAt: Date.now() - 60000 }, key + ':quick');
      store.put({ state: state(42), savedAt: Date.now() - 45000 }, key);
    });
    library = await createSaveLibrary(db, identity);
    let rows = await library.list();
    assert(rows.length === 2 && (await library.read('manual:1')).state[0x20000] === 37, 'Legacy manual snapshot must migrate exactly');
    assert((await library.read('auto:legacy')).state[0x20000] === 42, 'Legacy autosave must migrate independently');
    result('Legacy manual and auto saves migrate without upgrading or blocking the existing database.');

    const second = await library.writeManual(2, source(55), null);
    for (let i = 0; i < 5; i++) await library.writeAuto(source(60 + i, Date.now() + i));
    rows = await library.list();
    assert(rows.filter(row => row.kind === 'auto').length === 3, 'Keep exactly three latest autosaves');
    assert(rows.filter(row => row.kind === 'manual').length === 2, 'Autosave must not replace manual slots');
    assert((await library.read('manual:1')).state[0x20000] === 37, 'Original manual data must stay unchanged');
    await rejects(() => library.writeManual(7, source(1)), 'from 1 to 6');
    result('Six manual destinations and a three-entry autosave history stay independent.');

    secondary = await createSaveLibrary(await openSaveDatabase(), identity);
    const renamed = await secondary.rename('manual:2', 'Kodiak Canyon', second.revision);
    assert(renamed.savedAt === second.savedAt, 'Renaming must preserve the checkpoint date');
    await rejects(() => library.writeManual(2, source(99), second.revision), 'another tab');
    assert((await library.read('manual:2')).state[0x20000] === 55, 'A stale writer must not replace the payload');
    const simultaneous = await Promise.allSettled([library.writeManual(3, source(71), null), secondary.writeManual(3, source(72), null)]);
    assert(simultaneous.filter(item => item.status === 'fulfilled').length === 1, 'Only one simultaneous empty-slot writer may succeed');
    result('Cross-tab revisions reject stale and simultaneous overwrites. Renaming preserves the original save date.');

    const put = IDBObjectStore.prototype.put;
    try {
      IDBObjectStore.prototype.put = function(value, id) {
        if (typeof id === 'string' && id.endsWith(':v2:data:manual:2')) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
        return put.call(this, value, id);
      };
      await rejects(() => library.writeManual(2, source(88), renamed.revision), 'Synthetic quota');
    } finally { IDBObjectStore.prototype.put = put; }
    const kept = await library.read('manual:2');
    assert(kept.revision === renamed.revision && kept.state[0x20000] === 55, 'Failed writes must roll back both metadata and state');
    result('A write failure after the metadata update rolls the whole transaction back, keeping the old save intact.');

    await library.remove('manual:2', kept.revision);
    library.close(); secondary.close();
    library = await createSaveLibrary(await openSaveDatabase(), identity);
    const deleted = await library.deletedInfo();
    const restored = await library.undoDelete(deleted.revision);
    assert(restored.savedAt === kept.savedAt && (await library.read('manual:2')).state[0x20000] === 55, 'Undo must survive closing/reopening the library');
    result('The last deletion can be undone after reopening, with the exact state, preview and date.');

    const saved = await library.read('manual:2');
    const file = await encodeSaveFile(saved);
    const imported = await decodeSaveFile(file, identity);
    await library.writeManual(4, { ...imported, name: 'Imported checkpoint' }, null);
    assert((await library.read('manual:4')).sha256 === saved.sha256, 'Export and import must preserve the exact state');
    await rejects(() => decodeSaveFile(file, { ...identity, bios: '3'.repeat(64) }), 'different BIOS');
    result('Portable compressed files preserve state and previews and reject incompatible identities.');

    const request = await library.prepareLoad(saved, { files: [], settings: { progress: 'original', camera: true } });
    const handoff = await takeLoadRequest(request.id);
    assert(handoff.state[0x20000] === 55 && !(await takeLoadRequest(request.id)), 'A load handoff must be consumed once');
    const cancelled = await library.prepareLoad(saved, { files: [], settings: {} }); await cancelled.cancel();
    assert(!(await takeLoadRequest(cancelled.id)), 'Cancelled handoffs must not remain loadable');
    result('Load handoffs are atomic, one-use and cancellable.');

    $('checks-status').textContent = 'All 8 storage checks passed.';
    for (const id of ['open-library', 'open-save', 'toggle-room']) $(id).disabled = false;
  } catch (error) { $('checks-status').textContent = 'FAIL · ' + (error.stack || error.message); }
  finally { $('run-checks').disabled = false; }
});

const open = mode => manager.open({ storage: library, mode, playing: true,
  canCapture: () => !multiplayer, canLoad: () => !multiplayer,
  capture: async () => source(91),
  load: async record => { $('checks-notice').textContent = 'Loaded marker ' + record.state[0x20000]; },
});
$('open-library').addEventListener('click', () => open('load'));
$('open-save').addEventListener('click', () => open('save'));
$('toggle-room').addEventListener('click', () => { multiplayer = !multiplayer; $('toggle-room').textContent = multiplayer ? 'Return to solo' : 'Simulate another player'; manager.updateAvailability(); });

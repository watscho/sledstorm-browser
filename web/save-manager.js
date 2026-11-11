import { MANUAL_SLOTS, AUTO_SLOTS, identityKey, saveName, decodeSaveFile, encodeSaveFile } from './save-file.js';

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = value => value ? dateFormatter.format(new Date(value)) : '';
const sizeLabel = bytes => bytes < 1048576 ? Math.max(1, Math.round(bytes / 1024)) + ' KiB' : (bytes / 1048576).toFixed(1) + ' MiB';
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

export function createSaveManager(notify) {
  const $ = id => document.getElementById(id);
  const dialog = $('save-manager');
  const grid = $('saves-grid');
  const nameInput = $('saves-name');
  const remembered = new Map();
  let context, records = [], selected = 'manual:1', tab = 'manual', draft = '';
  let busy = false, editing = false, confirmation, imported, importKind, returnSelection, deleted;
  let unsubscribe, opener, serial = 0, opening = 0;
  let returnScroll = 0, outsidePress = false, confirmationOpener;
  // A native modal keeps focus/inert handling. Its absolute top-layer box moves
  // with the document; this spacer gives it real page height without inner scroll.
  const pageSpace = node('div', 'saves-page-space'); pageSpace.hidden = true; pageSpace.setAttribute('aria-hidden', 'true');
  dialog.after(pageSpace);
  const sizePage = () => { if (dialog.open) pageSpace.style.height = Math.ceil(dialog.getBoundingClientRect().height + 48) + 'px'; };
  new ResizeObserver(sizePage).observe(dialog);
  let urls = [];
  const selectedRecord = () => records.find(record => record.id === selected);
  const slotNumber = () => Number(selected.split(':')[1]);
  const locked = () => busy || Boolean(confirmation);
  const canCapture = () => Boolean(context?.canCapture?.());
  const canLoad = () => Boolean(context?.canLoad?.());
  const undoSlot = () => !deleted ? null : !records.some(item => item.id === deleted.id) ? deleted.slot
    : Array.from({ length: MANUAL_SLOTS }, (_, index) => index + 1).find(slot => !records.some(item => item.id === 'manual:' + slot));
  const imageUrl = preview => {
    const url = URL.createObjectURL(new Blob([preview], { type: 'image/jpeg' }));
    urls.push(url);
    return url;
  };
  function feedback(text, tone = '') {
    $('saves-feedback').textContent = text;
    $('saves-feedback').dataset.tone = tone;
  }
  function rememberSelection() {
    if (!context) return;
    const key = identityKey(context.storage.identity);
    const previous = remembered.get(key) || {};
    remembered.set(key, { ...previous, [tab]: selected, tab });
  }
  function controls() {
    const record = selectedRecord();
    const manual = tab === 'manual';
    $('saves-close').disabled = busy;
    for (const button of grid.querySelectorAll('button')) button.disabled = locked();
    for (const kind of ['manual', 'auto']) {
      const button = $('saves-' + kind + '-tab');
      button.disabled = locked() || Boolean(imported && kind === 'auto');
      button.setAttribute('aria-selected', String(kind === tab));
      button.tabIndex = kind === tab ? 0 : -1;
    }
    $('saves-slots').setAttribute('aria-labelledby', 'saves-' + tab + '-tab');
    nameInput.disabled = locked() || !manual;
    $('saves-name-editor').hidden = !manual || Boolean(record && !imported && !editing);
    $('saves-rename-actions').hidden = !editing;
    $('saves-name-save').disabled = locked() || !draft.trim() || saveName(draft) === record?.name;
    $('saves-name-cancel').disabled = busy;
    $('saves-write').disabled = locked() || !manual || (!imported && !canCapture());
    $('saves-write').textContent = imported ? (importKind === 'auto' ? 'Keep in Slot ' : 'Import to Slot ') + slotNumber()
      : record ? 'Save current game…' : 'Save to Slot ' + slotNumber();
    $('saves-write').hidden = !manual || Boolean(record && !imported && !context?.playing);
    $('saves-write').className = record && !imported ? 'secondary-button' : 'primary-button';
    $('saves-load').hidden = !record || Boolean(imported);
    $('saves-load').disabled = locked() || !record || Boolean(imported) || !canLoad();
    $('saves-export').disabled = locked() || !record || Boolean(imported);
    $('saves-rename').disabled = locked() || !manual || !record || Boolean(imported);
    $('saves-rename').hidden = !manual;
    $('saves-delete').disabled = locked() || !manual || !record || Boolean(imported);
    $('saves-delete').hidden = !manual;
    $('saves-copy').hidden = manual || !record;
    $('saves-copy').disabled = locked() || Boolean(imported);
    $('saves-primary-actions').hidden = Boolean(confirmation) || editing;
    $('saves-file-actions').hidden = !record || Boolean(imported) || Boolean(confirmation) || editing;
    $('saves-action-help').hidden = Boolean(confirmation) || editing || (!manual && !record);
    $('saves-action-help').textContent = imported ? 'The checkpoint date will be preserved.'
      : record ? 'Loading starts a new solo room.' : 'A new checkpoint of your current solo game.';
    $('saves-import').disabled = locked() || Boolean(imported);
    $('saves-cancel-import').disabled = busy;
    $('saves-confirm-accept').disabled = busy;
    $('saves-confirm-cancel').disabled = busy;
    $('saves-undo').hidden = !deleted;
    const restoreSlot = undoSlot();
    $('saves-undo').disabled = locked() || Boolean(imported) || !restoreSlot;
    $('saves-undo').textContent = deleted && restoreSlot !== deleted.slot ? 'Restore to Slot ' + (restoreSlot || '…') : 'Undo deletion';
    $('saves-undo').title = deleted ? restoreSlot ? 'Restore “' + deleted.name + '” to Slot ' + restoreSlot : 'Free a manual slot to restore this backup.' : '';
    dialog.setAttribute('aria-busy', String(busy));
  }
  function renderSelection() {
    const stored = selectedRecord();
    const record = imported || stored;
    const manual = tab === 'manual';
    $('saves-kind').textContent = imported ? (importKind === 'auto' ? 'KEEP AUTOSAVE' : 'VERIFIED IMPORT')
      : manual ? 'MANUAL SLOT ' + String(slotNumber()).padStart(2, '0') : 'AUTOSAVE';
    $('saves-selected-name').textContent = record?.name || (manual ? 'Empty slot' : 'No autosaves yet');
    $('saves-date').textContent = formatDate(record?.savedAt);
    if (record?.savedAt) $('saves-date').dateTime = new Date(record.savedAt).toISOString();
    else $('saves-date').removeAttribute('datetime');
    if (nameInput.value !== draft) nameInput.value = draft;
    const image = $('saves-preview-image');
    const hasImage = Boolean(record?.preview?.length);
    image.hidden = !hasImage;
    $('saves-preview-empty').hidden = hasImage;
    if (hasImage) { image.src = imageUrl(record.preview); image.alt = 'Preview of ' + record.name; }
    else image.removeAttribute('src');
    $('saves-selected-info').textContent = imported
      ? (stored ? 'Will replace “' + stored.name + '” in Slot ' : 'Will use empty Slot ') + slotNumber() + '. Original checkpoint date is preserved.'
      : record ? 'Sled Storm PAL · ' + sizeLabel(record.bytes || record.state?.length || 0)
        + (record.settings ? ' · ' + (record.settings.progress === 'all' ? 'All content unlocked' : 'Original progression') : '')
      : canCapture() ? 'Save the current game to this slot. Other slots stay available.' : 'Start a solo game to save a checkpoint here, or import a save file.';
    $('saves-pending').hidden = !imported;
    $('saves-pending-title').textContent = importKind === 'auto' ? 'Keep this autosave' : 'Save file verified';
    $('saves-cancel-import').textContent = importKind === 'auto' ? 'Cancel copy' : 'Cancel import';
    $('saves-confirm').hidden = !confirmation;
    controls();
  }
  function paint() {
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
    grid.replaceChildren();
    const manualRecords = records.filter(record => record.kind === 'manual');
    const autos = records.filter(record => record.kind === 'auto');
    $('saves-manual-count').textContent = manualRecords.length + ' / ' + MANUAL_SLOTS;
    $('saves-auto-count').textContent = autos.length + ' / ' + AUTO_SLOTS;
    const entries = tab === 'manual'
      ? Array.from({ length: MANUAL_SLOTS }, (_, index) => ({ id: 'manual:' + (index + 1), number: index + 1,
        record: manualRecords.find(item => item.slot === index + 1) }))
      : autos.map((record, index) => ({ id: record.id, number: index + 1, record }));
    $('saves-empty').hidden = entries.length > 0;
    for (const { id, number, record } of entries) {
      const button = node('button', 'save-slot'); button.type = 'button'; button.dataset.saveId = id;
      button.setAttribute('aria-pressed', String(id === selected));
      const thumb = node('span', 'save-slot-thumb');
      if (record?.preview?.length) {
        const image = node('img'); image.src = imageUrl(record.preview); image.alt = ''; image.decoding = 'async';
        thumb.append(image);
      } else thumb.append(node('span', '', record ? 'NO PREVIEW' : 'EMPTY SLOT'));
      thumb.append(node('small', 'save-slot-number', (tab === 'auto' ? 'AUTO ' : 'SLOT ') + String(number).padStart(2, '0')));
      const body = node('span', 'save-slot-body'); body.append(node('strong', '', record?.name || 'Empty slot'));
      if (record) { const time = node('time', '', formatDate(record.savedAt)); time.dateTime = new Date(record.savedAt).toISOString(); body.append(time); }
      else body.append(node('span', '', 'Ready for a checkpoint'));
      button.append(thumb, body); button.addEventListener('click', () => select(id)); grid.append(button);
    }
    renderSelection();
  }
  function select(id) {
    if (locked()) return;
    editing = false;
    selected = id;
    draft = imported ? draft : selectedRecord()?.name || '';
    rememberSelection(); paint();
    grid.querySelector('button[aria-pressed=true]')?.focus({ preventScroll: true });
  }
  async function refresh() {
    const active = context;
    if (!active) return;
    const request = ++serial;
    const [next, trash] = await Promise.all([active.storage.list(), active.storage.deletedInfo()]);
    if (context !== active || request !== serial || !dialog.open) return;
    const previous = selectedRecord();
    records = next; deleted = trash;
    if (tab === 'auto' && !selectedRecord()) selected = records.find(item => item.kind === 'auto')?.id || '';
    if (!imported && previous?.name === draft) draft = selectedRecord()?.name || '';
    paint();
  }
  async function run(action) {
    if (busy) return;
    busy = true; controls();
    try { return await action(); }
    catch (error) {
      feedback(error?.name === 'QuotaExceededError'
        ? 'Browser storage is full. Export a backup, free some space and try again. Existing saves were kept.'
        : error.message || 'The operation could not be completed. Try again.', 'error');
      await refresh().catch(() => {});
    } finally { busy = false; if (dialog.open) { controls(); if (imported) nameInput.focus(); } }
  }
  function confirm(title, help, label, action) {
    confirmationOpener = document.activeElement;
    confirmation = action;
    $('saves-confirm-title').textContent = title;
    $('saves-confirm-help').textContent = help;
    $('saves-confirm-accept').textContent = label;
    $('saves-confirm').dataset.danger = String(label === 'Delete save');
    renderSelection();
    $('saves-confirm-cancel').focus({ preventScroll: true });
    $('saves-confirm').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function switchTab(kind) {
    if (locked() || (imported && kind === 'auto')) return;
    editing = false;
    tab = kind;
    const saved = remembered.get(identityKey(context.storage.identity));
    selected = kind === 'manual' ? saved?.manual || 'manual:1'
      : records.find(item => item.id === saved?.auto)?.id || records.find(item => item.kind === 'auto')?.id || '';
    draft = imported ? draft : selectedRecord()?.name || '';
    rememberSelection(); paint();
  }
  async function stageImport(record, kind) {
    editing = false;
    returnSelection = { tab, selected };
    imported = record; importKind = kind; tab = 'manual';
    const firstEmpty = Array.from({ length: MANUAL_SLOTS }, (_, index) => 'manual:' + (index + 1))
      .find(id => !records.some(item => item.id === id));
    selected = firstEmpty || remembered.get(identityKey(context.storage.identity))?.manual || 'manual:1';
    draft = record.name;
    paint();
    feedback('Choose a destination slot, then confirm. Your current saves have not changed.');
    nameInput.focus();
  }
  $('saves-write').addEventListener('click', () => {
    if (locked() || tab !== 'manual' || (!imported && !canCapture())) return;
    const destination = slotNumber();
    const previous = selectedRecord();
    const title = saveName(draft, 'Slot ' + destination);
    const pending = imported;
    const action = () => run(async () => {
      feedback(pending ? 'Writing the imported checkpoint…' : 'Capturing your checkpoint…');
      const source = pending || await context.capture();
      if (!pending && !canCapture()) throw new Error('The room changed. Wait until you are playing alone to save.');
      const metadata = await context.storage.writeManual(destination, { ...source, name: title }, previous?.revision ?? null);
      imported = importKind = null; returnSelection = null;
      selected = metadata.id; tab = 'manual'; draft = metadata.name; rememberSelection();
      await refresh(); feedback('Saved to Slot ' + destination + ' · ' + formatDate(metadata.savedAt)
        + (metadata.preview.length ? '' : ' · Preview unavailable'), 'good');
    }).then(() => {
      if (dialog.open && !imported) ($('saves-write').hidden ? $('saves-load') : $('saves-write')).focus({ preventScroll: true });
    });
    if (previous) confirm('Overwrite Slot ' + destination + '?', '“' + previous.name + '” from ' + formatDate(previous.savedAt) + ' will be replaced. Other slots are kept.', 'Overwrite slot', action);
    else action();
  });
  $('saves-load').addEventListener('click', () => {
    const record = selectedRecord();
    if (locked() || !record || imported || !canLoad()) return;
    const action = () => run(async () => {
      const saved = await context.storage.read(record.id, record.revision);
      if (!canLoad()) throw new Error('Wait until you are playing alone to load a save.');
      feedback('Loading “' + saved.name + '”…');
      await context.load(saved);
    });
    if (context.playing) confirm('Load “' + record.name + '”?', 'Your current game will be backed up to an autosave. Loading starts a new room.', 'Load game', action);
    else action();
  });
  $('saves-copy').addEventListener('click', () => {
    const record = selectedRecord();
    if (locked() || !record) return;
    run(async () => stageImport(await context.storage.read(record.id, record.revision), 'auto'));
  });
  $('saves-cancel-import').addEventListener('click', () => {
    if (busy) return;
    const copied = importKind === 'auto';
    imported = importKind = null;
    if (returnSelection) { tab = returnSelection.tab; selected = returnSelection.selected; }
    returnSelection = null; draft = selectedRecord()?.name || ''; paint(); feedback((copied ? 'Copy' : 'Import') + ' cancelled. Your saves were kept.');
  });
  $('saves-import').addEventListener('click', () => $('saves-file').click());
  $('saves-file').addEventListener('change', () => {
    const file = $('saves-file').files[0];
    if (!file || !context || locked()) return;
    const active = context;
    run(async () => {
      feedback('Checking save file…');
      const record = await decodeSaveFile(file, active.storage.identity);
      if (record.preview.length) {
        const bitmap = await createImageBitmap(new Blob([record.preview], { type: 'image/jpeg' })); bitmap.close();
      }
      if (context !== active || !dialog.open) return;
      await stageImport(record, 'file');
    }).finally(() => { $('saves-file').value = ''; });
  });
  $('saves-export').addEventListener('click', () => {
    const record = selectedRecord();
    if (locked() || !record || imported) return;
    run(async () => {
      const saved = await context.storage.read(record.id, record.revision);
      const file = await encodeSaveFile(saved);
      const url = URL.createObjectURL(file);
      const link = node('a'); link.href = url;
      link.download = 'sled-storm-' + (record.kind === 'auto' ? 'autosave' : 'slot-' + record.slot)
        + '-' + new Date(record.savedAt).toISOString().replace(/[:.]/g, '-') + '.sledsave';
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
      feedback('Save exported · ' + sizeLabel(file.size) + '. Keep this file to move or back up your checkpoint.', 'good');
    });
  });
  $('saves-rename').addEventListener('click', () => {
    const record = selectedRecord();
    if (locked() || !record || tab !== 'manual' || imported) return;
    editing = true; draft = record.name; renderSelection(); nameInput.focus(); nameInput.select();
  });
  $('saves-name-cancel').addEventListener('click', () => {
    if (busy) return;
    editing = false; draft = selectedRecord()?.name || ''; renderSelection(); $('saves-rename').focus();
  });
  $('saves-name-save').addEventListener('click', () => {
    const record = selectedRecord();
    if (locked() || !editing || !record || !draft.trim()) return;
    run(async () => {
      const renamed = await context.storage.rename(record.id, draft, record.revision);
      editing = false; draft = renamed.name; await refresh(); feedback('Save renamed. Its checkpoint date is unchanged.', 'good');
    }).then(() => { if (dialog.open && !editing) $('saves-rename').focus({ preventScroll: true }); });
  });
  $('saves-delete').addEventListener('click', () => {
    const record = selectedRecord();
    if (locked() || !record || tab !== 'manual' || imported) return;
    confirm('Delete “' + record.name + '”?', 'The slot will become empty. You can undo your most recent deletion from this library.', 'Delete save', () => run(async () => {
      await context.storage.remove(record.id, record.revision);
      draft = ''; await refresh(); feedback('Save deleted. Undo is available below.', 'good');
    }).then(() => { if (dialog.open && !selectedRecord()) nameInput.focus({ preventScroll: true }); }));
  });
  $('saves-undo').addEventListener('click', () => {
    if (locked() || !deleted) return;
    run(async () => {
      const restored = await context.storage.undoDelete(deleted.revision, undoSlot());
      tab = 'manual'; selected = restored.id; draft = restored.name; await refresh();
      feedback('Save restored to Slot ' + restored.slot + '.', 'good');
    }).then(() => { if (dialog.open) grid.querySelector('button[aria-pressed=true]')?.focus({ preventScroll: true }); });
  });
  $('saves-confirm-accept').addEventListener('click', () => {
    if (busy || !confirmation) return;
    const action = confirmation; confirmation = null; renderSelection(); action();
  });
  function cancelConfirmation() {
    confirmation = null; renderSelection(); confirmationOpener?.focus({ preventScroll: true });
  }
  $('saves-confirm-cancel').addEventListener('click', () => { if (!busy) cancelConfirmation(); });
  for (const kind of ['manual', 'auto']) {
    const button = $('saves-' + kind + '-tab');
    button.addEventListener('click', () => switchTab(kind));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'manual' : event.key === 'End' ? 'auto' : kind === 'manual' ? 'auto' : 'manual';
      switchTab(next); $('saves-' + tab + '-tab').focus();
    });
  }
  nameInput.addEventListener('input', () => { draft = nameInput.value; controls(); });
  nameInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const button = editing ? $('saves-name-save') : $('saves-write');
    if (!button.disabled) button.click();
  });
  $('saves-close').addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', event => {
    if (busy) event.preventDefault();
    else if (confirmation) { event.preventDefault(); cancelConfirmation(); }
    else if (editing) { event.preventDefault(); $('saves-name-cancel').click(); }
  });
  const outside = event => {
    const box = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
  };
  dialog.addEventListener('pointerdown', event => { outsidePress = outside(event); });
  dialog.addEventListener('click', event => {
    if (outsidePress && outside(event) && !busy) dialog.close();
    outsidePress = false;
  });
  dialog.addEventListener('close', () => {
    opening++; serial++; unsubscribe?.(); unsubscribe = null;
    const previous = context; context = null;
    imported = importKind = confirmation = returnSelection = null;
    editing = false;
    document.body.classList.remove('saves-open'); pageSpace.hidden = true;
    document.body.style.removeProperty('--saves-background-top');
    window.scrollTo({ top: returnScroll, behavior: 'instant' });
    for (const url of urls) URL.revokeObjectURL(url); urls = [];
    $('saves-file').value = ''; previous?.onClose?.();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  return {
    isOpen: () => dialog.open,
    updateAvailability() { if (dialog.open) { controls(); $('saves-session-note').textContent = context?.playing
      ? canCapture() ? 'Game continues while this window is open. Autosave resumes when you close it.'
        : context.unavailableReason?.() || 'Saving and loading need a synchronized solo session. Return to the solo menus or wait for other players to leave.'
      : 'Load a checkpoint to start a new solo room. Your current graphics and controls stay in place.'; } },
    async open(next) {
      if (dialog.open || busy) return;
      const generation = ++opening;
      context = next; records = []; deleted = null; confirmation = imported = importKind = null; editing = false;
      opener = next.opener || document.activeElement; busy = true;
      tab = 'manual'; selected = 'manual:1'; draft = '';
      returnScroll = window.scrollY;
      document.body.style.setProperty('--saves-background-top', -returnScroll + 'px');
      document.body.classList.add('saves-open'); pageSpace.hidden = false;
      paint(); dialog.showModal(); sizePage(); window.scrollTo({ top: 0, behavior: 'instant' }); feedback('Reading your saved games…');
      try {
        await refresh();
        if (generation !== opening) return;
        const previous = remembered.get(identityKey(next.storage.identity));
        if (next.mode === 'save') {
          tab = 'manual'; selected = previous?.manual || Array.from({ length: MANUAL_SLOTS }, (_, index) => 'manual:' + (index + 1)).find(id => !records.some(item => item.id === id)) || 'manual:1';
        } else {
          const latest = records[0]; tab = latest?.kind || 'manual'; selected = latest?.id || 'manual:1';
        }
        draft = selectedRecord()?.name || ''; busy = false; paint(); this.updateAvailability();
        feedback(next.storage.warning || 'Stored in this browser. Export a copy to keep a backup or move it to another computer.');
        unsubscribe = next.storage.subscribe(() => { refresh().catch(error => { if (dialog.open) feedback(error.message, 'error'); }); });
        if (next.mode === 'save' && !selectedRecord()) nameInput.focus();
        else grid.querySelector('button[aria-pressed=true]')?.focus();
      } catch (error) { busy = false; controls(); feedback(error.message || 'Save storage is unavailable.', 'error'); notify('Could not read saved games.'); }
    },
  };
}

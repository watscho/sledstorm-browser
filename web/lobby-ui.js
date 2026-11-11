import { initControls } from './controls-ui.js';
import { GRAPHICS_LABELS, restoreGraphics, selectGraphicsPreset, customizeGraphics } from './graphics-presets.js';

// Presentation controls only. Console state and room settings remain in app.js.
export function initLobby(notify, returnToLobby) {
  const $ = selector => document.querySelector(selector);
  const storageKey = 'sledstorm.display.v1';
  let preferences = {};
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) preferences = saved;
  } catch { /* Use defaults when storage is unavailable. */ }
  const remember = patch => {
    Object.assign(preferences, patch);
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)); }
    catch { /* The current selection still applies. */ }
  };
  const controls = initControls();
  $('.skip-link').addEventListener('click', event => { event.preventDefault(); $('#setup').focus(); });
  const tabs = [...$('#setup').querySelectorAll('[role=tab]')];
  const activate = (tab, persist = true) => {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    }
    if (persist) remember({ tab: tab.id });
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let index = tabs.indexOf(tab);
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activate(tabs[index]); tabs[index].focus();
    });
  }
  activate(tabs.find(tab => tab.id === preferences.tab) || tabs[0], false);
  const aspect = $('#aspect');
  const wideOption = aspect.querySelector('[value=wide]');
  const image = $('#image');
  const enhanced = $('#enhanced-render');
  const progress = $('#progress');
  const camera = $('#camera');
  const volume = $('#volume');
  const drawDistance = $('#draw-distance');
  const keepGameData = $('#keep-game-data');
  const graphicsPreset = $('#graphics-preset');
  let graphics = restoreGraphics(preferences);
  const paintGraphics = () => {
    graphicsPreset.value = graphics.preset;
    image.value = graphics.settings.filter;
    enhanced.checked = graphics.settings.enhanced;
    drawDistance.value = graphics.settings.drawDistance;
  };
  paintGraphics();
  if ([...progress.options].some(option => option.value === preferences.progress)) progress.value = preferences.progress;
  if (typeof preferences.camera === 'boolean') camera.checked = preferences.camera;
  if (typeof preferences.keepGameData === 'boolean') keepGameData.checked = preferences.keepGameData;
  if (Number.isInteger(preferences.volume) && preferences.volume >= 0 && preferences.volume <= 100) volume.value = preferences.volume;
  let widescreenAvailable = false;
  let locked = false;
  const refresh = () => {
    wideOption.disabled = !widescreenAvailable;
    drawDistance.disabled = locked || !widescreenAvailable;
    aspect.value = wideOption.disabled ? 'original' : graphics.settings.aspect;
    const descriptions = {
      performance: '4:3 · Crisp pixels · 1× · Original distance. A lighter starting point.',
      balanced: '16:9 · Clean · 1× · +50% distance. A middle ground for personal cameras.',
      quality: '16:9 · Clean · 2× · +100% distance. The current graphics defaults.',
      custom: 'Your manual graphics settings. Choose a preset to apply its settings together.',
    };
    $('#graphics-preset-help').textContent = descriptions[graphics.preset] +
      (!widescreenAvailable && (graphics.settings.aspect === 'wide' || graphics.settings.drawDistance > 0)
        ? ' This room uses 4:3 and Original distance; your preference is kept.' : '');
    $('#summary-graphics').textContent = GRAPHICS_LABELS[graphics.preset];
    $('#summary-progress').textContent = $('#progress').selectedOptions[0].textContent;
    $('#summary-camera').textContent = $('#camera').checked ? 'Personal view' : 'Original shared view';
    $('#summary-image').textContent = image.selectedOptions[0].textContent +
      (enhanced.checked ? ' · 2×' : '');
    $('#summary-aspect').textContent = aspect.selectedOptions[0].textContent;
    $('#volume-value').textContent = `${$('#volume').value}%`;
    const distanceLabel = drawDistance.value === '0' ? 'Original' : `+${drawDistance.value}%`;
    $('#draw-distance-value').textContent = distanceLabel;
    drawDistance.setAttribute('aria-valuetext', distanceLabel);
    const files = $('#disc-files').files;
    $('#disc-selection').textContent = files.length ? `${files.length} files selected` : '';
  };
  const commitGraphics = next => {
    graphics = next;
    remember({ ...graphics.settings, graphicsPreset: graphics.preset, customGraphics: graphics.custom, graphicsDefaults: 1 });
    paintGraphics();
    refresh();
  };
  const rememberFilter = filter => commitGraphics(customizeGraphics(graphics, { filter }));
  graphicsPreset.addEventListener('change', () => commitGraphics(selectGraphicsPreset(graphics, graphicsPreset.value)));
  volume.addEventListener('input', refresh);
  drawDistance.addEventListener('input', () => commitGraphics(customizeGraphics(graphics, { drawDistance: Number(drawDistance.value) })));
  $('#setup').addEventListener('change', event => {
    const input = event.target;
    if (input === aspect) {
      commitGraphics(customizeGraphics(graphics, { aspect: aspect.value }));
    } else if (input === image) rememberFilter(image.value);
    else if (input === progress) remember({ progress: progress.value });
    else if (input === camera) remember({ camera: camera.checked });
    else if (input === enhanced) commitGraphics(customizeGraphics(graphics, { enhanced: enhanced.checked }));
    else if (input === volume) remember({ volume: Number(volume.value) });
    else if (input === keepGameData) remember({ keepGameData: keepGameData.checked });
    refresh();
  });
  $('#reset-settings').addEventListener('click', () => {
    for (const [id, value] of [['progress', 'all'], ['image', 'clean'], ['volume', '50']]) {
      if (!$(`#${id}`).disabled) $(`#${id}`).value = value;
    }
    commitGraphics(restoreGraphics());
    if (!$('#camera').disabled) $('#camera').checked = true;
    keepGameData.checked = true;
    keepGameData.dispatchEvent(new Event('change'));
    remember({ volume: 50, keepGameData: true,
      ...(!progress.disabled && { progress: progress.value, camera: camera.checked }) });
    $('#bios').value = ''; $('#disc-files').value = '';
    controls.reset();
    refresh();
  });
  const dialog = $('#exit-dialog');
  let saveBeforeExit;
  const brand = $('.brand');
  // Keep the room capability and diagnostic options in every lobby link,
  // including modified clicks that open a new tab.
  const updateBrand = () => brand.href = location.href;
  updateBrand();
  window.addEventListener('hashchange', updateBrand);
  brand.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!$('#game-stage').hidden) dialog.showModal();
    else $('#setup').focus();
  });
  $('#back-lobby').addEventListener('click', () => dialog.showModal());
  $('#stay-game').addEventListener('click', () => dialog.close());
  $('#confirm-exit').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await saveBeforeExit?.();
      returnToLobby();
    } catch {
      dialog.close();
      notify('Could not save this session. Use Save to retry or close the tab.');
    } finally {
      button.disabled = false;
    }
  });
  $('#fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await $('#game').requestFullscreen();
        $('#game').focus({ preventScroll: true });
      }
    } catch { notify('Fullscreen is unavailable in this browser. You can continue in the window.'); }
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.fullscreenElement && !$('dialog[open]')) {
      event.preventDefault();
      document.exitFullscreen().catch(() => {});
      return;
    }
    if ($('#game-stage').hidden || event.repeat || event.isComposing || $('dialog[open]') ||
        event.target.closest?.('input,select,textarea,[contenteditable]')) return;
    const command = event.metaKey !== event.ctrlKey && !event.altKey && !event.shiftKey;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    let button;
    if ((command && event.code === 'KeyS') || (plain && event.code === 'F9')) button = $('#solo-save');
    else if ((command && event.code === 'KeyL') || (plain && event.code === 'F10')) button = $('#solo-load');
    else if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.code === 'Enter')
      button = $('#fullscreen');
    if (!button || button.hidden || button.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    button.click();
  }, true);
  document.addEventListener('fullscreenchange', () => {
    const button = $('#fullscreen');
    const active = Boolean(document.fullscreenElement);
    button.toggleAttribute('data-fullscreen', active);
    button.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Fullscreen');
    button.dataset.tooltip = active ? 'Exit fullscreen (Alt+Enter / Esc)' : 'Fullscreen (Alt+Enter)';
  });
  refresh();
  return {
    rememberFilter,
    graphics: () => ({ preset: graphics.preset, ...graphics.settings }),
    restoreGraphics() {
      commitGraphics(restoreGraphics({
        aspect: aspect.value, filter: image.value, enhanced: enhanced.checked,
        drawDistance: Number(drawDistance.value), graphicsPreset: graphicsPreset.value, customGraphics: graphics.custom,
      }));
    },
    saveBeforeExit(save) { saveBeforeExit = save; },
    widescreenAvailable(available) {
      widescreenAvailable = available;
      refresh();
    },
    inputOptions: () => controls.options(),
    guest() {
      $('#launch-label').textContent = 'Join game';
      $('#summary-session').textContent = 'Join existing room';
      $('#lobby-title').textContent = 'Join game';
      $('#room-note').textContent = 'Progress and camera settings come from the host.';
      refresh();
    },
    discMode(mode) {
      const local = mode === 'local';
      $('#disc-settings').hidden = !local;
      $('#disc-title').textContent = local ? 'Use your local disc' : 'Host disc connected';
      $('#disc-description').textContent = local
        ? 'Choose matching PAL CUE/BIN files before joining.'
        : 'The complete game and music load automatically. No file selection needed.';
    },
    start() {
      locked = true;
      controls.lock();
      document.body.classList.add('is-playing');
      $('#game-stage').hidden = false;
      $('.stage-status').append($('#status'));
    },
    invitationChanged: updateBrand,
  };
}

import { initControls } from './controls-ui.js';

// Presentation controls only. Console state and room settings remain in app.js.
export function initLobby() {
  const $ = selector => document.querySelector(selector);
  const controls = initControls();
  $('.skip-link').addEventListener('click', event => { event.preventDefault(); $('#setup').focus(); });
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const activate = tab => {
    for (const item of tabs) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
    }
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
  const refresh = () => {
    $('#summary-progress').textContent = $('#progress').selectedOptions[0].textContent;
    $('#summary-camera').textContent = $('#camera').checked ? 'Personal view' : 'Original shared view';
    $('#summary-image').textContent = $('#image').selectedOptions[0].textContent;
    $('#volume-value').textContent = `${$('#volume').value}%`;
    const files = $('#disc-files').files;
    $('#disc-selection').textContent = files.length ? `${files.length} files selected` : '';
  };
  $('#setup').addEventListener('input', refresh);
  $('#setup').addEventListener('change', refresh);
  $('#reset-settings').addEventListener('click', () => {
    for (const [id, value] of [['progress', 'all'], ['image', 'crisp'], ['volume', '50']]) {
      if (!$(`#${id}`).disabled) $(`#${id}`).value = value;
    }
    if (!$('#camera').disabled) $('#camera').checked = true;
    $('#bios').value = ''; $('#disc-files').value = '';
    controls.reset();
    refresh();
  });
  const dialog = $('#exit-dialog');
  $('#back-lobby').addEventListener('click', () => dialog.showModal());
  $('#stay-game').addEventListener('click', () => dialog.close());
  $('#confirm-exit').addEventListener('click', () => location.assign('/'));
  $('#fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await $('#game').requestFullscreen();
        $('#game').focus({ preventScroll: true });
      }
    } catch { $('#status').textContent = 'Fullscreen is unavailable in this browser. You can continue in the window.'; }
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.fullscreenElement) {
      event.preventDefault();
      document.exitFullscreen().catch(() => {});
    }
  }, true);
  document.addEventListener('fullscreenchange', () => {
    $('#fullscreen').textContent = document.fullscreenElement ? 'Exit fullscreen ⛶' : 'Fullscreen ⛶';
  });
  refresh();
  return {
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
      controls.lock();
      document.body.classList.add('is-playing');
      $('#game-stage').hidden = false;
      $('#game-stage').prepend($('#status'));
    },
  };
}

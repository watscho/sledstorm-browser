const launch = document.querySelector('#launch');
const status = document.querySelector('#status');
let biosUrl;
launch.addEventListener('click', () => {
  launch.disabled = true;
  const bios = document.querySelector('#bios').files[0];
  if (bios) biosUrl = URL.createObjectURL(bios);
  Object.assign(window, {
    EJS_player: '#game',
    EJS_core: 'pcsx_rearmed',
    EJS_gameName: 'Sled Storm Europe',
    EJS_gameUrl: '/disc.zip',
    EJS_pathtodata: '/emulator/',
    EJS_biosUrl: biosUrl || '',
    EJS_disableCue: true,
    EJS_startOnLoaded: true,
    EJS_threads: false,
    EJS_language: 'en-US',
    EJS_color: '#8bd9ec',
    EJS_onGameStart: () => {
      status.textContent = 'Emulator started. Click the game to focus your controls.';
    },
  });
  document.querySelector('#game').classList.add('active');
  document.querySelector('#game').scrollIntoView({ block: 'start' });
  status.textContent = 'Loading emulator and disc…';
  const script = document.createElement('script');
  script.src = '/emulator/loader.js';
  script.onerror = () => {
    status.textContent = 'Could not load the emulator. Restart the page and check the local server.';
  };
  document.body.append(script);
});
window.addEventListener('pagehide', () => {
  if (biosUrl) URL.revokeObjectURL(biosUrl);
});

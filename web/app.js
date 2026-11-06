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
    EJS_disableAutoLang: false,
    EJS_color: '#8bd9ec',
    EJS_onGameStart: () => {
      status.textContent = 'Emulator started. Click the game to focus your controls.';
      if (new URLSearchParams(location.search).has('benchmark')) startBenchmark();
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

// Opt-in probe: count emulated frames, rather than browser animation callbacks.
function startBenchmark() {
  const output = document.createElement('pre');
  output.id = 'benchmark';
  output.setAttribute('aria-label', 'Emulator benchmark');
  document.querySelector('#game').after(output);
  let previousFrame;
  let previousTime;
  setInterval(() => {
    try {
      const emulator = window.EJS_emulator;
      const frame = Number(emulator.gameManager.getFrameNum());
      if (!Number.isFinite(frame)) throw new Error('Core returned an invalid frame counter');
      const now = performance.now();
      const hz = previousTime && frame >= previousFrame
        ? ((frame - previousFrame) * 1000 / (now - previousTime)).toFixed(1) : 'warming up';
      const heap = emulator.Module?.HEAPU8?.byteLength;
      output.textContent = `PCSX-ReARMed · ${hz} emulated frames/s · frame ${frame}\n`
        + `Wasm memory: ${heap ? (heap / 1048576).toFixed(0) + ' MiB' : 'unavailable'} · tab ${document.visibilityState}\n`
        + 'PAL target: 50 frames/s. Audio and race pacing require separate checks.';
      previousFrame = frame;
      previousTime = now;
    } catch (error) {
      output.textContent = `Benchmark unavailable: ${error.message}`;
    }
  }, 2000);
}
window.addEventListener('pagehide', () => {
  if (biosUrl) URL.revokeObjectURL(biosUrl);
});

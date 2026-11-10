const presets = {
  clean: { file: 'sharp-bilinear.glsl', linear: true },
  smooth: {
    file: 'sharp-bilinear.glsl', linear: true,
    parameters: { AUTO_PRESCALE: 0, SHARP_BILINEAR_PRE_SCALE: 1 },
  },
  crt: {
    file: 'crt-lottes.glsl', linear: false,
    parameters: { warpX: 0, warpY: 0, maskDark: 0.85, maskLight: 1.15, bloomAmount: 0.04, hardScan: -6 },
  },
};

export async function loadDisplayShaders() {
  const files = new Map();
  const entries = await Promise.allSettled(Object.entries(presets).map(async ([name, preset]) => {
    if (!files.has(preset.file)) files.set(preset.file, fetch('/shaders/' + preset.file).then(response => {
      if (!response.ok) throw new Error('Display filter unavailable.');
      return response.text();
    }));
    const source = await files.get(preset.file);
    const overrides = Object.entries(preset.parameters || {});
    const parameters = overrides.map(([key, value]) => key + ' = "' + value + '"');
    return [name, {
      shader: {
        type: 'text',
        value: ['shaders = 1', 'shader0 = ' + preset.file, 'filter_linear0 = ' + preset.linear,
          'parameters = "' + overrides.map(([key]) => key).join(';') + '"', ...parameters, ''].join('\n'),
      },
      resources: [{ type: 'text', name: preset.file, value: source }],
    }];
  }));
  return Object.fromEntries(entries.filter(entry => entry.status === 'fulfilled').map(entry => entry.value));
}

export function enableSessionDisplay(emulator, initial, shaders, notify, rememberFilter) {
  const filter = document.querySelector('#live-filter');
  const screenshot = document.querySelector('#take-screenshot');
  const available = ['crisp', ...Object.keys(shaders)];
  for (const option of filter.options) option.disabled = !available.includes(option.value);

  function apply(value, remember = false) {
    const selected = available.includes(value) ? value : 'crisp';
    try {
      emulator.enableShader(selected === 'crisp' ? 'disabled' : selected);
      filter.value = selected;
      if (remember) rememberFilter(selected);
    } catch {
      emulator.enableShader('disabled');
      filter.value = 'crisp';
      notify('Display filter unavailable. Using Crisp pixels.');
    }
  }
  filter.addEventListener('change', () => apply(filter.value, true));
  apply(initial);
  if (initial !== filter.value) notify('Display filter unavailable. Using Crisp pixels.');
  filter.disabled = screenshot.disabled = false;
  filter.closest('label').hidden = screenshot.hidden = false;
  screenshot.addEventListener('click', async () => {
    if (screenshot.disabled) return;
    screenshot.disabled = true;
    try {
      const bytes = (await emulator.Module.sledWideGpuScreenshot?.()) ?? await emulator.gameManager.screenshot();
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'sled-storm-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      notify('Screenshot downloaded.');
    } catch {
      notify('Could not take a screenshot.');
    } finally {
      screenshot.disabled = false;
    }
  });
  window.addEventListener('keydown', event => {
    if (!['F7', 'F8'].includes(event.code) || event.repeat || event.altKey || event.ctrlKey ||
        event.metaKey || event.shiftKey || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.code === 'F8') screenshot.click();
    else apply(available[(available.indexOf(filter.value) + 1) % available.length], true);
  }, true);
}

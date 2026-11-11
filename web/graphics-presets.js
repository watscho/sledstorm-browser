export const GRAPHICS_PRESETS = Object.freeze({
  performance: Object.freeze({ aspect: 'original', filter: 'crisp', enhanced: false, drawDistance: 0 }),
  balanced: Object.freeze({ aspect: 'wide', filter: 'clean', enhanced: false, drawDistance: 50 }),
  quality: Object.freeze({ aspect: 'wide', filter: 'clean', enhanced: true, drawDistance: 100 }),
});

export const GRAPHICS_LABELS = Object.freeze({
  performance: 'Performance', balanced: 'Balanced', quality: 'Quality', custom: 'Custom',
});

function normalize(settings = {}) {
  return {
    aspect: settings.aspect === 'original' ? 'original' : 'wide',
    filter: ['clean', 'crisp', 'smooth', 'crt'].includes(settings.filter) ? settings.filter : 'clean',
    enhanced: typeof settings.enhanced === 'boolean' ? settings.enhanced : true,
    drawDistance: Number.isFinite(settings.drawDistance)
      ? Math.max(0, Math.min(100, Math.round(settings.drawDistance / 10) * 10)) : 100,
  };
}

// Infer a preset for older preferences without overwriting deliberate choices.
// Once manually edited, Custom stays selected even if the values match a preset.
export function restoreGraphics(preferences = {}) {
  const settings = normalize(preferences);
  const matches = Object.keys(GRAPHICS_PRESETS).find(name =>
    Object.entries(GRAPHICS_PRESETS[name]).every(([key, value]) => settings[key] === value));
  const preset = preferences.graphicsPreset === 'custom' ? 'custom' : matches ?? 'custom';
  return {
    preset,
    settings,
    custom: normalize(preset !== 'custom' && preferences.customGraphics && typeof preferences.customGraphics === 'object'
      ? preferences.customGraphics : settings),
  };
}

export function selectGraphicsPreset(graphics, preset) {
  if (preset === 'custom') return { ...graphics, preset, settings: { ...graphics.custom } };
  if (!Object.hasOwn(GRAPHICS_PRESETS, preset)) return graphics;
  return { ...graphics, preset, settings: { ...GRAPHICS_PRESETS[preset] } };
}

export function customizeGraphics(graphics, patch) {
  const settings = normalize({ ...graphics.settings, ...patch });
  return { preset: 'custom', settings, custom: { ...settings } };
}

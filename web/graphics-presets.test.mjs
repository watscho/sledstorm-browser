import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAPHICS_PRESETS, restoreGraphics, selectGraphicsPreset, customizeGraphics } from './graphics-presets.js';

test('new players keep the existing Quality defaults; older preferences are preserved', () => {
  assert.equal(restoreGraphics().preset, 'quality');
  const old = { aspect: 'original', filter: 'crt', enhanced: false, drawDistance: 20 };
  assert.deepEqual(restoreGraphics(old).settings, old);
  assert.equal(restoreGraphics(old).preset, 'custom');
  assert.equal(restoreGraphics({ ...GRAPHICS_PRESETS.balanced }).preset, 'balanced');
  assert.deepEqual(restoreGraphics({ filter: 'broken', drawDistance: 900, enhanced: 'yes' }).settings,
    GRAPHICS_PRESETS.quality);
});

test('manual changes stay Custom across reloads, including when restored to preset values', () => {
  let graphics = customizeGraphics(restoreGraphics(), { enhanced: false });
  graphics = customizeGraphics(graphics, { enhanced: true });
  assert.deepEqual(graphics.settings, GRAPHICS_PRESETS.quality);
  assert.equal(graphics.preset, 'custom');
  assert.equal(restoreGraphics({ ...graphics.settings, graphicsPreset: graphics.preset }).preset, 'custom');
  const restored = restoreGraphics({ ...graphics.settings, filter: 'crt', graphicsPreset: 'custom', customGraphics: GRAPHICS_PRESETS.performance });
  assert.equal(selectGraphicsPreset(selectGraphicsPreset(restored, 'quality'), 'custom').settings.filter, 'crt');
});

test('each preset applies all graphics together and switching back to Custom restores edits', () => {
  const custom = customizeGraphics(restoreGraphics(), { filter: 'crt', drawDistance: 30 });
  for (const name of Object.keys(GRAPHICS_PRESETS)) {
    const selected = selectGraphicsPreset(custom, name);
    assert.equal(selected.preset, name);
    assert.deepEqual(selected.settings, GRAPHICS_PRESETS[name]);
    assert.deepEqual(selectGraphicsPreset(selected, 'custom').settings, custom.settings);
    assert.equal(selectGraphicsPreset(selected, 'invalid'), selected);
  }
  assert.equal(custom.settings.filter, 'crt');
  assert.equal(GRAPHICS_PRESETS.quality.filter, 'clean');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { packetEnd } from '../research/emulator/sled-enge-adapter.js';

test('a shaded snow line consumes both colors and both coordinates', () => {
  const words = Uint32Array.of(0x50f8f8f8, 0x00800050, 0x00404040, 0xffff0068, 0xe6000000);
  assert.equal(packetEnd(words, 0, words.length), 4);
  assert.equal(packetEnd(words, 4, words.length), 5);
});

test('polyline termination follows the flat or shaded word stride', () => {
  const flat = Uint32Array.of(0x48ffffff, 0, 1, 2, 0x50005000);
  const shaded = Uint32Array.of(0x58ffffff, 0, 0x303030, 1, 0x202020, 2, 0x50005000);
  assert.equal(packetEnd(flat, 0, flat.length), flat.length);
  assert.equal(packetEnd(shaded, 0, shaded.length), shaded.length);
  assert.ok(packetEnd(shaded, 0, shaded.length - 1) > shaded.length - 1);
  assert.ok(packetEnd(Uint32Array.of(0xa0000000), 0, 1) > 1);
});

test('Quality 2× ignores time spent holding a wide frame in a background tab', async t => {
  const previewUrl = new URL('./hardware-preview.js', import.meta.url).href;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL === previewUrl && specifier === './generated/enge-hardware.js')
        return nextResolve('data:text/javascript,export const createRenderer = () => ({})', context);
      return nextResolve(specifier, context);
    },
  });
  const { enableHardwarePreview } = await import('./hardware-preview.js').finally(() => hooks.deregister());
  const element = () => Object.assign(new EventTarget(), {
    classList: { add() {}, toggle() {} },
    append() {},
    setAttribute() {},
    getContext: () => ({ createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }) }),
  });
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    createElement: element,
    querySelector: () => ({ value: 'clean' }),
  });
  globalThis.document = document;
  t.after(() => { delete globalThis.document; });
  let now = 100;
  t.mock.method(performance, 'now', () => now);
  const module = { canvas: element(), sledPaintWideFrame: false };
  enableHardwarePreview(module, element(), { scale: 2 });

  module.sledWideGpuVisibility(true);
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  now += 10_000;
  // The native renderer retains the old frame and doesn't submit one while hidden.
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  module.sledWideGpuVisibility(true);
  assert.equal(module.sledPaintWideFrame, false, 'the first foreground frame must not request a yield');

  now += 70;
  module.sledWideGpuVisibility(true);
  assert.equal(module.sledPaintWideFrame, true, 'a slow foreground frame still requests a yield');
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(module.sledPaintWideFrame, false, 'hiding the tab clears pending paint work');
});

import { createRenderer } from './generated/enge-hardware.js';

const WIDTH = 684;
const HEIGHT = 256;
const VRAM_WORDS = 1024 * 512;
const LONG_FRAME_GAP_MS = 65;
const PAINT_YIELD_COOLDOWN_MS = 250;
const RELIEF_MAX_FRAME_AGE_MS = 55;
const RELIEF_SKIP_COOLDOWN_MS = 120;
const RELIEF_HIGH_BACKLOG_COOLDOWN_MS = 65;

export function enableHardwarePreview(module, game, options) {
  const layer = document.createElement('div');
  layer.className = 'hardware-preview';
  layer.hidden = true;
  layer.setAttribute('aria-hidden', 'true');
  const frame = document.createElement('div');
  const world = document.createElement('canvas');
  const hud = document.createElement('canvas');
  hud.width = WIDTH;
  hud.height = HEIGHT;
  const context = hud.getContext('2d');
  const pixels = context.createImageData(WIDTH, HEIGHT);
  const colors = new Uint32Array(pixels.data.buffer);
  const { render, redraw } = createRenderer(world, options);
  const filter = document.querySelector('#live-filter');
  let lastWideFrame;
  let nextPaintYield = 0;
  let lastReliefSkip = -Infinity;
  frame.append(world, hud);
  layer.append(frame);
  game.append(layer);
  const source = module.canvas;
  source.classList.add('hardware-preview-source');

  function disable() {
    module.sledWideGpuCapture = undefined;
    module.sledWideGpuHud = undefined;
    module.sledWideGpuVisibility = undefined;
    module.sledShouldHoldWideFrame = undefined;
    module.sledWideGpuScreenshot = undefined;
    module.sledPaintWideFrame = false;
    game.classList.remove('hardware-preview-active');
    source.classList.remove('hardware-preview-source');
    layer.remove();
  }

  world.addEventListener('webglcontextlost', disable, { once: true });
  const canRender = () => filter.value === 'clean' || filter.value === 'crisp';
  let imageFilter;
  module.sledWideGpuCapture = (vram, y, batches, count, words, length, clearBefore) => {
    if (!canRender()) return false;
    const buffer = module.HEAPU8.buffer;
    try {
      if (options.scale === 2 && imageFilter !== filter.value) {
        imageFilter = filter.value;
        world.style.imageRendering = imageFilter === 'crisp' ? 'pixelated' : 'auto';
      }
      const ready = render(new Uint16Array(buffer, vram, VRAM_WORDS), y,
        new Uint32Array(buffer, batches, count * 10), new Uint32Array(buffer, words, length), clearBefore,
        imageFilter === undefined ? options.sharpTextures : imageFilter === 'clean');
      if (ready) context.clearRect(0, 0, WIDTH, HEIGHT);
      return ready;
    } catch (error) {
      console.warn('WebGL2 preview fell back to the software renderer.', error);
      disable();
      return false;
    }
  };
  module.sledWideGpuHud = (background, stock, width) => {
    const buffer = module.HEAPU8.buffer;
    const before = new Uint16Array(buffer, background, width * HEIGHT);
    const after = new Uint16Array(buffer, stock, 1024 * HEIGHT);
    for (let y = 0; y < HEIGHT; ++y) {
      for (let x = 0; x < width; ++x) {
        const index = y * width + x;
        const color = after[y * 1024 + x];
        colors[index] = color === before[index] ? 0
          : 0xff000000 | ((color & 0x7c00) << 9) | ((color & 0x03e0) << 6) | ((color & 31) << 3);
      }
    }
    context.putImageData(pixels, 0, 0);
  };
  module.sledWideGpuVisibility = visible => {
    layer.hidden = !visible;
    game.classList.toggle('hardware-preview-active', visible);
    if (options.scale !== 2) return;
    if (!visible) {
      lastWideFrame = undefined;
      module.sledPaintWideFrame = false;
      return;
    }
    const now = performance.now();
    if (lastWideFrame !== undefined && now - lastWideFrame >= LONG_FRAME_GAP_MS && now >= nextPaintYield) {
      module.sledPaintWideFrame = true;
      nextPaintYield = now + PAINT_YIELD_COOLDOWN_MS;
    }
    lastWideFrame = now;
  };
  if (options.scale === 2) {
    module.sledShouldHoldWideFrame = () => {
      if (!module.sledRenderRelief || lastWideFrame === undefined) return false;
      const now = performance.now();
      const cooldown = module.sledRenderRelief === 2 ? RELIEF_HIGH_BACKLOG_COOLDOWN_MS : RELIEF_SKIP_COOLDOWN_MS;
      if (now - lastReliefSkip < cooldown || now - lastWideFrame >= RELIEF_MAX_FRAME_AGE_MS) return false;
      lastReliefSkip = now;
      return true;
    };
  }
  module.sledWideGpuScreenshot = async () => {
    if (layer.hidden || !redraw()) return null;
    const output = document.createElement('canvas');
    output.height = world.height;
    output.width = Math.round(output.height * 16 / 9);
    const compositor = output.getContext('2d');
    compositor.drawImage(world, 0, 0, output.width, output.height);
    compositor.imageSmoothingEnabled = false;
    compositor.drawImage(hud, 0, 0, output.width, output.height);
    const png = await new Promise(resolve => output.toBlob(resolve));
    return png?.arrayBuffer() ?? null;
  };
}

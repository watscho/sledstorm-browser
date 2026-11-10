// Opt-in integration test using a locally prepared Pine Valley checkpoint.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [event, checkpoint, controller = '1'] = process.argv.slice(2);
const objectIndex = { sign: 21, ice: 0 }[event];
const seat = Number(controller) - 1;
if (!Number.isInteger(objectIndex) || !checkpoint || !Number.isInteger(seat) || seat < 0 || seat > 3)
  throw Error('Usage: node tools/test-pal-impact.mjs <sign|ice> <checkpoint> [controller 1–4]');

const playwright = process.env.SLED_PLAYWRIGHT_MODULE;
const { chromium } = await import(playwright ? pathToFileURL(resolve(playwright)).href : 'playwright');
const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const launcher = 'http://127.0.0.1:8000';

async function replay(personal) {
  const page = await browser.newPage();
  try {
    await page.route(launcher + '/lab-state', route => route.fulfill({ path: resolve(checkpoint) }));
    const core = process.env.SLED_TEST_CORE;
    if (core) await page.route(launcher + '/network-core.data', route => route.fulfill({ path: resolve(core) }));
    await page.goto(launcher + '/?console=1&fixture=1');
    await page.locator('#launch').click();
    await page.getByText(/Local diagnostic console/).waitFor({ timeout: 45000 });

    return await page.evaluate(async ({ personal, objectIndex, seat }) => {
      const { Module: module, gameManager: manager } = EJS_emulator;
      module.sledBeforeFrame = () => false;
      const { captureState, canonicalStateDigest, restoreCoreState } = await import('/core-state.js');
      restoreCoreState(module, new Uint8Array(await (await fetch('/lab-state')).arrayBuffer()));
      const ram = new DataView(module.HEAPU8.buffer, module._sled_ram_pointer(), 0x200000);
      const get = addr => ram.getUint32(addr & 0x1fffff, true);
      const object = 0xe4e50 + 40 * objectIndex;
      const active = () => ram.getUint16(object, true) !== 0;
      const score = () => get(0xdae20 + 0x530 * seat + 0x360);
      if (get(0xd6988) !== 1 || get(0xd6980) !== 1 || get(0xd6a10) < 2 ||
          seat >= get(0xd6a10) || !active())
        throw Error('Expected a multiplayer Pine Valley checkpoint before impact.');

      module.sledWidescreen = personal;
      module.sledEnhancedGraphics = personal;
      module.sledDrawDistance = 0;
      // Keep the room's asset and HUD hooks in both runs.
      module._sled_view_configure(seat, personal ? 23 : 18);
      const digest = () => canonicalStateDigest(captureState(module, manager.functions.saveStateInfo));
      let before, isolationFailures = 0, privateFrames = 0, fragmentFrames = 0;
      if (personal) {
        const { packetEnd } = await import('/generated/enge-hardware.js');
        const { enableHardwarePreview } = await import('/hardware-preview.js');
        enableHardwarePreview(module, document.querySelector('#game'), { scale: 2 });
        const render = module.sledWideGpuCapture;
        const fragmentKey = word => {
          // Ignore screen coordinates, which change with the projection.
          const uv = { 0x24: [2, 4, 6], 0x2c: [2, 4, 6, 8], 0x34: [2, 5, 8] }[(word(0) >>> 24) & 0xfc];
          return uv && [word(0), ...uv.map(word)].join('/');
        };
        module.sledWideGpuCapture = (vram, y, batches, count, commands, words, clearBefore) => {
          const ready = render(vram, y, batches, count, commands, words, clearBefore);
          if (!ready || active()) return ready;
          const fragments = new Set();
          for (let buffer = 0; buffer < 2; ++buffer) {
            const start = get(0xc4010 + 4 * buffer);
            const end = get(0xc3ff0 + 4 * buffer);
            if (start < 0x80010000 || end >= 0x80200000 || end - start > 10000) continue;
            for (let addr = start; addr + 40 <= end; addr += 40)
              fragments.add(fragmentKey(i => get(addr + 4 + i * 4)));
          }
          fragments.delete(undefined);
          const heap = module.HEAPU8.buffer;
          const headers = new Uint32Array(heap, batches, count * 10);
          const stream = new Uint32Array(heap, commands, words);
          for (let i = 0; i < headers.length; i += 10) {
            const end = headers[i + 8] + headers[i + 9];
            for (let pos = headers[i + 8]; pos < end; pos = packetEnd(stream, pos, end)) {
              if (fragments.has(fragmentKey(k => stream[pos + k]))) {
                ++fragmentFrames;
                return ready;
              }
            }
          }
          return ready;
        };
        module.sledViewBefore = () => { before = digest(); };
        module.sledViewAfter = () => {
          ++privateFrames;
          if (before !== digest()) ++isolationFailures;
        };
      }

      const start = module._sled_frame_count();
      const initialScore = score();
      const digests = [];
      let hitStep;
      await new Promise((done, fail) => {
        const timeout = setTimeout(() => fail(Error('Timed out replaying checkpoint.')), 15000);
        module.sledCoreBefore = () => true;
        module.sledCoreAfter = () => {
          const step = module._sled_frame_count() - start;
          if (!active() && hitStep === undefined) hitStep = step;
          if (step % 2 === 1) digests.push(digest());
          if (step === 31) {
            module.sledBeforeFrame = () => false;
            clearTimeout(timeout);
            done();
          }
        };
        manager.functions.simulateInput(seat, 0, 1);
        module.sledBeforeFrame = () => true;
      });
      return { hitStep, digests, privateFrames, isolationFailures, fragmentFrames,
        points: score() - initialScore, hudPackets: module._sled_view_status(6) };
    }, { personal, objectIndex, seat });
  } finally {
    await page.close();
  }
}

try {
  const shared = await replay(false);
  const personal = await replay(true);
  assert.ok(shared.hitStep !== undefined, 'Accelerate for 31 steps from the checkpoint must hit the target');
  assert.equal(personal.hitStep, shared.hitStep);
  assert.equal(shared.points, event === 'ice' ? 500 : 50, 'Expected a single award for the impact');
  assert.equal(personal.points, shared.points);
  assert.deepEqual(personal.digests, shared.digests, 'Presentation changed the underlying console state');
  assert.ok(personal.privateFrames > 0 && personal.isolationFailures === 0, 'Private presentation isolation failed');
  assert.ok(personal.fragmentFrames > 0, 'The personal WebGL2 camera did not draw impact fragments');
  assert.ok(personal.hudPackets > 0, 'The personal camera did not render HUD packets');
  console.log(`PASS ${event}, controller ${controller}, impact at step ${personal.hitStep}, ${personal.fragmentFrames} frames with fragments`);
} finally {
  await browser.close();
}

import createModule from '../.cache/test-disc.mjs';
import { mountDisc } from '../research/wasm/disc-fs.js';
const size = 3_000_000;
const extent = (offset, length) => Uint8Array.from({ length }, (_, i) => ((offset + i) * 17) & 255);
for (const local of [false, true]) {
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  let requests = 0, remoteBytes = 0;
  globalThis.fetch = async (url) => {
    if (local) throw new Error('Local disc attempted a network read');
    ++requests;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const p = new URL(url, 'http://localhost');
    const bytes = extent(Number(p.searchParams.get('offset')), Number(p.searchParams.get('length')));
    return { ok: true, arrayBuffer: async () => bytes.buffer };
  };
  const m = await createModule({ noInitialRun: true, print: (text) => {
    if (text === 'DISC_FS_PASSED') finish();
    else console.log(text);
  } });
  m.FS.mkdir('/disc');
  mountDisc(m, [{ name: 'test.bin', size, url: '/test', ...(local ? { data: new Blob([extent(0, size)]) } : {}) }], count => { remoteBytes += count; });
  m.callMain([]);
  await done;
  if (local ? remoteBytes !== 0 : remoteBytes < size) throw new Error('Disc transfer progress does not match the source');
  if (!local && requests > 6) throw new Error('Unexpected extent fetch count');
  console.log(`DISC_FS_PASSED (${local ? 'local Blob, no network' : 'bounded remote extents'})`);
}

import assert from 'node:assert/strict';
const baseline = process.argv.includes('--baseline');
const { default: createModule } = await import(baseline ? '../.cache/perf-baseline/test-disc.mjs' : '../.cache/test-disc.mjs');
const { mountDisc } = await import(baseline ? '../.cache/perf-baseline/disc-fs.js' : '../research/wasm/disc-fs.js');
const size = 3_000_000;
const extent = (offset, length) => Uint8Array.from({ length }, (_, i) => ((offset + i) * 17) & 255);
for (const local of [false, true]) {
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  let requests = 0, remoteBytes = 0, suspensions = 0;
  const began = performance.now();
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
  const handleSleep = m.Asyncify.handleSleep;
  m.Asyncify.handleSleep = function(callback) {
    const before = this.state;
    const result = handleSleep.call(this, callback);
    if (before === 0 && this.state === 1) ++suspensions;
    return result;
  };
  m.FS.mkdir('/disc');
  const stats = mountDisc(m, [{ name: 'test.bin', size, url: '/test', ...(local ? { data: new Blob([extent(0, size)]) } : {}) }], count => { remoteBytes += count; });
  m.callMain([]);
  await done;
  if (local ? remoteBytes !== 0 : remoteBytes < size) throw new Error('Disc transfer progress does not match the source');
  if (!baseline) {
    assert.ok(suspensions <= (local ? 3 : 1), `Unexpected Wasm suspensions: ${suspensions}`);
    if (!local) assert.equal(requests, 1, 'hot/distant reads should share one remote block');
    assert.ok(stats.cacheBytes <= stats.capacity);
  }
  console.log(JSON.stringify({ baseline, source:local?'Blob':'HTTP', requests, remoteBytes, suspensions, elapsedMs:Math.round(performance.now()-began) }));
  console.log(`DISC_FS_PASSED (${local ? 'local Blob, no network' : 'bounded remote extents'})`);
}

// Read-only files backed by one bounded LRU across tracks. Cache hits return
// synchronously, so the WASI adapter only suspends the guest on actual I/O.
export function mountDisc(Module, files, onRead = () => {}) {
  const fs = Module.FS, cache = new Map(), inFlight = new Map();
  const capacity = 16 * 1048576;
  const stats = { reads: 0, hits: 0, misses: 0, requests: 0, bytes: 0, waitMs: 0, cacheBytes: 0, capacity };
  for (const [index, file] of files.entries()) {
    const blockSize = file.data ? 1048576 : 4 * 1048576;
    fs.writeFile(`/disc/${file.name}`, new Uint8Array());
    const node = fs.lookupPath(`/disc/${file.name}`).node;
    const original = node.node_ops;
    node.node_ops = { ...original, getattr(n) { return { ...original.getattr(n), size: file.size }; } };
    node.sledRead = (pointer, length, position) => {
      ++stats.reads;
      if (position >= file.size || length === 0) return 0;
      const start = Math.floor(position / blockSize) * blockSize;
      const end = Math.min(file.size, start + blockSize), key = `${index}:${start}`;
      const copy = bytes => {
        const count = Math.min(length, file.size - position, end - position);
        Module.HEAPU8.set(bytes.subarray(position - start, position - start + count), pointer);
        return count;
      };
      if (cache.has(key)) {
        ++stats.hits;
        const bytes = cache.get(key); cache.delete(key); cache.set(key, bytes);
        return copy(bytes);
      }
      ++stats.misses;
      if (!inFlight.has(key)) {
        const load = async () => {
          const began = performance.now();
          let bytes;
          if (file.data) bytes = new Uint8Array(await file.data.slice(start, end).arrayBuffer());
          else {
            ++stats.requests;
            const response = await fetch(`${file.url}?offset=${start}&length=${end - start}`);
            if (!response.ok) throw new Error(`Disc read failed: ${response.status}`);
            bytes = new Uint8Array(await response.arrayBuffer());
            stats.bytes += bytes.length; onRead(bytes.length);
          }
          stats.waitMs += performance.now() - began;
          if (bytes.length !== end - start) throw new Error('Incomplete disc extent');
          while (stats.cacheBytes + bytes.length > capacity && cache.size) {
            const oldest = cache.keys().next().value;
            stats.cacheBytes -= cache.get(oldest).length; cache.delete(oldest);
          }
          cache.set(key, bytes); stats.cacheBytes += bytes.length;
          return bytes;
        };
        inFlight.set(key, load().finally(() => inFlight.delete(key)));
      }
      return inFlight.get(key).then(copy);
    };
    node.stream_ops = {
      ...node.stream_ops,
      llseek(stream, offset, whence) {
        const position = offset + (whence === 1 ? stream.position : whence === 2 ? file.size : 0);
        if (position < 0) throw new fs.ErrnoError(28);
        return position;
      },
      read() { throw new Error('Disc reads must pass through the fd_read adapter'); },
      write() { throw new fs.ErrnoError(63); },
    };
  }
  return stats;
}

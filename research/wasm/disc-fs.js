// Read-only files with a bounded per-file cache. disc_io.js suspends the
// entire guest fd_read operation on a miss, preserving iovec/seek semantics.
export function mountDisc(Module, files, onRead = () => {}) {
  const fs = Module.FS;
  for (const file of files) {
    fs.writeFile(`/disc/${file.name}`, new Uint8Array());
    const node = fs.lookupPath(`/disc/${file.name}`).node;
    const original = node.node_ops;
    node.node_ops = { ...original, getattr(n) { return { ...original.getattr(n), size: file.size }; } };
    let cache = null;
    node.sledRead = async (pointer, length, position) => {
      if (position >= file.size || length === 0) return 0;
      if (!cache || position < cache.start || position >= cache.end) {
        const start = Math.floor(position / 1048576) * 1048576;
        const end = Math.min(file.size, start + Math.max(1048576, length));
        let bytes;
        if (file.data) bytes = new Uint8Array(await file.data.slice(start, end).arrayBuffer());
        else {
          const response = await fetch(`${file.url}?offset=${start}&length=${end - start}`);
          if (!response.ok) throw new Error(`Disc read failed: ${response.status}`);
          bytes = new Uint8Array(await response.arrayBuffer());
        }
        if (bytes.length !== end - start) throw new Error('Incomplete disc extent');
        cache = { start, end, bytes };
        if (!file.data) onRead(bytes.length);
      }
      const count = Math.min(length, file.size - position, cache.end - position);
      Module.HEAPU8.set(cache.bytes.subarray(position - cache.start, position - cache.start + count), pointer);
      return count;
    };
    node.stream_ops = {
      ...node.stream_ops,
      llseek(stream, offset, whence) {
        const position = offset + (whence === 1 ? stream.position : whence === 2 ? file.size : 0);
        if (position < 0) throw new fs.ErrnoError(28);
        return position;
      },
      read() { throw new Error('Disc reads must pass through the asynchronous fd_read adapter'); },
      write() { throw new fs.ErrnoError(63); },
    };
  }
}

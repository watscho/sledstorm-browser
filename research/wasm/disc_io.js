// fd_read adapter for bounded asynchronous disc extents. Based on the MIT
// Emscripten WASI fd_read/doReadv contract; the entire iovec is one suspension.
addToLibrary({
  fd_read__deps: ['$FS', '$SYSCALLS', '$Asyncify'],
  fd_read__async: true,
  fd_read: (fd, iov, iovcnt, pnum) => Asyncify.handleAsync(async () => {
    try {
      const stream = SYSCALLS.getStreamFromFD(fd);
      let total = 0;
      for (let i = 0; i < iovcnt; ++i) {
        const pointer = HEAPU32[(iov + i * 8) >> 2];
        const length = HEAPU32[(iov + i * 8 + 4) >> 2];
        let count;
        if (stream.node.sledRead) {
          count = await stream.node.sledRead(pointer, length, stream.position);
          stream.position += count;
        } else count = FS.read(stream, HEAPU8, pointer, length);
        total += count;
        if (count < length) break;
      }
      HEAPU32[pnum >> 2] = total;
      return 0;
    } catch (error) {
      if (error.name === 'ErrnoError') return error.errno;
      abort(error);
    }
  }),
});

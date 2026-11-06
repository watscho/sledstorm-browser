// WASI fd_read/doReadv adapter. handleSleep completes synchronously for MEMFS
// and cached disc bytes; only a cache miss unwinds the Wasm stack. The whole
// iovec remains one suspension and stream positions advance once per read.
addToLibrary({
  fd_read__deps: ['$FS', '$SYSCALLS', '$Asyncify'],
  fd_read__async: true,
  fd_read: (fd, iov, iovcnt, pnum) => Asyncify.handleSleep(wakeUp => {
    const finish = total => { HEAPU32[pnum >> 2] = total; wakeUp(0); };
    const failed = error => {
      if (error.name === 'ErrnoError') wakeUp(error.errno);
      else abort(error);
    };
    let stream;
    const step = (index, total) => {
      try {
        for (; index < iovcnt; ++index) {
          const pointer = HEAPU32[(iov + index * 8) >> 2];
          const length = HEAPU32[(iov + index * 8 + 4) >> 2];
          if (stream.node.sledRead) {
            const count = stream.node.sledRead(pointer, length, stream.position);
            if (count?.then) {
              count.then(n => {
                stream.position += n;
                if (n < length) finish(total + n);
                else step(index + 1, total + n);
              }, failed);
              return;
            }
            stream.position += count; total += count;
            if (count < length) break;
          } else {
            const count = FS.read(stream, HEAPU8, pointer, length);
            total += count;
            if (count < length) break;
          }
        }
        finish(total);
      } catch (error) { failed(error); }
    };
    try { stream = SYSCALLS.getStreamFromFD(fd); step(0, 0); }
    catch (error) { failed(error); }
  }),
});

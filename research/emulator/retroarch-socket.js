// Loaded into the Emscripten module closure by prepare-emulator.py.
// The WebSocket is already open when synchronous POSIX connect() runs.
Module.sledInstallNetplay = (role, socket, endpoint, netplayPort, room) => {
  const ops = SOCKFS.websocket_sock_ops;
  const connect = ops.connect;
  const listen = ops.listen;
  const accept = ops.accept;
  let listener;
  let peerPort = 20000;
  let used = false;

  ops.accept = sock => {
    // The pinned browser SOCKFS reports EINVAL for an empty accept queue.
    // RetroArch treats errors other than EAGAIN as a failed listener.
    if (sock === listener && !sock.error && !sock.pending.length) {
      throw new FS.ErrnoError(Module.ERRNO_CODES.EAGAIN);
    }
    return accept(sock);
  };

  function attach(sock, ws, port) {
    ws.binaryType = 'arraybuffer';
    ws._socket = { remoteAddress: '127.0.0.1', remotePort: port };
    const peer = ops.createPeer(sock, ws);
    sock.daddr = peer.addr;
    sock.dport = peer.port;
  }

  ops.connect = (sock, addr, port) => {
    if (used || role !== 'guest' || sock.type !== 1 || addr !== '127.0.0.1' || port !== netplayPort) {
      return connect(sock, addr, port);
    }
    used = true;
    attach(sock, socket, port);
  };

  ops.listen = (sock, backlog) => {
    if (used || role !== 'host' || sock.type !== 1 || sock.sport !== netplayPort) {
      return listen(sock, backlog);
    }
    used = true;
    listener = sock;
    const pending = new Set();
    sock.server = {
      close() {
        socket.close();
        for (const ws of pending) ws.close();
        for (const child of sock.pending.splice(0)) FS.close(child.stream);
      },
    };
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string' || !/^[a-f0-9]{48}$/.test(event.data)) return;
      if (pending.size + sock.pending.length >= 3) return;
      const ws = new WebSocket(endpoint);
      pending.add(ws);
      ws.addEventListener('close', () => pending.delete(ws), { once: true });
      ws.addEventListener('open', () => {
        pending.delete(ws);
        if (!sock.server) { ws.close(); return; }
        ws.send(JSON.stringify({ role: 'accept', room, ticket: event.data }));
        const child = SOCKFS.createSocket(sock.family, sock.type, sock.protocol);
        attach(child, ws, peerPort);
        peerPort = peerPort === 65535 ? 20000 : peerPort + 1;
        sock.pending.push(child);
        SOCKFS.emit('connection', sock.stream.fd);
      }, { once: true });
    });
  };
};

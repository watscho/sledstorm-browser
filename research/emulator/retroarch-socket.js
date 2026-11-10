// Loaded into the Emscripten module closure by prepare-emulator.py.
// The WebSocket is already open when synchronous POSIX connect() runs.
Module.sledInstallNetplay = (role, socket, endpoint, netplayPort, room, stream = socket) => {
  Module.sledNetplayActive = true;
  Module.sledDedicatedHost = role === 'worker';
  const animationFrame = MainLoop.requestAnimationFrame;
  let scheduled;
  let recoveryTasks;
  let recoveryTaskId = 0;
  let lastCallbackAt = performance.now();
  Module.sledResumeReplay = () => {
    if (!Module.sledNetplayActive || !Module.sledReplayPending) return false;
    Module._sled_netplay_resume_replay();
    if (!Module.sledReplayPending) Module.sledAfterFrame?.();
    return true;
  };
  const schedule = callback => {
    scheduled?.cancel?.();
    const catchup = Module.sledCatchup;
    const hidden = document.hidden;
    const run = () => {
      if (scheduled?.run !== run) return;
      scheduled.cancel?.();
      scheduled = undefined;
      lastCallbackAt = performance.now();
      callback();
    };
    if ((catchup || Module.sledReplayPending) && !hidden) {
      // Yield between frames without the minimum delay of nested timeouts.
      if (!recoveryTasks) {
        recoveryTasks = new MessageChannel();
        recoveryTasks.port1.onmessage = ({ data }) => {
          if (scheduled?.taskId === data) scheduled.run();
        };
      }
      const taskId = ++recoveryTaskId;
      scheduled = { callback, run, taskId };
      recoveryTasks.port2.postMessage(taskId);
      return;
    }
    if (hidden) {
      const id = setTimeout(run, catchup ? 0 : 1000 / 60);
      scheduled = { callback, run, cancel: () => clearTimeout(id) };
      return;
    }
    const frame = requestAnimationFrame(run);
    // A 30 Hz animation callback cannot keep up with the room's console clock.
    // Run an emulation step between paints when Chrome delays the callback.
    const timer = Module.sledDedicatedClient && !Module.sledPaintWideFrame
      ? setTimeout(run, Math.max(0, 1000 / 60 - (performance.now() - lastCallbackAt)))
      : undefined;
    scheduled = { callback, run, cancel: () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    } };
  };
  const reschedule = () => {
    if (!scheduled) return;
    schedule(scheduled.callback);
  };
  MainLoop.requestAnimationFrame = schedule;
  document.addEventListener('visibilitychange', reschedule);
  socket.addEventListener('close', () => {
    Module.sledNetplayActive = false;
    document.removeEventListener('visibilitychange', reschedule);
    MainLoop.requestAnimationFrame = animationFrame;
    if (recoveryTasks) {
      // Preserve the pending callback on the restored scheduler.
      if (scheduled?.taskId) {
        const { callback } = scheduled;
        scheduled = undefined;
        animationFrame(callback);
      }
      recoveryTasks.port1.close();
      recoveryTasks.port2.close();
    }
  }, { once: true });

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
    attach(sock, stream, port);
  };

  ops.listen = (sock, backlog) => {
    if (used || role === 'guest' || sock.type !== 1 || sock.sport !== netplayPort) {
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
      if (pending.size + sock.pending.length >= (role === 'worker' ? 4 : 3)) return;
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
    if (role === 'worker') socket.send('listening');
  };
};

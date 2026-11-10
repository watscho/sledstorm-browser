import { mirrorBufferLimit, mirrorPayloadLimit, orderedPackets, sequencePacket } from './netplay-wire.js';

// RetroArch sees one ordered stream. Either WebSocket can deliver a packet.
export function mirrorNetplayDownlink(primary, mirrorUrl, { duplex = false, separateUrl, discoverMirror } = {}) {
  let outgoing = 0;
  const mirrors = { fallback: null, separate: null };
  let retry;
  let discovery;
  const primaryOpen = () => primary.readyState === WebSocket.OPEN;
  const stream = {
    CONNECTING: WebSocket.CONNECTING,
    OPEN: WebSocket.OPEN,
    CLOSING: WebSocket.CLOSING,
    CLOSED: WebSocket.CLOSED,
    get readyState() { return primary.readyState; },
    send(data) {
      if (!duplex) { primary.send(data); return; }
      const packet = sequencePacket(outgoing, data);
      outgoing = (outgoing + 1) >>> 0;
      primary.send(packet);
      if (data.byteLength > mirrorPayloadLimit) return;
      for (const mirror of [mirrors.separate, mirrors.fallback]) {
        if (mirror?.readyState === WebSocket.OPEN && mirror.bufferedAmount + packet.length <= mirrorBufferLimit) {
          mirror.send(packet);
        }
      }
    },
    close: () => primary.close(),
  };
  primary.binaryType = 'arraybuffer';

  const receive = orderedPackets(payload => stream.onmessage?.({ data: payload.slice().buffer }));
  primary.addEventListener('message', ({ data }) => {
    if (typeof data === 'string') {
      stream.onmessage?.({ data });
    } else if (!receive(data)) {
      primary.close(4002, 'Invalid netplay packet');
    }
  });
  primary.addEventListener('error', event => stream.onerror?.(event));
  primary.addEventListener('close', event => {
    clearTimeout(retry);
    discovery?.abort();
    mirrors.separate?.close();
    mirrors.fallback?.close();
    stream.onclose?.(event);
  }, { once: true });

  function scheduleRecovery() {
    if (!duplex || !primaryOpen() || mirrors.separate || retry || discovery || (!discoverMirror && mirrors.fallback)) return;
    retry = setTimeout(async () => {
      retry = undefined;
      if (!primaryOpen() || mirrors.separate) return;
      connectMirror(mirrorUrl, 'fallback');
      if (!discoverMirror) return;
      const controller = new AbortController();
      discovery = controller;
      const deadline = setTimeout(() => controller.abort(), 3000);
      try {
        const url = await discoverMirror(controller.signal);
        if (url && primaryOpen()) connectMirror(url, 'separate');
      } catch { /* Keep playing while the separate route is unavailable. */ }
      finally {
        clearTimeout(deadline);
        discovery = undefined;
        scheduleRecovery();
      }
    }, 3000);
  }

  function connectMirror(url, path) {
    if (mirrors[path]) return;
    const socket = new WebSocket(url);
    mirrors[path] = socket;
    socket.binaryType = 'arraybuffer';
    let firstPacket = true;
    socket.addEventListener('message', ({ data }) => {
      if (!primaryOpen()) return;
      // Keep the fallback until the replacement's first packet reaches the
      // ordered stream. The fallback may still carry an earlier missing packet.
      const handoff = path === 'separate' && firstPacket && mirrors.fallback ? () => {
        if (mirrors.separate === socket && socket.readyState === WebSocket.OPEN) mirrors.fallback?.close();
      } : undefined;
      firstPacket = false;
      if (!receive(data, handoff)) socket.close(4002, 'Invalid mirrored packet');
    });
    const deadline = setTimeout(() => socket.close(), 4000);
    socket.addEventListener('open', () => clearTimeout(deadline), { once: true });
    socket.addEventListener('close', () => {
      clearTimeout(deadline);
      mirrors[path] = null;
      if (!primaryOpen()) return;
      if (path === 'separate') connectMirror(mirrorUrl, 'fallback');
      scheduleRecovery();
    }, { once: true });
  }

  return {
    stream,
    startMirror() {
      if (!primaryOpen() || mirrors.separate || mirrors.fallback) return;
      if (separateUrl) connectMirror(separateUrl, 'separate');
      else {
        connectMirror(mirrorUrl, 'fallback');
        scheduleRecovery();
      }
    },
  };
}

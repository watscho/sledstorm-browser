import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

const limit = 8 * 1024 * 1024;
const open = ws => ws?.readyState === WebSocket.OPEN;
const send = (ws, data, binary = false) => {
  if (!open(ws) || ws.bufferedAmount + Buffer.byteLength(data) > limit) return false;
  ws.send(data, { binary }, error => { if (error) ws.terminate(); });
  return true;
};

export function createRetroArchRelay({ port = 8006 } = {}) {
  const rooms = new Map();
  const server = new WebSocketServer({
    host: '127.0.0.1', port, maxPayload: limit, perMessageDeflate: false,
    verifyClient: ({ origin }) => ['http://127.0.0.1:8000', 'http://localhost:8000'].includes(origin),
  });
  const heartbeat = setInterval(() => {
    for (const ws of server.clients) {
      if (ws.alive === false) ws.terminate();
      else { ws.alive = false; if (open(ws)) ws.ping(); }
    }
  }, 20_000);
  heartbeat.unref();
  server.on('close', () => clearInterval(heartbeat));

  server.on('connection', ws => {
    ws.on('error', () => ws.terminate());
    ws.on('pong', () => { ws.alive = true; });
    const deadline = setTimeout(() => ws.close(1008, 'Room request timed out'), 5000);
    ws.once('close', () => clearTimeout(deadline));
    ws.once('message', (data, binary) => {
      clearTimeout(deadline);
      let request;
      try { if (!binary && data.length < 1024) request = JSON.parse(data); } catch {}
      const { role, room: id, token, identity, ticket, preferredSlot } = request ?? {};
      const reject = reason => ws.close(1008, reason);
      if (!/^[a-f0-9]{24}$/.test(id ?? '')) return reject('Invalid room');
      if (role === 'host') {
        if (rooms.size >= 32 || rooms.has(id) || !/^[a-f0-9]{64}$/.test(token ?? '') ||
            !/^[a-f0-9]{64}$/.test(identity ?? '')) return reject('Could not create room');
        const room = { host: ws, token, identity, peers: new Map() };
        rooms.set(id, room);
        ws.once('close', () => {
          rooms.delete(id);
          for (const peer of room.peers.values()) drop(room, peer, 'Host left the room');
        });
        ws.on('message', () => reject('Unexpected host message'));
        send(ws, JSON.stringify({ type: 'ready', slot: 0 }));
        return;
      }
      const room = rooms.get(id);
      if (!open(room?.host)) return reject('Host is unavailable');
      if (role === 'guest') {
        if (typeof token !== 'string' || token.length !== 64 ||
            !/^[a-f0-9]{64}$/.test(token) ||
            !timingSafeEqual(Buffer.from(token), Buffer.from(room.token))) return reject('Invalid invitation');
        if (identity !== room.identity) return reject('Disc, BIOS or emulator differs from the host');
        const used = new Set([...room.peers.values()].map(peer => peer.slot));
        const available = [1, 2, 3].filter(slot => !used.has(slot));
        const slot = available.includes(preferredSlot) ? preferredSlot : available[0];
        if (!slot) return reject('Room is full');
        const ticket = randomBytes(24).toString('hex');
        const peer = { ticket, slot, guest: ws };
        room.peers.set(ticket, peer);
        peer.timer = setTimeout(() => drop(room, peer, 'Host did not accept the connection'), 8000);
        ws.on('close', () => drop(room, peer));
        ws.on('message', (bytes, isBinary) => {
          if (!isBinary || !send(peer.stream, bytes, true)) drop(room, peer, 'Connection interrupted');
        });
        if (!send(room.host, ticket)) drop(room, peer, 'Host is unavailable');
        return;
      }
      const peer = room.peers.get(ticket);
      if (role !== 'accept' || !peer || peer.stream || !open(peer.guest)) return reject('Invalid connection ticket');
      peer.stream = ws;
      clearTimeout(peer.timer);
      ws.on('close', () => drop(room, peer));
      ws.on('message', (bytes, isBinary) => {
        if (!isBinary || !send(peer.guest, bytes, true)) drop(room, peer, 'Connection interrupted');
      });
      if (!send(peer.guest, JSON.stringify({ type: 'ready', slot: peer.slot }))) drop(room, peer);
    });
  });
  return server;
}

function drop(room, peer, reason = '') {
  if (!room.peers.delete(peer.ticket)) return;
  clearTimeout(peer.timer);
  peer.guest.close(1000, reason);
  peer.stream?.close(1000, reason);
}

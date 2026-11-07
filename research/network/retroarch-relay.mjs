import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

const limit = 8 * 1024 * 1024;
const joinWindow = 5 * 60_000;
const unavailable = 'This room is no longer available. Ask the host to copy a fresh invitation.';
const open = ws => ws?.readyState === WebSocket.OPEN;
const hex = (value, length) => typeof value === 'string' && value.length === length && /^[a-f0-9]+$/.test(value);
const send = (ws, data, binary = false) => {
  if (!open(ws) || ws.bufferedAmount + Buffer.byteLength(data) > limit) return false;
  ws.send(data, { binary }, error => { if (error) ws.terminate(); });
  return true;
};

export function createRetroArchRelay({ port = 8006, startDedicated } = {}) {
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
      const { role, room: id, token, identity, ticket, preferredSlot, previousSeatKey, progress, roster, camera, nativeCamera } = request ?? {};
      const reject = reason => ws.close(1008, reason);
      if (!hex(id, 24)) return reject('Invalid room');
      if (role === 'create') {
        if (!startDedicated || rooms.size >= 2 || rooms.has(id) ||
            !hex(token, 64) || !hex(identity, 64) ||
            !['all', 'original'].includes(progress) ||
            (nativeCamera === true && camera !== true))
          return reject('Could not create dedicated room');
        const workerKey = randomBytes(32).toString('hex');
        const controller = new AbortController();
        const room = { token, identity, workerKey, controller, peers: new Map(), seats: new Map() };
        room.stop = reason => {
          if (!rooms.delete(id)) return;
          room.stopping = true;
          clearTimeout(room.startup);
          clearTimeout(room.idle);
          for (const peer of room.peers.values()) drop(room, peer, reason);
          room.host?.close(1000, reason);
          controller.abort();
        };
        rooms.set(id, room);
        room.startup = setTimeout(() => room.stop('Dedicated emulator did not start'), 75_000);
        join(room, ws, randomBytes(16).toString('hex'), 0, roster === true);
        Promise.resolve().then(() => startDedicated({
          room: id, workerKey, progress, camera: camera === true, nativeCamera: nativeCamera === true,
        }, controller.signal))
          .then(runtime => runtime.exited.then(() => room.stop('Dedicated emulator stopped')))
          .catch(() => room.stop('Could not start the dedicated emulator'));
        return;
      }
      if (role === 'host') {
        if (startDedicated) return reject('Use the dedicated launcher');
        if (rooms.size >= 32 || rooms.has(id) || !/^[a-f0-9]{64}$/.test(token ?? '') ||
            !/^[a-f0-9]{64}$/.test(identity ?? '')) return reject('Could not create room');
        const room = { host: ws, token, identity, peers: new Map(), wantsRoster: roster === true };
        rooms.set(id, room);
        ws.once('close', () => {
          rooms.delete(id);
          for (const peer of room.peers.values()) drop(room, peer, 'Host left the room');
        });
        ws.on('message', (data, binary) => {
          if (!roster || binary || !isSynchronized(data)) return reject('Unexpected host message');
          room.hostSynchronized = true;
          broadcastRoster(room);
        });
        send(ws, JSON.stringify({ type: 'ready', slot: 0 }));
        return;
      }
      const room = rooms.get(id);
      if (role === 'check') {
        if (!open(room?.host)) return reject(unavailable);
        if (!hex(token, 64) || !timingSafeEqual(Buffer.from(token), Buffer.from(room.token)))
          return reject('Invalid invitation');
        if (room.workerKey) {
          room.joinUntil = Date.now() + joinWindow;
          if (room.emptySince !== undefined) scheduleRoomExpiry(room);
        }
        return ws.close(1000, 'Room available');
      }
      if (role === 'worker' && room?.workerKey && !room.host) {
        if (!hex(token, 64) ||
            !timingSafeEqual(Buffer.from(token), Buffer.from(room.workerKey)))
          return reject('Invalid worker');
        room.host = ws;
        ws.once('close', () => room.stop('Dedicated emulator disconnected'));
        ws.on('message', (data, binary) => {
          if (binary) return reject('Unexpected worker message');
          const message = data.toString();
          if (!room.listening && message === 'listening') {
            room.listening = true;
            clearTimeout(room.startup);
            for (const peer of room.peers.values()) announce(room, peer);
          } else if (room.listening && (message === 'race' || message === 'lobby')) {
            room.racing = message === 'race';
            if (!room.racing) {
              for (const [key, seat] of room.seats) if (seat.status === 'reserved') room.seats.delete(key);
            }
            broadcastRoster(room);
          } else return reject('Unexpected worker message');
        });
        send(ws, JSON.stringify({ type: 'ready', slot: 0 }));
        return;
      }
      if (role === 'guest' && room?.workerKey) {
        if (!hex(token, 64) ||
            !timingSafeEqual(Buffer.from(token), Buffer.from(room.token))) return reject('Invalid invitation');
        if (identity !== room.identity) return reject('Disc, BIOS or emulator differs from the room');
        const previous = hex(previousSeatKey, 32) ? room.seats.get(previousSeatKey) : undefined;
        if (previous && previous.status !== 'reserved') return reject('Controller is already connected');
        const used = new Set([...room.seats.values()].map(seat => seat.slot));
        const slot = previous?.slot ?? [0, 1, 2, 3].find(candidate => !used.has(candidate));
        if (slot === undefined) return reject('All controllers are connected or reserved');
        join(room, ws, previous ? previousSeatKey : randomBytes(16).toString('hex'), slot, roster === true);
        return;
      }
      if (!open(room?.host)) return reject(unavailable);
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
        const peer = { ticket, slot, guest: ws, wantsRoster: roster === true };
        room.peers.set(ticket, peer);
        peer.timer = setTimeout(() => drop(room, peer, 'Host did not accept the connection'), 8000);
        ws.on('close', () => drop(room, peer));
        ws.on('message', (bytes, isBinary) => {
          if (!isBinary && peer.wantsRoster && isSynchronized(bytes)) {
            peer.synchronized = true;
            broadcastRoster(room);
          } else if (!isBinary || !send(peer.stream, bytes, true)) drop(room, peer, 'Connection interrupted');
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
      if (!send(peer.guest, JSON.stringify({ type: 'ready', slot: peer.slot,
        ...(peer.seatKey && { owner: room.owner === peer, seatKey: peer.seatKey }) }))) drop(room, peer);
      else broadcastRoster(room);
    });
  });
  server.stopDedicated = () => {
    for (const room of rooms.values()) room.stop?.('Dedicated server stopped');
  };
  return server;
}

function join(room, guest, seatKey, slot, wantsRoster) {
  const ticket = randomBytes(24).toString('hex');
  const wasReserved = room.seats.has(seatKey);
  const seat = { slot, status: 'loading' };
  const peer = { ticket, slot, guest, seatKey, seat, wantsRoster, wasReserved };
  clearTimeout(room.idle);
  room.emptySince = undefined;
  room.seats.set(seatKey, seat);
  room.peers.set(ticket, peer);
  room.owner ??= peer;
  guest.on('close', () => drop(room, peer));
  guest.on('message', (bytes, binary) => {
    if (!binary && wantsRoster && isSynchronized(bytes)) {
      if (peer.stream && seat.status !== 'connected') {
        seat.status = 'connected';
        broadcastRoster(room);
      }
      return;
    }
    if (!binary || !send(peer.stream, bytes, true)) drop(room, peer, 'Connection interrupted');
  });
  broadcastRoster(room);
  if (room.listening) announce(room, peer);
}

function isSynchronized(bytes) {
  return bytes.toString() === '{"type":"synchronized"}';
}

function broadcastRoster(room) {
  const seats = Array.from({ length: 4 }, (_, slot) => ({ slot, status: 'empty' }));
  if (room.seats) {
    for (const seat of room.seats.values()) seats[seat.slot] = seat;
  } else {
    seats[0].status = room.hostSynchronized ? 'connected' : 'loading';
    for (const peer of room.peers.values()) seats[peer.slot].status = peer.synchronized ? 'connected' : 'loading';
  }
  const message = JSON.stringify({ type: 'roster', seats });
  if (room.wantsRoster) send(room.host, message);
  for (const peer of room.peers.values()) if (peer.wantsRoster && peer.stream) send(peer.guest, message);
}

function announce(room, peer) {
  peer.timer = setTimeout(() => drop(room, peer, 'Dedicated emulator did not accept the connection'), 8000);
  if (!send(room.host, peer.ticket)) drop(room, peer, 'Dedicated emulator unavailable');
}

function scheduleRoomExpiry(room) {
  clearTimeout(room.idle);
  const normalExpiry = room.emptySince + 60_000;
  const joinExpiry = Math.min(room.emptySince + joinWindow, room.joinUntil ?? 0);
  room.idle = setTimeout(() => room.stop('Room expired'), Math.max(normalExpiry, joinExpiry) - Date.now());
}

function drop(room, peer, reason = '') {
  if (!room.peers.delete(peer.ticket)) return;
  clearTimeout(peer.timer);
  if (peer.seatKey && !room.stopping) {
    if (room.racing && (peer.seat.status === 'connected' || peer.wasReserved)) peer.seat.status = 'reserved';
    else room.seats.delete(peer.seatKey);
    if (room.owner === peer) {
      room.owner = room.peers.values().next().value;
      if (room.owner?.stream) send(room.owner.guest, JSON.stringify({ type: 'ownership', owner: true }));
    }
    if (!room.peers.size) {
      room.emptySince = Date.now();
      scheduleRoomExpiry(room);
    }
  }
  if (!room.stopping) broadcastRoster(room);
  peer.guest.close(1000, reason);
  peer.stream?.close(1000, reason);
}

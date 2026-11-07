import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

const limit = 8 * 1024 * 1024;
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
      const { role, room: id, token, identity, ticket, preferredSlot, seatKey, progress, recover, roster, camera, nativeCamera } = request ?? {};
      const reject = reason => ws.close(1008, reason);
      if (!hex(id, 24)) return reject('Invalid room');
      if (role === 'create') {
        if (!startDedicated || rooms.size >= 2 || rooms.has(id) ||
            !hex(token, 64) || !hex(identity, 64) ||
            !['all', 'original'].includes(progress) || !hex(seatKey, 32) ||
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
          clearTimeout(room.seatExpiry);
          for (const peer of room.peers.values()) drop(room, peer, reason);
          room.host?.close(1000, reason);
          controller.abort();
        };
        rooms.set(id, room);
        room.startup = setTimeout(() => room.stop('Dedicated emulator did not start'), 75_000);
        join(room, ws, seatKey, 0, roster === true);
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
              for (const seat of room.seats.values()) {
                seat.ready = false;
                if (seat.reserved) seat.expires = Date.now() + 60_000;
              }
            } else {
              for (const [key, seat] of room.seats) {
                if (seat.expires <= Date.now()) room.seats.delete(key);
                else if (seat.reserved) seat.expires = Infinity;
              }
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
        if (!hex(seatKey, 32)) return reject('Missing controller identity');
        const now = Date.now();
        for (const [key, seat] of room.seats)
          if (seat.expires <= now) room.seats.delete(key);
        const previous = room.seats.get(seatKey);
        if (recover === true && !previous) return reject('This recovery link no longer has a reserved controller');
        if (previous && !previous.reserved) return reject('Controller is already connected');
        const used = new Set([...room.seats.values()].map(seat => seat.slot));
        const slot = previous?.slot ?? [0, 1, 2, 3].find(candidate => !used.has(candidate));
        if (slot === undefined) return reject('All controllers are connected or reserved');
        join(room, ws, seatKey, slot, roster === true);
        return;
      }
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
      if (!send(peer.guest, JSON.stringify({ type: 'ready', slot: peer.slot,
        ...(peer.seatKey && { owner: room.owner === peer }) }))) drop(room, peer);
      else if (peer.seatKey) broadcastRoster(room);
    });
  });
  server.stopDedicated = () => {
    for (const room of rooms.values()) room.stop?.('Dedicated server stopped');
  };
  return server;
}

function join(room, guest, seatKey, slot, wantsRoster) {
  const ticket = randomBytes(24).toString('hex');
  const previous = room.seats.get(seatKey);
  const seat = { slot, expires: Infinity, name: previous?.name ?? '', status: 'loading', ready: false };
  const peer = { ticket, slot, guest, seatKey, seat, wantsRoster };
  clearTimeout(room.idle);
  room.seats.set(seatKey, seat);
  room.peers.set(ticket, peer);
  room.owner ??= peer;
  guest.on('close', () => drop(room, peer));
  guest.on('message', (bytes, binary) => {
    if (!binary && wantsRoster && bytes.length <= 256) {
      let update;
      try { update = JSON.parse(bytes); } catch { return; }
      if (update?.type === 'player') {
        if (typeof update.name === 'string') seat.name = update.name.trim().slice(0, 24);
        if (update.synchronized === true && peer.stream) seat.status = 'connected';
        if (typeof update.ready === 'boolean' && seat.status === 'connected') seat.ready = update.ready;
        broadcastRoster(room);
      }
      return;
    }
    if (!binary || !send(peer.stream, bytes, true)) drop(room, peer, 'Connection interrupted');
  });
  broadcastRoster(room);
  if (room.listening) announce(room, peer);
}

function broadcastRoster(room) {
  const now = Date.now();
  clearTimeout(room.seatExpiry);
  let nextExpiry = Infinity;
  const seats = Array.from({ length: 4 }, (_, slot) => ({ slot, status: 'empty' }));
  for (const [key, seat] of room.seats) {
    if (seat.expires <= now) {
      room.seats.delete(key);
      continue;
    }
    nextExpiry = Math.min(nextExpiry, seat.expires);
    seats[seat.slot] = {
      slot: seat.slot,
      name: seat.name,
      status: seat.status,
      ready: seat.ready,
      owner: room.owner?.slot === seat.slot,
    };
  }
  if (Number.isFinite(nextExpiry))
    room.seatExpiry = setTimeout(() => broadcastRoster(room), nextExpiry - now);
  const message = JSON.stringify({ type: 'roster', racing: Boolean(room.racing), seats });
  for (const peer of room.peers.values()) if (peer.wantsRoster && peer.stream) send(peer.guest, message);
}

function announce(room, peer) {
  peer.timer = setTimeout(() => drop(room, peer, 'Dedicated emulator did not accept the connection'), 8000);
  if (!send(room.host, peer.ticket)) drop(room, peer, 'Dedicated emulator unavailable');
}

function drop(room, peer, reason = '') {
  if (!room.peers.delete(peer.ticket)) return;
  clearTimeout(peer.timer);
  if (peer.seatKey && !room.stopping) {
    Object.assign(peer.seat, { reserved: true, ready: false, status: 'reconnecting',
      expires: room.racing ? Infinity : Date.now() + 60_000 });
    if (room.owner === peer) {
      room.owner = room.peers.values().next().value;
      if (room.owner?.stream) send(room.owner.guest, JSON.stringify({ type: 'ownership', owner: true }));
    }
    if (!room.peers.size) room.idle = setTimeout(() => room.stop('Room expired'), 60_000);
    broadcastRoster(room);
  }
  peer.guest.close(1000, reason);
  peer.stream?.close(1000, reason);
}

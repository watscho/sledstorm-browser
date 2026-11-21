import { randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { validateStateFormat } from '../../web/core-state.js';

const limit = 8 * 1024 * 1024;
const joinWindow = 5 * 60_000;
// How long a dedicated room waits, after a player's stream ended, to learn whether its worker ended too.
const workerNews = 100;
const unavailable = 'This room is no longer available. Ask the host to copy a fresh invitation.';
const starting = 'The room is starting. Try again in a moment.';
const ownRoom = 'This server has one room. Open the game with its invitation link.';
const loading = 'The room is loading a saved game. Try again in a moment.';
const settling = 'The room is still finishing the last load. Try again in a moment.';
const notAlone = 'The room is not available for loading a save. Try again when playing alone.';
const otherGame = 'This save belongs to a different game or emulator build.';
const notStarted = 'The saved game could not be started. The room is unchanged.';
const loaded = 'Saved game loaded';
const serverStopped = 'Dedicated server stopped';
const open = ws => ws?.readyState === WebSocket.OPEN;
const hex = (value, length) => typeof value === 'string' && value.length === length && /^[a-f0-9]+$/.test(value);
const send = (ws, data, binary = false) => {
  if (!open(ws) || ws.bufferedAmount + Buffer.byteLength(data) > limit) return false;
  ws.send(data, { binary }, error => { if (error) ws.terminate(); });
  return true;
};

const validRoom = ({ room, token, identity, progress, camera, nativeCamera, saves }) =>
  hex(room, 24) && hex(token, 64) && hex(identity, 64) && ['all', 'original'].includes(progress) &&
  !(nativeCamera === true && camera !== true) &&
  (saves === undefined || (typeof saves === 'string' && saves.length >= 1 && saves.length <= 256));

/**
 * `ownsRooms` is for a server that opens its one room itself with `createRoom`: no player can make it
 * start or stop an emulator. `startupMs` is how long a new emulator may take to listen. `reservedMs` is
 * how long a server's room that stands empty keeps the controllers of players who left a race, and the
 * controller of a player who loaded a save. `transferMs` is how long a save may take to arrive; the
 * player may be far away, on an uplink that also carries the game. `retryMs` is how long the room takes
 * no new load after one that started an emulator and did not complete.
 */
export function createRetroArchRelay({ port = 8006, startDedicated,
  origins = ['http://127.0.0.1:8000', 'http://localhost:8000'], ownsRooms = false, startupMs = 75_000,
  reservedMs = 60_000, transferMs = 60_000, retryMs = 5_000 } = {}) {
  const rooms = new Map();
  // Rooms of the server whose emulator has ended. A new session may open under the same name.
  const resting = new Set();

  /** A dedicated room and its emulator. A browser asks for one with `create`; a server opens its own. */
  function openDedicated({ room: id, token, identity, progress, camera, nativeCamera, saves, onRestoring }, owned) {
    // Only a server's room says which saves fit it, and only such a room loads one.
    const room = { token, identity, peers: new Map(), seats: new Map(), owned, reservedMs, existing: 0,
      saves: owned ? saves : undefined, onRestoring: typeof onRestoring === 'function' ? onRestoring : undefined };
    room.ended = new Promise(resolve => { room.finish = resolve; });
    /**
     * An emulator for this room, started when its `start` is called. What its end means depends on what
     * it is to the room by then: the room ends with the emulator it runs on, a load fails with the one
     * it was starting, and the end of one that was replaced means nothing.
     */
    room.launch = () => {
      const emulator = { workerKey: randomBytes(32).toString('hex'), controller: new AbortController() };
      emulator.gone = reason => {
        if (room.current === emulator) room.stop(reason);
        else if (room.load?.emulator === emulator) room.load.end(notStarted);
      };
      emulator.startup = setTimeout(() => emulator.gone('Dedicated emulator did not start'), startupMs);
      emulator.start = snapshot => {
        // Counted until it is gone, not until it is told to end: a browser takes a while to leave.
        room.existing += 1;
        return Promise.resolve().then(() => startDedicated({
          room: id, workerKey: emulator.workerKey, progress, camera: camera === true, nativeCamera: nativeCamera === true, snapshot,
        }, emulator.controller.signal))
          .then(runtime => runtime.exited)
          .then(() => 'Dedicated emulator stopped', () => 'Could not start the dedicated emulator')
          .then(reason => {
            room.existing -= 1;
            emulator.gone(reason);
          });
      };
      return emulator;
    };
    room.stop = reason => {
      // By the room itself, not by its name: a server's room has one name for all its sessions, and the
      // emulator of an old session may end long after the next session has opened under that name.
      if (room.stopping) return;
      room.stopping = true;
      if (rooms.get(id) === room) rooms.delete(id);
      clearTimeout(room.current.startup);
      clearTimeout(room.idle);
      // A player who waited for a session that never listened is not told that the emulator failed:
      // the server opens another session, and the answer to that is to try again.
      const told = owned && !room.listening && reason !== serverStopped ? starting : reason;
      // A load that is under way ends with the room, and so does the emulator it was starting.
      room.load?.end(reason);
      for (const peer of room.peers.values()) drop(room, peer, told);
      room.host?.close(1000, reason);
      room.current.controller.abort();
      // Until the server opens the next session or lets go of the name, a guest is told to wait.
      if (owned) resting.add(id);
      room.finish(reason);
    };
    rooms.set(id, room);
    resting.delete(id);
    room.current = room.launch();
    // Having a worker key is what marks a room as a dedicated one.
    room.workerKey = room.current.workerKey;
    room.start = room.current.start;
    return room;
  }

  /**
   * Takes the save that the only player of a server's room wants to load, on the connection `ws` that
   * was opened for it. Until the new emulator listens, every way this can end leaves the room as it was.
   */
  function receiveSave(room, peer, ws) {
    const load = room.load = { peer, seatKey: peer.seatKey };
    load.end = reason => {
      if (room.load !== load) return;
      room.load = undefined;
      clearTimeout(load.timer);
      ws.off('close', load.cancel);
      peer.guest.off('close', load.cancel);
      if (load.emulator) {
        clearTimeout(load.emulator.startup);
        load.emulator.host?.close(1000, reason);
        load.emulator.controller.abort();
        // An emulator was started for nothing. The next one waits, so that asking and calling off
        // again and again cannot keep the server starting browsers.
        room.loadAfter = Date.now() + retryMs;
      }
      ws.close(1008, reason);
      if (room.restoring) {
        room.restoring = false;
        room.onRestoring?.(false);
      }
    };
    load.done = () => {
      ws.off('close', load.cancel);
      send(ws, '{"type":"restore","state":"done"}');
      ws.close(1000, loaded);
    };
    // The player leaving, or the request being closed, calls the load off.
    load.cancel = () => load.end(notAlone);
    load.timer = setTimeout(() => load.end('Save transfer timed out'), transferMs);
    ws.once('close', load.cancel);
    peer.guest.once('close', load.cancel);
    ws.once('message', (bytes, binary) => {
      if (room.load !== load || load.emulator) return;
      clearTimeout(load.timer);
      try {
        if (!binary) throw new Error('Expected a binary snapshot');
        validateStateFormat(bytes);
      } catch { return load.end('Invalid game save'); }
      // Another player may have come while the save was on its way.
      if (!mayLoad(room, peer, load)) return load.end(notAlone);
      room.restoring = true;
      room.onRestoring?.(true);
      send(ws, '{"type":"restore","state":"starting"}');
      // The emulator that runs keeps the room until the new one listens.
      load.emulator = room.launch();
      load.emulator.start(bytes.toString('base64'));
    });
    send(ws, '{"type":"restore","state":"send"}');
  }

  /** The emulator that a load started is listening: the room moves to it, and the one before it ends. */
  function completeLoad(room, load) {
    const { emulator, peer } = load;
    const previous = room.current;
    load.emulator = undefined;
    load.returning = true;
    room.current = emulator;
    room.host = emulator.host;
    room.racing = false;
    previous.host?.close(1000, loaded);
    previous.controller.abort();
    // The player's game was in the emulator that ended. The controller is kept, so that the player comes
    // back to it and is the first in the room again.
    peer.seat.status = 'reserved';
    room.peers.delete(peer.ticket);
    clearTimeout(peer.timer);
    room.owner = undefined;
    peer.guest.off('close', load.cancel);
    peer.guest.close(1000, loaded);
    peer.stream?.close(1000, loaded);
    load.done();
    // Until that player is back the room takes nobody else, and no longer than a kept controller lasts.
    load.timer = setTimeout(() => {
      room.seats.delete(load.seatKey);
      load.end('');
    }, room.reservedMs);
  }
  const server = new WebSocketServer({
    host: '127.0.0.1', port, maxPayload: limit, perMessageDeflate: false,
    verifyClient: ({ origin }) => origins.includes(origin),
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
      const { role, room: id, token, identity, ticket, preferredSlot, previousSeatKey, seatKey, progress, roster, camera, nativeCamera } = request ?? {};
      const reject = reason => ws.close(1008, reason);
      if (!hex(id, 24)) return reject('Invalid room');
      if (ownsRooms && (role === 'create' || role === 'host')) return reject(ownRoom);
      if (role === 'create') {
        if (!startDedicated || rooms.size >= 2 || rooms.has(id) || !validRoom(request))
          return reject('Could not create dedicated room');
        const room = openDedicated(request, false);
        const { start } = room;
        if (request.restoreSnapshot === true) {
          const timeout = setTimeout(() => room.stop('Save transfer timed out'), 10_000);
          const cancel = () => { clearTimeout(timeout); room.stop('Save transfer cancelled'); };
          ws.once('close', cancel);
          join(room, ws, randomBytes(16).toString('hex'), 0, roster === true, (bytes, isBinary) => {
            clearTimeout(timeout);
            ws.off('close', cancel);
            try {
              if (!isBinary) throw new Error('Expected a binary snapshot');
              validateStateFormat(bytes);
              start(bytes.toString('base64'));
            } catch { room.stop('Invalid game save'); }
          });
        } else {
          join(room, ws, randomBytes(16).toString('hex'), 0, roster === true);
          start();
        }
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
      if (role === 'restore') {
        // On a connection of its own: the player's connection to the room carries the live input.
        if (!room?.owned || !room.saves || !hex(token, 64) || !timingSafeEqual(Buffer.from(token), Buffer.from(room.token)))
          return reject('Invalid invitation');
        const peer = hex(seatKey, 32) ? [...room.peers.values()].find(candidate => candidate.seatKey === seatKey) : undefined;
        if (!mayLoad(room, peer)) return reject(notAlone);
        // The room's emulator and one for a load are all that may exist: the one that the last load
        // replaced or gave up must be gone first.
        if (room.existing > 1 || Date.now() < (room.loadAfter ?? 0)) return reject(settling);
        if (request.save !== room.saves) return reject(otherGame);
        return receiveSave(room, peer, ws);
      }
      if (!room && resting.has(id) && (role === 'check' || role === 'guest')) return reject(starting);
      if (role === 'check') {
        // A server's room is there before its emulator listens; a guest who joins then is seated when it does.
        if (!room?.owned && !open(room?.host)) return reject(unavailable);
        if (!hex(token, 64) || !timingSafeEqual(Buffer.from(token), Buffer.from(room.token)))
          return reject('Invalid invitation');
        // After the swap the room waits for the player of the load, who may ask first: a page that was
        // reloaded once more comes back this way. The controller key says whose load it is.
        if (room.restoring && !(room.load?.returning && hex(seatKey, 32) && seatKey === room.load.seatKey))
          return reject(loading);
        // Asking about a server's room changes nothing in it; the join window is for rooms that expire.
        if (room.workerKey && !room.owned) {
          room.joinUntil = Date.now() + joinWindow;
          if (room.emptySince !== undefined) scheduleRoomExpiry(room);
        }
        return ws.close(1000, 'Room available');
      }
      // The worker of the emulator the room runs on, or of the one that a load is starting beside it.
      const emulator = role === 'worker' && room?.workerKey ? [room.current, room.load?.emulator].find(candidate =>
        candidate && !candidate.host && hex(token, 64) &&
        timingSafeEqual(Buffer.from(token), Buffer.from(candidate.workerKey))) : undefined;
      if (role === 'worker' && room?.workerKey && !room.host && !emulator) return reject('Invalid worker');
      if (emulator) {
        emulator.host = ws;
        if (room.current === emulator) room.host = ws;
        ws.once('close', () => emulator.gone('Dedicated emulator disconnected'));
        ws.on('message', (data, binary) => {
          if (binary) return reject('Unexpected worker message');
          const message = data.toString();
          if (!emulator.listening && message === 'listening') {
            emulator.listening = true;
            clearTimeout(emulator.startup);
            if (room.current !== emulator) {
              if (room.load?.emulator === emulator) completeLoad(room, room.load);
              return;
            }
            room.listening = true;
            room.onListening?.();
            for (const peer of room.peers.values()) announce(room, peer);
          } else if (emulator.listening && (message === 'race' || message === 'lobby')) {
            // An emulator that was replaced has nothing more to say about the room.
            if (room.current !== emulator) return;
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
        // While a save is loading, and until its player is back, the room takes nobody else.
        const returning = room.load?.returning === true && previousSeatKey === room.load.seatKey;
        if (room.restoring && !returning) return reject(loading);
        const previous = hex(previousSeatKey, 32) ? room.seats.get(previousSeatKey) : undefined;
        if (previous && previous.status !== 'reserved') return reject('Controller is already connected');
        const used = new Set([...room.seats.values()].map(seat => seat.slot));
        const slot = previous?.slot ?? [0, 1, 2, 3].find(candidate => !used.has(candidate));
        if (slot === undefined) return reject('All controllers are connected or reserved');
        join(room, ws, previous ? previousSeatKey : randomBytes(16).toString('hex'), slot, roster === true);
        if (returning) room.load.end('');
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
      ws.on('close', () => {
        if (!room.workerKey) return drop(room, peer);
        // In a dedicated room this stream ends with the worker, and the relay may see it end before the
        // worker's own connection does. The player is told why the room is gone, not only that a
        // connection ended; what the player sends in the meantime has nowhere to go and says nothing.
        peer.streamEnded = true;
        setTimeout(() => drop(room, peer, open(room.host) ? '' : 'Dedicated emulator disconnected'), workerNews).unref();
      });
      ws.on('message', (bytes, isBinary) => {
        if (!isBinary || !send(peer.guest, bytes, true)) drop(room, peer, 'Connection interrupted');
      });
      if (!send(peer.guest, JSON.stringify({ type: 'ready', slot: peer.slot,
        ...(peer.seatKey && { owner: room.owner === peer, seatKey: peer.seatKey, releaseForLoad: !room.owned,
          ...(room.owned && room.saves && { restore: true }) }) }))) drop(room, peer);
      else broadcastRoster(room);
    });
  });
  server.stopDedicated = () => {
    for (const room of rooms.values()) room.stop?.(serverStopped);
    resting.clear();
  };
  /** What a room looks like from outside, or null when there is none under that name. */
  server.roomStatus = id => describe(rooms.get(id));
  /** Lets go of the name of a room that will not get another session. */
  server.releaseRoom = id => { resting.delete(id); };
  /**
   * Opens a dedicated room without a player: nobody is seated and all four controllers are free.
   * `ready` resolves when its emulator listens and rejects with the reason when the room ends first.
   * `ended` resolves with the reason, whoever ended the room. The room has no idle timeout.
   * `saves` is the identity key of the saves that fit the room's game; with it, the only player of the
   * room may load one into it, and `onRestoring` hears when such a load starts and when it is over.
   */
  server.createRoom = spec => {
    if (!startDedicated) throw new Error('This relay cannot run a dedicated emulator.');
    if (!validRoom(spec ?? {})) throw new Error('Invalid room.');
    if (rooms.has(spec.room)) throw new Error('This room is already open.');
    const room = openDedicated(spec, true);
    const ready = new Promise((resolve, reject) => {
      room.onListening = resolve;
      room.ended.then(reason => reject(new Error(reason)));
    });
    ready.catch(() => {});
    room.start();
    return { ready, ended: room.ended, stop: room.stop, status: () => (rooms.get(spec.room) === room ? describe(room) : null) };
  };
  return server;
}

function describe(room) {
  if (!room) return null;
  const seats = Array.from({ length: 4 }, (_, slot) => ({ slot, status: 'empty' }));
  for (const seat of room.seats?.values() ?? []) seats[seat.slot] = { slot: seat.slot, status: seat.status };
  return { listening: room.listening === true, players: room.peers.size, seats, racing: room.racing === true,
    expiresAt: room.expiresAt ?? null, restoring: room.restoring === true };
}

/**
 * Whether `peer` may load a save into the room: the room's owner, connected, with nobody else there, no
 * controller kept for anyone and no race on. `own` is the load that this question belongs to, if any.
 */
function mayLoad(room, peer, own) {
  return Boolean(peer) && room.owner === peer && peer.seat.status === 'connected' && room.peers.size === 1 &&
    room.seats.size === 1 && !room.racing && room.listening === true && !room.stopping &&
    (room.load === undefined || room.load === own);
}

function join(room, guest, seatKey, slot, wantsRoster, receiveSnapshot) {
  const ticket = randomBytes(24).toString('hex');
  const wasReserved = room.seats.has(seatKey);
  const seat = { slot, status: 'loading' };
  const peer = { ticket, slot, guest, seatKey, seat, wantsRoster, wasReserved };
  clearTimeout(room.idle);
  room.emptySince = undefined;
  room.expiresAt = undefined;
  room.seats.set(seatKey, seat);
  room.peers.set(ticket, peer);
  room.owner ??= peer;
  guest.on('close', () => drop(room, peer));
  guest.on('message', (bytes, binary) => {
    if (receiveSnapshot) {
      const receive = receiveSnapshot;
      receiveSnapshot = undefined;
      receive(bytes, binary);
      return;
    }
    if (!binary && wantsRoster && isSynchronized(bytes)) {
      if (peer.stream && seat.status !== 'connected') {
        seat.status = 'connected';
        broadcastRoster(room);
      }
      return;
    }
    if (!binary && wantsRoster && bytes.toString() === '{"type":"release-for-load"}') {
      // A server's room is not a player's to stop.
      const allowed = !room.owned && room.owner === peer && seat.status === 'connected' &&
        room.peers.size === 1 && room.seats.size === 1 && !room.racing;
      if (send(guest, JSON.stringify({ type: 'released-for-load', allowed })) && allowed)
        room.stop('Loading saved game');
      return;
    }
    if (peer.streamEnded) return;
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
  if (room.owned) {
    // A server's room stays for as long as the server keeps it, with or without players. What does not
    // stay is a controller kept for a player of a race that nobody is in any more.
    room.idle = setTimeout(() => {
      for (const [key, seat] of room.seats) if (seat.status === 'reserved') room.seats.delete(key);
    }, room.reservedMs);
    return;
  }
  const normalExpiry = room.emptySince + 60_000;
  const joinExpiry = Math.min(room.emptySince + joinWindow, room.joinUntil ?? 0);
  room.expiresAt = Math.max(normalExpiry, joinExpiry);
  room.idle = setTimeout(() => room.stop('Room expired'), room.expiresAt - Date.now());
}

function drop(room, peer, reason = '') {
  if (!room.peers.delete(peer.ticket)) return;
  clearTimeout(peer.timer);
  // A load has nobody to come back to it once its player is let go, whether or not that player's
  // connection has closed yet.
  if (room.load?.peer === peer && !room.load.returning) room.load.end(notAlone);
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

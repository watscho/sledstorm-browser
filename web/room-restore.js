// The page's side of loading a saved game into a room that a server owns.
//
// Such a room keeps its name and its invitation through a load: the server starts a second emulator with
// the save and moves the room to it. The save travels on a connection of its own, because the player's
// connection to the room carries the live input. Once the room has taken the save, the player's game is in
// the emulator that ended, so the page reloads and comes back to the room with the controller key it keeps.
import { identityKey } from './save-file.js';

const lost = 'Could not reach the room. Check the connection and try again.';
const rejoinKey = 'sled-room-rejoin';
// The room bounds the save's way (a minute) and the emulator's start (75 s) itself, and closes the request
// each time. This is for a connection that died without a word and so never closes.
const patience = 150_000;

/**
 * Asks the room to load `state`, a save of the library whose key is `save`. Resolves when the room says
 * the game is loaded. Rejects with the room's reason for refusing; the room is then as it was.
 */
export function restoreInRoom({ url, room, token, seatKey, save, state, onStarting, WebSocket: Socket = globalThis.WebSocket }) {
  return new Promise((resolve, reject) => {
    let socket;
    try { socket = new Socket(url); } catch { reject(new Error(lost)); return; }
    let sent = false;
    const deadline = setTimeout(() => {
      reject(new Error(lost));
      // Closing the request calls the load off in the room, if the room can still be reached.
      socket.close();
    }, patience);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ role: 'restore', room, token, seatKey, save }));
    }, { once: true });
    socket.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.type !== 'restore') return;
      // The room checks the player's right first and asks for the save only then.
      if (message.state === 'send' && !sent) {
        sent = true;
        socket.send(state);
      } else if (message.state === 'starting') onStarting?.();
      else if (message.state === 'done') {
        clearTimeout(deadline);
        resolve();
      }
    });
    // The room closes the connection after `done` too; a promise that is settled stays as it is.
    socket.addEventListener('close', event => {
      clearTimeout(deadline);
      reject(new Error(event.reason || lost));
    }, { once: true });
  });
}

/** Keeps the load request to come back with after the reload. */
export function rememberRejoin(id) {
  try { sessionStorage.setItem(rejoinKey, id); } catch { /* The page then returns with its lobby settings. */ }
}

/** The request that `rememberRejoin` kept, once. */
export function takeRejoin() {
  try {
    const id = sessionStorage.getItem(rejoinKey);
    sessionStorage.removeItem(rejoinKey);
    return /^[a-f0-9-]{36}$/.test(id ?? '') ? id : undefined;
  } catch { return undefined; }
}

/**
 * Loads `record` of the save library `storage` into the room that `connection` plays in, then reloads the
 * page, which finds its request with `takeRejoin`. A refusal leaves the page and the game as they were.
 */
export async function loadInRoom(connection, storage, record, options, reload = () => location.reload()) {
  const request = await storage.prepareLoad(record, options);
  try { await connection.restore(record.state, identityKey(storage.identity)); } catch (error) {
    await request.cancel().catch(() => {});
    throw error;
  }
  rememberRejoin(request.id);
  reload();
}

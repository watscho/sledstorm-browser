// Loopback-only transport for qualifying upstream RetroArch Netplay.
import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

const origin = 'http://127.0.0.1:8000';
const capability = process.env.SLED_RETROARCH_LAB_TOKEN;
const maxBytes = 8 * 1024 * 1024;
if (!/^[a-f0-9]{48}$/.test(capability ?? '')) throw new Error('Missing lab capability');

const server = new WebSocketServer({
  host: '127.0.0.1', port: 8007, maxPayload: maxBytes,
  verifyClient: ({ origin: requestOrigin, req }) =>
    requestOrigin === origin && req.url?.startsWith('/' + capability + '/'),
});
const open = ws => ws?.readyState === WebSocket.OPEN;
let host;
const peers = new Map();

function send(ws, data, binary) {
  if (!open(ws) || ws.bufferedAmount + Buffer.byteLength(data) > maxBytes) return false;
  ws.send(data, { binary }, error => { if (error) ws.terminate(); });
  return true;
}

function drop(id) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  clearTimeout(peer.timeout);
  peer.guest.close();
  peer.stream?.close();
}

server.on('connection', (ws, req) => {
  const path = req.url.slice(capability.length + 2);
  ws.on('error', () => ws.terminate());
  if (path === 'host' && !host) {
    host = ws;
    ws.on('message', () => ws.close(1008));
    ws.on('close', () => {
      if (host !== ws) return;
      host = undefined;
      for (const id of peers.keys()) drop(id);
    });
    return;
  }
  if (path === 'guest' && open(host) && peers.size === 0) {
    const id = randomBytes(16).toString('hex');
    const peer = { guest: ws, timeout: setTimeout(() => drop(id), 5000) };
    peers.set(id, peer);
    ws.on('close', () => drop(id));
    ws.on('message', (data, binary) => {
      if (!binary || !send(peer.stream, data, true)) drop(id);
    });
    if (!send(host, id, false)) drop(id);
    return;
  }
  const id = path.startsWith('accept/') && path.slice(7);
  const peer = peers.get(id);
  if (!peer || peer.stream || !open(peer.guest)) {
    ws.close(1008);
    return;
  }
  peer.stream = ws;
  clearTimeout(peer.timeout);
  ws.on('close', () => drop(id));
  ws.on('message', (data, binary) => {
    if (!binary || !send(peer.guest, data, true)) drop(id);
  });
  if (!send(peer.guest, 'ready', false)) drop(id);
});
server.on('listening', () => console.log('RetroArch Netplay lab relay on 127.0.0.1:8007'));

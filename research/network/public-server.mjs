// Loopback gateway for the emulator's private HTTPS tunnel.
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { timingSafeEqual } from 'node:crypto';
export function createPublicGateway({ port = 8005, upstream = 8000, relay = 8004, netplay = null, accessToken = null, discMode = 'local', assetPaths = new Set(), maxPayload = 2048 } = {}) {
  if (!['local', 'shared'].includes(discMode)) throw new Error('Disc mode must be local or shared');
  if (discMode === 'shared' && !/^[a-f0-9]{48}$/.test(accessToken || ''))
    throw new Error('Shared disc mode requires a private access token');
  const accessPath = accessToken ? `/access/${accessToken}` : null;
  const authorized = (request) => {
    if (!accessToken) return true;
    const value = /(?:^|;\s*)sled_access=([a-f0-9]+)/.exec(request.headers.cookie || '')?.[1];
    return value?.length === accessToken.length && timingSafeEqual(Buffer.from(value), Buffer.from(accessToken));
  };
  const server = http.createServer((request, response) => {
    response.setHeader('Referrer-Policy', 'no-referrer');
    let path;
    try { path = new URL(request.url, 'http://localhost').pathname; }
    catch { response.writeHead(400).end(); return; }
    if (accessPath && path === accessPath && request.method === 'GET') {
      const secure = request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      response.writeHead(302, { location: '/',
        'set-cookie': `sled_access=${accessToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure}` }).end();
      return;
    }
    if (!authorized(request)) { response.writeHead(401).end('Open the private access link supplied by the host.'); return; }
    if (!['GET', 'HEAD'].includes(request.method) || !assetPaths.has(path)) {
      response.writeHead(403).end(discMode === 'local'
        ? 'This gateway requires local CUE and BIN files.'
        : 'This gateway only permits runtime assets and the shared disc archive.'); return;
    }
    const remote = http.request({ hostname: '127.0.0.1', port: upstream, path,
      method: request.method, headers: { host: `127.0.0.1:${upstream}` } }, (incoming) => {
      const headers = { ...incoming.headers, 'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp', 'cache-control': 'no-store' };
      if (path === '/session-info' && accessPath) headers['x-invite-path'] = accessPath;
      response.writeHead(incoming.statusCode, headers);
      incoming.pipe(response);
    });
    remote.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end('Local runtime server unavailable'); });
    response.on('close', () => remote.destroy());
    remote.end();
  });
  const websockets = new WebSocketServer({ noServer: true, maxPayload, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    let validOrigin = false;
    try { validOrigin = new URL(request.headers.origin).host === request.headers.host; } catch {}
    const binaryRelay = request.url === '/netplay' && netplay;
    if ((request.url !== '/relay' && !binaryRelay) || !validOrigin || !authorized(request)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    websockets.handleUpgrade(request, socket, head, (client) => {
      const peer = new WebSocket(`ws://127.0.0.1:${binaryRelay || relay}`, { origin: `http://127.0.0.1:${upstream}`, maxPayload, perMessageDeflate: false });
      const pending = [];
      let pendingBytes = 0;
      const forward = (target, data, binary) => {
        if (target.bufferedAmount + data.length > maxPayload) { close(); return; }
        target.send(data, { binary }, error => { if (error) close(); });
      };
      const close = () => { client.close(); peer.close(); };
      client.on('error', () => {});
      peer.on('error', close);
      client.on('close', () => peer.close());
      peer.on('close', (code, reason) => code === 1006 ? client.close() : client.close(code === 1005 ? 1000 : code, reason));
      client.on('message', (data, binary) => {
        if (binary && !binaryRelay) { close(); return; }
        if (peer.readyState === WebSocket.OPEN) forward(peer, data, binary);
        else if (peer.readyState === WebSocket.CONNECTING && pending.length < 8 && pendingBytes + data.length <= maxPayload) {
          pending.push([data, binary]);
          pendingBytes += data.length;
        }
        else close();
      });
      peer.on('open', () => { for (const [data, binary] of pending) forward(peer, data, binary); pending.length = 0; });
      peer.on('message', (data, binary) => { if (client.readyState === WebSocket.OPEN) forward(client, data, binary); });
    });
  });
  server.on('close', () => { for (const client of websockets.clients) client.terminate(); websockets.close(); });
  server.listen(port, '127.0.0.1');
  return server;
}

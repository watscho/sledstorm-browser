// Optional loopback gateway for an HTTPS tunnel. Only runtime assets and disc
// metadata are exposed. CUE/BIN bytes are deliberately outside the allowlist.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const assets = new Set(['/', '/port.js', '/lobby.js', '/lobby.css', '/launch-settings.js', '/race-preview.svg', '/network-client.js', '/disc-fs.js', '/local-disc.js',
  '/game.js', '/game.wasm', '/bios.bin', '/manifest', '/identity']);
export function createPublicGateway({ port = 8003, upstream = 8001, relay = 8002, accessToken = null } = {}) {
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
    if (request.method === 'POST' && path === '/diagnostic') {
      request.resume(); response.writeHead(204).end(); return;
    }
    if (!['GET', 'HEAD'].includes(request.method) || !assets.has(path)) {
      response.writeHead(403).end('This gateway does not serve disc files. Select your local CUE and BIN files.'); return;
    }
    const remote = http.request({ hostname: '127.0.0.1', port: upstream, path,
      method: request.method, headers: { host: '127.0.0.1:8001' } }, (incoming) => {
      const headers = { ...incoming.headers, 'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp', 'cache-control': 'no-store' };
      if (path === '/manifest') headers['x-disc-local-required'] = '1';
      if (path === '/manifest' && accessPath) headers['x-invite-path'] = accessPath;
      response.writeHead(incoming.statusCode, headers);
      incoming.pipe(response);
    });
    remote.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end('Local runtime server unavailable'); });
    response.on('close', () => remote.destroy());
    remote.end();
  });
  const websockets = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    let validOrigin = false;
    try { validOrigin = new URL(request.headers.origin).host === request.headers.host; } catch {}
    if (request.url !== '/relay' || !validOrigin || !authorized(request)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    websockets.handleUpgrade(request, socket, head, (client) => {
      const peer = new WebSocket(`ws://127.0.0.1:${relay}`, { origin: 'http://127.0.0.1:8001', maxPayload: 2048, perMessageDeflate: false });
      const pending = [];
      const close = () => { client.close(); peer.close(); };
      client.on('error', () => {});
      peer.on('error', close);
      client.on('close', () => peer.close());
      peer.on('close', () => client.close());
      client.on('message', (data, binary) => {
        if (binary) { close(); return; }
        if (peer.readyState === WebSocket.OPEN) peer.send(data, { binary: false });
        else if (peer.readyState === WebSocket.CONNECTING && pending.length < 8) pending.push(data);
        else close();
      });
      peer.on('open', () => { for (const data of pending) peer.send(data, { binary: false }); pending.length = 0; });
      peer.on('message', (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }); });
    });
  });
  server.on('close', () => { for (const client of websockets.clients) client.terminate(); websockets.close(); });
  server.listen(port, '127.0.0.1');
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const accessToken = randomBytes(24).toString('hex');
  await mkdir(new URL('../../.cache/', import.meta.url), { recursive: true });
  await writeFile(new URL('../../.cache/gateway-access.txt', import.meta.url), `/access/${accessToken}`, { mode: 0o600 });
  const server = createPublicGateway({ accessToken });
  server.on('listening', () => console.log(`Private disc-free gateway: http://127.0.0.1:8003/access/${accessToken}`));
}

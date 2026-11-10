// Loopback gateway for the emulator's private HTTPS tunnel.
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { timingSafeEqual } from 'node:crypto';
import { mirrorBufferLimit, mirrorPayloadLimit, orderedPackets, sequenceBytes, sequencePacket } from '../../web/netplay-wire.js';

export function createPublicGateway({ port = 8005, upstream = 8000, relay = 8004, netplay = null, accessToken = null,
  discMode = 'local', assetPaths = new Set(), maxPayload = 2048, mirrorPort, getMirrorOrigin } = {}) {
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
      if (path === '/disc.zip' && request.method === 'GET' && incoming.statusCode === 200 &&
          headers['content-length'] !== undefined) {
        // Stream archive bytes through the tunnel while keeping the size for download validation.
        headers['x-sledstorm-disc-size'] = headers['content-length'];
        delete headers['content-length'];
      }
      if (path === '/session-info' && accessPath) headers['x-invite-path'] = accessPath;
      if (path === '/session-info' && netplay) {
        headers['x-sled-netplay-delivery'] = 'mirror-v2';
        const mirrorOrigin = getMirrorOrigin?.();
        if (mirrorOrigin) headers['x-sled-netplay-mirror-origin'] = mirrorOrigin;
      }
      response.writeHead(incoming.statusCode, headers);
      incoming.once('error', () => response.destroy());
      incoming.pipe(response);
    });
    remote.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end('Local runtime server unavailable'); });
    response.on('close', () => remote.destroy());
    remote.end();
  });
  const websockets = new WebSocketServer({ noServer: true, maxPayload: maxPayload + sequenceBytes, perMessageDeflate: false });
  const mirrors = new WebSocketServer({ noServer: true, maxPayload: mirrorPayloadLimit + sequenceBytes, perMessageDeflate: false });
  const downlinks = new Map();
  const deliveryRoute = /^\/netplay(-mirror)?\?(downlink|duplex)=([a-f0-9]{48})$/;
  const rejectUpgrade = socket => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');

  function upgradeMirror(link, path, request, socket, head) {
    if (link[path] || link.primary.readyState !== WebSocket.OPEN || (link.duplex && !link.ready)) return rejectUpgrade(socket);
    mirrors.handleUpgrade(request, socket, head, mirror => {
      link[path] = mirror;
      mirror.on('error', () => mirror.terminate());
      mirror.on('message', (data, binary) => {
        if (!link.duplex || !binary || !link.receive(data)) mirror.close(1008, 'Invalid mirrored input');
      });
      mirror.on('close', () => { link[path] = null; });
    });
  }

  if (netplay && mirrorPort !== undefined) {
    // A separate loopback listener exposes only a mirror for an existing, authorized primary.
    const mirrorServer = http.createServer((request, response) => response.writeHead(403).end());
    mirrorServer.on('upgrade', (request, socket, head) => {
      const route = deliveryRoute.exec(request.url);
      const link = route?.[1] && route[2] === 'duplex' && downlinks.get(route[3]);
      if (!link?.duplex || request.headers.origin !== link.origin || request.headers['x-forwarded-proto'] !== 'https')
        return rejectUpgrade(socket);
      upgradeMirror(link, 'separate', request, socket, head);
    });
    server.mirrorServer = mirrorServer.listen(mirrorPort, '127.0.0.1');
  }

  server.on('upgrade', (request, socket, head) => {
    let validOrigin = false;
    try { validOrigin = new URL(request.headers.origin).host === request.headers.host; } catch {}
    const reject = () => rejectUpgrade(socket);
    if (!validOrigin || !authorized(request)) return reject();
    const delivery = netplay && deliveryRoute.exec(request.url);
    const key = delivery?.[3];
    const duplex = delivery?.[2] === 'duplex';
    if (delivery?.[1]) {
      const link = downlinks.get(key);
      if (!link || link.duplex !== duplex) return reject();
      return upgradeMirror(link, 'fallback', request, socket, head);
    }
    const binaryRelay = (request.url === '/netplay' || delivery) && netplay;
    if ((request.url !== '/relay' && !binaryRelay) || downlinks.has(key)) return reject();
    websockets.handleUpgrade(request, socket, head, (client) => {
      const peer = new WebSocket(`ws://127.0.0.1:${binaryRelay || relay}`, { origin: `http://127.0.0.1:${upstream}`, maxPayload, perMessageDeflate: false });
      const link = key ? { primary: client, separate: null, fallback: null, sequence: 0, origin: request.headers.origin, duplex } : null;
      if (link) downlinks.set(key, link);
      const pending = [];
      let pendingBytes = 0;
      const forward = (target, data, binary, budget = maxPayload) => {
        if (target.bufferedAmount + data.length > budget) { close(); return; }
        target.send(data, { binary }, error => { if (error) close(); });
      };
      const close = () => { client.close(); peer.close(); };
      client.on('error', () => {});
      peer.on('error', close);
      client.on('close', () => {
        peer.close();
        if (link) {
          downlinks.delete(key);
          link.separate?.close();
          link.fallback?.close();
        }
      });
      peer.on('close', (code, reason) => code === 1006 ? client.close() : client.close(code === 1005 ? 1000 : code, reason));
      const fromClient = (data, binary) => {
        if ((binary && !binaryRelay) || data.length > maxPayload) { close(); return; }
        if (peer.readyState === WebSocket.OPEN) forward(peer, data, binary);
        else if (peer.readyState === WebSocket.CONNECTING && pending.length < 8 && pendingBytes + data.length <= maxPayload) {
          pending.push([data, binary]);
          pendingBytes += data.length;
        }
        else close();
      };
      if (duplex) link.receive = orderedPackets(data => fromClient(data, true));
      client.on('message', (data, binary) => {
        if (binary && duplex && link.ready) {
          if (!link.receive(data)) close();
        } else fromClient(data, binary);
      });
      peer.on('open', () => { for (const [data, binary] of pending) forward(peer, data, binary); pending.length = 0; });
      peer.on('message', (data, binary) => {
        if (client.readyState !== WebSocket.OPEN) return;
        if (!link || !binary) {
          // The creator may upload an unframed save before RetroArch receives its connection.
          if (duplex && !link.ready && data.toString().startsWith('{"type":"ready","slot":')) link.ready = true;
          forward(client, data, binary);
          return;
        }
        const packet = sequencePacket(link.sequence, data);
        link.sequence = (link.sequence + 1) >>> 0;
        forward(client, packet, true, maxPayload + sequenceBytes);
        // Keep large save-state transfers on the primary connection.
        if (data.length > mirrorPayloadLimit) return;
        for (const mirror of [link.separate, link.fallback]) {
          if (mirror?.readyState !== WebSocket.OPEN) continue;
          if (mirror.bufferedAmount + packet.length > mirrorBufferLimit) mirror.terminate();
          else mirror.send(packet, { binary: true }, error => { if (error) mirror.terminate(); });
        }
      });
    });
  });
  server.on('close', () => {
    server.mirrorServer?.close();
    for (const sockets of [websockets, mirrors]) {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}

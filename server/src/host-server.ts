// Loopback control listener. This stage exposes only what launch, reopen and
// quit need; the admin panel and its session handling arrive with stage P3.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { applicationName } from './paths.ts';

export interface HostServer {
  port: number;
  instance: string;
  token: string;
  startedAt: string;
  close(): Promise<void>;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }).end(data);
}

function page(response: ServerResponse, version: string): void {
  const data = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${applicationName}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 1rem}</style>
<h1>${applicationName}</h1>
<p>The server is running. This development build proves packaging only; the control panel arrives in a later stage.</p>
<p>Version ${version}</p>
</html>
`;
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  }).end(data);
}

export async function startHostServer({ version, onQuit, status, invitation }: {
  version: string;
  onQuit: () => void;
  status: () => object;
  /** The links to the server's room: for guests, and for a browser on this computer. Each is null while it does not work. */
  invitation: () => { url: string | null; localUrl: string | null };
}): Promise<HostServer> {
  const instance = randomBytes(8).toString('hex');
  const token = randomBytes(32).toString('hex');
  const startedAt = new Date().toISOString();
  let hosts: string[] = [];

  const authorized = (request: IncomingMessage) => {
    const supplied = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '')?.[1];
    return supplied !== undefined && timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
  };

  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    // A loopback address is not authorization: refuse rebound hosts and foreign origins first.
    if (!hosts.includes(request.headers.host ?? '')) return send(response, 403, { error: 'Unexpected host' });
    const origin = request.headers.origin;
    if (origin !== undefined && !hosts.some(host => origin === `http://${host}`))
      return send(response, 403, { error: 'Unexpected origin' });
    // Routes match the raw request path. Nothing is decoded or normalized, so an
    // encoded or dotted spelling of a route is simply not a route.
    const path = (request.url ?? '').split('?', 1)[0] ?? '';

    if (path === '/' && request.method === 'GET') return page(response, version);
    if (!path.startsWith('/api/')) return send(response, 404, { error: 'Not found' });
    if (!authorized(request)) return send(response, 401, { error: 'Authorization required' });
    if (path === '/api/status' && request.method === 'GET')
      return send(response, 200, { application: applicationName, version, instance, pid: process.pid, startedAt, host: status() });
    if (path === '/api/invitation' && request.method === 'GET') {
      // The links are credentials for the room. They leave the server here only, to a caller that holds the control credential.
      const { url, localUrl } = invitation();
      return url || localUrl ? send(response, 200, { url, localUrl }) : send(response, 409, { error: 'No room is open.' });
    }
    if (path === '/api/host/quit' && request.method === 'POST') {
      send(response, 202, { quitting: true });
      setImmediate(onQuit);
      return;
    }
    send(response, 404, { error: 'Not found' });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  return {
    port, instance, token, startedAt,
    close: () => new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

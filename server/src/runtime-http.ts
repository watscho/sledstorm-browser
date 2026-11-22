// The game origin: the web client, the emulator assets, the session info and
// the host disc, on the fixed loopback port. This is the TypeScript port of
// the routes of server.py that a packaged host needs.
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createDeliveryLimit, DeliveryBusyError } from './delivery-limit.ts';
import type { ArchiveManifest } from './game-data.ts';

export interface RuntimeHttpOptions {
  port: number;
  webRoot: string;
  /** Served under /emulator/. */
  emulatorRoot: string;
  /** Served as /network-core.data. */
  coreData: string;
  hardwareRenderer: boolean;
  sessionInfo: object;
  invitation(): { origin: string; path: string } | null;
  /** Null keeps the host disc private: /disc.zip and /game-data/ answer 404. */
  archive: {
    size: number;
    /** What /game-data/manifest names (D92): the session info's disc, PAL flag and archive. */
    manifest: { disc: string; pal: boolean; archive: ArchiveManifest };
    open(): Promise<Readable>;
    openChunk(index: number): Promise<Readable>;
  } | null;
  /** The limit on disc deliveries to guests, which the gateway marks (D94); the defaults are DELIVERY's. */
  delivery?: { active: number; waiting: number; idleMs: number };
}

/**
 * At most 4 disc deliveries to guests at once and 16 waiting; a delivery whose client stops reading is cut 30 to 60 s
 * later (D94).
 */
export const DELIVERY = { active: 4, waiting: 16, idleMs: 30_000 };
/** The header that the gateway adds to every request it forwards (`research/network/public-server.mjs`). */
const GATEWAY_MARK = 'x-sled-gateway';
const CHUNK_ROUTE = /^\/game-data\/([a-f0-9]{64})\/chunks\/(0|[1-9][0-9]*)$/;
const CHANGED = 'The game files changed. Start the server again.';
/** The mark on a changed-files 503, by which the page tells it from a proxy's 503 (D102). */
const CHANGED_MARK = { 'X-Sled-Game-Files': 'changed' };

export interface RuntimeHttp {
  port: number;
  close(): Promise<void>;
}

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.zip': 'application/zip',
};

function plain(response: ServerResponse, status: number, text: string, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text),
    ...headers }).end(text);
}

/** Sends a stream and ends quietly when either side goes away; the source is destroyed with it. */
async function send(source: Readable, response: ServerResponse): Promise<void> {
  try { await pipeline(source, response); } catch { response.destroy(); }
}

export async function startRuntimeHttp(options: RuntimeHttpOptions): Promise<RuntimeHttp> {
  const webRoot = await realpath(options.webRoot);
  const emulatorRoot = await realpath(options.emulatorRoot);
  let hosts: string[] = [];
  const delivery = options.delivery ?? DELIVERY;
  const limit = createDeliveryLimit(delivery);

  /**
   * Sends one disc delivery, under the limit when a guest asks through the gateway. HEAD opens the source as GET
   * does, so it never promises what GET would refuse, and reads nothing. The source stops when the client goes or
   * stops reading.
   */
  async function deliver(request: IncomingMessage, response: ServerResponse, open: () => Promise<Readable>,
    headers: Record<string, string | number>): Promise<void> {
    if (request.method === 'HEAD') {
      let source: Readable;
      try { source = await open(); }
      catch { return plain(response, 503, CHANGED, CHANGED_MARK); }
      source.destroy();
      response.writeHead(200, headers).end();
      return;
    }
    const gone = new AbortController();
    const abort = () => gone.abort(new Error('The client went away.'));
    response.once('close', abort);
    // The room's emulator, the owner's page and any page on this computer come over loopback without the gateway's
    // mark: they always get the disc and never wait behind guests (brief §11.1, D94).
    let release = () => {};
    if (request.headers[GATEWAY_MARK] !== undefined) {
      try { release = await limit.acquire(gone.signal); }
      catch (error) {
        response.off('close', abort);
        if (!(error instanceof DeliveryBusyError)) return;
        response.setHeader('Retry-After', '2');
        return plain(response, 503, error.message);
      }
    }
    try {
      let source: Readable;
      try { source = await open(); }
      catch { return plain(response, 503, CHANGED, CHANGED_MARK); }
      response.writeHead(200, headers);
      response.setTimeout(delivery.idleMs, () => response.destroy());
      await send(source, response);
    } finally {
      response.off('close', abort);
      release();
    }
  }

  async function gameData(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
    const { archive } = options;
    if (!archive) return plain(response, 404, 'Not found');
    if (path === '/game-data/manifest') {
      const body = JSON.stringify({ version: 1, ...archive.manifest });
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    // The archive ID and the index are checked before anything is opened (D92).
    const match = CHUNK_ROUTE.exec(path);
    const { sha256, size, chunkSize, chunks } = archive.manifest.archive;
    const index = match ? Number(match[2]) : -1;
    if (!match || match[1] !== sha256 || !(index < chunks.length)) return plain(response, 404, 'Not found');
    const length = Math.min(chunkSize, size - index * chunkSize);
    return deliver(request, response, () => archive.openChunk(index),
      { 'Content-Type': 'application/octet-stream', 'Content-Length': length });
  }

  async function file(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
    const status = await stat(path).catch(() => null);
    if (!status?.isFile()) return plain(response, 404, 'Not found');
    response.setHeader('Last-Modified', new Date(Math.floor(status.mtimeMs / 1000) * 1000).toUTCString());
    // A copy the browser kept is confirmed by this tag and never by its date. The Python launcher and every
    // other build serve this same address, and a copy from one of them may be newer by date and still be
    // another file: confirming it would run that client against this server.
    const tag = `"${status.size.toString(16)}-${Math.floor(status.mtimeMs).toString(16)}"`;
    response.setHeader('ETag', tag);
    const kept = (request.headers['if-none-match'] ?? '').split(',').map(value => value.trim().replace(/^W\//, ''));
    if (kept.includes(tag)) {
      response.writeHead(304).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': types[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': status.size });
    if (request.method === 'HEAD' || status.size === 0) {
      response.end();
      return;
    }
    await send(createReadStream(path, { start: 0, end: status.size - 1 }), response);
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const raw = request.url ?? '';
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (raw === '/session-info' || raw.startsWith('/game-data/')) response.setHeader('Cache-Control', 'no-store');
    // Without this a browser may use a kept copy for a while without asking, and the tag gets no say.
    else if (!raw.startsWith('/disc.zip')) response.setHeader('Cache-Control', 'no-cache');

    // A loopback address is not authorization: a page on another site could
    // reach this port through a rebound host name.
    if (!hosts.includes(request.headers.host ?? '')) return plain(response, 403, 'Forbidden');
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      return plain(response, 405, 'Method not allowed');
    }

    if (raw === '/session-info') {
      const body = JSON.stringify(options.sessionInfo);
      if (options.hardwareRenderer) response.setHeader('X-Sled-Hardware-Renderer', 'webgl2');
      // The host page builds invitations for the public address of this exact server.
      const invitation = options.invitation();
      if (invitation && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(invitation.origin)
          && /^\/access\/[a-f0-9]{48}$/.test(invitation.path)) {
        response.setHeader('X-Invite-Origin', invitation.origin);
        response.setHeader('X-Invite-Path', invitation.path);
      }
      response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }).end(body);
      return;
    }

    const query = raw.indexOf('?');
    const path = query < 0 ? raw : raw.slice(0, query);
    let route: string;
    try { route = decodeURIComponent(path); }
    catch { return plain(response, 400, 'Bad request'); }
    if (!route.startsWith('/')) return plain(response, 400, 'Bad request');

    // The disc's pieces are matched as they were written, so an encoded spelling never names one.
    if (path.startsWith('/game-data/') || route.startsWith('/game-data/')) return gameData(request, response, path);
    if (route === '/disc.zip') {
      const { archive } = options;
      if (!archive) return plain(response, 404, 'Not found');
      return deliver(request, response, () => archive.open(), { 'Content-Type': 'application/zip', 'Content-Length': archive.size });
    }
    if (route === '/network-core.data') return file(request, response, options.coreData);

    const emulator = route.startsWith('/emulator/');
    const root = emulator ? emulatorRoot : webRoot;
    const relative = emulator ? route.slice('/emulator/'.length) : route.replace(/^\/+/, '') || 'index.html';
    // Hidden files and dot segments are never part of the client.
    if (/[\0\\]/.test(relative) || relative.split('/').some(segment => segment.startsWith('.')))
      return plain(response, 404, 'Not found');
    // The real path settles links: the file must sit inside its root.
    const target = await realpath(join(root, relative)).catch(() => null);
    if (!target?.startsWith(root + sep)) return plain(response, 404, 'Not found');
    return file(request, response, target);
  }

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (response.headersSent) response.destroy();
      else plain(response, 500, 'Internal error');
    });
  });
  server.listen(options.port, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  return {
    port,
    close: () => new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

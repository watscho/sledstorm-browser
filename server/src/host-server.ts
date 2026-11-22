// Loopback control listener. It answers the commands of the executable, which
// hold the control credential of the instance record, and the panel's page,
// which holds a session that it got for a one-time token. Either may start
// and stop hosting, start a new game in the room, change the configuration,
// choose the game folder in the system's dialog and export the diagnostic
// report; `host-control.ts` has the rules.
// The page itself is a few files of the resource directory `admin`.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { HostControl, InTheRoom, Refusal } from './host-control.ts';
import { createPanelSessions, type PanelSessions } from './panel-sessions.ts';
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

const LINK_EXPIRED = 'This link to the panel has expired. Open Sled Storm Server again.';
/** The longest body the listener reads. */
const BODY_LIMIT = 1024;
/** A configuration carries the path of a folder, which may be as long as the system allows. */
const CONFIG_LIMIT = 4096;

type Body = { value: unknown } | { status: 400 | 413 | 415; error: string };

/** The JSON body of a request. A body that is too long is not read to its end. */
async function readJson(request: IncomingMessage, limit = BODY_LIMIT): Promise<Body> {
  // A page of another origin cannot send this type without asking first, and the listener never says yes.
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? ''))
    return { status: 415, error: 'Send the request as application/json.' };
  const tooLong: Body = { status: 413, error: 'The request is too long.' };
  if (Number(request.headers['content-length'] ?? 0) > limit) return tooLong;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > limit) return tooLong;
      chunks.push(chunk);
    }
  } catch {
    return { status: 400, error: 'The request was cut short.' };
  }
  try { return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }; }
  catch { return { status: 400, error: 'The request is not JSON.' }; }
}

/** The panel's page: these addresses, and no other file of its folder. */
const PANEL_FILES = new Map([
  ['/', { name: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/panel.css', { name: 'panel.css', type: 'text/css; charset=utf-8' }],
  ['/session.js', { name: 'session.js', type: 'text/javascript; charset=utf-8' }],
  ['/view.js', { name: 'view.js', type: 'text/javascript; charset=utf-8' }],
  ['/controller.js', { name: 'controller.js', type: 'text/javascript; charset=utf-8' }],
  ['/panel.js', { name: 'panel.js', type: 'text/javascript; charset=utf-8' }],
]);

/** The page runs its own files and talks to its own listener. Nothing written into it runs, and no other page may frame it. */
const PANEL_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; "
  + "form-action 'none'; frame-ancestors 'none'";

/**
 * The page's files, read once when the listener starts: a server that keeps running after the application was
 * replaced in place serves the page of its own build, which knows its routes, not the page on the disc. A file
 * that cannot be read is null.
 */
async function readPanel(root: string): Promise<Map<string, Buffer | null>> {
  const files = new Map<string, Buffer | null>();
  for (const { name } of PANEL_FILES.values()) files.set(name, await readFile(join(root, name)).catch(() => null));
  return files;
}

function panelFile(response: ServerResponse, data: Buffer | null | undefined, type: string): void {
  if (!data) {
    const text = 'This build is missing the control panel page.';
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) }).end(text);
    return;
  }
  response.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Content-Security-Policy': PANEL_POLICY }).end(data);
}

export async function startHostServer({ version, panelRoot, onQuit, status, invitation, control, startSolo, sessions = createPanelSessions() }: {
  version: string;
  /** The folder of the panel's page, `admin` in the resources. */
  panelRoot: string;
  onQuit: () => void;
  status: () => object;
  /** Start, stop, a new game, the configuration and the diagnostic report, for a command or the panel. */
  control: HostControl;
  startSolo?: () => Promise<string>;
  /** The links to the server's room: for guests, and for a browser on this computer. Each is null while it does not work. */
  invitation: () => { url: string | null; localUrl: string | null };
  /** The sessions of the panel. A test gives its own, with a clock. */
  sessions?: PanelSessions;
}): Promise<HostServer> {
  const instance = randomBytes(8).toString('hex');
  const token = randomBytes(32).toString('hex');
  const startedAt = new Date().toISOString();
  const panel = await readPanel(panelRoot);
  let hosts: string[] = [];

  /** Who asks: a command that holds the control credential, the panel's page with its session, or nobody. */
  const caller = (request: IncomingMessage): 'control' | 'panel' | null => {
    const supplied = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '')?.[1];
    if (supplied === undefined) return null;
    if (timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return 'control';
    return sessions.has(supplied) ? 'panel' : null;
  };

  /** The JSON body, or null once the request has been answered because it had none that could be read. */
  const body = async (request: IncomingMessage, response: ServerResponse, limit?: number): Promise<{ value: unknown } | null> => {
    const read = await readJson(request, limit);
    if (!('status' in read)) return read;
    // The rest of a long body is not waited for.
    if (read.status === 413) response.setHeader('Connection', 'close');
    send(response, read.status, { error: read.error });
    return null;
  };

  /** The page has nothing but its one-time token yet, so this route alone takes no credential. */
  const openSession = async (request: IncomingMessage, response: ServerResponse) => {
    const sent = await body(request, response);
    if (!sent) return;
    const bootstrap = (sent.value as { bootstrap?: unknown } | null)?.bootstrap;
    const session = typeof bootstrap === 'string' ? sessions.exchange(bootstrap) : null;
    return session ? send(response, 201, { session }) : send(response, 401, { error: LINK_EXPIRED });
  };

  /**
   * A start or a stop may come without a body. With one, only `"force": true` ends a room that has
   * players. Null once the request has been answered because its body could not be read.
   */
  const forced = async (request: IncomingMessage, response: ServerResponse): Promise<{ force: boolean } | null> => {
    if (request.headers['transfer-encoding'] === undefined && !(Number(request.headers['content-length'] ?? 0) > 0)) return { force: false };
    const sent = await body(request, response);
    return sent && { force: (sent.value as { force?: unknown } | null)?.force === true };
  };

  /** The answer does not wait for the host: preparing a disc takes a while, and the status tells how it goes. */
  const hosting = async (request: IncomingMessage, response: ServerResponse, ask: (force: boolean) => InTheRoom | Refusal | null) => {
    const sent = await forced(request, response);
    if (!sent) return;
    const refused = ask(sent.force);
    if (!refused) return send(response, 202, { host: status() });
    return 'players' in refused ? send(response, 409, { error: 'Players are in the room.', players: refused.players })
      : send(response, refused.status, { error: refused.error });
  };

  const changeConfig = async (request: IncomingMessage, response: ServerResponse) => {
    const sent = await body(request, response, CONFIG_LIMIT);
    if (!sent) return;
    const saved = await control.configure(sent.value);
    return 'error' in saved ? send(response, saved.status, { error: saved.error }) : send(response, 200, saved);
  };

  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    // No page of another origin gets an answer as a script, a style or an image, the page's own files included.
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    // A loopback address is not authorization: refuse rebound hosts and foreign origins first.
    if (!hosts.includes(request.headers.host ?? '')) return send(response, 403, { error: 'Unexpected host' });
    const origin = request.headers.origin;
    if (origin !== undefined && !hosts.some(host => origin === `http://${host}`))
      return send(response, 403, { error: 'Unexpected origin' });
    // Routes match the raw request path. Nothing is decoded or normalized, so an
    // encoded or dotted spelling of a route is simply not a route.
    const path = (request.url ?? '').split('?', 1)[0] ?? '';

    // A route that reads a body or the disk answers later. What it could not answer ends the connection.
    const later = (answer: Promise<void>) => { void answer.catch(() => response.destroy()); };
    // The page holds no secret and needs no credential. What it may ask for, it asks with its session.
    const file = request.method === 'GET' ? PANEL_FILES.get(path) : undefined;
    if (file) return panelFile(response, panel.get(file.name), file.type);
    if (!path.startsWith('/api/')) return send(response, 404, { error: 'Not found' });
    if (path === '/api/session' && request.method === 'POST') return later(openSession(request, response));
    const asking = caller(request);
    if (!asking) return send(response, 401, { error: 'Authorization required' });
    if (path === '/api/session/bootstrap' && request.method === 'POST') {
      // Only a command of this user opens the panel; a page cannot hand its access on.
      return asking === 'control' ? send(response, 201, { bootstrap: sessions.mintBootstrap() })
        : send(response, 403, { error: 'A panel session cannot open another one.' });
    }
    if (path === '/api/status' && request.method === 'GET')
      return send(response, 200, { application: applicationName, version, instance, pid: process.pid, startedAt, host: status() });
    if (path === '/api/invitation' && request.method === 'GET') {
      // The links are credentials for the room. They leave the server here only, to a command or to the panel.
      const { url, localUrl } = invitation();
      return url || localUrl ? send(response, 200, { url, localUrl }) : send(response, 409, { error: 'No room is open.' });
    }
    if (path === '/api/host/start' && request.method === 'POST') return later(hosting(request, response, force => control.start(force)));
    if (path === '/api/solo/start' && request.method === 'POST' && startSolo) return later(startSolo().then(
      url => send(response, 200, { url }),
      error => send(response, 503, { error: error instanceof Error ? error.message : 'The local game could not be opened.' }),
    ));
    if (path === '/api/room/stop' && request.method === 'POST') return later(hosting(request, response, force => control.stop(force)));
    if (path === '/api/room/new-game' && request.method === 'POST') return later(hosting(request, response, force => control.newGame(force)));
    // The folder's path leaves the server in these two answers only.
    if (path === '/api/config' && request.method === 'GET')
      return later(control.config().then(saved => send(response, 200, saved)));
    if (path === '/api/config' && request.method === 'PUT') return later(changeConfig(request, response));
    // The folder comes out of a dialog on this computer. The request names none, and its body is not read.
    // The answer waits for the dialog, however long that is open.
    if (path === '/api/game-folder/pick' && request.method === 'POST') {
      return later(control.pickFolder().then(picked => 'error' in picked ? send(response, picked.status, { error: picked.error })
        : send(response, 200, picked)));
    }
    // The report names no folder and no secret; the page saves it as a file. The request's body is not read.
    if (path === '/api/diagnostics/export' && request.method === 'POST')
      return later(control.diagnostics({ version, startedAt }).then(report => send(response, 200, report)));
    // With players in the room a quit asks first, as a stop does. An accepted one is answered before the server goes.
    if (path === '/api/host/quit' && request.method === 'POST') {
      return later(forced(request, response).then(sent => {
        if (!sent) return;
        const refused = control.quit(sent.force);
        if (refused) return send(response, 409, { error: 'Players are in the room.', players: refused.players });
        send(response, 202, { quitting: true });
        setImmediate(onQuit);
      }));
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

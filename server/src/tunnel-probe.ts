// Checks that the public address of a tunnel really leads to this server's
// gateway and relay. A registered connection alone does not prove that.
//
// A new Quick Tunnel name takes a few seconds to appear in DNS, and its zone
// lets resolvers remember a miss for a minute. Asking the system resolver too
// early would stop this very computer from opening the link, so the probe
// asks public DNS directly and then connects to the address it was given.
import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { request as plainRequest, type IncomingHttpHeaders } from 'node:http';
import { request as secureRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

const STEP_MS = 8000;

export interface ResolveOptions {
  resolve4?: (name: string) => Promise<string[]>;
  intervalMs?: number;
}

function publicResolver(): (name: string) => Promise<string[]> {
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  resolver.setServers(['1.1.1.1', '1.0.0.1']);
  return name => resolver.resolve4(name);
}

/** Resolves to an IPv4 address once public DNS knows the name. Never asks the system resolver. */
export async function resolvePublic(hostname: string, signal: AbortSignal, options: ResolveOptions = {}): Promise<string> {
  const resolve4 = options.resolve4 ?? publicResolver();
  for (;;) {
    signal.throwIfAborted();
    try {
      const [address] = await resolve4(hostname);
      if (address) return address;
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      // Not there yet. Anything else means that public DNS itself is out of reach.
      if (code !== 'ENOTFOUND' && code !== 'ENODATA') throw error;
    }
    await delay(options.intervalMs ?? 1000, undefined, { signal });
  }
}

/** Sends every connection to `address`, whatever the name; TLS and the Host header keep the name. */
function pinned(address: string): LookupFunction {
  return (_hostname, options, callback) => {
    const answer = callback as (error: null, address: string | { address: string; family: number }[], family?: number) => void;
    if (options.all) answer(null, [{ address, family: 4 }]);
    else answer(null, address, 4);
  };
}

function get(url: URL, headers: Record<string, string>, lookup?: LookupFunction, signal?: AbortSignal):
  Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? secureRequest : plainRequest)(url, { headers, lookup, timeout: STEP_MS, signal }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { if (body.length < 1024 * 1024) body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('The request timed out.')));
    request.on('error', reject);
    request.end();
  });
}

/** A Netplay connection that asks about a room that does not exist: it travels to the relay and back and takes no seat. */
function netplayCheck(origin: string, cookie: string, lookup?: LookupFunction, signal?: AbortSignal): Promise<void> {
  const url = new URL('/netplay', origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new Promise((resolve, reject) => {
    const refused = new Error('The public address did not carry a Netplay connection.');
    const socket = new WebSocket(url, { origin, headers: { cookie }, lookup, perMessageDeflate: false, handshakeTimeout: STEP_MS });
    const timer = setTimeout(() => socket.terminate(), STEP_MS);
    signal?.addEventListener('abort', () => socket.terminate(), { once: true });
    socket.once('open', () => socket.send(JSON.stringify({ role: 'check', room: randomBytes(12).toString('hex'),
      token: randomBytes(32).toString('hex') })));
    socket.once('error', () => reject(refused));
    socket.once('close', code => {
      clearTimeout(timer);
      if (code === 1008) resolve();
      else reject(refused);
    });
  });
}

/** Checks the gateway behind `origin`: the access link, an allowed page and a Netplay round trip. Aborting `signal` ends it at once. */
export async function probeGateway(origin: string, accessToken: string,
  { address, signal }: { address?: string; signal?: AbortSignal } = {}): Promise<void> {
  signal?.throwIfAborted();
  const lookup = address ? pinned(address) : undefined;
  const cookie = `sled_access=${accessToken}`;
  const access = await get(new URL(`/access/${accessToken}`, origin), {}, lookup, signal);
  if (access.status !== 302 || !String(access.headers['set-cookie']).includes(cookie))
    throw new Error('The public address did not accept the access link.');
  const info = await get(new URL('/session-info', origin), { cookie }, lookup, signal);
  let described: unknown;
  try { described = JSON.parse(info.body); } catch { /* Checked below. */ }
  if (info.status !== 200 || typeof described !== 'object' || described === null)
    throw new Error('The public address did not serve the session info.');
  signal?.throwIfAborted();
  await netplayCheck(origin, cookie, lookup, signal);
}

/** The probe a tunnel runs before it calls itself online. It keeps trying until it passes or `signal` aborts. */
export function publicProbe(accessToken: string, options: ResolveOptions & { fallbackWaitMs?: number } = {}):
  (origin: string, signal: AbortSignal) => Promise<void> {
  return async (origin, signal) => {
    let address: string | undefined;
    try {
      address = await resolvePublic(new URL(origin).hostname, signal, options);
    } catch {
      signal.throwIfAborted();
      // Public DNS is out of reach on this network. Give the name time to exist before the system resolver is asked.
      await delay(options.fallbackWaitMs ?? 10_000, undefined, { signal });
    }
    for (;;) {
      try {
        return await probeGateway(origin, accessToken, { address, signal });
      } catch {
        await delay(options.intervalMs ?? 1000, undefined, { signal });
      }
    }
  };
}

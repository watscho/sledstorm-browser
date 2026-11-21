// Helper roles that the executable runs as its own child process. A packaged
// executable cannot start a separate Node.js, so helpers are subcommands.
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

export interface SmokeGuestSetup {
  url: string;
  origin: string;
  cookie: string;
  room: string;
  token: string;
  identity: string;
}

const emit = (event: object) => console.log(JSON.stringify(event));

/** Joins the self-test room as a Netplay guest and exchanges one binary packet with the host. */
function smokeGuest(encoded: string | undefined): Promise<number> {
  const { url, origin, cookie, room, token, identity } = JSON.parse(encoded ?? '') as SmokeGuestSetup;
  const socket = new WebSocket(url, { origin, headers: { cookie }, perMessageDeflate: false });
  return new Promise<number>(resolve => {
    process.once('SIGTERM', () => {
      socket.terminate();
      resolve(0);
    });
    socket.on('error', error => {
      emit({ event: 'error', message: error.message });
      resolve(1);
    });
    socket.on('open', () => socket.send(JSON.stringify({ role: 'guest', room, token, identity, roster: true })));
    socket.on('message', (data, binary) => {
      if (binary) return emit({ event: 'echo', text: data.toString() });
      const message = JSON.parse(data.toString()) as { type?: string; slot?: number };
      if (message.type !== 'ready') return;
      emit({ event: 'ready', slot: message.slot });
      socket.send(Buffer.from('guest-to-host'));
    });
  });
}

/** Reports ready and then ignores SIGTERM, so the owner must escalate. */
function smokeStubborn(): Promise<number> {
  process.on('SIGTERM', () => { /* Deliberately ignored. */ });
  emit({ event: 'ready' });
  setInterval(() => { /* Keep the process alive. */ }, 1000);
  return new Promise<number>(() => { /* Ends only when killed. */ });
}

/**
 * Ends another process once this one loses its owner. The owner holds our
 * input open for as long as it lives, and the system closes it however the
 * owner dies. This is how a tunnel program never outlives a killed server.
 * An owner whose child has already ended writes a byte before it closes the
 * input: the PID may belong to someone else by then, so nothing is signalled.
 */
function guard(target: string | undefined): Promise<number> {
  const pid = Number(target);
  if (!Number.isInteger(pid) || pid <= 1) return Promise.resolve(2);
  const alive = () => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  const signal = (name: NodeJS.Signals) => {
    try { process.kill(pid, name); } catch { /* It ended by itself. */ }
  };
  return new Promise<number>(resolve => {
    process.stdin.on('error', () => { /* A broken input also means the owner is gone. */ });
    let released = false;
    process.stdin.on('data', () => { released = true; });
    process.stdin.once('close', async () => {
      if (!released) {
        signal('SIGTERM');
        for (let attempt = 0; alive() && attempt < 30; attempt++) await delay(100);
        if (alive()) signal('SIGKILL');
      }
      resolve(0);
    });
    process.stdin.resume();
  });
}

export function internal([name, argument]: string[]): Promise<number> {
  if (name === 'guard') return guard(argument);
  if (name === 'smoke-guest') return smokeGuest(argument);
  if (name === 'smoke-stubborn') return smokeStubborn();
  console.error('Unknown internal command.');
  return Promise.resolve(2);
}

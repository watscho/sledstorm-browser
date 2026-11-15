// Helper roles that the executable runs as its own child process. A packaged
// executable cannot start a separate Node.js, so helpers are subcommands.
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

export function internal([name, argument]: string[]): Promise<number> {
  if (name === 'smoke-guest') return smokeGuest(argument);
  if (name === 'smoke-stubborn') return smokeStubborn();
  console.error('Unknown internal command.');
  return Promise.resolve(2);
}

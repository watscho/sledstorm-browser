import { createRetroArchRelay } from './retroarch-relay.mjs';
import { createRelay } from './server.mjs';
import { launchDedicatedRuntime } from './dedicated-runtime.mjs';
const relay = createRelay({ port: 8004, historyBatch: 256, compactHistory: true, checkpoints: process.env.SLED_EMULATOR_CHECKPOINTS === '1', origins: ['http://127.0.0.1:8000', 'http://localhost:8000'] });
relay.on('listening', () => console.log('Emulator room relay: ws://127.0.0.1:8004'));
relay.on('error', error => { console.error(error.message); process.exitCode = 1; });

const chrome = process.env.SLED_DEDICATED_CHROME;
const netplay = createRetroArchRelay({
  startDedicated: chrome && ((setup, signal) => launchDedicatedRuntime(chrome, setup, signal)),
});
netplay.on('listening', () => console.log('RetroArch Netplay relay: ws://127.0.0.1:8006'));
netplay.on('error', error => { console.error(error.message); relay.close(); process.exitCode = 1; });
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  netplay.stopDedicated();
  for (const server of [relay, netplay]) {
    for (const socket of server.clients) socket.terminate();
    server.close();
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);

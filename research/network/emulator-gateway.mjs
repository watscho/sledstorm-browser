import { createPublicGateway } from './public-server.mjs';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const lock = JSON.parse(await readFile(new URL('../../emulator.lock.json', import.meta.url)));
const modeIndex = process.argv.indexOf('--disc-mode');
const discMode = modeIndex < 0 ? 'shared' : process.argv[modeIndex + 1];
if (!['shared', 'local'].includes(discMode)) throw new Error('Invalid disc mode');
const assetPaths = new Set(['/', '/app.js', '/frame-sync.js', '/core-state.js', '/pal-profile.js', '/local-disc.js', '/disc-identity.js', '/session-client.js', '/style.css',
  '/session-info', '/network-core.data', '/disc.zip', ...Object.keys(lock.files).map(name => '/emulator/' + name)]);
if (discMode === 'local') assetPaths.delete('/disc.zip');
const token = randomBytes(24).toString('hex');
await writeFile(new URL('../../.cache/emulator-access.txt', import.meta.url), `/access/${token}`, { mode: 0o600 });
const gateway = createPublicGateway({ port: 8005, upstream: 8000, relay: 8004, accessToken: token,
  discMode, assetPaths, maxPayload: 8 * 1024 * 1024 });
gateway.on('listening', () => console.log('Emulator gateway ready on 127.0.0.1:8005; access path saved privately.'));
gateway.on('error', error => { console.error(error.message); process.exitCode = 1; });

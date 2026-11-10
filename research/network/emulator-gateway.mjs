import { emulatorAssetPaths } from './emulator-assets.mjs';
import { createPublicGateway } from './public-server.mjs';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
const lock = JSON.parse(await readFile(new URL('../../emulator.lock.json', import.meta.url)));
const modeIndex = process.argv.indexOf('--disc-mode');
const discMode = modeIndex < 0 ? 'shared' : process.argv[modeIndex + 1];
if (!['shared', 'local'].includes(discMode)) throw new Error('Invalid disc mode');
const assetPaths = emulatorAssetPaths(lock, discMode);
const token = randomBytes(24).toString('hex');
await writeFile(new URL('../../.cache/emulator-access.txt', import.meta.url), `/access/${token}`, { mode: 0o600 });
const mirror = process.argv.includes('--mirror');
const mirrorOriginFile = new URL('../../.cache/online/mirror-origin.txt', import.meta.url);
const gateway = createPublicGateway({ port: 8005, upstream: 8000, relay: 8004, netplay: 8006, accessToken: token,
  discMode, assetPaths, maxPayload: 8 * 1024 * 1024, ...(mirror && {
    mirrorPort: 0,
    getMirrorOrigin() {
      try {
        const origin = readFileSync(mirrorOriginFile, 'utf8').trim();
        if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) return origin;
      } catch { /* The optional connector has not registered. */ }
    },
  }) });
gateway.on('listening', () => console.log('Emulator gateway ready on 127.0.0.1:8005; access path saved privately.'));
gateway.on('error', error => { console.error(error.message); process.exitCode = 1; });
gateway.mirrorServer?.on('listening', () => console.log(`Mirror gateway ready on 127.0.0.1:${gateway.mirrorServer.address().port}.`));
gateway.mirrorServer?.on('error', error => console.error(`Optional mirror listener unavailable: ${error.message}`));

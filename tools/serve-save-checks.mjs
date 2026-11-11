// Optional real-IndexedDB/manager checks, served only on loopback without a disc.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const files = new Map([
  ['/', ['tools/save-manager-check.html', 'text/html']],
  ['/checks.js', ['tools/save-manager-checks.mjs', 'text/javascript']],
  ['/launcher.html', ['web/index.html', 'text/html']],
  ...['save-manager.js', 'save-storage.js', 'save-file.js', 'core-state.js', 'lobby-ui.js', 'controls-ui.js', 'controls.js', 'graphics-presets.js', 'session-client.js'].map(name => ['/' + name, ['web/' + name, 'text/javascript']]),
  ['/style.css', ['web/style.css', 'text/css']],
  ...['lobby-mountains.svg', 'lobby-snow-trail.svg'].map(name => ['/' + name, ['web/' + name, 'image/svg+xml']]),
]);
const server = http.createServer(async (request, response) => {
  const entry = files.get(new URL(request.url, 'http://localhost').pathname);
  if (!entry || request.method !== 'GET') { response.writeHead(404).end(); return; }
  try {
    const body = await readFile(new URL(entry[0], root));
    response.writeHead(200, { 'content-type': entry[1], 'cache-control': 'no-store' }).end(body);
  } catch { response.writeHead(500).end('Could not read the local check fixture.'); }
});
server.listen(Number(process.env.SLED_SAVE_CHECK_PORT || 18009), '127.0.0.1', () => console.log('Save checks: http://127.0.0.1:' + server.address().port + '/'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());

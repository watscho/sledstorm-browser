// The server and the browser run the same module; these are the browser's fixtures, through the server's import.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { emulatorAssetPaths, roomIdentity, type RoomIdentityInput } from '../src/network.ts';

test('the server computes the identities that the browser fixtures record', async () => {
  const fixtures = JSON.parse(await readFile(new URL('../../web/room-identity.fixtures.json', import.meta.url), 'utf8')) as
    { name: string; input: RoomIdentityInput; identity: string }[];
  assert.ok(fixtures.length >= 4);
  for (const { name, input, identity } of fixtures) assert.equal(await roomIdentity(input), identity, name);
});

test('the server\'s session info can be passed as it is', async () => {
  const [fixture] = JSON.parse(await readFile(new URL('../../web/room-identity.fixtures.json', import.meta.url), 'utf8')) as
    { input: RoomIdentityInput; identity: string }[];
  const { options, bios, ...game } = fixture!.input;
  // The keys in the order the server sends them, with what it adds for delivery.
  const sessionInfo = { disc: game.disc, pal: true, archive: { sha256: 'f'.repeat(64), size: 9, chunkSize: 9, chunks: [] }, discMode: 'shared',
    roomCheck: true, core: game.core, adapter: game.adapter, native: game.native, dedicated: true };
  assert.equal(await roomIdentity({ ...sessionInfo, bios, options }), fixture!.identity);
});

test('the gateway serves the identity module to guests', () => {
  assert.ok(emulatorAssetPaths({ files: {} }, 'shared').has('/room-identity.js'));
});

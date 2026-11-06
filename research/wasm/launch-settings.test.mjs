import test from 'node:test';
import assert from 'node:assert/strict';
import {CLASSIC,WASD,normalizeSettings,rebind,keyMap,keybindFile,invitationFrom,roomIdentity,sessionURL} from './launch-settings.js';
test('a rebound key swaps conflicts and matches both the native INI and online pad',()=>{
  const custom=rebind(CLASSIC,'cross','KeyA');
  assert.equal(custom.triangle,'KeyX');assert.equal(new Set(Object.values(custom)).size,16);
  assert.equal(keyMap(custom).KeyA,14);assert.match(keybindFile(custom),/cross = A\n/);
  assert.match(keybindFile(WASD),/cross = Space\n/);assert.match(keybindFile(WASD),/ls_left = A\n/);
  assert.equal((keybindFile(WASD).match(/\[player\d\]/g)||[]).length,5);
  assert.throws(()=>rebind(CLASSIC,'cross','Escape'));
});
test('storage cannot inject native config values or unsupported settings',()=>{
  assert.equal(normalizeSettings(null).volume,80);
  const dirty=normalizeSettings({resolution:'4x\n[game]',filter:999,volume:500,renderer:'x',bindings:{...CLASSIC,cross:'X\n[game]'}});
  assert.equal(dirty.volume,100);assert.equal(dirty.resolution,2);assert.equal(dirty.filter,0);
  assert.deepEqual(dirty.bindings,CLASSIC);
});
test('invitation transfers every shared setting, while controls and volume stay local',()=>{
  const url=sessionURL('https://example.com/',{room:'a'.repeat(24),token:'b'.repeat(64)},{renderer:'opengl',resolution:1,filter:1,unlocked:false});
  assert.match(new URL(url).hash,/^#session=[A-Za-z0-9_-]+$/);
  const invite=invitationFrom(url);assert.equal(invite.unlocked,false);assert.equal(invite.resolution,1);assert.equal(invite.filter,1);
  const host={...normalizeSettings({}),camera:2}, guest={...host,volume:0,bindings:WASD};
  assert.equal(roomIdentity(host,'disc','wasm'),roomIdentity(guest,'disc','wasm'));
  for(const [key,value] of [['resolution',1],['filter',1],['unlocked',false]])
    assert.notEqual(roomIdentity(host,'disc','wasm'),roomIdentity({...guest,[key]:value},'disc','wasm'));
  assert.throws(()=>invitationFrom('javascript:alert(1)'));assert.throws(()=>invitationFrom('https://u:p@example.com/'+new URL(url).hash));
  assert.throws(()=>invitationFrom('https://example.com/#join=wrong'));
});

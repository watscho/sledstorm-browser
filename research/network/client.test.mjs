import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket as Socket } from 'ws';
import { createRelay } from './server.mjs';
import { BrowserSession } from '../wasm/network-client.js';

test('custom keys release after toolbar focus changes and blur; UI keys are not captured',()=>{
  const listeners={};globalThis.window={addEventListener(type,callback){listeners[type]=callback;}};
  const client=new BrowserSession(()=>{},{keyMap:{Space:14}});
  const canvas={tagName:'CANVAS'}, input={tagName:'INPUT'};
  const event=(type,target)=>({type,target,code:'Space',preventDefault(){}});
  listeners.keydown(event('keydown',canvas));assert.equal(client.pad,65535^(1<<14));
  listeners.keyup(event('keyup',input));assert.equal(client.pad,65535);
  listeners.keydown(event('keydown',input));assert.equal(client.pad,65535);
  listeners.keydown(event('keydown',canvas));listeners.blur();assert.equal(client.pad,65535);
});

test('one live console admits three late peers, preserves CRC phase and four pad order', async () => {
  const relay=createRelay({port:0,inputDelay:8});await once(relay,'listening');
  const endpoint=`ws://127.0.0.1:${relay.address().port}`;
  globalThis.window={addEventListener(){}};
  globalThis.location={protocol:'http:',hostname:'127.0.0.1',host:'127.0.0.1:8001',port:'8001'};
  globalThis.WebSocket=class extends Socket{constructor(){super(endpoint);}};
  const clients=[];const make=()=>{const c=new BrowserSession(()=>{});clients.push(c);return c;};
  const state=t=>t%25===0?((0x81230000+t)>>>0):null;
  let invitation;
  try {
    const host=make();assert.equal(await host.connect('a'.repeat(64),null,i=>{invitation=i;}),0);host.pad=65534;
    const records=[];
    for(let t=0;t<41;t++)records[t]=await host.exchangeFast(t,state(t));
    const guest=make();assert.equal(await guest.connect('a'.repeat(64),invitation,()=>{}),1);guest.pad=65533;
    const boundary=guest.replayTarget;assert.ok(boundary>=41);
    for(let t=41;t<boundary;t++)records[t]=await host.exchangeFast(t,state(t));
    for(let t=0;t<boundary;t++)assert.deepEqual(await guest.exchangeFast(t,state(t)),records[t]);
    for(let t=boundary;t<boundary+20;t++){
      const rows=await Promise.all([host.exchangeFast(t,state(t)),guest.exchangeFast(t,state(t))]);assert.deepEqual(rows[0],rows[1]);
    }
    const third=make(),fourth=make();assert.equal(await third.connect('a'.repeat(64),invitation,()=>{}),2);assert.equal(await fourth.connect('a'.repeat(64),invitation,()=>{}),3);
    third.pad=65531;fourth.pad=65527;const tip=third.replayTarget;assert.equal(tip,fourth.replayTarget);
    for(let t=boundary+20;t<tip;t++)await Promise.all([host.exchangeFast(t,state(t)),guest.exchangeFast(t,state(t))]);
    for(let t=0;t<tip;t++)assert.deepEqual(await third.exchangeFast(t,state(t)),await fourth.exchangeFast(t,state(t)));
    let last;
    for(let t=tip;t<tip+40;t++){
      const rows=await Promise.all(clients.map(c=>c.exchangeFast(t,state(t))));for(const row of rows)assert.deepEqual(row,rows[0]);last=rows[0];
    }
    assert.deepEqual(last,[65534,65533,65531,65527]);assert.ok(clients.every(c=>c.verified>=75));
  } finally {clients.forEach(c=>c.fail('Test finished'));await new Promise(r=>relay.close(r));}
});


test('buffered controller/history rows return without creating a promise', async () => {
  globalThis.window={addEventListener(){}};
  globalThis.WebSocket={OPEN:1};
  Object.defineProperty(globalThis,'navigator',{value:{getGamepads:()=>[]},configurable:true});
  const c=new BrowserSession(()=>{});
  c.socket={readyState:1,send(){},close(){}};c.active=true;c.warmed=true;c.delay=0;
  c.frames.set(0,{tick:0,pads:[1,2,3,4],state:123});
  const row=c.exchangeFast(0,123);assert.deepEqual(row,[1,2,3,4]);assert.ok(!row.then);
  c.replayTarget=2;c.history.set(1,{tick:1,pads:[4,3,2,1],state:null});
  assert.deepEqual(c.exchangeFast(1,null),[4,3,2,1]);
  assert.equal(c.metrics.buffered,2);assert.equal(c.metrics.waits,0);
  await assert.rejects(c.exchange(4,null),/Non-sequential/);
});

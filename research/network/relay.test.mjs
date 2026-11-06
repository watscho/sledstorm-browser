import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createRelay} from './server.mjs';
const identity='a'.repeat(64);
class Peer {
  constructor(url){this.socket=new WebSocket(url);this.queue=[];this.socket.on('message',data=>{const msg=JSON.parse(data);if(this.resolve){const cb=this.resolve;this.resolve=null;cb(msg);}else this.queue.push(msg);});}
  send(msg){this.socket.send(JSON.stringify(msg));}
  async next(type){for(;;){const msg=this.queue.length?this.queue.shift():await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.resolve=null;reject(new Error(`Timeout: ${type}`));},2000);this.resolve=item=>{clearTimeout(timer);resolve(item);};});if(!type||msg.type===type)return msg;}}
}
async function setup(t){const server=createRelay({port:0});await once(server,'listening');const peers=[];t.after(async()=>{peers.forEach(p=>p.socket.terminate());await new Promise(r=>server.close(r));});return async()=>{const p=new Peer(`ws://127.0.0.1:${server.address().port}`);peers.push(p);await once(p.socket,'open');return p;};}
async function create(connect){const host=await connect();host.send({type:'create',identity});const invite=await host.next('created');const start=await host.next('start');assert.equal(start.slot,0);return {host,invite};}
async function join(connect,invite){const peer=await connect();peer.send({type:'join',identity,room:invite.room,token:invite.token});const start=await peer.next('start');return {peer,start};}
const input=(peer,tick,pad=65535,state=null)=>peer.send({type:'input',tick,pad,state});
const ready=(peer,tick=0)=>peer.send({type:'ready',tick});
test('a console starts immediately with one controller; separate links isolate input',async t=>{
  const connect=await setup(t),a=await create(connect),b=await create(connect);assert.notEqual(a.invite.room,b.invite.room);assert.notEqual(a.invite.token,b.invite.token);
  ready(a.host);ready(b.host);input(a.host,0,123);input(b.host,0,456);
  assert.deepEqual((await a.host.next('frame')).pads,[123,65535,65535,65535]);assert.deepEqual((await b.host.next('frame')).pads,[456,65535,65535,65535]);
});
test('four controllers share ordered rows; a fifth cannot pause the room',async t=>{
  const connect=await setup(t),{host,invite}=await create(connect),peers=[host];
  for(let slot=1;slot<4;slot++){const result=await join(connect,invite);assert.equal(result.start.slot,slot);peers.push(result.peer);}
  peers.forEach(p=>ready(p));
  const fifth=await connect();fifth.send({type:'join',identity,room:invite.room,token:invite.token});assert.match((await fifth.next('error')).message,/four/);
  for(let tick=0;tick<100;tick++){const pads=[65535-tick,tick,1000+tick,3000-tick];peers.forEach((p,s)=>input(p,tick,pads[s],tick%25===0?0x81234567:null));for(const p of peers)assert.deepEqual((await p.next('frame')).pads,pads);}
});
test('late join freezes at a precise boundary and exposes bounded immutable history',async t=>{
  const connect=await setup(t),{host,invite}=await create(connect);ready(host);
  for(let tick=0;tick<12;tick++){input(host,tick,60000+tick);await host.next('frame');}
  const {peer,start}=await join(connect,invite);assert.equal(start.replayTarget,12);
  input(host,12,123);peer.send({type:'history',from:0});const chunk=await peer.next('history');assert.equal(chunk.frames.length,8);assert.ok(Buffer.byteLength(JSON.stringify(chunk))<2048);assert.equal(chunk.frames[0].pads[0],60000);
  ready(peer,12);input(peer,12,456);assert.deepEqual((await host.next('frame')).pads,[123,456,65535,65535]);assert.deepEqual((await peer.next('frame')).pads,[123,456,65535,65535]);
});
test('leaving releases that controller while the other console participants continue',async t=>{
  const connect=await setup(t),{host,invite}=await create(connect),{peer}=await join(connect,invite);ready(host);ready(peer);input(host,0);input(peer,0);await host.next('frame');await peer.next('frame');
  peer.socket.close();await host.next('presence');await new Promise(r=>setTimeout(r,20));input(host,1,22);assert.deepEqual((await host.next('frame')).pads,[22,65535,65535,65535]);
});
test('bad invitations and builds do not reserve a controller',async t=>{
  const connect=await setup(t),{host,invite}=await create(connect),wrong=await connect();
  wrong.send({type:'join',identity,room:invite.room,token:'0'.repeat(64)});assert.equal((await wrong.next('error')).type,'error');
  wrong.send({type:'join',identity:'b'.repeat(64),room:invite.room,token:invite.token});assert.match((await wrong.next('error')).message,/differs/);
  const {start}=await join(connect,invite);assert.equal(start.slot,1);
});
test('out-of-order input and divergent checksums stop that room',async t=>{
  const connect=await setup(t),a=await create(connect);ready(a.host);input(a.host,1);assert.equal((await a.host.next('ended')).type,'ended');
  const b=await create(connect),{peer}=await join(connect,b.invite);ready(b.host);ready(peer);input(b.host,0,65535,1);input(peer,0,65535,2);assert.match((await b.host.next('ended')).reason,/desync/);assert.equal((await peer.next('ended')).type,'ended');
});

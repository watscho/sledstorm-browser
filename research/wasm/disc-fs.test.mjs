import test from 'node:test';
import assert from 'node:assert/strict';
import { mountDisc } from './disc-fs.js';
const MiB=1048576;
function fixture(files) {
 const nodes=new Map();
 const Module={HEAPU8:new Uint8Array(8192),FS:{writeFile(path){nodes.set(path,{node_ops:{getattr:()=>({})},stream_ops:{}});},lookupPath(path){return {node:nodes.get(path)};}}};
 const stats=mountDisc(Module,files);
 return {Module,stats,node:name=>nodes.get('/disc/'+name)};
}
test('remote blocks coalesce, keep synchronous hits and never mix tracks',async()=>{
 let requests=0;
 globalThis.fetch=async url=>{++requests;const p=new URL(url,'http://localhost');const length=Number(p.searchParams.get('length'));assert.ok(length<=4*MiB);await new Promise(r=>setTimeout(r,1));return {ok:true,arrayBuffer:async()=>new Uint8Array(length).fill(p.pathname==='/disc/0'?12:34).buffer};};
 const f=fixture([{name:'a.bin',size:8*MiB,url:'/disc/0'},{name:'b.bin',size:4*MiB,url:'/disc/1'}]);
 const a=f.node('a.bin');
 await Promise.all([a.sledRead(0,4,0),a.sledRead(4,4,100)]);
 assert.equal(requests,1);assert.deepEqual([...f.Module.HEAPU8.slice(0,8)],Array(8).fill(12));
 assert.equal(a.sledRead(0,4,0),4,'cached reads return synchronously');
 await f.node('b.bin').sledRead(4,4,0);assert.equal(f.Module.HEAPU8[4],34);
 assert.equal(a.sledRead(0,4,0),4);assert.equal(f.Module.HEAPU8[0],12);
 assert.equal(requests,2);
});
test('LRU is shared across files and bounded; evicted data is refetched',async()=>{
 let requests=0;
 globalThis.fetch=async()=>{++requests;return {ok:true,arrayBuffer:async()=>new Uint8Array(4*MiB).buffer};};
 const files=Array.from({length:5},(_,i)=>({name:i+'.bin',size:4*MiB,url:'/disc/'+i}));
 const f=fixture(files);
 for(const file of files){await f.node(file.name).sledRead(0,1,0);assert.ok(f.stats.cacheBytes<=16*MiB);}
 assert.equal(f.stats.cacheBytes,16*MiB);assert.equal(requests,5);
 await f.node('0.bin').sledRead(0,1,0);assert.equal(requests,6);
});
test('a short fetch is rejected, not cached, and can be retried',async()=>{
 let count=0;
 globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new Uint8Array(++count===1?9:10).buffer});
 const f=fixture([{name:'a.bin',size:10,url:'/disc/0'}]);
 await assert.rejects(f.node('a.bin').sledRead(0,10,0),/Incomplete/);
 assert.equal(f.stats.cacheBytes,0);
 assert.equal(await f.node('a.bin').sledRead(0,10,0),10);
 assert.equal(f.node('a.bin').sledRead(0,1,10),0);
});

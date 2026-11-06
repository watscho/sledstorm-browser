import assert from 'node:assert/strict';
const baseline=process.argv.includes('--baseline');
const {default:createModule}=await import(baseline?'../.cache/perf-baseline/network-bridge.mjs':'../.cache/network-bridge.mjs');
let finish, failure, suspensions=0, calls=0;
const done=new Promise((resolve,reject)=>{finish=resolve;failure=reject;});
const m=await createModule({noInitialRun:true,print:text=>{if(text==='NETWORK_BRIDGE_PASSED')finish();},onAbort:failure});
const handleSleep=m.Asyncify.handleSleep;
m.Asyncify.handleSleep=function(callback){const before=this.state;const result=handleSleep.call(this,callback);if(before===0&&this.state===1)++suspensions;return result;};
m.sledNetwork={
 exchangeFast(tick,state){
  assert.equal(tick,calls++);
  assert.equal(state,tick%25===0?0x1234+tick:null);
  const row=[tick,tick+1,tick+2,tick+3];
  return tick===3||tick===37?new Promise(resolve=>setTimeout(()=>resolve(row),5)):row;
 },
 async exchange(tick,state){return this.exchangeFast(tick,state);},
 fail:failure,
};
m.callMain([]);
await done;
assert.equal(calls,200);assert.equal(suspensions,baseline?200:2);
console.log(JSON.stringify({baseline,frames:calls,suspensions}));
console.log('NETWORK_BRIDGE_PASSED: ordered frames, digest phase and suspension count');

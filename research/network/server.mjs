// One deterministic console per random capability URL. Only controller history,
// never disc bytes or guest memory, is retained for late-joining browsers.
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {WebSocket,WebSocketServer} from 'ws';
import {FrameHistory} from './frame-history.mjs';
export function createRelay({port=8002,host='127.0.0.1',inputDelay=8,maxHistoryFrames=900000,checkpoints=false,historyBatch=8,compactHistory=false,origins=['http://127.0.0.1:8001','http://localhost:8001']}={}) {
  if(!Number.isInteger(inputDelay)||inputDelay<0||inputDelay>8)throw new Error('Invalid input delay');
  const server=new WebSocketServer({port,host,maxPayload:checkpoints?8*1024*1024:2048,perMessageDeflate:false}),rooms=new Map();
  const checkpointCatchupLimit = 750;
  const send=(socket,data)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(data));};
  const end=(room,reason)=>{
    if(!rooms.delete(room.id))return;
    for(const peer of room.peers)if(peer){send(peer.socket,{type:'ended',reason});peer.socket.close(1000,reason.slice(0,120));}
    room.inputs.clear();if(room.history.clear)room.history.clear();else room.history.length=0;
  };
  const presence=(room)=>{
    const slots=room.peers.map((peer)=>Boolean(peer));
    for(const peer of room.peers)if(peer)send(peer.socket,{type:'presence',slots,syncing:room.peers.some((p)=>p&&!p.ready&&!p.loadingSnapshot)});
  };
  const flush=(room)=>{
    if(room.peers.some((peer)=>peer&&!peer.ready&&!peer.loadingSnapshot))return;
    const active=room.peers.filter(peer=>peer?.ready);
    while(active.length&&room.inputs.has(room.tick)){
      const row=room.inputs.get(room.tick);
      const missing=active.filter(peer=>!row[peer.slot]);
      if(missing.length){
        for(const peer of missing){
          if(peer.snapshotTick!==undefined)peer.missingInputSince??=Date.now();
        }
        return;
      }
      const established=active.filter(peer=>!peer.verifyingSnapshot);
      const state=row[(established[0]??active[0]).slot].state;
      const divergent=active.filter(peer=>row[peer.slot].state!==state);
      if(divergent.length){
        const reason=`Simulation desync at tick ${room.tick}`;
        if(!established.length||divergent.some(peer=>!peer.verifyingSnapshot)){end(room,reason);return;}
        // Reject the new snapshot before using its divergent input in the room.
        for(const peer of divergent)removePeer(peer,reason);
        return;
      }
      for(const peer of active){
        peer.missingInputSince=undefined;
        if(state!==null&&room.tick>=peer.target+inputDelay)peer.verifyingSnapshot=false;
      }
      if(room.tick>=maxHistoryFrames){end(room,'Session history limit reached');return;}
      const frame={type:'frame',tick:room.tick,pads:Array.from({length:4},(_,s)=>room.peers[s]?.ready?row[s].pad:65535),state};
      room.history.push(frame);room.inputs.delete(room.tick++);
      for(const peer of active)send(peer.socket,frame);
    }
  };
  const removePeer=(peer,reason)=>{
    const {room,slot}=peer;
    if(room.peers[slot]!==peer)return;
    room.peers[slot]=null;
    for(const row of room.inputs.values())delete row[slot];
    if(reason){
      send(peer.socket,{type:'ended',reason});
      peer.socket.close(1000,reason);
    }
    for(const guest of room.peers){
      if(guest&&!guest.ready&&!guest.snapshotSent&&guest.sponsor===slot){
        removePeer(guest,'Snapshot source disconnected');
      }
    }
    if(!room.peers.some(Boolean)){end(room,'Session ended');return;}
    presence(room);flush(room);
  };
  const housekeeping=setInterval(()=>{
    for(const room of rooms.values()) {
      if(Date.now()-room.touched>30000)end(room,'Session timed out');
      else for(const peer of room.peers){
        if(peer?.snapshotDeadline&&Date.now()>peer.snapshotDeadline)removePeer(peer,'Snapshot transfer timed out');
        else if(peer?.missingInputSince&&Date.now()-peer.missingInputSince>=5000){
          removePeer(peer,'The snapshot player stopped sending inputs');
        }
      }
    }
  },checkpoints?1000:5000);housekeeping.unref();server.on('close',()=>clearInterval(housekeeping));
  server.on('connection',(socket,request)=>{
    if(request.headers.origin&&!origins.includes(request.headers.origin)){socket.close(1008,'Origin refused');return;}
    let membership;const reject=(message)=>send(socket,{type:'error',message});
    socket.on('error',()=>{});
    socket.on('message',(buffer,binary)=>{
      let msg;try{msg=JSON.parse(buffer.toString());}catch{socket.close(1008,'Invalid JSON');return;}
      if(binary||!msg||typeof msg!=='object'){socket.close(1008,'Invalid message');return;}
      if(!membership){
        if(typeof msg.identity!=='string'||!/^[a-f0-9]{64}$/.test(msg.identity)){reject('A SHA-256 execution/content identity is required');return;}
        let room,slot;
        if(msg.type==='create'){
          if(rooms.size>=8){reject('Relay is full');return;}
          room={id:randomBytes(12).toString('hex'),token:randomBytes(32).toString('hex'),identity:msg.identity,peers:Array(4).fill(null),inputs:new Map(),history:compactHistory?new FrameHistory():[],tick:0,touched:Date.now()};
          rooms.set(room.id,room);slot=0;
        }else if(msg.type==='join'){
          room=rooms.get(msg.room);const token=typeof msg.token==='string'?Buffer.from(msg.token):Buffer.alloc(0);
          if(!room||token.length!==64||!timingSafeEqual(token,Buffer.from(room.token))){reject('Invitation is invalid or session has ended');return;}
          if(msg.identity!==room.identity){reject('Game content or execution build differs');return;}
          slot=room.peers.findIndex((peer)=>!peer);if(slot<0){reject('All four controllers are occupied');return;}
        }else{reject('Create or join a room first');return;}
        const sponsor=checkpoints&&msg.type==='join'?room.peers.find(peer=>peer?.ready):null;
        if(checkpoints&&msg.type==='join'&&!sponsor){reject('Session is already synchronizing; retry after it is ready');return;}
        membership={room,socket,slot,next:room.tick,target:room.tick,ready:false,
          sponsor:sponsor?.slot,loadingSnapshot:Boolean(sponsor),snapshotDeadline:sponsor?Date.now()+30000:0};room.peers[slot]=membership;room.touched=Date.now();
        // A joining seat must never inherit queued input from its previous owner.
        for(const row of room.inputs.values())delete row[slot];
        if(msg.type==='create')send(socket,{type:'created',room:room.id,token:room.token,slot});
        send(socket,{type:'start',slot,tick:0,replayTarget:room.tick,inputDelay,snapshot:Boolean(sponsor)});
        if(sponsor)send(sponsor.socket,{type:'snapshot-request',tick:room.tick,slot});
        presence(room);return;
      }
      const {room,slot}=membership;
      if(room.peers[slot]!==membership||!rooms.has(room.id))return;
      room.touched=Date.now();
      if(msg.type==='ping'){send(socket,{type:'pong'});return;}
      if(checkpoints&&(msg.type==='snapshot'||msg.type==='snapshot-unavailable')){
        const target=room.peers[msg.slot];
        // A snapshot may arrive after its recipient leaves.
        if(!target||target.ready||target.snapshotSent||target.sponsor!==slot||msg.tick!==target.target)return;
        if(msg.type==='snapshot-unavailable'){
          removePeer(target,'Could not capture the room snapshot');return;
        }
        if(typeof msg.data!=='string'||msg.data.length!==5941964||!/^[A-Za-z0-9+/]*={0,2}$/.test(msg.data)||
            !Array.isArray(msg.checks)||msg.checks.length>16||msg.checks.some(row=>!Array.isArray(row)||row.length!==2||
              !Number.isInteger(row[0])||row[0]<0||row[0]>msg.tick||!Number.isInteger(row[1])||row[1]<0||row[1]>0xffffffff)){
          removePeer(target,'Invalid synchronization snapshot');return;
        }
        target.snapshotDeadline=Date.now()+30000;
        target.snapshotSent=true;
        send(target.socket,{type:'snapshot',tick:msg.tick,data:msg.data,checks:msg.checks});return;
      }
      if(msg.type==='snapshot-restored'&&membership.loadingSnapshot){
        if(!membership.snapshotSent||msg.tick!==membership.target||room.tick-msg.tick>checkpointCatchupLimit){
          removePeer(membership,'Snapshot is no longer current. Try joining again.');return;
        }
        membership.snapshotTick=msg.tick;
        membership.verifyingSnapshot=true;
        membership.loadingSnapshot=false;
        membership.target=membership.next=room.tick;
        membership.snapshotDeadline=Date.now()+5000;
        send(socket,{type:'snapshot-boundary',tick:room.tick});
        presence(room);return;
      }
      if(msg.type==='history'){
        if(membership.ready||membership.loadingSnapshot||!Number.isInteger(msg.from)||msg.from<(membership.snapshotTick??0)||msg.from>=membership.target){reject('Invalid history request');return;}
        // Eight rows keep every gateway message below its existing 2 KiB limit.
        send(socket,{type:'history',frames:room.history.slice(msg.from,Math.min(msg.from+historyBatch,membership.target))});return;
      }
      if(msg.type==='ready'){
        if(membership.ready||membership.loadingSnapshot||msg.tick!==membership.target||(membership.sponsor!==undefined&&!membership.snapshotSent)){removePeer(membership,'Invalid replay boundary');return;}
        membership.ready=true;presence(room);flush(room);return;
      }
      if(msg.type!=='input'||!membership.ready||!Number.isInteger(msg.tick)||msg.tick!==membership.next||msg.tick>room.tick+inputDelay+8||!Number.isInteger(msg.pad)||msg.pad<0||msg.pad>65535||(msg.state!=null&&(!Number.isInteger(msg.state)||msg.state<0||msg.state>0xffffffff))){end(room,'Invalid or out-of-order input');return;}
      membership.snapshotDeadline=0;
      if(msg.tick===room.tick)membership.missingInputSince=undefined;
      membership.next++;
      const row=room.inputs.get(msg.tick)||[];row[slot]={pad:msg.pad,state:msg.state??null};room.inputs.set(msg.tick,row);flush(room);
    });
    socket.on('close',()=>{
      if(membership&&rooms.has(membership.room.id))removePeer(membership);
    });
  });return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const server=createRelay();server.on('listening',()=>console.log('Console session relay: ws://127.0.0.1:8002'));}

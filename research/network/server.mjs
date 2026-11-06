// One deterministic console per random capability URL. Only controller history,
// never disc bytes or guest memory, is retained for late-joining browsers.
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {WebSocket,WebSocketServer} from 'ws';
export function createRelay({port=8002,host='127.0.0.1',inputDelay=8,maxHistoryFrames=900000,origins=['http://127.0.0.1:8001','http://localhost:8001']}={}) {
  if(!Number.isInteger(inputDelay)||inputDelay<0||inputDelay>8)throw new Error('Invalid input delay');
  const server=new WebSocketServer({port,host,maxPayload:2048,perMessageDeflate:false}),rooms=new Map();
  const send=(socket,data)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(data));};
  const end=(room,reason)=>{
    if(!rooms.delete(room.id))return;
    for(const peer of room.peers)if(peer){send(peer.socket,{type:'ended',reason});peer.socket.close(1000,reason.slice(0,120));}
    room.inputs.clear();room.history.length=0;
  };
  const presence=(room)=>{
    const slots=room.peers.map((peer)=>Boolean(peer));
    for(const peer of room.peers)if(peer)send(peer.socket,{type:'presence',slots,syncing:room.peers.some((p)=>p&&!p.ready)});
  };
  const flush=(room)=>{
    if(room.peers.some((peer)=>peer&&!peer.ready))return;
    const active=room.peers.filter(Boolean);
    while(active.length&&room.inputs.has(room.tick)){
      const row=room.inputs.get(room.tick);
      if(active.some((peer)=>!row[peer.slot]))return;
      const state=row[active[0].slot].state;
      if(active.some((peer)=>row[peer.slot].state!==state)){end(room,`Simulation desync at tick ${room.tick}`);return;}
      if(room.tick>=maxHistoryFrames){end(room,'Session history limit reached');return;}
      const frame={type:'frame',tick:room.tick,pads:Array.from({length:4},(_,s)=>room.peers[s]?row[s].pad:65535),state};
      room.history.push(frame);room.inputs.delete(room.tick++);
      for(const peer of active)send(peer.socket,frame);
    }
  };
  const housekeeping=setInterval(()=>{
    for(const room of rooms.values())if(Date.now()-room.touched>30000)end(room,'Session timed out');
  },5000);housekeeping.unref();server.on('close',()=>clearInterval(housekeeping));
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
          room={id:randomBytes(12).toString('hex'),token:randomBytes(32).toString('hex'),identity:msg.identity,peers:Array(4).fill(null),inputs:new Map(),history:[],tick:0,touched:Date.now()};
          rooms.set(room.id,room);slot=0;
        }else if(msg.type==='join'){
          room=rooms.get(msg.room);const token=typeof msg.token==='string'?Buffer.from(msg.token):Buffer.alloc(0);
          if(!room||token.length!==64||!timingSafeEqual(token,Buffer.from(room.token))){reject('Invitation is invalid or session has ended');return;}
          if(msg.identity!==room.identity){reject('Game content or execution build differs');return;}
          slot=room.peers.findIndex((peer)=>!peer);if(slot<0){reject('All four controllers are occupied');return;}
        }else{reject('Create or join a room first');return;}
        membership={room,socket,slot,next:room.tick,target:room.tick,ready:false};room.peers[slot]=membership;room.touched=Date.now();
        // A joining seat must never inherit queued input from its previous owner.
        for(const row of room.inputs.values())delete row[slot];
        if(msg.type==='create')send(socket,{type:'created',room:room.id,token:room.token,slot});
        send(socket,{type:'start',slot,tick:0,replayTarget:room.tick,inputDelay});presence(room);return;
      }
      const {room,slot}=membership;room.touched=Date.now();
      if(msg.type==='ping'){send(socket,{type:'pong'});return;}
      if(msg.type==='history'){
        if(membership.ready||!Number.isInteger(msg.from)||msg.from<0||msg.from>=membership.target){reject('Invalid history request');return;}
        // Eight rows keep every gateway message below its existing 2 KiB limit.
        send(socket,{type:'history',frames:room.history.slice(msg.from,Math.min(msg.from+8,membership.target))});return;
      }
      if(msg.type==='ready'){
        if(membership.ready||msg.tick!==membership.target){end(room,'Invalid replay boundary');return;}
        membership.ready=true;presence(room);flush(room);return;
      }
      if(msg.type!=='input'||!membership.ready||!Number.isInteger(msg.tick)||msg.tick!==membership.next||msg.tick>room.tick+inputDelay+8||!Number.isInteger(msg.pad)||msg.pad<0||msg.pad>65535||(msg.state!=null&&(!Number.isInteger(msg.state)||msg.state<0||msg.state>0xffffffff))){end(room,'Invalid or out-of-order input');return;}
      membership.next++;
      const row=room.inputs.get(msg.tick)||[];row[slot]={pad:msg.pad,state:msg.state??null};room.inputs.set(msg.tick,row);flush(room);
    });
    socket.on('close',()=>{
      if(!membership||!rooms.has(membership.room.id))return;
      const {room,slot}=membership;if(room.peers[slot]!==membership)return;
      room.peers[slot]=null;for(const row of room.inputs.values())delete row[slot];
      if(!room.peers.some(Boolean)){end(room,'Session ended');return;}
      presence(room);flush(room);
    });
  });return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const server=createRelay();server.on('listening',()=>console.log('Console session relay: ws://127.0.0.1:8002'));}

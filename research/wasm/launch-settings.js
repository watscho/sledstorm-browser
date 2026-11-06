// Shared contract for the lobby, native keybind file and online pad sampling.
export const BUTTONS = [
  ['up',4,'Up','ArrowUp'],['down',6,'Down','ArrowDown'],
  ['left',7,'Steer left','ArrowLeft'],['right',5,'Steer right','ArrowRight'],
  ['cross',14,'Accelerate / confirm','KeyX'],['square',15,'Square □','KeyZ'],
  ['triangle',12,'Back / △','KeyA'],['start',3,'Start / pause','Enter'],
  ['circle',13,'Circle ○','KeyS'],['select',0,'Select','ShiftRight'],
  ['l1',10,'L1','KeyQ'],['r1',11,'R1','KeyW'],['l2',8,'L2','KeyE'],['r2',9,'R2','KeyR'],
  ['l3',1,'L3','KeyT'],['r3',2,'R3','KeyY'],
];
export const CLASSIC = Object.fromEntries(BUTTONS.map(([id,,,code]) => [id,code]));
export const WASD = {...CLASSIC,up:'KeyW',down:'KeyS',left:'KeyA',right:'KeyD',cross:'Space',square:'KeyJ',circle:'KeyK',triangle:'Backspace',l1:'KeyQ',r1:'KeyE',l2:'Digit1',r2:'Digit3'};
export const DEFAULTS = {renderer:'opengl',resolution:1,filter:0,volume:80,unlocked:true,fullscreen:false,preset:'classic',bindings:CLASSIC};
const NAMED = {ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',Enter:'Return',Space:'Space',Backspace:'Backspace',ShiftRight:'Right Shift',ShiftLeft:'Left Shift',ControlRight:'Right Ctrl',ControlLeft:'Left Ctrl'};
export function validKey(code) { return typeof code === 'string' && (/^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code) || Object.hasOwn(NAMED,code)); }
export function keyLabel(code) { return ({ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Space:'Space',Enter:'Enter',Backspace:'⌫',ShiftRight:'R Shift',ShiftLeft:'L Shift',ControlRight:'R Ctrl',ControlLeft:'L Ctrl'})[code] || code?.replace(/^(Key|Digit)/,'') || '—'; }
export function normalizeSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const bindings = {...CLASSIC};
  if (input.bindings && BUTTONS.every(([id]) => validKey(input.bindings[id])) && new Set(Object.values(input.bindings)).size === BUTTONS.length)
    for (const [id] of BUTTONS) bindings[id] = input.bindings[id];
  return {renderer:input.renderer==='software'?'software':'opengl',
    resolution:Number(input.resolution)===2?2:1,filter:Number(input.filter)===1?1:0,
    volume:Number.isFinite(Number(input.volume))?Math.max(0,Math.min(100,Number(input.volume))):80,
    unlocked:input.unlocked!==false,fullscreen:input.fullscreen===true,preset:['classic','wasd','custom'].includes(input.preset)?input.preset:'classic',bindings};
}
export function rebind(bindings, id, code) {
  if (!Object.hasOwn(CLASSIC,id) || !validKey(code)) throw new Error('Choose a letter, digit, arrow, Space, Enter, Shift, Ctrl or Backspace.');
  const next = {...bindings};
  const conflict = Object.keys(next).find((other) => other !== id && next[other] === code);
  if (conflict) next[conflict] = next[id]; // swap, never leave an ambiguous pad mapping
  next[id] = code;
  return next;
}
export function keyMap(bindings) { return Object.fromEntries(BUTTONS.map(([id,bit]) => [bindings[id],bit])); }
export function keybindFile(bindings) {
  const sdl = (code) => NAMED[code] || code.replace(/^(Key|Digit)/,'');
  const lines = BUTTONS.map(([id]) => `${id} = ${sdl(bindings[id])}`);
  for (const dir of ['up','down','left','right']) lines.push(`ls_${dir} = ${sdl(bindings[dir])}`);
  return Array.from({length:5},(_,i) => `[player${i+1}]\n${lines.join('\n')}\n`).join('\n');
}
export function invitationFrom(value, base) {
  let url;try {url=new URL(value,base);} catch {throw new Error('Could not read the session link.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid session link.');
  let data;
  try {
    const encoded=/^#session=([A-Za-z0-9_-]{1,2048})$/.exec(url.hash)?.[1];
    if(!encoded)throw new Error();
    data=JSON.parse(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')));
    if(data.v!==4||! /^[a-f0-9]{24}$/.test(data.r)||! /^[a-f0-9]{64}$/.test(data.t)||!['opengl','software'].includes(data.g)||![1,2].includes(data.q)||![0,1].includes(data.f)||typeof data.u!=='boolean')throw new Error();
  } catch {throw new Error('This session link is damaged or outdated. Ask for a new one.');}
  return {url,room:data.r,token:data.t,renderer:data.g,camera:data.g==='opengl'?2:0,resolution:data.q,filter:data.f,unlocked:data.u};
}
export function sessionURL(base, invite, settings) {
  const url=new URL(base);url.search='';
  const data={v:4,r:invite.room,t:invite.token,g:settings.renderer,q:settings.resolution,f:settings.filter,u:settings.unlocked};
  url.hash='session='+btoa(JSON.stringify(data)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');return url.href;
}
export function roomIdentity(settings, disc, wasmHash) {
  return `${disc}:${wasmHash}:${settings.renderer}:${settings.camera}:unlocked=${Number(settings.unlocked)}:resolution=${settings.resolution}:filter=${settings.filter}:sled-browser-console-v4-replay-multitap4-delay8`;
}

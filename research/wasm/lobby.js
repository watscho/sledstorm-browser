import {launchGame,graphicsSupport} from './port.js';
import {BUTTONS,CLASSIC,WASD,DEFAULTS,normalizeSettings,rebind,keyLabel,invitationFrom} from './launch-settings.js';
import {selectedDisc} from './local-disc.js';
const $=(id)=>document.getElementById(id);
const storageKey='sledstorm.lobby.v1';
let stored={};try{stored=JSON.parse(localStorage.getItem(storageKey)||'{}');}catch{}
let settings=normalizeSettings(stored), invitation=null, busy=false, listening=null, localRequired=false, discAvailable=false, selectedValid=false;
let previousVolume=settings.volume||80, manifestError='', invitationError='';
const accelerated=graphicsSupport();
if (!accelerated && settings.renderer==='opengl') settings.renderer='software';
document.querySelector('.skip-link').addEventListener('click',(event)=>{
  event.preventDefault();$('setup').focus();$('setup').scrollIntoView({block:'start'});
});
function save() {
  try { localStorage.setItem(storageKey,JSON.stringify(settings)); $('saved-note').textContent='Settings saved automatically'; }
  catch { $('saved-note').textContent='The browser does not allow settings to be saved'; }
}
function setError(text) { $('launch-error').textContent=text; $('launch-error').hidden=!text; }
function setStatus(text) {
  if($('status').textContent!==text)$('status').textContent=text;
  if($('loading-detail').textContent!==text)$('loading-detail').textContent=text;
}
function showTab(id,focus=false) {
  for (const tab of document.querySelectorAll('[role=tab]')) {
    const active=tab.id===id;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;$(tab.getAttribute('aria-controls')).hidden=!active;
    if(active&&focus)tab.focus();
  }
  cancelBinding();
}
for(const tab of document.querySelectorAll('[role=tab]')) {
  tab.addEventListener('click',()=>showTab(tab.id));
  tab.addEventListener('keydown',(event)=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const tabs=Array.from(document.querySelectorAll('[role=tab]'));let index=tabs.indexOf(tab);
    index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    showTab(tabs[index].id,true);
  });
}
function update() {
  const joining=Boolean(invitation);
  $('unlocked').checked=settings.unlocked;$('unlocked').disabled=busy||joining;
  $('launch-fullscreen').checked=settings.fullscreen;
  $('renderer').value=settings.renderer;$('renderer').disabled=busy||joining;
  $('resolution').value=String(settings.resolution);$('resolution').disabled=busy||joining||settings.renderer==='software';
  $('texture-filter').value=String(settings.filter);$('texture-filter').disabled=busy||joining||settings.renderer==='software';
  $('renderer-help').textContent=joining?'These settings are chosen by the session creator.':'Accelerated graphics provide a personal view for two players. Compatible graphics keep the original screen layout.';
  $('resolution-help').textContent=joining?'Resolution is chosen by the session creator.':'If the game runs slowly, try 1×.';
  $('volume').value=String(settings.volume);$('live-volume').value=String(settings.volume);$('volume-value').value=`${settings.volume}%`;
  $('mute').setAttribute('aria-pressed',String(settings.volume===0));$('mute').setAttribute('aria-label',settings.volume===0?'Unmute':'Mute');$('mute').textContent=settings.volume===0?'×':'♪';
  $('control-preset').value=settings.preset;
  $('summary-mode').textContent=joining?'Shared game · up to 4':'New session · up to 4';
  $('summary-video').textContent=`${settings.renderer==='opengl'?'WebGL2':'Original graphics'} · ${settings.resolution}×`;
  $('summary-progress').textContent=settings.unlocked?'All content unlocked':'Original progression';
  $('summary-controls').textContent=({classic:'Arrows + X',wasd:'WASD + space',custom:'Custom layout'})[settings.preset];
  $('launch-label').textContent=joining?'Join game':'Start game';
  $('launch-hint').textContent=localRequired&&!selectedValid?'Select the CUE and all BIN files in Game files.':joining?'Your browser will restore the current game state before joining.':'Your invitation link appears as soon as the session starts.';
  $('capabilities').textContent=accelerated?'Accelerated graphics are available in this browser.':'Compatible graphics are available in this browser.';
  $('play-controls').textContent=`${keyLabel(settings.bindings.left)} ${keyLabel(settings.bindings.right)} — steer · ${keyLabel(settings.bindings.cross)} to accelerate / confirm · ${keyLabel(settings.bindings.start)} for Start · ${keyLabel(settings.bindings.triangle)} to go back`;
  $('launch').disabled=busy||Boolean(invitationError);
  $('mobile-launch').disabled=$('launch').disabled;$('mobile-launch-label').textContent=$('launch-label').textContent;
}
for(const [id,key] of [['renderer','renderer'],['resolution','resolution'],['texture-filter','filter'],['volume','volume'],['live-volume','volume'],['unlocked','unlocked'],['launch-fullscreen','fullscreen']]) {
  $(id).addEventListener(id.includes('volume')?'input':'change',()=>{
    const node=$(id);settings[key]=node.type==='checkbox'?node.checked:key==='renderer'?node.value:Number(node.value);
    if(settings.renderer==='software'){settings.resolution=1;settings.filter=0;}
    if(key==='volume'){if(settings.volume>0)previousVolume=settings.volume;window.Module?._sled_volume_set?.(settings.volume);}
    update();save();setError('');
  });
}
$('mute').addEventListener('click',()=>{
  settings.volume=settings.volume===0?previousVolume:0;window.Module?._sled_volume_set?.(settings.volume);update();save();
});
function renderBindings() {
  $('key-bindings').replaceChildren();$('extra-bindings').replaceChildren();
  BUTTONS.forEach(([id,,label],index)=>{
    const row=document.createElement('div');row.className='key-row';
    const name=document.createElement('span');name.textContent=label;
    const button=document.createElement('button');button.type='button';button.className='key-button';button.dataset.binding=id;
    button.textContent=keyLabel(settings.bindings[id]);button.setAttribute('aria-label',`${label}: ${button.textContent}. Rebind`);
    button.addEventListener('click',()=>{
      cancelBinding();listening=id;button.dataset.listening='true';button.textContent='…';
      $('binding-status').textContent=`Press a new key for ${label}. Escape cancels.`;
    });row.append(name,button);$(index<8?'key-bindings':'extra-bindings').append(row);
  });
}
function cancelBinding() {
  if(!listening)return;
  const button=document.querySelector(`[data-binding="${listening}"]`);if(button){button.dataset.listening='false';button.textContent=keyLabel(settings.bindings[listening]);}
  listening=null;
  $('binding-status').textContent='Rebinding cancelled.';
}
window.addEventListener('keydown',(event)=>{
  if(!listening)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(event.code==='Escape'){cancelBinding();$('binding-status').textContent='Rebinding cancelled.';return;}
  if(event.metaKey||(event.ctrlKey&&!event.code.startsWith('Control'))||event.altKey){$('binding-status').textContent='Choose a single key without Cmd, Ctrl or Alt modifiers.';return;}
  const id=listening;
  try{
    const conflict=BUTTONS.find(([other])=>other!==id&&settings.bindings[other]===event.code);
    settings.bindings=rebind(settings.bindings,id,event.code);settings.preset='custom';cancelBinding();renderBindings();update();save();
    document.querySelector(`[data-binding="${id}"]`).focus();
    $('binding-status').textContent=conflict?`Assigned ${keyLabel(event.code)}. Swapped the key for ${conflict[2]} with the selected action.`:`Assigned ${keyLabel(event.code)}. Settings saved.`;
  }catch(error){$('binding-status').textContent=error.message;}
},true);
window.addEventListener('blur',cancelBinding);
$('control-preset').addEventListener('change',()=>{
  settings.preset=$('control-preset').value;
  if(settings.preset!=='custom')settings.bindings={...(settings.preset==='wasd'?WASD:CLASSIC)};
  cancelBinding();renderBindings();update();save();
});
$('reset-settings').addEventListener('click',()=>{
  settings=normalizeSettings(DEFAULTS);if(!accelerated)settings.renderer='software';
  if(invitation)settings={...settings,renderer:invitation.renderer,resolution:invitation.resolution,filter:invitation.filter,unlocked:invitation.unlocked};
  cancelBinding();renderBindings();update();save();setError('');$('binding-status').textContent='Settings reset.';
});
async function updateFiles() {
  selectedValid=false;
  if(!$('disc-files').files.length){$('disc-selection').textContent='No files selected manually.';$('clear-disc').hidden=true;update();return;}
  try {const files=await selectedDisc($('disc-files').files);selectedValid=true;$('disc-selection').textContent=`Ready: CUE and ${files.length-1} BIN files. Read locally.`;$('clear-disc').hidden=false;setError('');}
  catch(error){$('disc-selection').textContent=discError(error);$('clear-disc').hidden=false;}
  update();
}
function discError(error) {
  if(String(error.message).startsWith('Missing local track:'))return `Missing BIN: ${error.message.split(': ').slice(1).join(': ')}`;
  return 'Select one CUE and all 11 BIN files from the Sled Storm (Europe) folder.';
}
$('disc-files').addEventListener('change',updateFiles);
$('clear-disc').addEventListener('click',()=>{$('disc-files').value='';updateFiles();});
async function inspectDisc() {
  try {
    const response=await fetch('/manifest');if(!response.ok)throw new Error();
    localRequired=response.headers.get('X-Disc-Local-Required')==='1';const files=await response.json();discAvailable=Array.isArray(files)&&files.length===12;
    $('disc-title').textContent=localRequired?'Select files on your computer':discAvailable?'Game found in the local folder':'Game files not found';
    $('disc-description').textContent=localRequired?'You need your own CUE and all 11 BIN files to join.':discAvailable?'Sled Storm · Europe · CUE + 11 BIN. Ready to launch.':'Select the CUE and all BIN files manually.';
  }catch{manifestError='Could not reach the local server. Refresh this page after starting it.';$('disc-title').textContent='Server unavailable';$('disc-description').textContent=manifestError;}
  update();
}
function setBusy(value) {
  busy=value;for(const element of document.querySelectorAll('.configuration input,.configuration select,.configuration .key-button,#reset-settings'))element.disabled=value;
  update();
}
async function fullscreen() {
  if(document.fullscreenElement)return document.exitFullscreen();
  if(!$('game-stage').requestFullscreen)throw new Error('Fullscreen is not supported by this browser.');
  return $('game-stage').requestFullscreen();
}
$('fullscreen').addEventListener('click',()=>fullscreen().then(()=>$('canvas').focus()).catch(()=>setStatus('The browser blocked fullscreen. Try the Fullscreen button again.')));
document.addEventListener('fullscreenchange',()=>{
  $('fullscreen').textContent=document.fullscreenElement?'Exit fullscreen ⛶':'Fullscreen ⛶';
  if(busy)$('canvas').focus();
});
$('share-session').addEventListener('click',()=>{$('invite-box').hidden=!$('invite-box').hidden;});
$('copy-invite').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText($('invite').value);$('copy-invite').textContent='Link copied ✓';}
  catch{$('invite').focus();$('invite').select();$('copy-invite').textContent='Copy the selected link';}
});
$('back-lobby').addEventListener('click',()=>{$('exit-dialog').showModal();$('stay-game').focus();});
document.querySelector('.brand').addEventListener('click',(event)=>{
  if(busy){event.preventDefault();$('exit-dialog').showModal();$('stay-game').focus();}
});
$('stay-game').addEventListener('click',()=>{$('exit-dialog').close();$('canvas').focus();});
$('confirm-exit').addEventListener('click',()=>{const url=new URL(location.href);url.hash='';url.search='';location.replace(url.href);});
$('mobile-launch').addEventListener('click',()=>$('launch').click());
$('launch').addEventListener('click',async()=>{
  if(busy)return;cancelBinding();setError('');
  if(manifestError){setError(manifestError);return;}
  if((localRequired||!discAvailable||$('disc-files').files.length>0)&&!selectedValid){showTab('tab-files');setError('Select one CUE and all 11 BIN files from the game folder.');$('disc-files').focus();return;}
  if(settings.renderer==='opengl'&&!accelerated){showTab('tab-video');setError(invitation?'This session requires accelerated graphics. Open the link in a supported browser.':'Accelerated graphics are unavailable. Select compatible graphics.');return;}
  const snapshot={...settings,bindings:{...settings.bindings},files:$('disc-files').files,camera:settings.renderer==='opengl'?2:0,invitation:invitation?{room:invitation.room,token:invitation.token}:null};
  save();setBusy(true);document.body.classList.add('is-playing');$('game-stage').hidden=false;$('loading-overlay').hidden=false;
  $('session-title').textContent='Sled Storm · shared session';$('session-state').textContent='Loading';
  if(settings.fullscreen)fullscreen().catch(()=>{});
  function onError(error){
    setStatus(error.message);$('session-state').textContent='Unable to continue';$('loading-title').textContent='Could not start';
    if(!window.Module){document.body.classList.remove('is-playing');$('game-stage').hidden=true;setBusy(false);setError(error.message);$('launch-error').focus();}
    else{$('loading-overlay').hidden=false;$('loading-detail').textContent=`${error.message} End this session and return to the lobby to try again.`;}
  }
  try{await launchGame(snapshot,{
    onStatus:setStatus,onError,onLog:(text)=>{$('log').textContent=text;},onDiagnostics:(text)=>{$('camera').textContent=text;},
    onInvite:(url)=>{$('invite').value=url;$('invite-box').hidden=false;$('share-session').hidden=false;$('session-state').textContent='Session created';},
    onBoot:({replaying})=>{$('loading-overlay').hidden=!replaying;$('loading-title').textContent='Connecting controller';$('session-state').textContent=replaying?'Synchronizing':'Starting game';setStatus(replaying?'Restoring the current game…':'Loading game · Enter to skip the intro');},
    onRunning:()=>{$('loading-overlay').hidden=true;$('invite-box').hidden=true;$('session-state').textContent='In game';document.title='Sled Storm — game';$('canvas').focus();},
  });}catch(error){onError(error);}
});
setInterval(()=>{
  const pad=Array.from(navigator.getGamepads?.()||[]).find((pad)=>pad?.connected);
  $('gamepad-name').textContent=pad?pad.id:'No gamepad connected';
  $('gamepad-help').textContent=pad?(pad.mapping==='standard'?'Ready. Left stick to steer; bottom face button to accelerate / confirm.':'The browser could not detect a standard gamepad mapping. Use the keyboard for online play.'):'Connect a gamepad and press any button. The keyboard works without one.';
},1200);
renderBindings();
if(location.hash && location.hash!=='#setup'){
  try{invitation=invitationFrom(location.href);settings={...settings,renderer:invitation.renderer,resolution:invitation.resolution,filter:invitation.filter,unlocked:invitation.unlocked};document.querySelector('.intro').textContent='Join the shared game as the next controller.';}
  catch(error){invitationError=error.message;setError(invitationError);}
}
if(settings.renderer==='software'){settings.resolution=1;settings.filter=0;}
update();inspectDisc();

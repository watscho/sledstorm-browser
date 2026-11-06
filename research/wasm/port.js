import { BrowserSession } from './network-client.js';
import { mountDisc } from './disc-fs.js';
import { selectedDisc, localDiscIdentity } from './local-disc.js';
import { keybindFile, keyMap, roomIdentity, sessionURL } from './launch-settings.js';

export function graphicsSupport() {
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2');
  const supported = Boolean(gl?.getExtension('WEBGL_blend_func_extended') && gl?.getExtension('NV_shader_noperspective_interpolation'));
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return supported;
}
async function bytes(url) {
  const result = await fetch(url);
  if (!result.ok) throw new Error(`Could not load ${url} (HTTP ${result.status}).`);
  return new Uint8Array(await result.arrayBuffer());
}
const hex = (buffer) => Array.from(new Uint8Array(buffer),(n) => n.toString(16).padStart(2,'0')).join('');
export async function launchGame(settings, ui) {
  const messages = []; let reported = 0; let failed = false; let running = false; let hostBytesRead = 0;
  function fail(error) { if (!failed) {failed=true;ui.onError(error instanceof Error ? error : new Error(String(error)));} }
  function write(message) {
    const text = String(message), last = messages.at(-1);
    if (text.includes('GL pipeline init failed')) fail(new Error('Accelerated graphics did not start. Return to the lobby and select compatible graphics.'));
    if (last?.text === text) last.count++; else messages.push({text,count:1});
    if (last?.text !== text && reported++ < 50) fetch('/diagnostic',{method:'POST',body:text.slice(0,4000)}).catch(()=>{});
    if (messages.length > 200) messages.shift();
    ui.onLog(messages.map((item)=>`${item.text}${item.count>1?` (×${item.count})`:''}`).join('\n'));
    if(text.includes('program exited (with status:')) {
      try { const report=window.Module.FS.readFile('/psx_last_run_report.json',{encoding:'utf8'}); messages.push({text:'Native crash report:\n'+report.slice(0,18000),count:1}); ui.onLog(messages.map((item)=>item.text).join('\n'));  } catch {}
      window.Module.sledNetwork?.fail('Native game execution stopped');
      fail(new Error('The game runtime stopped. See Technical details for more information.'));
    }
  }
  ui.onStatus('Checking game files…');
  const localFiles = await selectedDisc(settings.files);
  const manifest = await fetch('/manifest');
  if (!manifest.ok) throw new Error('The local server is not responding. Make sure it is running.');
  if (!localFiles && manifest.headers.get('X-Disc-Local-Required') === '1') throw new Error('For this session, select the CUE and all 11 BIN files in Game files.');
  const files = localFiles || await manifest.json(), invitePath = manifest.headers.get('X-Invite-Path');
  let hostBootPending = !localFiles;
  function publishInvite(invite) {
    const base = new URL(location.href);
    if (invitePath && /^\/access\/[a-f0-9]{48}$/.test(invitePath)) base.pathname = invitePath;
    const link = sessionURL(base.href, invite, settings);
    history.replaceState(null, '', link);
    ui.onInvite(link);
  }
  ui.onStatus('Loading the game in your browser…');
  const wasmBinary = await bytes('/game.wasm');
  const wasmHash = hex(await crypto.subtle.digest('SHA-256',wasmBinary));
  const online = true, camera = settings.camera;
  return new Promise((resolve,reject) => {
    window.Module = {
      wasmBinary,canvas:document.querySelector('#canvas'),noInitialRun:true,
      locateFile:(name)=>name.endsWith('.wasm')?'/game.wasm':`/${name}`,
      print:write,printErr:write,onAbort:(reason)=>{ fail(new Error('The game stopped. See Technical details for more information.'));write(reason);window.Module.sledNetwork?.fail('Native game execution stopped'); },
      onRuntimeInitialized:async()=>{
        try {
          const fs = window.Module.FS;
          fs.mkdir('/disc');fs.mkdir('/bios');
          const bios = await bytes('/bios.bin');fs.writeFile('/bios/openbios.bin',bios,{canOwn:true});
          mountDisc(window.Module,files,(count)=>{ hostBytesRead += count; });
          const cue = files.find((file)=>/\.cue$/i.test(file.name));
          fs.writeFile('/keybinds.ini',keybindFile(settings.bindings));
          let config = `[game]\nname="SledStorm"\nid="SLES-02194"\nplayers=4\nexe="/disc/SLES_021.94"\nload_address="0x80010000"\nentry_pc="0x800800FC"\ntext_size="0x000B4000"\n[recompiler]\nseeds="seeds/ghidra_funcs.txt"\nout_dir="generated"\n[video]\nrenderer="software"\ninternal_resolution="${settings.resolution}x"\ntexture_filtering="${settings.filter===1?'bilinear':'nearest'}"\n[runtime]\nmemcard_dir="/saves"\noverlay_cache=false\n`;
          if (camera===2) config+='\n[widescreen]\ngte_game_mode=true\nauto_ui_squash=true\nauto_ui_anchor="edges"\nauto_ui_size="original"\ngameplay_state_addr="0x800D6980"\ngameplay_state_values=["0x1"]\n[netplay]\nlocal_viewport="vertical_split"\nlocal_viewport_renderer="projection"\nlocal_viewport_aspect="16:9"\n';
          fs.writeFile('/game.toml',config);
          window.Module._sled_preferences_configure(settings.volume,settings.resolution);
          if (online) {
            ui.onStatus('Checking game compatibility…');
            const response = await fetch('/identity');
            if (!response.ok) throw new Error('Could not verify the game files.');
            const server = await response.json();
            const disc = localFiles ? await localDiscIdentity(files,bios,()=>ui.onStatus('Checking local game files…')) : server.disc_identity;
            const identity = hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(roomIdentity(settings,disc,wasmHash))));
            const network = new BrowserSession((text)=>{
              write(text);
              if (text.startsWith('Session ready')) ui.onStatus('Session created. You can play and invite friends.');
              else if(text.startsWith('Syncing session')) {} // The status interval shows replay progress.
              else if (text.startsWith('Session paused')) {
                const reason=text.includes('All four controllers')?'All four controllers are already occupied.':text.includes('Invitation is invalid')?'The link is invalid or the session has ended.':text.includes('execution build differs')?'Your game files or build differ from the shared session.':'The connection was interrupted or game states did not match.';
                fail(new Error(`${reason} Return to the lobby to start a new game.`));
              }
            },{keyMap:keyMap(settings.bindings)});
            window.Module.sledNetwork=network;
            ui.onStatus('Connecting to the session…');
            if (settings.invitation) publishInvite(settings.invitation);
            const slot = await network.connect(identity, settings.invitation, publishInvite);
            window.Module._sled_online_configure(slot);window.Module._sled_camera_enable(camera);
          }
          window.Module._sled_progress_configure(Number(settings.unlocked));
          ui.onStatus('Loading Sled Storm. This may take about a minute…');
          setInterval(()=>{
            if (!window.Module._sled_camera_word) return;
            const fields=Array.from({length:6},(_,i)=>window.Module._sled_camera_word(i));
            const network=window.Module.sledNetwork;
            if (hostBootPending && network.tick >= 0 && !network.replaying) {
              hostBootPending = false;
              ui.onBoot({replaying:false,hostDisc:false});
            }
            if (!network.replaying && !running && (fields[0]===1 || fields[2]!==0)) {running=true;ui.onRunning();}
            if(!failed)ui.onStatus(!localFiles && network.tick<0?`Reading the host’s disc · ${Math.floor(hostBytesRead/1048576)} MiB received`:network.replaying?`Restoring session · ${Math.min(100,Math.floor((network.tick+1)/network.replayTarget*100))}%`:network.syncing?'Another controller is joining · synchronizing':running?`Controller ${network.slot+1} · Session ${network.members||1} of 4`:'Loading game · Enter to skip the intro');
            const progress=Array.from({length:7},(_,i)=>window.Module._sled_progress_word(i));
            const projection=Array.from({length:5},(_,i)=>window.Module._sled_projection_word(i));
            ui.onDiagnostics(`race=${fields[0]}, players=${fields[1]}, frontend=${fields[2]}, menu=${fields[5]}; projection=${projection.join('/')}; profile=${progress.join('/')}; volume=${window.Module._sled_volume_get()}; ${network?`tick=${network.tick}, verified=${network.verified}`:'offline'}`);
          },1000);
          document.querySelector('#canvas').focus();
          ui.onBoot({replaying:Boolean(window.Module.sledNetwork?.replaying),hostDisc:!localFiles});
          resolve();
          window.Module.callMain(['--game','/game.toml','--bios','/bios/openbios.bin','--disc',`/disc/${cue.name}`,'--renderer',settings.renderer,'--no-launcher']);
        } catch(error) {write(String(error));fail(error);reject(error);}
      },
    };
    const script=document.createElement('script');script.src='/game.js';
    script.onerror=()=>{const error=new Error('Could not load the game build. Check the local server.');fail(error);reject(error);};
    document.body.append(script);
  });
}

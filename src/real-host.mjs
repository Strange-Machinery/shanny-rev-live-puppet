import {createServer} from 'node:http';
import {createServer as tcpServer} from 'node:net';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile,mkdir,open,unlink} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createLiveServer} from './live-server.mjs';
import {createLocalPuppetGateway} from './donations/gateway-client.mjs';
import {OmniVoiceProvider} from './providers/omnivoice.mjs';
import {createQwenCompletion} from './providers/qwen.mjs';
import {PersistentWhisper} from './providers/whisper.mjs';
import {createConversationDirector} from './conversation-director.mjs';
import {ConversationSession} from './conversation-session.mjs';
import {AnimationMenu} from './animation-menu.mjs';
import {waitForVoiceMemory} from './gpu-readiness.mjs';
import {createStageMedia} from './stage-media.mjs';
import {serveRemotePanel} from './remote-panel.mjs';

async function freePort(){const socket=tcpServer();await new Promise((r,j)=>{socket.once('error',j);socket.listen(0,'127.0.0.1',r);});const port=socket.address().port;await new Promise(r=>socket.close(r));return port;}
async function waitUntil(check,ms){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await delay(200);}throw new Error('A character service did not become ready');}

/** Producer-owned real services. No fixture fallback, episode generation, or public sharing. */
export async function serveRealHost(config){
  let phase='Starting character services';
  const progress=message=>{phase=message;process.stderr.write('BUFF_STARTUP '+message+'\n');};
  if(config.resourceHeadroomVerified!==true)throw new Error('Character voice resource check is required');
  const root=resolve(config.scratch),token=randomBytes(32).toString('hex'),qwenKey=randomBytes(32).toString('hex');
  await mkdir(root,{recursive:true});
  const lockPath=join(root,'host.lock');let lock;
  try {lock=await open(lockPath,'wx');} catch(error) {
    if(error.code!=='EEXIST')throw error;
    const owner=JSON.parse(await readFile(lockPath,'utf8'));let alive=true;
    try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
    if(alive)throw new Error('Real characters are already running. Use their existing producer window.');
    await unlink(lockPath);lock=await open(lockPath,'wx');
  }
  await lock.writeFile(JSON.stringify({pid:process.pid}));
  const children=[],logs=[];let live,session,http,voice,whisper,monitor,media,preview,closed=false;
  const stopChildren=()=>{for(const child of children)if(child.exitCode===null)child.kill();};
  const close=async()=>{
    if(closed)return;closed=true;clearInterval(monitor);
    await preview?.close();await session?.stop().catch(()=>{});stopChildren();
    await whisper?.close();
    await media?.close();
    if(http){http.closeAllConnections();await new Promise(r=>http.close(r));}
    if(live)await live.close();else await voice?.close();
    for(const log of logs)await log.close();
    await lock.close();await unlink(lockPath);
  };
  try {
    progress('Loading the language model...');
    const port=await freePort(),modelName=config.qwenRuntime.modelId||'Qwen3.5-2B';
    const modelLog=await open(join(root,'qwen.log'),'a');logs.push(modelLog);
    const model=spawn(config.qwenRuntime.executable,['-m',config.qwenRuntime.modelPath,'--alias',modelName,
      '--host','127.0.0.1','--port',String(port),'-ngl','0','--ctx-size','4096','--parallel','1','--threads','6',
      '--reasoning','off','--reasoning-budget','0','--no-webui'],
      {windowsHide:true,stdio:['ignore',modelLog.fd,modelLog.fd],env:{...process.env,LLAMA_API_KEY:qwenKey}});
    children.push(model);model.on('error',()=>{});
    await waitUntil(async()=>{if(model.exitCode!==null)throw new Error('Local Qwen exited; inspect producer diagnostics');try{return (await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(1500)})).ok;}catch{return false;}},120000);
    const notes=await readFile(config.characterNotes,'utf8');
    const examples=config.approvedExamples?JSON.parse(await readFile(config.approvedExamples,'utf8')):[];
    const complete=createQwenCompletion({endpoint:'http://127.0.0.1:'+port+'/v1/chat/completions',model:modelName,apiKey:qwenKey,placement:'cpu',timeoutMs:12000,maxTokens:240});
    const director=createConversationDirector({complete,notes,examples});
    progress('Checking room for the character voices...');
    await waitForVoiceMemory({progress,readFreeMiB:async()=>{
      const gpu=await promisify(execFile)('nvidia-smi',['--query-gpu=memory.free','--format=csv,noheader,nounits'],{windowsHide:true,timeout:5000});
      return gpu.stdout.trim().split('\n')[0];
    }});
    progress('Loading the character voices...');
    voice=new OmniVoiceProvider(config.omnivoice);await voice.warmup();
    // Absorb first-synthesis work before Ready; warmup audio is never published.
    progress('Warming Shanny voice - microphone remains off...');
    await voice.generate({actor:'SHANNY',text:'The microphone stays off until you press the button.'});
    progress('Warming Rev voice - microphone remains off...');
    await voice.generate({actor:'REV',text:'The stage is ready for a local test.'});
    progress('Warming short character replies...');
    await director.warmup();
    live=createLiveServer({provider:voice,token,port:0,startMuted:true});const gatewayPort=(await live.start()).port;
    const origin='http://127.0.0.1:'+gatewayPort,gateway=createLocalPuppetGateway({url:origin,token});
    progress('Loading offline speech recognition...');
    whisper=new PersistentWhisper({...config.whisper,workerScript:fileURLToPath(new URL('../python/whisper_file.py',import.meta.url))});
    await whisper.warmup();
    progress('Opening the character stage...');
    if(config.media?.enabled)media=await createStageMedia({token,iceServers:config.media.iceServers||[]});
    session=new ConversationSession({gateway,director,whisper,presentation:media?{
      begin:({rain,signal})=>media.animate({id:rain?'make_it_rain':'seated_response',targets:['SHANNY','REV'],signal}),
      end:({signal})=>media.animate({id:'presentation_end',targets:['SHANNY','REV'],signal}),stop:()=>media.stopAnimations()
    }:undefined});await session.initialize();
    const player=spawn(config.player,['-force-d3d11','-screen-fullscreen','0','-videoMode',config.videoMode||'COLORBLIND','-logFile',join(root,'player.log')],
      {windowsHide:false,stdio:'ignore',env:{...process.env,LIVE_PUPPET_TOKEN:token,LIVE_PUPPET_URL:origin,
        ...(media?{LIVE_MEDIA_URL:media.url}:{})}});
    children.push(player);player.on('error',()=>{});
    await waitUntil(async()=>{if(player.exitCode!==null)throw new Error('Character player exited');const {stage}=await gateway.metrics();return stage&&Date.now()-stage.received_unix_ms<2500;},30000);
    let performanceMode='standard';
    if(config.performanceMode==='show'&&process.platform==='win32'){
      progress('Giving the show priority on this PC...');
      try {
        await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
          '-File',fileURLToPath(new URL('../scripts/show-priority.ps1',import.meta.url)),
          '-RootProcessId',String(process.pid)],{windowsHide:true,timeout:15000});
        performanceMode='above-normal';
      } catch { performanceMode='standard (priority unavailable)'; }
    }
    const animations=new AnimationMenu({catalogPath:config.animationCatalog});
    let monitorBusy=false;
    monitor=setInterval(async()=>{
      if(closed||monitorBusy||session.mode!=='live')return;monitorBusy=true;
      try {const {stage}=await gateway.metrics();if(!stage||Date.now()-stage.received_unix_ms>4000||player.exitCode!==null||model.exitCode!==null)await session.stop();}
      catch {await session.stop().catch(()=>{});}finally{monitorBusy=false;}
    },1000);
    const action=async data=>{
      if(data.action==='status')return {...session.status(),qwen:modelName+' (local CPU)',performance_mode:performanceMode,media:media?.info()||null,
        preview_url:preview?'http://127.0.0.1:'+preview.port+'/#key='+preview.token:null};
      if(data.action?.startsWith('media-')){if(!media)throw new Error('Stage feed not configured');return media.viewer(data);}
      if(data.action==='animations')return animations.menu();
      if(data.action==='stop'){animations.stop();await session.stop();return {stopped:true};}
      if(data.action==='arm'){
        const result=await session.arm();
        await waitUntil(async()=>{const {stage}=await gateway.metrics();return stage&&!stage.muted&&Date.now()-stage.received_unix_ms<2500;},5000);
        return result;
      }
      if(data.action==='donate'||data.action==='transcript')return session.submit({...data,kind:data.action==='donate'?'donation':'microphone',
        session_id:data.session_id||session.scope.session_id,mode_epoch:data.mode_epoch??session.epoch});
      throw new Error('This control is unavailable in real character mode');
    };
    if(media)preview=await serveRemotePanel({action,publicOrigin:'http://127.0.0.1',allowLocalPreview:true,scratch:join(root,'preview')});
    http=createServer((req,res)=>{const revision=session.revision;void(async()=>{
      const supplied=Buffer.from(String(req.headers.authorization||'')),expected=Buffer.from('Bearer '+token);
      if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.writeHead(401);res.end();return;}
      if(req.method!=='POST'||req.url!=='/action'){res.writeHead(404);res.end();return;}
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>64000)throw new Error('Request exceeds limit');chunks.push(chunk);}
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(data.action!=='stop'&&revision!==session.revision)throw new Error('Request cancelled by Stop');
      const result=await action(data);
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));
    })().catch(error=>{if(!res.headersSent)res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));});});
    await new Promise((r,j)=>{http.once('error',j);http.listen(0,'127.0.0.1',r);});
    return {port:http.address().port,token,action,gateway,session,close:async()=>{clearInterval(monitor);await close();}};
  }catch(error){await close();throw new Error(phase.replace(/\.+$/,'')+': '+error.message,{cause:error});}
}

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
import {createQwenFailover,createV620ModelProbe} from './providers/qwen-failover.mjs';
import {withBlackoutLiveV01} from './blackout-live-v01.mjs';
import {PersistentWhisper} from './providers/whisper.mjs';
import {createConversationDirector} from './conversation-director.mjs';
import {createBlackoutMicrodirector} from './blackout-microdirector-director.mjs';
import {liveLoreStats} from './live-lore-index.mjs';
import {ConversationSession} from './conversation-session.mjs';
import {AnimationMenu} from './animation-menu.mjs';
import {waitForVoiceMemory} from './gpu-readiness.mjs';
import {createStageMedia} from './stage-media.mjs';
import {serveRemotePanel} from './remote-panel.mjs';
import {LiveDonations} from './donations/live-donations.mjs';
import {loadOrCreateViewerKey} from './obs-viewer-key.mjs';
import {createCameraFlipGate} from './audience-reactions.mjs';

async function freePort(){const socket=tcpServer();await new Promise((r,j)=>{socket.once('error',j);socket.listen(0,'127.0.0.1',r);});const port=socket.address().port;await new Promise(r=>socket.close(r));return port;}
async function waitUntil(check,ms){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await delay(200);}throw new Error('A character service did not become ready');}

/** Producer-owned real services. No fixture fallback, episode generation, or public sharing. */
export async function serveRealHost(config){
  let phase='Starting character services';
  const progress=message=>{phase=message;process.stderr.write('BUFF_STARTUP '+message+'\n');};
  if(config.resourceHeadroomVerified!==true)throw new Error('Character voice resource check is required');
  const microdirectorEnabled=config.microdirector?.enabled===true;
  if(microdirectorEnabled&&config.omnivoice?.approvedDelivery!==true)
    throw new Error('Microdirector needs explicitly approved natural episode voice routing');
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
  const children=[],logs=[];let live,session,http,voice,whisper,monitor,media,preview,donations,closed=false;
  const stopChildren=()=>{for(const child of children)if(child.exitCode===null)child.kill();};
  const close=async()=>{
    if(closed)return;closed=true;clearInterval(monitor);
    await preview?.close();await donations?.close().catch(()=>{});
    await session?.stop().catch(()=>{});stopChildren();
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
    const localComplete=createQwenCompletion({endpoint:'http://127.0.0.1:'+port+'/v1/chat/completions',model:modelName,apiKey:qwenKey,placement:'cpu',
      // Preserve the exact warm local CPU Qwen fallback and legacy behavior.
      timeoutMs:microdirectorEnabled?24000:12000,
      maxTokens:microdirectorEnabled?384:240,
      ...(microdirectorEnabled?{temperature:0.7,topP:0.9}:{})});
    // V620 routing is opt-in, in the isolated Microdirector profile only.
    // No provider credentials, native Unity, or approved OmniVoice settings
    // are changed. The original local CPU writer remains a warm failover.
    const preferV620=microdirectorEnabled&&config.microdirector?.qwenPriority==='v620-preferred';
    const liveProfile=config.microdirector?.liveProfile||null;
    if(liveProfile&&(liveProfile!=='blackout_live_v01'||!preferV620))
      throw new Error('BLACKOUT_LIVE v0.1 requires explicitly preferred private V620');
    const blackoutLiveV01=liveProfile==='blackout_live_v01';
    let complete=localComplete;
    const v620Model=preferV620?(config.microdirector?.v620?.model||'qwen3.8-27b'):null;
    if(preferV620){
      const v620Host=config.microdirector?.v620?.host;
      const remote=createQwenCompletion({
        endpoint:'http://'+v620Host+':1234/v1/chat/completions',
        model:v620Model,placement:'off-device',responseFormat:'lmstudio',
        trustedTailnetHost:v620Host,
        timeoutMs:30000,maxTokens:512,temperature:0.7,topP:0.9
      });
      const probe=createV620ModelProbe({host:v620Host,model:v620Model,timeoutMs:1500});
      // Only the remote request gets the v0.1 acting arc. MSI fallback receives
      // the exact pre-existing director messages, not the new profile.
      complete=createQwenFailover({primary:blackoutLiveV01?withBlackoutLiveV01(remote):remote,
        fallback:localComplete,probe,cooldownMs:10000});
      progress('V620 27B preferred, warm MSI CPU Qwen ready as fallback...');
    }
    // Voice prompts are qualified at worker startup. Qwen sees only those
    // categories actually available, not a guessed global voice inventory.
    const director=microdirectorEnabled?
      createBlackoutMicrodirector({complete,notes,examples,
        getDeliveryCodes:()=>voice?.availableEpisodeCodes||{}}):
      createConversationDirector({complete,notes,examples});
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
    // Per-producer/actor performance gate, not an audience-controlled stage command.
    const cameraFlipGate=createCameraFlipGate();
    session=new ConversationSession({gateway,director,whisper,
      onChange:event=>{
        if(!media)return;
        if(event.type==='line.started'){
          media.setCaption({actor:event.actor,text:event.text});
          // Only a REAL performed Qwen reply, never untrusted donation TTS,
          // may earn the middle finger. Native owns the hand, camera and
          // eventual recovery; optional gesture failure must never abort TTS.
          const selected=cameraFlipGate.select(event);
          if(selected)return media.animate({id:selected.id,targets:selected.targets})
            .catch(()=>{process.stderr.write('BUFF_CAMERA_FLIP_SKIPPED: native live gesture unavailable\n');});
        }else if(event.type==='line.finished')media.setCaption(null);
      },
      presentation:media?{
      begin:async({rain,signal,popup})=>{
        media.setPopup(popup);
        try{
          return await media.animate({id:rain?'make_it_rain':'seated_response',
            targets:['SHANNY','REV'],signal});
        }catch(error){media.stopAnimations();throw error;}
      },
      // Mid-show handoff: native seated_response resets camera/chairs while
      // keeping the public popup visible. TTS is NOT released until receipt.
      seat:({signal})=>media.animate({id:'seated_response',targets:['SHANNY','REV'],signal}),
      end:({signal})=>media.animate({id:'presentation_end',targets:['SHANNY','REV'],signal}),
      waitVisible:({signal})=>media.waitForViewer({signal}),
      waitRainEnd:({signal})=>media.waitForRainEnd({signal}),
      stop:()=>media.stopAnimations()
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
    const animations=new AnimationMenu({catalogPath:config.animationCatalog,getScope:()=>({enabled:session.mode==='live',session_id:session.scope.session_id,epoch:session.epoch}),
      adapter:media&&config.media?.m16Validated===true?{accepted:true,
        canPlay:({id,targets,bindings})=>media.info().available&&/^m16_(conversation|directed_point|objection|open_explanation|quiet_listening|seated_listening)$/.test(id)&&targets.every(a=>bindings[a]===id.replace('directed_point','directed-point').replace('open_explanation','open-explanation').replace('quiet_listening','quiet-listening').replace('seated_listening','seated-listening')+'_'+a),
        playBatch:request=>media.animate(request),stopNow:()=>media.stopAnimations()}:null});
    let monitorBusy=false;
    monitor=setInterval(async()=>{
      if(closed||monitorBusy||session.mode!=='live')return;monitorBusy=true;
      try {const {stage}=await gateway.metrics();if(!stage||Date.now()-stage.received_unix_ms>4000||player.exitCode!==null||model.exitCode!==null)await session.stop();}
      catch {await session.stop().catch(()=>{});}finally{monitorBusy=false;}
    },1000);
    let manualRainArming=false;
    const action=async data=>{
      if(data.action==='status')return {...session.status(),
        qwen:preferV620?v620Model+' (V620 primary; MSI CPU backup)':modelName+' (local CPU)',
        qwen_backend:preferV620?complete.status():{preferred:'msi',last_route:'msi',last_reason:'none'},
        performance_mode:performanceMode,
        microdirector:microdirectorEnabled?{enabled:true,
          live_profile:blackoutLiveV01?'blackout_live_v01':'baseline',
          qwen_budget:preferV620?{max_tokens:512,timeout_ms:30000,
            fallback_max_tokens:384,fallback_timeout_ms:24000,
            accepted_passes_per_turn:1,max_attempts_on_failure:2}:
            {max_tokens:384,timeout_ms:24000,model_calls_per_turn:1},
          dialogue_length:{preferred_words_min:16,preferred_words_max:32,
            max_chars_per_line:320,max_sentences_per_line:2},
          response_schema:'named-character-slots-v2',
          spoken_line_validator:'natural-punctuation-v2',
          shanny_blackout:{version:'producer-blackout-v1',overt_pressure_target:0.65,
            lanes:['direct_attack','disgust_contempt','wounded_victim','insular_crying','contained_blackout']},
          audience_roles:'viewer-address-v1',topic_focus:'superchat-only-v1',
          background_notes_in_qwen_prompt:false,offtopic_voice_prefetch_blocked:true,
          lore_index:liveLoreStats(),
          available_delivery_codes:voice.availableEpisodeCodes,
          qualified_samples_by_code:voice.availableEpisodeCounts,
          source_echo_flags:director.audit({history:session.history})}:{enabled:false},
        media:media?.info()||null,
        presentation_visible:media?.info().presentation_visible||false,donations:donations?.status()||null,
        preview_url:preview?'http://127.0.0.1:'+preview.port+'/#key='+preview.token:null};
      if(data.action?.startsWith('media-')){if(!media)throw new Error('Stage feed not configured');return media.viewer(data);}
      if(data.action==='animations')return animations.menu();
      if(data.action==='animate'){if(session.mode!=='live')await session.arm();return animations.play(data);}
      if(data.action==='rain-now'){
        if(!media?.info().available)throw new Error('Native paired stage is unavailable');
        if(manualRainArming||session.turn)throw new Error('Stage busy; finish the current donation before money rain');
        // A verified paid event may have been admitted just before the
        // native session becomes busy. Never let an operator celebration
        // steal that slot: the durable worker would otherwise mark the
        // paid delivery STARTED and discard it after a busy-host error.
        // Disabled/STOPped queues may retain old pending rows, which must
        // not prevent a separate, authorized manual celebration.
        const queue=donations?.queue;
        const paid=queue?.status();
        if(queue?.enabled&&(paid?.pending>0||paid?.inflight>0||queue.task))
          throw new Error('Paid donations are waiting; manual rain is available when the queue is idle.');
        manualRainArming=true;
        try {
          // Pressing the trusted button explicitly arms a ONE-OFF dance.
          // This does not enable/re-enable paid provider intake after STOP.
          if(session.mode!=='live')await session.arm();
          return session.startRainNow();
        }finally{manualRainArming=false;}
      }
      if(data.action==='donation-status')return donations.status();
      if(data.action==='donation-enable'){
        const ready=media?.info();
        if(!ready?.available)throw new Error('The paired OBS stage must be ready before donation reactions are enabled');
        if(!ready.obs_viewers)
          throw new Error('Connect the private OBS Browser Source before enabling automatic paid donations');
        return donations.enable({make_it_rain:data.make_it_rain===true});
      }
      if(data.action==='donation-mode')return donations.setMode(data.make_it_rain);
      if(data.action==='donation-stop')return donations.stop();
      if(data.action==='silence')return donations.queue.enabled?donations.silence():session.silence();
      if(data.action==='stop'){animations.stop();
        if(donations)await donations.stop();else await session.stop();
        return {stopped:true};}
      if(data.action==='arm'){
        const result=await session.arm();
        await waitUntil(async()=>{const {stage}=await gateway.metrics();return stage&&!stage.muted&&Date.now()-stage.received_unix_ms<2500;},5000);
        return result;
      }
      if(data.action==='transcript'&&!data.audioPath&&
          typeof data.text==='string'&&/^\s*shut\s+up[.!?]*\s*$/i.test(data.text))
        return donations.queue.enabled?donations.silence():session.silence();
      if(data.action==='donate'||data.action==='transcript')return session.submit({...data,kind:data.action==='donate'?'donation':'microphone',
        session_id:data.session_id||session.scope.session_id,mode_epoch:data.mode_epoch??session.epoch});
      throw new Error('This control is unavailable in real character mode');
    };
    // The trusted dispatcher calls the existing one-turn /action contract,
    // not another speech controller. STOP from queue must not recurse.
    // Producer may simply place donations.local.json under the owned scratch
    // folder. The launcher never prints or transmits its credentials to Buff.
    let donationConfig=config.donations||{};
    if(!config.donations){
      const localCredentials=join(root,'donations.local.json');
      try{await readFile(localCredentials,'utf8');donationConfig={credentialsFile:localCredentials};}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
    donations=new LiveDonations({directory:join(root,'donation-intake'),config:donationConfig,
      host:async data=>data.action==='stop'?(await session.stop(),{stopped:true}):
        data.action==='silence'?session.silence():action(data)});
    if(media)preview=await serveRemotePanel({action,publicOrigin:'http://127.0.0.1',
      allowLocalPreview:true,scratch:join(root,'preview'),
      viewerKey:loadOrCreateViewerKey(join(root,'obs-viewer-key.local.json'))});
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

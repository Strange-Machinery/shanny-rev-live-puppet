import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { showFixture, wav } from './fixture.mjs';
import { OfflineConversation, createFileWhisper } from './conversation.mjs';
import { createQwenCompletion } from '../providers/qwen.mjs';
import { createReactionDirector } from '../donations/reaction.mjs';
import { OmniVoiceProvider } from '../providers/omnivoice.mjs';
import { AnimationMenu } from '../animation-menu.mjs';

export async function createOfflineLab({ whisper, realDirector, voiceProvider, desktopAudio = false, animationCatalog } = {}) {
  let scenario='normal',lastDonation='',cursor=0,closed=false,driving=false;
  const trace=[],timers=new Set(),active=new Map();
  let generation=0;
  const later=(fn,ms)=>{const captured=generation;const timer=setTimeout(()=>{timers.delete(timer);if(captured===generation)void fn().catch(()=>{});},ms);timers.add(timer);};
  const f=await showFixture({
    provider:voiceProvider || {name:'offline-silent-PCM-fixture',async generate(job){
      if(scenario==='synthesis_failure')throw new Error('Injected synthesis failure');
      if(scenario==='panic_during_synthesis')await new Promise(resolve=>setTimeout(resolve,1000));
      return wav(job.prepareOnly?(scenario==='invalid_duration'?4000:10000):1000);
    }},
    qwenReply:(_req,res,body)=>{
      const actor=JSON.parse(body.messages[1].content).intended_actor;
      const reply=()=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({actor,text:'Fixture reaction text',emotion:'amused',intensity:.5})}}]}));};
      if(scenario==='timeout_qwen')return;
      later(async()=>reply(),scenario==='late_qwen'?3500:scenario==='delayed_qwen'?1800:40);
    }
  });
  const operatorToken=randomBytes(24).toString('hex'),donationToken=randomBytes(24).toString('hex');
  const addr=await f.runner.listen({port:0,token:operatorToken,donationToken});
  const runnerOrigin='http://127.0.0.1:'+addr.port;
  const clear=()=>{generation++;for(const timer of timers)clearTimeout(timer);timers.clear();active.clear();};
  const stopNow=f.installed.stage.stopNow;
  f.installed.stage.stopNow=()=>{clear();stopNow();};
  const director=realDirector || f.coordinator.director;
  if(realDirector)f.coordinator.director=realDirector;
  const conversation=new OfflineConversation({gateway:f.gateway,director,controller:f.controller,whisper});
  const animations=new AnimationMenu({catalogPath:animationCatalog});
  async function call(path,data,donation=false) {
    const reply=await fetch(runnerOrigin+path,{method:data===undefined?'GET':'POST',headers:{Authorization:'Bearer '+(donation?donationToken:operatorToken),'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
    const result=await reply.json();if(!reply.ok)throw new Error(result.error);return result;
  }
  async function drive() {
    if(driving||closed)return;driving=true;
    try {
      await f.runner.tick();
      const page=await f.gateway.events({after:cursor});
      for(const event of page.events) {
        // Arming can advance the baseline while this event page is in flight.
        // An old panic must not clear timers belonging to the newly armed test.
        if(event.seq<=cursor)continue;
        trace.push({seq:event.seq,type:event.type,actor:event.actor,id:event.id,duration_ms:event.duration_ms,epoch:event.epoch});
        if(trace.length>200)trace.shift();
        conversation.onEvent(event);
        if(['panic','interrupt'].includes(event.type))clear();
        if(event.type==='speech.ready'&&f.controller.mode==='live') {
          active.set(event.id,event);
          if(!desktopAudio) {
            const started=await f.ack(event,'started');
            if(started.status===200)later(async()=>{await f.ack(event,'finished');active.delete(event.id);},event.prepared_release?700:1000);
          }
        }
      }
      cursor=Math.max(cursor,page.cursor);
    } finally {driving=false;}
  }
  const pump=setInterval(()=>{void drive().catch(()=>{});},40);
  return {
    async action({action,text='Buff, tell us what happened.',actor='SHANNY',audioPath,final=true,session_id,mode_epoch,id,state,source,target,context,catalogRevision}) {
      if(action==='animations')return animations.menu();
      if(action==='animate')return animations.play({id,target,context,catalogRevision});
      if(action==='arm') {
        const result=await call('/live',{});
        cursor=(await f.gateway.status()).cursor;
        return {...result,session_id:f.coordinator.sessionId};
      }
      if(action==='stop'){animations.stop();conversation.stop();clear();return call('/stop',{});}
      if(action==='scenario') {
        if(!['normal','delayed_qwen','late_qwen','timeout_qwen','invalid_duration','synthesis_failure','panic_during_synthesis'].includes(text))throw new Error('Unknown fixture scenario');
        scenario=text;return {scenario};
      }
      if(action==='donate'||action==='duplicate') {
        if(action==='donate')lastDonation=randomUUID();
        if(!lastDonation)throw new Error('Send a test donation first');
        const input=f.donation(lastDonation,text);
        const result=await call('/donations',input,true);
        if(scenario==='panic_during_synthesis')later(async()=>{conversation.stop();await call('/stop',{});},100);
        return result;
      }
      if(action==='tts') {
        if(f.controller.mode!=='live')throw new Error('Arm the test stage first');
        return f.gateway.speak({actor,text,delivery:'queue'});
      }
      if(action==='interrupt') {
        if(f.controller.mode!=='live')throw new Error('Arm the test stage first');
        conversation.stop();return f.gateway.speak({actor:'SHANNY',text,delivery:'interrupt'});
      }
      if(action==='transcript') {
        if(f.runner.turn||active.size)throw new Error('Wait until the test stage is idle');
        if(typeof session_id!=='string'||!Number.isSafeInteger(mode_epoch))throw new Error('Explicit test session/mode epoch required');
        return conversation.respond({text,actor,audioPath,final,source:source||(audioPath?'OFFLINE_WAV':'OFFLINE_REPLAY'),
          session_id,mode_epoch});
      }
      if(action==='finish') {
        if(desktopAudio)throw new Error('Desktop audio must finish on its output device; use Stop to cancel');
        for(const event of active.values())await f.ack(event,'finished');active.clear();return {status:'finished'};
      }
      if(action==='playback') {
        if(!desktopAudio||!active.has(id)||!['started','finished','stopped'].includes(state))throw new Error('Unknown desktop test playback');
        const event=active.get(id);
        const result=await f.ack(event,state);
        if(result.status!==200)throw new Error('Desktop playback acknowledgement rejected');
        if(state!=='started')active.delete(id);
        return result.body;
      }
      if(action==='status')return {...await call('/status'),scenario,trace:[...trace],
        gateway_epoch:f.coordinator.epoch,
        playback:desktopAudio?'WINDOWS_DESKTOP_AUDIO':'SIMULATED_RECEIPTS',speech:voiceProvider?'PRIVATE_OMNIVOICE':'SILENT_PCM_FIXTURE',qwen:realDirector?'LOCAL_CONFIGURED_QWEN':'DETERMINISTIC_FIXTURE',
        whisper_available:Boolean(whisper),conversation_busy:Boolean(conversation.busy),conversation_context_turns:conversation.context.length,
        active_audio:active.size,
        resume_count:f.installed.trace.filter(x=>x==='episode.resume').length};
      throw new Error('Unknown test action');
    },
    async audio(id) {
      if(!desktopAudio||!active.has(id))throw new Error('No current desktop test audio');
      const response=await fetch(f.origin+'/v1/audio/'+id,{headers:{Authorization:'Bearer '+f.token},redirect:'error',signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw new Error('Audio expired or cancelled');
      return Buffer.from(await response.arrayBuffer());
    },
    async close(){closed=true;animations.stop();conversation.stop();clear();clearInterval(pump);await f.close();}
  };
}

export async function serveLab(config={}) {
  if(config.mode==='real-characters')return (await import('../real-host.mjs')).serveRealHost(config);
  let realDirector,voiceProvider;
  if(config.qwen) {
    const host=new URL(config.qwen.endpoint).hostname;
    if(!['127.0.0.1','localhost','[::1]'].includes(host))throw new Error('Offline testing requires a local Qwen endpoint');
    const persona=JSON.parse(await readFile(resolve(config.personaFile),'utf8'));
    for(const actor of ['SHANNY','REV'])if(typeof persona[actor]!=='string'||!persona[actor].trim())throw new Error('Private personas required');
    realDirector=createReactionDirector({complete:createQwenCompletion(config.qwen),personaNotes:persona});
  }
  const whisper=config.whisper?createFileWhisper({...config.whisper,workerScript:fileURLToPath(new URL('../../python/whisper_file.py',import.meta.url))}):undefined;
  if(config.omnivoice) {
    if(config.resourceHeadroomVerified!==true)throw new Error('Real local OmniVoice testing requires explicit verified resource headroom');
    voiceProvider=new OmniVoiceProvider(config.omnivoice);
    try {await voiceProvider.warmup();}catch(error){await voiceProvider.close();throw error;}
  }
  const lab=await createOfflineLab({whisper,realDirector,voiceProvider,desktopAudio:Boolean(voiceProvider),animationCatalog:config.animationCatalog});
  const token=randomBytes(24).toString('hex');
  const server=createServer((req,res)=>{
    void (async()=>{
      const a=Buffer.from(String(req.headers.authorization||'')),b=Buffer.from('Bearer '+token);
      if(a.length!==b.length||!timingSafeEqual(a,b)){res.writeHead(401);res.end();return;}
      if(req.method==='GET'&&/^\/audio\/[a-f0-9-]{36}$/.test(req.url)) {
        const bytes=await lab.audio(req.url.slice('/audio/'.length));
        res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store','Content-Length':bytes.length});res.end(bytes);return;
      }
      if(req.method!=='POST'||req.url!=='/action'){res.writeHead(404);res.end();return;}
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>8192)throw new Error('Test request too large');chunks.push(chunk);}
      const result=await lab.action(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));
    })().catch(error=>{if(!res.headersSent)res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {port:server.address().port,token,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await lab.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const config=process.argv[2]?JSON.parse(await readFile(resolve(process.argv[2]),'utf8')):{};
  const app=await serveLab(config);
  process.stdout.write(JSON.stringify({port:app.port,token:app.token,offline:true})+'\n');
  let closing=false;const close=async()=>{if(closing)return;closing=true;await app.close();};
  process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());process.stdin.resume();process.stdin.on('end',()=>void close());
}

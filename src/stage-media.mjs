import {createServer} from 'node:http';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

/** Signaling only. Camera/audio travel directly over encrypted WebRTC. */
export async function createStageMedia({token,iceServers=[],now=Date.now,maxViewers=2}={}){
  if(typeof token!=='string'||token.length<32||!Array.isArray(iceServers)||iceServers.length>8)throw new Error('Invalid stage media configuration');
  for(const server of iceServers){
    if(!Array.isArray(server.urls)||!server.urls.length||server.urls.length>4||server.urls.some(u=>typeof u!=='string'||u.length>500||!/^turns?:|^stun:/.test(u)))throw new Error('Invalid ICE service');
  }
  const peers=new Map(),commands=new Map();let controlEpoch=0,closed=false,lastSource=0,sourceState='starting',presentationVisible=false,presentationMode='seated',popup=null,caption=null,presentationNonce=null,rainPlayback=null;
  const stopAnimations=()=>{controlEpoch++;presentationVisible=false;popup=null;caption=null;presentationNonce=null;rainPlayback=null;for(const c of commands.values())c.finish(new Error('Animation stopped'));commands.clear();};
  const animate=({targets,id,signal})=>new Promise((resolve,reject)=>{
    const presentation=['make_it_rain','seated_response','presentation_end'].includes(id);
    const incensedCameraFlip=id==='flip_camera';
    const allowedMotion=/^m16_(conversation|directed_point|objection|open_explanation|quiet_listening|seated_listening)$/.test(id);
    if(!info().available||!Array.isArray(targets)||!targets.length||targets.length>2||
       new Set(targets).size!==targets.length||targets.some(a=>!['SHANNY','REV'].includes(a))||
       !(presentation||incensedCameraFlip||allowedMotion)||
       presentation&&targets.length!==2||
       // A finger at the audience is legal only while that SAME actor
       // audibly speaks in a visible seated donation/hotmic response.
       // It must never escape during full-body rain or after presentation_end.
       incensedCameraFlip&&(targets.length!==1||!presentationVisible||
         presentationMode!=='seated'||caption?.actor!==targets[0]))
      return reject(new Error('Animation unavailable'));
    if(commands.size||signal?.aborted)return reject(new Error('Animation command busy or cancelled'));
    const request=randomUUID(),abort=()=>stopAnimations();
    const timer=setTimeout(()=>{controlEpoch++;finish(new Error('Player did not acknowledge animation'));},2500);
    const finish=(error,result)=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);commands.delete(request);error?reject(error):resolve(result);};
    commands.set(request,{id:request,targets,alias:presentation||incensedCameraFlip?id:id.slice(4),finish});signal?.addEventListener('abort',abort,{once:true});
  });
  const sweep=()=>{for(const [id,p] of peers)if(now()-p.seen>15000)peers.delete(id);};
  const timer=setInterval(sweep,1000);timer.unref();
  const info=()=>({available:!closed&&lastSource>0&&now()-lastSource<5000&&sourceState==='ready',state:sourceState,
    width:1920,height:1080,fps:30,max_bitrate:12000000,
    presentation_visible:presentationVisible&&now()-lastSource<5000,presentation_mode:presentationMode,
    popup:presentationVisible&&now()-lastSource<5000?popup:null,
    caption:presentationVisible&&now()-lastSource<5000?caption:null,
    presentation_nonce:presentationVisible?presentationNonce:null,
    rain_audio:presentationVisible&&presentationMode==='rain'?rainPlayback?.state||'pending':null,
    obs_viewers:[...peers.values()].filter(p=>p.role==='obs'&&now()-p.seen<15000).length,
    transport:'WebRTC',relay_configured:iceServers.some(s=>s.urls.some(u=>/^turns?:/.test(u)))});
  function viewer(input){
    sweep();if(closed)throw new Error('Stage feed closed');
    if(input.action==='media-status')return info();
    if(input.action==='media-open'){
      if(!info().available)throw new Error('Stage camera is not ready');
      if(peers.size>=maxViewers)throw new Error('Stage viewer limit reached; close an unused preview');
      const id=randomUUID();peers.set(id,{id,seen:now(),offer:null,answer:null,error:null,
        role:input.viewer_role==='obs'?'obs':'preview',presentedNonce:null});
      if(input.viewer_role==='obs'&&rainPlayback)rainPlayback.hadObsViewer=true;
      return {id,iceServers,...info()};
    }
    const p=peers.get(input.id);if(!p)throw new Error('Stage connection expired; reconnect');
    if(input.action==='media-close'){peers.delete(p.id);return {closed:true};}
    p.seen=now();
    if(['media-presented','media-rain-started','media-rain-ended','media-rain-failed'].includes(input.action)){
      if(p.role!=='obs'||!presentationVisible||input.nonce!==presentationNonce)
        throw new Error('Stale or unauthorized OBS presentation receipt');
      if(input.action==='media-presented'){
        p.presentedNonce=input.nonce;
        if(rainPlayback?.nonce===input.nonce)rainPlayback.hadObsViewer=true;
        return {accepted:true};
      }
      if(presentationMode!=='rain'||!rainPlayback||rainPlayback.nonce!==input.nonce)
        throw new Error('Rain soundtrack is not active');
      // Never accept music receipts from a preview or an OBS peer that
      // never acknowledged the current visible/unmuted presentation.
      if(p.presentedNonce!==input.nonce)
        throw new Error('OBS presentation must be visible before rain receipt');
      if(input.action==='media-rain-started'){
        if(rainPlayback.state==='pending'){
          rainPlayback.state='playing';rainPlayback.startedAt=now();
        }
      }else if(input.action==='media-rain-ended'){
        if(rainPlayback.state!=='playing'&&rainPlayback.state!=='ended')
          throw new Error('Rain cannot finish before audio playback starts');
        if(rainPlayback.state==='playing'){
          rainPlayback.state='ended';rainPlayback.endedAt=now();
        }
      }else if(rainPlayback.state!=='ended'){
        rainPlayback.state='failed';
      }
      return {accepted:true,state:rainPlayback.state};
    }
    if(input.action==='media-offer'){
      if(p.offer||typeof input.sdp!=='string'||input.sdp.length>48000||!input.sdp.startsWith('v=0')||!/m=video /.test(input.sdp)||!/m=audio /.test(input.sdp))throw new Error('Invalid stage offer');
      p.offer=input.sdp;return {accepted:true};
    }
    if(input.action==='media-poll')return {answer:p.answer,error:p.error,...info()};
    throw new Error('Unsupported stage action');
  }
  const server=createServer((req,res)=>{void(async()=>{
    res.setHeader('Cache-Control','no-store');
    const auth=Buffer.from(String(req.headers.authorization||'')),expected=Buffer.from('Bearer '+token);
    if(auth.length!==expected.length||!timingSafeEqual(auth,expected)){res.writeHead(401);res.end();return;}
    if(req.method!=='POST'||!['/poll','/answer','/command-receipt'].includes(req.url)){res.writeHead(404);res.end();return;}
    const chunks=[];let bytes=0;
    for await(const chunk of req){bytes+=chunk.length;if(bytes>64000)throw new Error('Stage message too large');chunks.push(chunk);}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));let value;
    if(req.url==='/poll'){
      sweep();lastSource=now();sourceState=String(data.state||'ready').slice(0,120);
      value={peers:[...peers.values()].map(p=>({id:p.id,sdp:p.error?'':p.offer||''})),iceServers,
        control_epoch:controlEpoch,commands:[...commands.values()].map(({id,targets,alias})=>({id,targets,alias}))};
    }else if(req.url==='/command-receipt'){
      const c=commands.get(data.id);if(c){
        if(data.accepted===true&&['make_it_rain','seated_response','presentation_end'].includes(c.alias)){
          presentationVisible=c.alias!=='presentation_end';
          if(presentationVisible){
            presentationMode=c.alias==='make_it_rain'?'rain':'seated';
            presentationNonce=randomUUID();
            rainPlayback=presentationMode==='rain'
              ?{nonce:presentationNonce,state:'pending',startedAt:null,endedAt:null,
                hadObsViewer:[...peers.values()].some(p=>p.role==='obs'&&now()-p.seen<15000)}:null;
          }else{popup=null;caption=null;presentationNonce=null;rainPlayback=null;}
        }
        c.finish(data.accepted===true?null:new Error('Player could not prepare the requested performance'),{status:'accepted',kind:'M16_FITTED',targets:c.targets,duration_ms:Number.isSafeInteger(data.duration_ms)&&data.duration_ms>=20000&&data.duration_ms<=60000?data.duration_ms:20000});
      }
      value={received:Boolean(c)};
    }else{
      const p=peers.get(data.id);
      if(!p){res.writeHead(410);res.end();return;}
      if(data.error)p.error=String(data.error).slice(0,200);
      else if(typeof data.sdp==='string'&&data.sdp.startsWith('v=0')&&data.sdp.length<=48000)p.answer=data.sdp;
      else throw new Error('Invalid stage answer');
      value={accepted:true};
    }
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));
  })().catch(()=>{if(!res.headersSent)res.writeHead(400);res.end();});});
  server.requestTimeout=10000;server.headersTimeout=5000;server.maxConnections=8;
  await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
  return {url:'http://127.0.0.1:'+server.address().port,viewer,info,animate,stopAnimations,
    /**
     * Synchronize donor TTS to the real OBS audio ended event rather than
     * merely estimating the song length from the native stage command.
     * With no OBS viewer, local fixture mode reports an unverified fallback.
     * With an OBS viewer, actual completion is required before speech.
     */
    async waitForRainEnd({signal,timeoutMs=8000,requireViewer=false}={}){
      if(!presentationVisible||presentationMode!=='rain'||!rainPlayback)
        throw new Error('Rain music gate requires visible native rain');
      const nonce=presentationNonce;
      const obs=()=>[...peers.values()].some(p=>p.role==='obs'&&now()-p.seen<15000);
      if(!obs()){
        // A local-only fixture with NO viewer ever may use nominal timing.
        // A REAL paid donation or a viewer that vanished after showing the
        // rain MUST NOT pretend the music completed successfully.
        if(requireViewer||rainPlayback.hadObsViewer)
          throw new Error('OBS rain viewer unavailable; refusing unverified TTS');
        return {verified:false,reason:'no-obs-viewer'};
      }
      const deadline=Date.now()+timeoutMs;
      while(Date.now()<=deadline){
        if(signal?.aborted)throw signal.reason||new Error('Rain cancelled');
        if(!presentationVisible||presentationMode!=='rain'||presentationNonce!==nonce)
          throw new Error('Rain soundtrack was interrupted');
        if(!obs())throw new Error('OBS rain audio viewer disconnected');
        if(rainPlayback.state==='ended')return {verified:true,reason:'OBS-ENDED'};
        if(rainPlayback.state==='failed')throw new Error('OBS rain audio failed; refusing overlapping TTS');
        await delay(50,undefined,{signal});
      }
      throw new Error('OBS rain music did not finish; refusing overlapping TTS');
    },
    async waitForViewer({signal,timeoutMs=1700}={}){
      // The browser has to unmute and render the frame before first syllable.
      // No OBS viewer during producer-only tests: modest deterministic preroll.
      const nonce=presentationNonce;
      if(!presentationVisible||!nonce)return false;
      const hasObsViewer=[...peers.values()].some(p=>p.role==='obs'&&now()-p.seen<15000);
      if(!hasObsViewer){
        await delay(420,undefined,{signal});
        return false;
      }
      const deadline=Date.now()+timeoutMs;
      while(Date.now()<deadline){
        if(!presentationVisible||presentationNonce!==nonce)return false;
        if([...peers.values()].some(p=>p.role==='obs'&&p.presentedNonce===nonce))return true;
        await delay(50,undefined,{signal});
      }
      return false;
    },
    setCaption(line){
      if(!presentationVisible){caption=null;return;}
      if(line===null){caption=null;return;}
      if(!line||!['SHANNY','REV'].includes(line.actor)||
         typeof line.text!=='string'||!line.text.trim()||line.text.length>1000)
        throw new Error('Invalid character subtitle');
      // Only played Shanny/Rev lines; the producer's hotmic input and
      // private Qwen deliberation are never exposed in OBS.
      caption={actor:line.actor,text:line.text.trim()};
    },
    setPopup(details){
      if(presentationVisible||commands.size)throw new Error('Cannot change details during visible performance');
      if(details===null){popup=null;return;}
      if(!details||!['hotmic','donation','test','celebration','chat'].includes(details.type))
        throw new Error('Invalid public popup details');
      // Manual membership celebrations carry NO donor/payment identity.
      if(details.type==='celebration'){popup={type:'celebration'};return;}
      // Whitelist fields: no provider IDs, receipts, secrets or source objects.
      if(details.type==='hotmic'){popup={type:'hotmic'};return;}
      if(typeof details.message!=='string'||details.message.length>1000)
        throw new Error('Invalid public popup message');
      if(details.type==='test'){popup={type:'test',message:details.message};return;}
      if(details.type==='chat'){
        if(!details.message.trim()||details.message.length>450||
           typeof details.donor!=='string'||details.donor.length>60||
           /[\x00-\x1f\x7f]/.test(details.donor))
          throw new Error('Invalid public chat display fields');
        popup={type:'chat',donor:details.donor,message:details.message};
        return;
      }
      if(typeof details.donor!=='string'||details.donor.length>80||
         !Number.isFinite(details.amount)||details.amount<=0||
         typeof details.currency!=='string'||!/^[A-Z]{3}$/.test(details.currency))
        throw new Error('Invalid public donor display fields');
      popup={type:'donation',donor:details.donor,amount:details.amount,
        currency:details.currency,message:details.message};
    },
    async close(){closed=true;stopAnimations();peers.clear();clearInterval(timer);server.closeAllConnections();await new Promise(r=>server.close(r));}};
}

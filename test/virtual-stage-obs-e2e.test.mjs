import test from 'node:test';
import assert from 'node:assert/strict';
import {createStageMedia} from '../src/stage-media.mjs';
import {ConversationSession} from '../src/conversation-session.mjs';

const token='virtual-obs-handoff-acceptance-key'.repeat(3);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=2400){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){
  if(fn())return;
  await delay(12);
 }
 throw new Error('Virtual OBS missing transition: '+label);
}

test('FULL simulated paid $100: Unity rain -> OBS played/ended -> seated camera -> authentic TTS -> both replies -> idle',async t=>{
 const media=await createStageMedia({token});
 const log=[],released=[],clips=new Map();
 let epoch=0,muted=true,cursor=0;
 const events=[];
 const emit=(type,id)=>events.push({type,id,epoch,session_id:'virtual-stage',
  seq:++cursor,timestamp_unix_ms:Date.now()});
 const gateway={
  async panic(){epoch++;muted=true;emit('panic');},
  async resume(){muted=false;emit('resume');},
  async status(){return {session_id:'virtual-stage',epoch,muted,cursor};},
  async events({after}){return {session_id:'virtual-stage',epoch,muted,cursor,
    events:events.filter(e=>e.seq>after)};},
  async speak(row){
    const id='clip-'+(clips.size+1);clips.set(id,row);
    assert.equal(row.prepare_only,true);
    emit('speech.prepared',id);return {request_id:id};
  },
  async release({id}){
    assert.equal(media.info().presentation_mode,'seated');
    assert.equal(media.info().rain_audio,null);
    assert.ok(log.includes('OBS-ended'),'no donor speech before verified music end');
    assert.ok(log.includes('native-seated_response'),'no donor speech before accepted chair command');
    released.push(id);emit('playback.started',id);emit('playback.finished',id);
    return {status:'released'};
  }
 };
 const director={async generate(){log.push('Qwen-started');return {lines:[
  {actor:'SHANNY',mood:'rage',text:'Chat, quit acting entitled to my money!'},
  {actor:'REV',mood:'irritated',text:'You viewers keep demanding more and more!'}
 ],rev_reason:'Rev rejects donor demands'};}};
 let pumping=false;
 const post=async(path,body)=>{
  const response=await fetch(media.url+path,{method:'POST',headers:{
   Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(body)});
  if(!response.ok)throw new Error('Mock Unity poll HTTP '+response.status);
  return response.json();
 };
 await post('/poll',{state:'ready'});
 const native=new Set();
 const timer=setInterval(()=>{
  if(pumping)return;pumping=true;
  void(async()=>{
    const poll=await post('/poll',{state:'ready'});
    for(const row of poll.commands){
      if(native.has(row.id))continue;
      native.add(row.id);log.push('native-'+row.alias);
      await post('/command-receipt',{id:row.id,accepted:true,duration_ms:20000});
    }
  })().catch(error=>{log.push('PUMP_ERROR:'+error.message);}).finally(()=>{pumping=false;});
 },16);
 t.after(async()=>{clearInterval(timer);await media.close();});
 const obs=media.viewer({action:'media-open',viewer_role:'obs'});
 const presentation={
  begin({rain,popup,signal}){
   media.setPopup(popup);
   return media.animate({id:rain?'make_it_rain':'seated_response',
    targets:['SHANNY','REV'],signal});
  },
  seat:({signal})=>media.animate({id:'seated_response',targets:['SHANNY','REV'],signal}),
  end:({signal})=>media.animate({id:'presentation_end',targets:['SHANNY','REV'],signal}),
  waitVisible({signal}){return media.waitForViewer({signal,timeoutMs:1100});},
  async waitRainEnd({signal,requireViewer}){
   log.push('audio-wait');
   const result=await media.waitForRainEnd({signal,requireViewer,timeoutMs:1300});
   assert.equal(result.verified,true);log.push('OBS-ended');
   return result;
  },
  stop(){media.stopAnimations();}
 };
 const session=new ConversationSession({gateway,director,presentation,
  onChange:evt=>{
   if(evt.type==='line.started')media.setCaption({actor:evt.actor,text:evt.text});
   if(evt.type==='line.finished')media.setCaption(null);
  },pause:async()=>{log.push('nominal-23.9s-window');}});
 t.after(()=>session.stop());
 await session.initialize();const scope=await session.arm();
 const response=await session.submit({
  kind:'donation',make_it_rain:true,text:'Give me a show!',
  donation:{provider:'streamlabs',donor:'WHALE',amount:100,currency:'USD'},...scope
 });
 assert.equal(response.status,'accepted');
 await until(()=>media.info().presentation_mode==='rain'&&media.info().presentation_visible,
  'native rain stage');
 const rain=media.info(),nonce=rain.presentation_nonce;
 assert.deepEqual(rain.popup,{type:'donation',donor:'WHALE',amount:100,currency:'USD',message:'Give me a show!'});
 assert.deepEqual(media.viewer({action:'media-presented',id:obs.id,nonce}),{accepted:true});
 media.viewer({action:'media-rain-started',id:obs.id,nonce});
 await until(()=>log.includes('audio-wait'),'actual music gate');
 assert.equal(released.length,0);
 assert.ok(log.indexOf('native-make_it_rain')<log.indexOf('Qwen-started')||
  log.includes('native-make_it_rain'),'rain native command was admitted');
 media.viewer({action:'media-rain-ended',id:obs.id,nonce});
 await until(()=>media.info().presentation_mode==='seated','native chair return');
 const desk=media.info();
 assert.notEqual(desk.presentation_nonce,nonce);
 assert.equal(desk.popup.donor,'WHALE');
 media.viewer({action:'media-presented',id:obs.id,nonce:desk.presentation_nonce});
 await until(()=>released.length===3,'verbatim donor read and both replies');
 await until(()=>media.info().presentation_visible===false,'native hide after last speech');
 assert.ok(log.indexOf('OBS-ended')<log.indexOf('native-seated_response'));
 assert.deepEqual([...clips.values()].map(x=>x.text),[
  'Give me a show!','Chat, quit acting entitled to my money!',
  'You viewers keep demanding more and more!']);
 assert.equal(media.info().popup,null);
 assert.equal(media.info().caption,null);
 assert.deepEqual(log.filter(x=>x.startsWith('PUMP_ERROR')),[]);
});

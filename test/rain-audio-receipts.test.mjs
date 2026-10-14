import test from 'node:test';
import assert from 'node:assert/strict';
import {createStageMedia} from '../src/stage-media.mjs';

const token='offline-rain-music-gate-test-secret'.repeat(3);
async function fixture(t){
 const stage=await createStageMedia({token});
 t.after(()=>stage.close());
 const post=async (route,body)=>{
  const reply=await fetch(stage.url+route,{method:'POST',headers:{
   Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(body)});
  assert.equal(reply.status,200,route);
  return reply.json();
 };
 await post('/poll',{state:'ready'});
 const command=async alias=>{
  const pending=stage.animate({id:alias,targets:['SHANNY','REV']});
  const page=await post('/poll',{state:'ready'});
  const row=page.commands.find(x=>x.alias===alias);
  assert.ok(row,'expected native '+alias+' to be forwarded');
  await post('/command-receipt',{id:row.id,accepted:true});
  await pending;
 };
 return {stage,post,command};
}

test('only current authorized OBS may attest playing and actual ending, then chair handoff is safe',async t=>{
 const {stage,command}=await fixture(t);
 const obs=stage.viewer({action:'media-open',viewer_role:'obs'});
 const preview=stage.viewer({action:'media-open',viewer_role:'preview'});
 stage.setPopup({type:'donation',donor:'WHALE',amount:100,currency:'USD',message:'This is a real donation'});
 await command('make_it_rain');
 const nonce=stage.info().presentation_nonce;
 assert.equal(stage.info().presentation_mode,'rain');
 assert.equal(stage.info().rain_audio,'pending');
 const receipt=(who,action,number=nonce)=>stage.viewer({action,id:who.id,nonce:number});
 assert.throws(()=>receipt(preview,'media-rain-started'),/unauthorized/);
 assert.throws(()=>receipt(obs,'media-rain-started'),/visible/);
 assert.throws(()=>receipt(obs,'media-rain-ended'),/visible/);
 assert.deepEqual(receipt(obs,'media-presented'),{accepted:true});
 assert.throws(()=>receipt(obs,'media-rain-ended'),/before audio playback/);
 assert.deepEqual(receipt(obs,'media-rain-started'),{accepted:true,state:'playing'});
 assert.equal(stage.info().rain_audio,'playing');
 assert.equal(receipt(obs,'media-rain-started').state,'playing');
 assert.deepEqual(receipt(obs,'media-rain-ended'),{accepted:true,state:'ended'});
 assert.equal(stage.info().rain_audio,'ended');
 assert.deepEqual(await stage.waitForRainEnd({timeoutMs:150}),{verified:true,reason:'OBS-ENDED'});
 const prior=stage.info().popup;
 await command('seated_response');
 assert.equal(stage.info().rain_audio,null);
 assert.equal(stage.info().presentation_mode,'seated');
 assert.deepEqual(stage.info().popup,prior);
 assert.throws(()=>receipt(obs,'media-rain-started'),/Stale/);
 assert.throws(()=>receipt(obs,'media-rain-ended'),/Stale/);
 await assert.rejects(stage.waitForRainEnd({timeoutMs:100}),/visible native rain/);
 await command('presentation_end');
 assert.equal(stage.info().presentation_visible,false);
});

test('OBS missing sound, rejected media, or interruption never marks a cue completed',async t=>{
 const {stage,command}=await fixture(t);
 const obs=stage.viewer({action:'media-open',viewer_role:'obs'});
 stage.setPopup({type:'hotmic'});
 await command('make_it_rain');
 const nonce=stage.info().presentation_nonce;
 const receipt=(action)=>stage.viewer({action,id:obs.id,nonce});
 receipt('media-presented');
 await assert.rejects(stage.waitForRainEnd({timeoutMs:140}),/did not finish/);
 receipt('media-rain-failed');
 assert.equal(stage.info().rain_audio,'failed');
 await assert.rejects(stage.waitForRainEnd({timeoutMs:100}),/audio failed/);
 stage.stopAnimations();
 assert.throws(()=>receipt('media-rain-ended'),/Stale/);
 assert.equal(stage.info().presentation_visible,false);
 assert.equal(stage.info().rain_audio,null);
});

test('no OBS viewer allows documented local-only unverified timing fallback',async t=>{
 const {stage,command}=await fixture(t);
 stage.setPopup({type:'test',message:'Local rehearsal without OBS'});
 await command('make_it_rain');
 const result=await stage.waitForRainEnd({timeoutMs:100});
 assert.deepEqual(result,{verified:false,reason:'no-obs-viewer'});
 assert.equal(stage.info().rain_audio,'pending');
 await command('presentation_end');
});

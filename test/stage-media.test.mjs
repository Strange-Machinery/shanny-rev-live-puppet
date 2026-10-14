import test from 'node:test';
import assert from 'node:assert/strict';
import {createStageMedia} from '../src/stage-media.mjs';
const token='test-stage-token-'.repeat(4),sdp='v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
async function setup(t){let clock=1000;const stage=await createStageMedia({token,now:()=>clock});t.after(()=>stage.close());return {stage,advance:n=>clock+=n,source:(route,body,auth=token)=>fetch(stage.url+route,{method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},body:JSON.stringify(body)})};}
test('stage requires authenticated camera and expires source readiness and viewer leases',async t=>{
 const {stage,source,advance}=await setup(t);
 assert.throws(()=>stage.viewer({action:'media-open'}),/not ready/);
 assert.equal((await source('/poll',{},'wrong')).status,401);
 await source('/poll',{state:'ready'});const a=stage.viewer({action:'media-open'}),b=stage.viewer({action:'media-open'});
 assert.throws(()=>stage.viewer({action:'media-open'}),/limit/);
 stage.viewer({action:'media-close',id:b.id});advance(5001);assert.equal(stage.info().available,false);
 advance(10000);assert.throws(()=>stage.viewer({action:'media-poll',id:a.id}),/expired/);
 await source('/poll',{});assert.ok(stage.viewer({action:'media-open'}).id);
});
test('stage signaling exchanges bounded offers/answers without accepting duplicate or oversized offers',async t=>{
 const {stage,source}=await setup(t);await source('/poll',{});const {id}=stage.viewer({action:'media-open'});
 assert.throws(()=>stage.viewer({action:'media-offer',id,sdp:'v=0'}),/Invalid/);
 assert.throws(()=>stage.viewer({action:'media-offer',id,sdp:sdp+'x'.repeat(48000)}),/Invalid/);
 stage.viewer({action:'media-offer',id,sdp});assert.throws(()=>stage.viewer({action:'media-offer',id,sdp}),/Invalid/);
 const poll=await (await source('/poll',{})).json();assert.deepEqual(poll.peers,[{id,sdp}]);
 assert.equal((await source('/answer',{id,sdp})).status,200);assert.equal(stage.viewer({action:'media-poll',id}).answer,sdp);
 stage.viewer({action:'media-close',id});assert.equal((await source('/answer',{id,sdp})).status,410);
});

test('manual Both motion is one acknowledged command; Stop cancels it and advances player epoch',async t=>{
 const {stage,source}=await setup(t);await source('/poll',{});
 const request={targets:['SHANNY','REV'],id:'m16_objection'};
 const promise=stage.animate(request);const poll=await (await source('/poll',{})).json();
 assert.deepEqual(poll.commands[0].targets,request.targets);assert.equal(poll.commands[0].alias,'objection');
 await source('/command-receipt',{id:poll.commands[0].id,accepted:true});assert.equal((await promise).status,'accepted');
 const abort=new AbortController(),pending=stage.animate({...request,signal:abort.signal});
 const cancelled=assert.rejects(pending,/stopped/);abort.abort();await cancelled;
 const after=await (await source('/poll',{})).json();assert.equal(after.commands.length,0);assert.ok(after.control_epoch>poll.control_epoch);
 await assert.rejects(stage.animate({...request,id:'rage'}),/unavailable/);
});

test('OBS popup is exposed only after the paired player acknowledges and is hidden on end or Stop',async t=>{
 const {stage,source}=await setup(t);await source('/poll',{});
 assert.equal(stage.info().presentation_visible,false);
 for(const id of ['make_it_rain','presentation_end','seated_response']){
  const pending=stage.animate({id,targets:['SHANNY','REV']});assert.equal(stage.info().presentation_visible,id==='presentation_end');
  const poll=await (await source('/poll',{})).json();assert.equal(poll.commands[0].alias,id);
  await source('/command-receipt',{id:poll.commands[0].id,accepted:true});await pending;
  assert.equal(stage.info().presentation_visible,id!=='presentation_end');
 }
 stage.stopAnimations();assert.equal(stage.info().presentation_visible,false);
 await assert.rejects(stage.animate({id:'make_it_rain',targets:['REV']}),/unavailable/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { ShowController, EpisodeJobs } from '../src/show-controller.mjs';
import { adapters, flush } from './helpers/show-fixture.mjs';
function rig() {
  const installed=adapters();const trace=installed.trace;let epoch=0;
  const gateway={panic:async()=>{trace.push('gateway.panic');epoch++;},status:async()=>({session_id:'s',epoch,muted:true,cursor:0}),resume:async()=>trace.push('gateway.resume')};
  const coordinator={start:()=>trace.push('coordinator.start'),stop:()=>trace.push('coordinator.stop')};
  const controller=new ShowController({gateway,coordinator,...installed,timeoutMs:40});
  return {controller,installed,trace,gateway};
}
test('concurrent live and stop requests preserve actual playhead and resume exactly once',async()=>{
  const f=rig();const a=f.controller.live(),b=f.controller.live();assert.equal(a,b);await a;
  const stop=f.controller.stopAndResume();assert.equal(f.controller.mode,'stopping');
  assert.ok(f.trace.lastIndexOf('local.stop.both') < f.trace.lastIndexOf('gateway.panic')); assert.equal(stop,f.controller.stopAndResume());await stop;
  await f.controller.stopAndResume();assert.equal(f.trace.filter(x=>x==='episode.resume').length,1);
  assert.equal(f.controller.mode,'show');assert.equal(f.controller.microphoneEnabled,false);
});
test('stop during pending pause prevents gateway/stage resume and restores retained playhead',async()=>{
  const f=rig();let resolve;
  f.installed.player.pause=()=>new Promise(r=>{resolve=r;});
  const enabling=f.controller.live();await flush();const stopped=f.controller.stopAndResume();
  resolve({playback_id:'episode',position_ms:99123});await assert.rejects(enabling,/cancelled/);await stopped;
  assert.equal(f.trace.includes('gateway.resume'),false);assert.equal(f.trace.includes('stage.resume'),false);
  assert.equal(f.trace.filter(x=>x==='episode.resume').length,1);
});
test('missing or timed-out stage stop acknowledgement keeps episode paused',async()=>{
  const f=rig();await f.controller.live();f.installed.stage.confirmStopped=async()=>false;
  await assert.rejects(f.controller.stopAndResume(),/acknowledge/);
  assert.equal(f.controller.mode,'stop_pending');assert.equal(f.controller.paused.position_ms,123456);
  assert.equal(f.trace.includes('episode.resume'),false);
  f.installed.stage.confirmStopped=async()=>true;await f.controller.stopAndResume();
  assert.equal(f.trace.filter(x=>x==='episode.resume').length,1);
});
test('lost resume response retries with same transition ID and cannot replay episode',async()=>{
  const f=rig();const resume=f.installed.player.resume;let lose=true;
  f.installed.player.resume=async token=>{const ack=await resume(token);if(lose){lose=false;throw new Error('lost response');}return ack;};
  await f.controller.live();await assert.rejects(f.controller.stopAndResume(),/lost/);await f.controller.stopAndResume();
  assert.equal(f.trace.filter(x=>x==='episode.resume').length,1);
});
test('unaccepted adapters cannot advertise live or microphone capability',async()=>{
  const f=rig();f.installed.player.accepted=false;
  await assert.rejects(f.controller.live(),/unavailable/);assert.equal(f.controller.snapshot().live_available,false);
  assert.equal(f.controller.snapshot().microphone_enabled,false);
});
test('late pause timeout remains unresolved until an actual playhead arrives',async()=>{
  const f=rig();let resolve;f.installed.player.pause=()=>new Promise(r=>{resolve=r;});
  await assert.rejects(f.controller.live(),/timed out/);
  await assert.rejects(f.controller.stopAndResume(),/unknown/);assert.equal(f.trace.includes('episode.resume'),false);
  resolve({playback_id:'late',position_ms:77});await flush();await f.controller.stopAndResume();assert.equal(f.controller.mode,'show');
});
test('episode job status verifies private origin, checksum, expiry and retry',async()=>{
  let state='generating';let verified=true;let expires=200;let origin='https://private.example';let calls=0;
  const service={accepted:true,request:async()=>({job_id:'j'+(++calls)}),retry:async()=>({job_id:'j'+(++calls)}),
    status:async id=>({job_id:id,state,download_url:origin+'/signed',expires_unix_ms:expires,sha256:'a'.repeat(64),private:true}),verifyDelivery:async()=>verified};
  const jobs=new EpisodeJobs({service,deliveryOrigins:[origin],now:()=>100});
  assert.equal((await jobs.request('topic','request1')).job_id,'j1');await jobs.request('topic','request1');assert.equal(calls,1);
  assert.equal((await jobs.poll('j1')).state,'generating');state='ready';assert.equal((await jobs.poll('j1')).download_url,origin+'/signed');
  verified=false;await assert.rejects(jobs.poll('j1'),/verified/);verified=true;origin='https://evil.example';await assert.rejects(jobs.poll('j1'),/verified/);
  origin='https://private.example';expires=99;assert.equal((await jobs.poll('j1')).state,'expired');
  assert.equal((await jobs.retry('j1','retry1')).job_id,'j2');state='failed';assert.equal((await jobs.poll('j2')).retry_available,true);
});

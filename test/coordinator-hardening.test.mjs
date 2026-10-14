import test from 'node:test';
import assert from 'node:assert/strict';
import { DonationReactionCoordinator } from '../src/donations/coordinator.mjs';
import { flush } from './helpers/show-fixture.mjs';
const draft={actor:'SHANNY',text:'A fixture reaction.',emotion:'neutral',intensity:.5};
function rig({speak,generate,now=Date.now}={}) {
  const releases=[],discards=[],errors=[];let id=0;
  const gateway={speak:speak|| (async()=>({request_id:'id'+(++id)})),release:async data=>{releases.push(data);},discard:async data=>{discards.push(data);}};
  const flow=new DonationReactionCoordinator({gateway,director:{generate:generate|| (async()=>draft)},now,onError:e=>errors.push(e)});
  flow.start({session_id:'s',epoch:4,mode_epoch:8});
  const admit=()=>flow.admit({session_id:'s',mode_epoch:8,donation_id:'d',text:'Hi'});
  const event=(type,id,extra={})=>({type,id,session_id:'s',epoch:4,...extra});
  return {flow,releases,discards,errors,admit,event};
}
test('new-epoch panic and interrupt invalidate before old-epoch filtering',async()=>{
  for(const type of ['panic','interrupt']) {
    const f=rig();const a=await f.admit();f.flow.onEvent(f.event('playback.started',a.read_id));await flush();
    f.flow.onEvent(f.event(type,undefined,{epoch:5}));
    f.flow.onEvent(f.event('speech.prepared','id2',{duration_ms:10000}));
    f.flow.onEvent(f.event('playback.finished',a.read_id));await flush();
    assert.equal(f.flow.active,false);assert.equal(f.releases.length,0);assert.equal(f.discards.length,1);
  }
});
test('fast start/prepared/finish events arriving before HTTP responses are replayed once',async()=>{
  let f;let id=0;
  f=rig({speak:async data=>{
    const request_id='id'+(++id);
    if(data.prepare_only)f.flow.onEvent(f.event('speech.prepared',request_id,{duration_ms:10000,seq:3}));
    else {
      f.flow.onEvent(f.event('playback.started',request_id,{seq:1}));
      f.flow.onEvent(f.event('playback.finished',request_id,{seq:2}));
    }
    return {request_id};
  }});
  await f.admit();await flush();assert.equal(f.releases.length,1);assert.equal(f.releases[0].epoch,4);
});
test('stale prepared acknowledgement discards using original session after restart',async()=>{
  let resolve;let id=0;
  const f=rig({speak:async()=>++id===1?{request_id:'read'}:new Promise(r=>{resolve=r;})});
  await f.admit(); f.flow.onEvent(f.event('playback.started','read'));await flush();
  f.flow.start({session_id:'new',epoch:9,mode_epoch:10});resolve({request_id:'held'});await flush();
  assert.deepEqual(f.discards[0],{id:'held',session_id:'s',epoch:4});assert.equal(f.releases.length,0);
});
test('expiry is checked again after asynchronous Qwen completion',async()=>{
  let time=0,resolve;
  const f=rig({now:()=>time,generate:()=>new Promise(r=>{resolve=r;})});
  const a=await f.admit();f.flow.onEvent(f.event('playback.started',a.read_id));time=45001;resolve(draft);await flush();
  assert.equal(f.flow.pending,0);assert.equal(f.flow.metrics().outcomes.expired,1);assert.equal(f.discards.length,0);
});
test('overlapping actor speech cancels reaction and rejects a subsequent finish',async()=>{
  const f=rig();const a=await f.admit();f.flow.onEvent(f.event('playback.started',a.read_id));await flush();
  f.flow.onEvent(f.event('playback.started','unrelated-rev'));f.flow.onEvent(f.event('playback.finished',a.read_id));
  f.flow.onEvent(f.event('speech.prepared','id2',{duration_ms:10000}));await flush();
  assert.equal(f.releases.length,0);assert.equal(f.flow.metrics().outcomes.overlap,1);
});
test('duplicate receipts and synthesis failures cannot leak pending reads',async()=>{
  const f=rig();const a=await f.admit();
  f.flow.onEvent(f.event('playback.started',a.read_id,{seq:1}));f.flow.onEvent(f.event('playback.started',a.read_id,{seq:1}));await flush();
  f.flow.onEvent(f.event('speech.failed','id2',{seq:2}));await flush();
  assert.equal(f.flow.pending,0);assert.equal(f.discards.length,1);
});
test('capacity counts concurrent read submissions before HTTP acknowledgement',async()=>{
  const pending=[];const f=rig({speak:()=>new Promise(r=>pending.push(r))});
  f.flow.admission.maxPerMinute=100;
  const tasks=Array.from({length:32},(_,i)=>f.flow.admit({session_id:'s',mode_epoch:8,donation_id:'d'+i,text:'Hi'}));
  assert.equal((await f.flow.admit({session_id:'s',mode_epoch:8,donation_id:'overflow',text:'Hi'})).status,'busy');
  f.flow.stop();pending.forEach((r,i)=>r({request_id:'read'+i}));await Promise.all(tasks);
  assert.equal(f.flow.pending,0);
});

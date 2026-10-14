import test from 'node:test';
import assert from 'node:assert/strict';
import { showFixture, wav } from './helpers/show-fixture.mjs';

test('held audio cannot fetch or acknowledge playback; guarded release waits for actual donation finish',async()=>{
  const f=await showFixture();
  try {
    const scope=await f.gateway.status();await f.gateway.resume();
    const r=await f.gateway.speak({actor:'SHANNY',text:'donation'});const read=await f.until('speech.ready',r.request_id);
    const p=await f.gateway.speak({actor:'SHANNY',text:'Fixture reaction text',prepare_only:true});const prepared=await f.until('speech.prepared',p.request_id);
    assert.equal((await f.ack(prepared,'started')).status,409);
    const release={id:p.request_id,after_read_id:r.request_id,session_id:scope.session_id,epoch:scope.epoch};
    await assert.rejects(f.gateway.release(release),/409/);await f.ack(read,'started');await assert.rejects(f.gateway.release(release),/409/);
    await f.ack(read,'finished');assert.equal((await f.gateway.release(release)).status,'released');
    await f.ack(prepared,'started');await f.ack(prepared,'finished');assert.equal((await f.ack(prepared,'started')).status,409);
  } finally {await f.close();}
});
test('held metadata cache is bounded and TTL purge occurs without new synthesis',async()=>{
  let time=100000;const f=await showFixture({now:()=>time,provider:{generate:async()=>wav(100)}});
  try {
    await f.gateway.resume();
    for(let i=0;i<24;i++) {
      const p=await f.gateway.speak({actor:'REV',text:'held',prepare_only:true});await f.until('speech.prepared',p.request_id);
    }
    const before=await f.gateway.metrics();assert.equal(before.prepared_entries,20);assert.equal(before.clip_count,20);assert.ok(before.job_count<=256);
    time+=60000;const after=await f.gateway.metrics();assert.equal(after.prepared_entries,0);assert.equal(after.clip_count,0);
  } finally {await f.close();}
});
test('stale scoped speak and resume cannot race a newer panic',async()=>{
  const f=await showFixture();
  try {
    const old=await f.gateway.status();await f.gateway.panic();
    await assert.rejects(f.gateway.resume({session_id:old.session_id,epoch:old.epoch}),/409/);
    await assert.rejects(f.gateway.speak({actor:'SHANNY',text:'stale',session_id:old.session_id,epoch:old.epoch}),/409/);
    assert.equal((await f.gateway.status()).muted,true);
  } finally {await f.close();}
});

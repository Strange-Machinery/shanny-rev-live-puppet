import test from 'node:test';
import assert from 'node:assert/strict';
import { DonationReactionCoordinator } from '../src/donations/coordinator.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const draft = (actor='SHANNY') => ({actor,text:'That is absolutely not what happened, Buff!',
  emotion:'defensive',intensity:0.6});

function rig(director = {generate:async ({actor})=>draft(actor)}) {
  const seen = { speak:[], release:[], discard:[], errors:[] };
  const gateway = {
    speak: async data => {seen.speak.push(data);return {request_id:'id'+seen.speak.length};},
    release: async data => {seen.release.push(data);return {status:'released'};},
    discard: async data => {seen.discard.push(data);return {status:'discarded'};}
  };
  const flow = new DonationReactionCoordinator({
    gateway, director, onError: error => seen.errors.push(error)
  });
  flow.start({session_id:'session-one',epoch:4,mode_epoch:8});
  const event=(type,id,meta={})=>({type,id,session_id:'session-one',epoch:4,...meta});
  return { flow, seen, event };
}

test('Qwen reaction prepares during donation and releases only after finished receipt', async () => {
  const {flow,seen,event}=rig();
  const accepted = await flow.admit({
    session_id:'session-one',mode_epoch:8,donation_id:'d1',
    text:'(rev) Buff, tell Shanny she interrupted me'
  });
  assert.equal(accepted.reader,'REV');
  assert.equal(seen.speak[0].actor,'REV');
  flow.onEvent(event('playback.started',accepted.read_id));
  await flush();
  assert.equal(seen.speak.length,2);
  assert.equal(seen.speak[1].prepare_only,true);
  assert.equal(seen.speak[1].actor,'REV');
  flow.onEvent(event('speech.prepared','id2',{duration_ms:10_100}));
  await flush();
  assert.equal(seen.release.length,0);
  flow.onEvent(event('playback.finished',accepted.read_id));
  await flush();
  assert.equal(seen.release.length,1);
  assert.equal(seen.release[0].id,'id2');
  flow.onEvent(event('playback.finished',accepted.read_id));
  await flush();
  assert.equal(seen.release.length,1);
  assert.equal(flow.pending,0);
});

test('late prepared reaction releases after finished, never before', async () => {
  const {flow,seen,event}=rig();
  const accepted=await flow.admit({session_id:'session-one',mode_epoch:8,
    donation_id:'d2',text:'Hi Buff'});
  flow.onEvent(event('playback.started',accepted.read_id));
  await flush();
  flow.onEvent(event('playback.finished',accepted.read_id));
  await flush();
  assert.equal(seen.release.length,0);
  flow.onEvent(event('speech.prepared','id2',{duration_ms:9000}));
  await flush();
  assert.equal(seen.release.length,1);
});

test('wrong-epoch and stale Qwen never trigger prepared speech', async () => {
  let resolve;
  const gated = new Promise(r=>{resolve=r;});
  const {flow,seen,event}=rig({generate:async ()=>gated});
  const accepted=await flow.admit({session_id:'session-one',mode_epoch:8,
    donation_id:'d3',text:'Hello'});
  flow.onEvent(event('playback.started',accepted.read_id));
  flow.onEvent({ ...event('playback.finished',accepted.read_id),epoch:5 });
  flow.stop();
  resolve(draft());
  await flush();
  assert.equal(seen.speak.length,1);
  assert.equal(seen.release.length,0);
});

test('invalid generated duration is discarded and never released', async () => {
  const {flow,seen,event}=rig();
  const accepted=await flow.admit({session_id:'session-one',mode_epoch:8,
    donation_id:'d4',text:'Hey'});
  flow.onEvent(event('playback.started',accepted.read_id));
  await flush();
  flow.onEvent(event('speech.prepared','id2',{duration_ms:5600}));
  flow.onEvent(event('playback.finished',accepted.read_id));
  await flush();
  assert.equal(seen.release.length,0);
  assert.equal(seen.discard.length,1);
});

test('donation de-duplication and per-mode ingress gate', async () => {
  const {flow,seen}=rig();
  assert.equal((await flow.admit({
    session_id:'wrong',mode_epoch:8,donation_id:'d5',text:'Hi'
  })).status,'stale');
  assert.equal((await flow.admit({
    session_id:'session-one',mode_epoch:8,donation_id:'d5',text:'Hi'
  })).status,'accepted');
  assert.equal((await flow.admit({
    session_id:'session-one',mode_epoch:8,donation_id:'d5',text:'Hi'
  })).status,'duplicate');
  assert.equal(seen.speak.length,1);
});

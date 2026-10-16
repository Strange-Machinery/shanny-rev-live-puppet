import test from 'node:test';
import assert from 'node:assert/strict';
import {planBlackoutLiveV01,decorateBlackoutLiveV01,withBlackoutLiveV01} from '../src/blackout-live-v01.mjs';
import {createQwenFailover} from '../src/providers/qwen-failover.mjs';

const turn=(first='SHANNY',lane='direct_attack',input='Shanny, why are you blaming Rev?')=>({
  kind:'donation',input,first_speaker:first,second_speaker:first==='SHANNY'?'REV':'SHANNY',
  shanny_blackout:{regime:'HIGH_PRESSURE',emotional_lane:lane,
    acting_objective:'Respond to this comment, not a prior topic.'},
  contextual_grievance_hooks:[],recent_played_lines:[]
});
const messages=(payload=turn())=>[
  {role:'system',content:'Existing identity lock; obey qualified voice and topic checks.'},
  {role:'user',content:JSON.stringify(payload)}
];

test('V620 v0.1 yields exactly two required causal beats and one optional earned return',()=>{
  const arc=planBlackoutLiveV01(turn());
  assert.equal(arc.version,'blackout_live_v01');
  assert.deepEqual(arc.beats.map(b=>b.slot),['first_SHANNY','second_REV','third_SHANNY']);
  assert.equal(arc.beats[2].optional,true);
  assert.match(arc.beats[2].objective,/Rev changes the emotional stakes/);
  assert.doesNotMatch(JSON.stringify(arc),/bucket|sandwich|food|old clips/i);
});
test('Rev-directed remarks preserve Rev-first acting and Shanny has a distinct second role',()=>{
  const arc=planBlackoutLiveV01(turn('REV','wounded_victim','Rev, why blame Shanny?'));
  assert.deepEqual(arc.beats.map(b=>b.slot),['first_REV','second_SHANNY','third_REV']);
  assert.match(arc.beats[0].objective,/Rev addresses the viewer/);
  assert.match(arc.beats[1].objective,/was not necessarily addressed/);
});
test('all preexisting blackout emotional lanes retain distinct, grounded pivots',()=>{
  const lines=new Set();
  for(const lane of ['direct_attack','disgust_contempt','wounded_victim','insular_crying','contained_blackout']){
    const arc=planBlackoutLiveV01(turn('SHANNY',lane));
    lines.add(arc.beats[2].objective);
    assert.doesNotMatch(arc.beats[2].objective,/must (cry|swear|rage)/i);
  }
  assert.equal(lines.size,5);
});
test('identical input yields identical director output without memory, timers or additional classification',()=>{
  const sample=turn('REV','insular_crying');
  assert.deepEqual(planBlackoutLiveV01(sample),planBlackoutLiveV01(structuredClone(sample)));
});
test('V620 prompt is decorated but original MSI fallback messages remain byte-for-byte unchanged',()=>{
  const base=messages();const saved=JSON.stringify(base);
  const v620=decorateBlackoutLiveV01(base);
  assert.equal(JSON.stringify(base),saved);
  assert.notEqual(v620,base);
  assert.match(v620[0].content,/BLACKOUT_LIVE v0\.1/);
  assert.equal(JSON.parse(v620[1].content).input,turn().input);
  assert.deepEqual(JSON.parse(v620[1].content).blackout_live_v01.beats.map(x=>x.slot),
    ['first_SHANNY','second_REV','third_SHANNY']);
  assert.equal(JSON.parse(base[1].content).blackout_live_v01,undefined);
});
test('non-JSON silent warmup is passed through without changing the ready schema',()=>{
  const warmup=[{role:'system',content:'Be ready'},
    {role:'user',content:'Silent startup check: return only {"ready":true}.'}];
  assert.equal(decorateBlackoutLiveV01(warmup),warmup);
});
test('invalid actor, lane, forged direction or budget overflow fails closed',()=>{
  assert.throws(()=>planBlackoutLiveV01({...turn(),second_speaker:'SHANNY'}),/Invalid BLACKOUT_LIVE/);
  assert.throws(()=>planBlackoutLiveV01(turn('REV','made-up')), /Invalid BLACKOUT_LIVE/);
  assert.throws(()=>decorateBlackoutLiveV01(messages({...turn(),blackout_live_v01:{}})),/already present/);
  assert.throws(()=>decorateBlackoutLiveV01(messages({...turn(),input:'x'.repeat(1001)})),/Invalid BLACKOUT_LIVE/);
  assert.throws(()=>decorateBlackoutLiveV01([{role:'system',content:'x'}]),/Invalid BLACKOUT_LIVE/);
});
test('wrapper calls its writer exactly once and respects STOP',async()=>{
  let calls=0;const wrapped=withBlackoutLiveV01(async args=>{calls++;return args.messages;});
  const result=await wrapped({messages:messages()});
  assert.equal(calls,1);
  assert.ok(JSON.parse(result[1].content).blackout_live_v01);
  const controller=new AbortController();controller.abort();
  assert.throws(()=>wrapped({messages:messages(),signal:controller.signal}),/abort/i);
  assert.equal(calls,1);
});
test('failed remote V620 v0.1 falls back exactly once to UNMODIFIED MSI prompt',async()=>{
  let remoteMessages,msiMessages,msiCalls=0;
  const complete=createQwenFailover({probe:async()=>true,
    primary:withBlackoutLiveV01(async args=>{remoteMessages=args.messages;throw Error('V620 offline');}),
    fallback:async args=>{msiCalls++;msiMessages=args.messages;return '{"ready":true}';}});
  const original=messages();
  assert.equal(await complete({messages:original}),'{"ready":true}');
  assert.ok(JSON.parse(remoteMessages[1].content).blackout_live_v01);
  assert.deepEqual(msiMessages,original);
  assert.equal(msiCalls,1);
  assert.equal(complete.status().last_route,'msi');
});

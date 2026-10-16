import test from 'node:test';
import assert from 'node:assert/strict';
import {detectBlackoutLiveRelay,planBlackoutLiveV01,decorateBlackoutLiveV01,assertBlackoutLiveSpeech,withBlackoutLiveV01} from '../src/blackout-live-v01.mjs';
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

test('successful V620 v0.1 delivers one remote plan without a local generation',async()=>{
  let remote=0,local=0,early=[];
  const complete=createQwenFailover({probe:async()=>true,
    primary:withBlackoutLiveV01(async ({messages,onText})=>{
      remote++;assert.equal(onText,undefined);
      assert.ok(JSON.parse(messages[1].content).blackout_live_v01);
      return '{"ready":true}';
    }),
    fallback:async()=>{local++;throw Error('must not run');}});
  assert.equal(await complete({messages:messages(),onText:text=>early.push(text)}),'{"ready":true}');
  assert.deepEqual(early,['{"ready":true}']);
  assert.equal(remote,1);assert.equal(local,0);
  assert.equal(complete.status().last_route,'v620');
});
test('STOP during profiled V620 completion never launches MSI or emits stale audio',async()=>{
  const controller=new AbortController();let backup=0,early=0;
  const complete=createQwenFailover({probe:async()=>true,
    primary:withBlackoutLiveV01(async ()=>{
      controller.abort();throw Error('cancelled');
    }),
    fallback:async()=>{backup++;return '{"ready":true}';}});
  await assert.rejects(complete({messages:messages(),signal:controller.signal,
    onText:()=>early++}),/cancelled/);
  assert.equal(backup,0);assert.equal(early,0);
});

const producerMessage='buff, tell rev to let shanny finish her sentence.';
const hostRelayTurn=()=>({...turn('SHANNY','direct_attack',producerMessage),
  audience_address:{target:'BUFF',basis:'direct-vocative'}});
const response=(shanny,rev)=>JSON.stringify({
  hinge:'The viewer wants Rev to stop cutting Shanny off.',
  first_SHANNY:{text:shanny,mood:'anger'},
  second_REV:{text:rev,mood:'irritated'},
  rev_reason:'Rev challenges Shanny or gives her space.'
});

test('producer regression: Buff request is a relay to Rev, not Buff speaking as a character',()=>{
  assert.deepEqual(detectBlackoutLiveRelay(producerMessage,'BUFF'),{
    kind:'host_relay',recipient:'REV',goal:'give_other_actor_room_to_speak',beneficiary:'SHANNY'
  });
  const arc=planBlackoutLiveV01(hostRelayTurn());
  assert.deepEqual(arc.beats.map(x=>x.slot),['first_SHANNY','second_REV','third_SHANNY']);
  assert.match(arc.beats[0].objective,/COMPLETE one actual thought/);
  assert.match(arc.beats[1].objective,/grants speaking space/);
  assert.equal(arc.relay.recipient,'REV');
  assert.equal(arc.relay.beneficiary,'SHANNY');
  assert.doesNotMatch(JSON.stringify(arc),/first_BUFF|second_BUFF/);
  const baseline=hostRelayTurn();
  baseline.focus_terms=['buff','finish','sentence'];
  baseline.dialogue_route='The viewer directly addresses BUFF, not either actor.';
  const original=messages(baseline);
  const decorated=decorateBlackoutLiveV01(original);
  const v620=JSON.parse(decorated[1].content);
  assert.deepEqual(v620.focus_terms,['turn-taking','complete-thought']);
  assert.match(v620.dialogue_route,/offstage host.*REV.*SHANNY/i);
  assert.equal(JSON.parse(original[1].content).focus_terms[0],'buff');
  assert.equal(JSON.parse(original[1].content).dialogue_route,baseline.dialogue_route);
});
test('host-only question is not falsely classified as a relay and generic relays remain distinct',()=>{
  assert.equal(detectBlackoutLiveRelay('Buff, what do you think?','BUFF'),null);
  assert.equal(detectBlackoutLiveRelay('Rev, tell Buff to behave','REV'),null);
  assert.deepEqual(detectBlackoutLiveRelay('Hey Buff, ask Shanny why she is upset','BUFF'),
    {kind:'host_relay',recipient:'SHANNY',goal:'address_viewer_request'});
});
test('exact repeating words and echoed Buff phrases fail V620-only speech validation',()=>{
  const relay=detectBlackoutLiveRelay(producerMessage,'BUFF');
  assert.throws(()=>assertBlackoutLiveSpeech(response(
    'Sentence sentence sentence!','You are a Buff, you are a Buff, a Buff.'),relay),/repetitive speech blocked/);
  assert.throws(()=>assertBlackoutLiveSpeech(response(
    'I am Buff and I am the host.','Please carry on.'),relay),/host identity confusion/);
  assert.throws(()=>assertBlackoutLiveSpeech(response(
    'I was trying to finish a real point.','I was trying to finish a real point.'),relay),/repeated dialogue/);
});
test('normal anger, natural short emphasis and a substantive response remain acceptable',()=>{
  const relay=detectBlackoutLiveRelay(producerMessage,'BUFF');
  assert.doesNotThrow(()=>assertBlackoutLiveSpeech(response(
    'No, no, no. I want to explain why I am frustrated without Jason stepping on every word.',
    'I disagree with your explanation, Shanny, but say the part you wanted to finish.'),relay));
});
test('producer repeating-V620 completion cannot prefetch voice; falls back to unchanged MSI once',async()=>{
  const actual=messages(hostRelayTurn());const snapshot=JSON.stringify(actual);
  let localCount=0,firstPrefetch=0,remoteCount=0,seenLocal;
  const bad=response('Sentence sentence sentence!',"You're a Buff, you're a Buff, a Buff!");
  const good=response('Rev, I am explaining why I need you to listen without cutting me off.',
    'I think you talk over me too, but go on and finish your point.');
  const complete=createQwenFailover({
    probe:async()=>true,
    primary:withBlackoutLiveV01(async({messages,onText})=>{
      remoteCount++;assert.equal(onText,undefined);
      assert.equal(JSON.parse(messages[1].content).blackout_live_v01.relay.recipient,'REV');
      return bad;
    }),
    fallback:async args=>{localCount++;seenLocal=args.messages;args.onText?.(good);return good;}
  });
  const director=createBlackoutMicrodirector({complete,notes:'Private cartoon acting direction'});
  const plan=await director.generate({text:producerMessage,kind:'donation',
    onFirstLine:()=>firstPrefetch++});
  assert.deepEqual(plan.lines.map(x=>x.actor),['SHANNY','REV']);
  assert.equal(remoteCount,1);assert.equal(localCount,1);
  assert.equal(firstPrefetch,1,'only the accepted local result may enter held first-line preparation');
  assert.equal(complete.status().last_route,'msi');
  assert.equal(complete.status().last_reason,'remote-generation-failed');
  assert.equal(JSON.stringify(actual),snapshot);
  assert.ok(Array.isArray(seenLocal));
  assert.equal(JSON.parse(seenLocal[1].content).blackout_live_v01,undefined);
});
test('V620-only repetition rejection does not affect silent startup warmup',async()=>{
  const warmup=[{role:'system',content:'Be ready'},
    {role:'user',content:'Silent startup check: return only {"ready":true}.'}];
  const complete=withBlackoutLiveV01(async({messages})=>{
    assert.equal(messages,warmup);
    return '{"ready":true}';
  });
  assert.equal(await complete({messages:warmup}),'{"ready":true}');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseBlackoutShanny} from '../src/blackout-shanny-heat.mjs';
import {identifyAudienceAddressee} from '../src/audience-addressee.mjs';
import {createBlackoutMicrodirector} from '../src/blackout-microdirector-director.mjs';
import {shortlistEpisodeCodes,requestedEpisodeCodes} from '../src/approved-delivery.mjs';

function decide(text,kind='donation',hooks=[]){
 return chooseBlackoutShanny({text,kind,address:identifyAudienceAddressee(text),hooks});
}
test('Blackout Shanny has overt pressure in roughly 65% of ordinary inputs, not all',()=>{
 let heated=0;const seen=new Set();
 for(let n=0;n<1000;n++){
  const decision=decide('Shanny, what do you think about ordinary question number '+n+'?');
  if(decision.regime==='HIGH_PRESSURE')heated++;
  seen.add(decision.emotional_lane);
  assert.equal(decision.pressure_target,0.65);
 }
 assert.ok(heated>=600&&heated<=700,'expected close to 65%, observed '+heated+'/1000');
 for(const name of ['direct_attack','disgust_contempt','wounded_victim','insular_crying','contained_blackout'])
  assert.ok(seen.has(name),'missing Blackout lane '+name);
});
test('personally directed betrayal, insult or humiliating order earns hot performance',()=>{
 for(const incoming of [
  'Shanny, you are a manipulative liar.',
  'Shanny, shut up and explain yourself.',
  'Shanny, why did you betray Rev?',
  'Shanny, you are a hypocrite.'
 ]){
  assert.equal(decide(incoming).regime,'HIGH_PRESSURE',incoming);
 }
});
test('earned kindness can override hostile Blackout default without switching identity',()=>{
 const warm=decide('Shanny, I love you and hope you feel better.');
 assert.equal(warm.regime,'CONTAINED');
 assert.equal(warm.emotional_lane,'contained_blackout');
 const wounded=decide('Shanny, how can nobody ever care about you?');
 assert.equal(wounded.addressed_context,'the viewer addresses Shanny');
});
test('named Rev message does not make Shanny the personally accused donor target',()=>{
 const info=decide('Rev, can you explain KittyDoomz to Shanny?');
 assert.equal(info.addressed_context,'the viewer addresses Rev');
 assert.notEqual(info.addressed_context,'the viewer addresses Shanny');
 assert.equal(typeof info.acting_objective,'string');
});
test('high-pressure intent gives Qwen a natural, category-matched emotional menu',()=>{
 for(const term of ['furious anger rage','disgust contempt','crying defensive hurt','sobbing sadness crying']){
  const short=shortlistEpisodeCodes(requestedEpisodeCodes,term);
  assert.ok(short.SHANNY.length>0);
  assert.ok(short.REV.length>0);
  assert.ok(short.SHANNY.length<=10);
 }
});
test('new Blackout acting treatment is added inside one Qwen call without old food notes',async()=>{
 let calls=0,observed;
 const director=createBlackoutMicrodirector({
  notes:'Old persona notes here mention biscuits, bread and sandwiches.',
  complete:async req=>{
   calls++;observed=req;
   return {hinge:'Shanny objects to being publicly told what to do; Rev disputes her claim.',
    lines:[
     {actor:'SHANNY',text:'You are not going to order me around tonight!',mood:'rage',to:'VIEWER'},
     {actor:'REV',text:'Shanny, you cannot treat every order as an attack!',mood:'irritated',to:'SHANNY'}
    ],rev_reason:'Rev disputes the totalizing claim.'};
  }
 });
 const plan=await director.generate({kind:'donation',text:'Shanny, shut up and answer this.'});
 assert.equal(calls,1,'never a second Qwen call');
 assert.equal(plan.lines[0].actor,'SHANNY');
 assert.equal(plan.lines[1].actor,'REV');
 const system=observed.messages[0].content;
 assert.match(system,/BLACKOUT SHANNY/);
 assert.match(system,/SELF-VICTIMIZING HURT/);
 assert.match(system,/INSULAR CRYING/);
 assert.doesNotMatch(JSON.stringify(observed.messages),/biscuits|sandwiches|bread/i);
 const input=JSON.parse(observed.messages.at(-1).content);
 assert.equal(input.audience_address.target,'SHANNY');
 assert.equal(input.shanny_blackout.regime,'HIGH_PRESSURE');
 assert.equal(input.shanny_blackout.pressure_target,0.65);
 assert.ok(input.shanny_blackout.acting_objective.length>50);
 assert.equal(input.donation_reader,'SHANNY');
});

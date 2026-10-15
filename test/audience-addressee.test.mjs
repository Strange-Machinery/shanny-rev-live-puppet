import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyAudienceAddressee,audienceReplyContract} from '../src/audience-addressee.mjs';
import {createBlackoutMicrodirector,firstMicroLine,validateMicroPlan} from '../src/blackout-microdirector-director.mjs';

const addressed=[
 ['Shanny, why do you make Rev empty the bucket?','SHANNY'],
 ['Hey Rev, what is Shanny doing with the bucket?','REV'],
 ['Rev, tell Shanny I said hi.','REV'],
 ['Shanny, tell Rev to answer.','SHANNY'],
 ['Shanny did you ever see the moon?','SHANNY'],
 ['Did Shanny ever see the moon?','UNSPECIFIED'],
 ["Shanny's bucket is filthy.",'UNSPECIFIED'],
 ['Shanny is blaming Rev.','UNSPECIFIED'],
 ['Rev dropkicked Will.','UNSPECIFIED'],
 ['Rev did you dropkick Will?','REV'],
 ['Rev did the dropkick on Will.','UNSPECIFIED'],
 ['Shanny and Rev, what do you think?','BOTH'],
 ['Rev and Shanny, you two agree?','BOTH'],
 ['Shanny and Rev are arguing.','UNSPECIFIED'],
 ['Hey, Shanny, are you awake?','SHANNY'],
 ['Hey Rev!','REV'],
 ['Shanny, Rev, do you mind?','BOTH'],
 ['Hey guys, answer the question.','BOTH'],
 ['Shanny, should you two stop?','SHANNY'],
 ['Buff, what do you think?','BUFF'],
 ['Can you answer this, Shanny?','SHANNY'],
 ['Question for Rev: what happened?','REV'],
 ['@AI_SHANNY, are you okay?','SHANNY'],
 ['Hi, AI_REV, how are you?','REV'],
 ['To Shanny: remember the bucket?','SHANNY'],
 ['Rev how do you feel?','REV'],
 ['Rev can do this without Shanny.','UNSPECIFIED'],
 ['I heard you both discussing this.','BOTH'],
 ['Shanny would you ask Rev?','SHANNY']
];
test('viewer addressee is not inferred from incidental name mentions',()=>{
 for(const [input,target] of addressed){
  assert.equal(identifyAudienceAddressee(input).target,target,input);
 }
});
test('identity and addressee are distinct for reader, partner and donor',()=>{
 const addr=identifyAudienceAddressee('Shanny, tell Rev to stop.');
 assert.equal(addr.target,'SHANNY');
 assert.deepEqual(addr.mentioned,['SHANNY','REV']);
 const contract=audienceReplyContract(addr,'donation','REV');
 assert.match(contract,/reader is REV/);
 assert.match(contract,/viewer speaks TO SHANNY/);
 assert.match(contract,/REV must NOT speak as if the viewer directly/i);
});

const revFirst={
 hinge:'Rev is asked to justify a decision and Shanny challenges his answer.',
 lines:[
  {actor:'REV',text:'I made that decision because I thought it was reasonable!',mood:'irritated',to:'VIEWER'},
  {actor:'SHANNY',text:'Your idea of reasonable gets us into trouble every time!',mood:'anger',to:'REV'}
 ],rev_reason:'Rev defends his own decision.'};
const shannyFirst={
 hinge:'Shanny is challenged about the bucket and Rev disputes the duty it creates.',
 lines:[
  {actor:'SHANNY',text:'I never said that bucket was your personal entertainment!',mood:'anger',to:'VIEWER'},
  {actor:'REV',text:'You are the one who keeps making this everybody’s business!',mood:'irritated',to:'SHANNY'}
 ],rev_reason:'Rev objects to Shanny’s framing.'};

test('Shanny-addressed donation read aloud by Rev still makes Shanny primary',async()=>{
 let request,calls=0;
 const director=createBlackoutMicrodirector({notes:'Private acting rules',
  complete:async args=>{request=args;calls++;return shannyFirst;}});
 const answer=await director.generate({kind:'donation',
  text:'Shanny, tell Rev to empty the bucket.',readBy:'REV'});
 const user=JSON.parse(request.messages.at(-1).content);
 assert.equal(calls,1);
 assert.equal(user.audience_address.target,'SHANNY');
 assert.equal(user.donation_reader,'REV');
 assert.match(user.dialogue_route,/viewer speaks TO SHANNY/);
 assert.match(user.dialogue_route,/REV must NOT speak as if the viewer directly/i);
 assert.equal(answer.lines[0].actor,'SHANNY');
 assert.equal(answer.lines[1].actor,'REV');
});
test('Rev-addressed donation read aloud by Shanny makes Rev first',async()=>{
 let request;
 const director=createBlackoutMicrodirector({notes:'Private acting rules',
  complete:async args=>{request=args;return revFirst;}});
 const answer=await director.generate({kind:'donation',
  text:'Rev, why did you choose that?',readBy:'SHANNY'});
 const user=JSON.parse(request.messages.at(-1).content);
 assert.equal(user.audience_address.target,'REV');
 assert.equal(user.donation_reader,'SHANNY');
 assert.match(user.dialogue_route,/viewer speaks TO REV/);
 assert.equal(answer.lines[0].actor,'REV');
});
test('wrong first speaker fails both speculative prefetch and final validation',async()=>{
 let prematurelyPrepared=false;
 const director=createBlackoutMicrodirector({notes:'Private direction',
  complete:async({onText})=>{onText?.(JSON.stringify(revFirst));return revFirst;}});
 await assert.rejects(director.generate({kind:'donation',text:'Shanny, answer my question.',
  onFirstLine:()=>{prematurelyPrepared=true;}}),/addressed-actor mismatch/);
 assert.equal(prematurelyPrepared,false);
 assert.equal(firstMicroLine(JSON.stringify(revFirst),{},{
  input:'Shanny, tell me.',hooks:[],audience_address:{target:'SHANNY'}}),null);
 assert.throws(()=>validateMicroPlan(shannyFirst,'donation',{},{
  input:'Rev, why?',hooks:[],audience_address:{target:'REV'}}),/addressed-actor mismatch/);
});
test('the runtime owns recipient routing; a wrong legacy to field cannot kill a turn',()=>{
 const wrongDestinations={
  ...shannyFirst,
  lines:[{...shannyFirst.lines[0],to:'REV'},
    {...shannyFirst.lines[1],to:'VIEWER'}]
 };
 const accepted=validateMicroPlan(wrongDestinations,'donation',{},{
  input:'Shanny, stop blaming Rev.',hooks:[],audience_address:{target:'SHANNY'}
 });
 assert.equal(accepted.lines[0].actor,'SHANNY');
 assert.equal(accepted.lines[1].actor,'REV');
 for(const line of accepted.lines)
  assert.equal('to' in line,false,'routing metadata never reaches the speech gateway');
});

const roleSlots={
 hinge:'Rev is asked to explain his behavior and Shanny takes issue with that explanation.',
 first:{text:'I already explained why I decided to do that!',mood:'irritated'},
 second:{text:'Rev, your explanation changes every time you tell the story!',mood:'anger'},
 rev_reason:'Rev challenges the viewer accusation.'
};
test('real model slots assign Rev as first speaker without actor or to labels',async()=>{
 let captured,prepared=[];
 const director=createBlackoutMicrodirector({
  notes:'Private Blackout character reference',
  complete:async request=>{
   captured=request;
   request.onText?.(JSON.stringify(roleSlots));
   return roleSlots;
  }
 });
 const response=await director.generate({kind:'donation',text:'Rev, why did you choose that?',
  readBy:'REV',onFirstLine:line=>prepared.push(line)});
 assert.equal(response.lines[0].actor,'REV');
 assert.equal(response.lines[1].actor,'SHANNY');
 assert.equal(response.lines[0].mood,'irritated');
 assert.equal(response.lines[1].mood,'anger');
 assert.equal(prepared.length,1);
 assert.equal(prepared[0].actor,'REV');
 assert.equal('to' in response.lines[0],false);
 const schema=captured.responseSchema;
 assert.deepEqual(schema.required,['hinge','first_REV','second_SHANNY','rev_reason']);
 assert.equal('actor' in schema.properties.first_REV.properties,false);
 assert.equal('to' in schema.properties.first_REV.properties,false);
 assert.deepEqual(schema.properties.first_REV.properties.mood.enum,
  ['pacifying','irritated','rage','skeptical','surprised']);
 assert.deepEqual(schema.properties.second_SHANNY.properties.mood.enum,
  ['anger','rage','crying','smug','surprised']);
 assert.equal(captured.messages.length,2,'old script examples do not leak');
});
test('Shanny-addressed model slots route Shanny then Rev, even if Rev read it',async()=>{
 const slots={...roleSlots,
  first:{text:'You are not putting the blame for that bucket on me!',mood:'anger'},
  second:{text:'Shanny, you keep refusing to hear my explanation!',mood:'irritated'},
  rev_reason:'Rev defends his account of the chore.'};
 const director=createBlackoutMicrodirector({notes:'Private Blackout treatment',
  complete:async()=>slots});
 const result=await director.generate({kind:'donation',
  text:'Shanny, why are you blaming Rev for the bucket?',readBy:'REV'});
 assert.deepEqual(result.lines.map(row=>row.actor),['SHANNY','REV']);
});
test('one slot cannot spoof its assigned character or recipient',async()=>{
 const polluted={...roleSlots,
  first:{...roleSlots.first,actor:'SHANNY',to:'REV'}};
 const director=createBlackoutMicrodirector({notes:'Private Blackout treatment',
  complete:async()=>polluted});
 await assert.rejects(director.generate({kind:'donation',text:'Rev, explain that.'}),
  /speaker slot/);
 assert.equal(firstMicroLine(JSON.stringify(polluted),{},{
  input:'Rev, explain that.',hooks:[],audience_address:{target:'REV'}}),null);
});
test('both-addressed viewer and unspecified audience do not force an incorrect individual',async()=>{
 const director=createBlackoutMicrodirector({notes:'Private direction',
  complete:async()=>shannyFirst});
 for(const input of ['Shanny and Rev, what do you think?','Do either of you agree?']){
  const response=await director.generate({kind:'donation',text:input});
  assert.equal(response.lines.length,2);
 }
});

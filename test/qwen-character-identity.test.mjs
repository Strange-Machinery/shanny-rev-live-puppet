import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlackoutMicrodirector,firstMicroLine,validateMicroPlan} from '../src/blackout-microdirector-director.mjs';

const SHANNY_TALK='I am the one you asked about the bucket, and I am tired of being treated like the entire mess is mine. Rev keeps blaming me whenever anyone notices that he is standing there doing nothing!';
const REV_TALK='Shanny, I have explained what happened with that bucket more than once, and you keep pretending that I never answered you. I carried it out last time, but somehow you have decided that is my job forever!';
const HINGE='Shanny resents being singled out about the bucket and Rev disputes the blame.';
const REASON='Rev disputes the bucket blame and workload.';
const shannyFirst={
 hinge:HINGE,
 first_SHANNY:{text:SHANNY_TALK,mood:'anger',delivery:'S07'},
 second_REV:{text:REV_TALK,mood:'irritated',delivery:'R11'},
 rev_reason:REASON
};
const revFirst={
 hinge:'Rev is directly questioned about the bucket; Shanny attacks his explanation.',
 first_REV:{text:REV_TALK,mood:'irritated',delivery:'R11'},
 second_SHANNY:{text:SHANNY_TALK,mood:'anger',delivery:'S07'},
 rev_reason:REASON
};
const codes={SHANNY:['S07','S08'],REV:['R11','R12']};
function context(target,input){return {input,hooks:[],audience_address:{target}};}

test('longer, two-sentence, over-160-character utterances pass and retain actor-qualified voices',()=>{
 assert.ok(SHANNY_TALK.length>160);
 assert.ok(REV_TALK.length>160);
 for(const [plan,target,input] of [
   [shannyFirst,'SHANNY','Shanny, explain the bucket.'],
   [revFirst,'REV','Rev, explain the bucket.']
 ]){
   const answer=validateMicroPlan(plan,'donation',codes,context(target,input));
   assert.equal(answer.lines.length,2);
   assert.deepEqual(answer.lines.map(row=>row.actor),target==='REV'?['REV','SHANNY']:['SHANNY','REV']);
   assert.deepEqual(answer.lines.map(row=>row.delivery),target==='REV'?['R11','S07']:['S07','R11']);
   assert.deepEqual(answer.lines.map(row=>row.text),target==='REV'? [REV_TALK,SHANNY_TALK] : [SHANNY_TALK,REV_TALK]);
 }
});
test('max spoken limit is 320 characters and 70 words, but punctuation and short interruptions are free',()=>{
 const check=text=>validateMicroPlan({...shannyFirst,first_SHANNY:{...shannyFirst.first_SHANNY,text}},
  'donation',codes,context('SHANNY','Shanny, tell me about the bucket.'));
 assert.equal(check('W'.repeat(319)+'!').lines[0].text.length,320);
 assert.throws(()=>check('W'.repeat(320)+'!'),/exceeds 320 characters \(321\)/);
 assert.equal(check('First sentence. Second sentence. Third sentence.').lines[0].text,
  'First sentence. Second sentence. Third sentence.');
 assert.throws(()=>check(Array(71).fill('x').join(' ')+'!'),/exceeds 70 words \(71\)/);
 assert.equal(check('Absolutely not!').lines[0].text,'Absolutely not!',
  'a short intense interruption must remain allowed');
});
test('natural Rev dialogue with short sentences, direct quotation and sound punctuation does not fail',()=>{
 const examples=[
  'Shanny, I said no! Why is that so hard? You asked me to explain. I explained!',
  'I told Shanny, "That was not what I said!" and she interrupted me again.',
  'Wait... what? No! That is not how I remember it.',
  'I am NOT going to sit here all day pretending this made sense!!!',
  'I told you I was tired.\nI still have a point to make.'
 ];
 for(const input of examples){
  const raw=input.replace('\\n','\n');
  const parsed=validateMicroPlan({...revFirst,
   first_REV:{...revFirst.first_REV,text:raw}},
   'donation',codes,context('REV','Rev, explain that bucket.'));
  assert.equal(parsed.lines[0].actor,'REV');
  assert.ok(parsed.lines[0].text.length<=320);
  assert.equal(/[\r\n\t]/.test(parsed.lines[0].text),false);
 }
});
test('invalid speech failures are actionable but do not reveal audience or generated text',()=>{
 const secret='Private generated dialogue and sensitive donor name';
 const bads=[
  {text:secret+'!'.repeat(350),reason:/line 1 exceeds 320 characters/},
  {text:'\u0001'+secret,reason:/line 1 contains non-spoken control characters/},
  {text:'<think>'+secret+'</think>',reason:/line 1 contains forbidden model-thinking tags/},
  {text:'    ',reason:/line 1 is empty/}
 ];
 for(const {text,reason} of bads){
  assert.throws(()=>validateMicroPlan({...shannyFirst,
    first_SHANNY:{...shannyFirst.first_SHANNY,text}},'donation',codes,
    context('SHANNY','Shanny, explain the bucket.')),error=>{
    assert.match(error.message,/Invalid Microdirector spoken line/);
    assert.match(error.message,reason);
    assert.doesNotMatch(error.message,/Private generated|sensitive donor/);
    return true;
  });
 }
});
test('early Rev voice prefetch and final reply agree with quoted, three-sentence speech',async()=>{
 const raw={...revFirst,
  first_REV:{...revFirst.first_REV,
   text:'Shanny, I said "stop blaming me!" You keep making this my entire problem. I already carried the bucket!'}};
 let prefetched;
 const director=createBlackoutMicrodirector({notes:'Private',
  getDeliveryCodes:()=>codes,
  complete:async({onText})=>{onText?.(JSON.stringify(raw));return raw;}});
 const result=await director.generate({text:'Rev, what happened with the bucket?',
  kind:'donation',onFirstLine:line=>{prefetched=line;}});
 assert.equal(prefetched.actor,'REV');
 assert.equal(prefetched.text,result.lines[0].text);
 assert.equal(prefetched.delivery,'R11');
 assert.equal(result.lines[1].actor,'SHANNY');
});
test('a malformed second character gets a line-2 diagnosis without revealing words',()=>{
 const spoken='Sensitive fictional dialogue from Shanny';
 assert.throws(()=>validateMicroPlan({...revFirst,
  second_SHANNY:{...revFirst.second_SHANNY,text:spoken.repeat(12)}},
 'donation',codes,context('REV','Rev, explain the bucket.')),error=>{
   assert.match(error.message,/Invalid Microdirector spoken line: line 2 exceeds 320 characters/);
   assert.doesNotMatch(error.message,/Sensitive|Shanny/);
   return true;
 });
});
test('Qwen receives true identity locks and fixed actor-named fields, not anonymous first/second',async()=>{
 for(const [input,expectedFirst,expectedSecond,raw] of [
  ['Shanny, explain why you are angry about the bucket.','SHANNY','REV',shannyFirst],
  ['Rev, why are you defensive about the bucket?','REV','SHANNY',revFirst]
 ]){
  let request,called=0,early;
  const director=createBlackoutMicrodirector({notes:'Private notes: never quote them.',
   getDeliveryCodes:()=>codes,
   complete:async args=>{called++;request=args;args.onText?.(JSON.stringify(raw));return raw;}});
  const result=await director.generate({kind:'donation',text:input,
   readBy:expectedFirst,onFirstLine:row=>{early=row;}});
  const first='first_'+expectedFirst,second='second_'+expectedSecond;
  assert.equal(called,1);
  assert.deepEqual(result.lines.map(row=>row.actor),[expectedFirst,expectedSecond]);
  assert.equal(early.actor,expectedFirst);
  const schema=request.responseSchema;
  assert.deepEqual(schema.required,['hinge',first,second,'rev_reason']);
  assert.equal(schema.properties[first].properties.text.maxLength,320);
  assert.equal(schema.properties[first].properties.text.minLength,1);
  assert.equal(schema.properties[first].properties.text.pattern,undefined,
   'natural quoted dialogue must not be forbidden by constrained JSON regex');
  assert.equal(Object.hasOwn(schema.properties[first].properties,'actor'),false);
  assert.equal(Object.hasOwn(schema.properties[first].properties,'to'),false);
  assert.match(request.messages[0].content,new RegExp('SHANNY IS SHANNY'));
  assert.match(request.messages[0].content,new RegExp('REV IS REV'));
  assert.match(request.messages[0].content,new RegExp('IDENTITY LOCK: '+first+' is spoken BY '+expectedFirst));
  assert.match(request.messages[0].content,/16–32 natural words/);
  const payload=JSON.parse(request.messages.at(-1).content);
  assert.equal(payload.actor_slots[first],expectedFirst);
  assert.equal(payload.actor_slots[second],expectedSecond);
  assert.doesNotMatch(request.messages[0].content,/Private notes: never quote them/);
 }
});
test('wrong named role cannot get mistaken for SHANNY or REV and cannot prefetch audio',async()=>{
 const wrong={...revFirst};
 const director=createBlackoutMicrodirector({notes:'Private',getDeliveryCodes:()=>codes,
  complete:async({onText})=>{onText?.(JSON.stringify(wrong));return wrong;}});
 let prepared=false;
 await assert.rejects(director.generate({kind:'donation',text:'Shanny, explain the bucket.',
  onFirstLine:()=>{prepared=true;}}),/Invalid causal Microdirector plan/);
 assert.equal(prepared,false);
 assert.equal(firstMicroLine(JSON.stringify(wrong),codes,context('SHANNY','Shanny, explain the bucket.')),null);
});
test('optional named third line is again spoken by original addressed character',()=>{
 const three={...revFirst,
  third_REV:{text:'I am telling you this again because neither of you lets me finish what I was saying.',mood:'irritated',delivery:'R12'}
 };
 const result=validateMicroPlan(three,'donation',codes,context('REV','Rev, can you finish?'));
 assert.deepEqual(result.lines.map(row=>row.actor),['REV','SHANNY','REV']);
 assert.deepEqual(result.lines.map(row=>row.delivery),['R11','S07','R12']);
});

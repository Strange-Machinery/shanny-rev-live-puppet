import test from 'node:test';
import assert from 'node:assert/strict';
import {focusTerms,detectTopicDrift,hasCurrentFoodTopic} from '../src/live-topic-focus.mjs';
import {createBlackoutMicrodirector,firstMicroLine} from '../src/blackout-microdirector-director.mjs';

const foodPlan={hinge:'Shanny chooses her sandwiches over a conversation with Rev.',
 lines:[
  {actor:'SHANNY',text:'You should have brought my sandwich ingredients!',mood:'anger'},
  {actor:'REV',text:'You cannot make me prepare bread for your dinner!',mood:'irritated'}
 ],rev_reason:'Rev objects to dinner demands.'};
const relevantPlan={hinge:'A demand about the bucket embarrasses Rev while Shanny sees it as his job.',
 lines:[
  {actor:'SHANNY',text:'That bucket is not another excuse for you to complain!',mood:'anger'},
  {actor:'REV',text:'I have carried that bucket enough times already!',mood:'irritated'}
 ],rev_reason:'Rev wants his work recognized.'};

test('focus is bounded to this donation rather than old chat nouns',()=>{
 assert.deepEqual(focusTerms('Rev, go dump the bucket again.'),['dump','bucket']);
 assert.deepEqual(focusTerms('Shanny, why did you turn into KittyDoomz?'),['turn','into','kittydoomz']);
 assert.ok(focusTerms('a '.repeat(1000)).length<=5);
});
test('off-topic sandwiches are identified, but food-relevant questions stay legitimate',()=>{
 assert.equal(detectTopicDrift({input:'Rev, empty the bucket.',plan:foodPlan}), 'UNRELATED_FOOD_THEME');
 assert.equal(detectTopicDrift({input:'What happened to your bread recipe?',plan:foodPlan}),null);
 assert.equal(hasCurrentFoodTopic('What about your kitchen?',[]),true);
 assert.equal(hasCurrentFoodTopic('Tell us the Hungry Boy story.', ['rev-hungry-boy']),true);
 assert.equal(hasCurrentFoodTopic('Tell us the bucket story.', ['bucket']),false);
 assert.equal(detectTopicDrift({input:'Did Rev really use the bucket?',plan:relevantPlan}),null);
});
test('microdirector does not inject private notes about food into Qwen context',async()=>{
 let called=0,request;
 const director=createBlackoutMicrodirector({
  notes:'Old persona examples mention flour, cheese, pizza, soup, sandwiches and ingredients.',
  complete:async args=>{called++;request=args;return relevantPlan;}
 });
 await director.generate({kind:'donation',text:'Please empty the bucket.'});
 assert.equal(called,1,'no extra model pass');
 assert.doesNotMatch(JSON.stringify(request.messages),/\b(?:flour|cheese|pizza|soup|sandwiches|ingredients)\b/i);
 assert.deepEqual(JSON.parse(request.messages.at(-1).content).focus_terms,['empty','bucket']);
});
test('model drift is stopped before any finished plan can be spoken',async()=>{
 let called=0,prep=[];
 const director=createBlackoutMicrodirector({notes:'Original character notes',
  complete:async ({onText})=>{called++;
   const s=JSON.stringify(foodPlan);
   const split=s.indexOf('},{')+2;
   onText?.(s.slice(0,split));onText?.(s);
   return s;
  }});
 await assert.rejects(director.generate({kind:'donation',text:'Tell us about your internet connection.',
  onFirstLine:row=>prep.push(row)}),/topic drift blocked/);
 assert.equal(called,1);
 assert.deepEqual(prep,[],'off-topic speculative WAV must never start');
 assert.equal(firstMicroLine(JSON.stringify(foodPlan),{}, {input:'Explain the bucket.',hooks:[]}),null);
});
test('Qwen may discuss food when the superchat actually asked about it',async()=>{
 const director=createBlackoutMicrodirector({notes:'Short identity note',
  complete:async()=>foodPlan});
 const reply=await director.generate({kind:'donation',text:'Why did you keep making sandwiches?'});
 assert.equal(reply.lines.length,2);
 assert.match(reply.lines[0].text,/sandwich/);
});
test('completed topic-relevant Qwen output remains as creative as before',async()=>{
 let called=0;
 const director=createBlackoutMicrodirector({notes:'One character reacts to status and unfairness.',
  complete:async()=>{called++;return relevantPlan;}});
 const response=await director.generate({kind:'donation',text:'Could someone dump the bucket now.'});
 assert.equal(called,1);
 assert.match(response.lines[1].text,/bucket/);
 assert.equal(response.hinge,relevantPlan.hinge);
});

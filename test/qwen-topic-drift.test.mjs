import test from 'node:test';
import assert from 'node:assert/strict';
import {makeMicroInput,isSameLiveSubject,echoFlags} from '../src/blackout-microdirector.mjs';
import {createBlackoutMicrodirector} from '../src/blackout-microdirector-director.mjs';

test('new unrelated donation does not receive prior culinary chatter or causes',()=>{
 const prior='Tell me about those sandwiches and ingredients.';
 const history=[
  {actor:'SHANNY',text:'That sandwich is disgusting.',input:prior,source:'donation'},
  {actor:'REV',text:'Those ingredients are terrible.',input:prior,source:'donation'}
 ];
 const result=makeMicroInput({text:'What was the deal with Ezzie?',kind:'donation',history,
  hinges:[{text:'Rev resents the sandwiches.',input:prior}]});
 assert.equal(result.contextual_grievance_hooks[0].id,'ezzie');
 assert.deepEqual(result.recent_played_lines,[]);
 assert.deepEqual(result.recent_causes,[]);
 assert.equal(isSameLiveSubject('Tell me about the bucket.',prior),false);
 assert.equal(isSameLiveSubject('Thanks for your donation.','A new donation arrives.'),false);
});

test('topic continuity is grounded in audience input and keeps two short lines',()=>{
 const prior='Why has Rev not emptied the bucket?';
 const history=[
  {actor:'SHANNY',text:'You cannot blame me for that bucket.',input:prior},
  {actor:'REV',text:'You know my recipe for a sandwich.',input:prior},
  {actor:'REV',text:'You left the bucket for me.',input:prior}
 ];
 const now=makeMicroInput({text:'Rev, explain the bucket again.',kind:'microphone',
  history,hinges:[{text:'Rev resents being made to handle the bucket.',input:prior}]});
 assert.equal(now.recent_played_lines.length,2);
 assert.equal(now.recent_played_lines.some(x=>/recipe|sandwich/i.test(x.text)),false);
 assert.equal(now.recent_causes.length,1);
 assert.equal(now.recent_causes[0].includes('bucket'),true);
});

test('explicit continuity is possible while independent prompts begin with clean context',()=>{
 const history=[{actor:'REV',text:'You mentioned a sandwich.',input:'What did you eat for lunch?'}];
 const followup=makeMicroInput({text:'You just said that about the sandwich.',kind:'microphone',history});
 assert.equal(followup.recent_played_lines.length,1);
 const unrelated=makeMicroInput({text:'Discuss the broken stage light.',kind:'donation',history});
 assert.equal(unrelated.recent_played_lines.length,0);
});

test('private source audit catches food-theme drift without exposing notes',()=>{
 const notes='A private sandbox text containing sandwich ingredients.';
 const flags=echoFlags(notes,[],[{actor:'REV',text:'I thought about making sandwiches.'}]);
 assert.equal(flags.old_notes_contain_food_theme,true);
 assert.equal(flags.recent_spoken_food_echo,true);
 assert.doesNotMatch(JSON.stringify(flags),/sandbox|sandwich|ingredients/i);
});

test('permanent Qwen instructions do not themselves seed the unrelated ingredient topic',async()=>{
 let seen;
 const director=createBlackoutMicrodirector({
  notes:'A guarded cartoon character with argumentative energy.',
  complete:async value=>{seen=value.messages;return {
   hinge:'Shanny resents being ordered to perform while Rev disputes her reaction.',
   lines:[
    {actor:'SHANNY',text:'You do not get to boss me around!',mood:'anger'},
    {actor:'REV',text:'You have been bossing me around all day!',mood:'irritated'}
   ],rev_reason:'He resents her double standard.'
  }}
 });
 await director.generate({text:'Why are you acting so demanding?',kind:'donation'});
 assert.equal(seen.length,2);
 assert.doesNotMatch(seen[0].content,/\b(?:food|sandwich|ingredients|bread|recipe|moldy)\b/i);
});

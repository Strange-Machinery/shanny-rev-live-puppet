import test from 'node:test';
import assert from 'node:assert/strict';
import {selectGrievanceHooks,echoFlags,makeMicroInput} from '../src/blackout-microdirector.mjs';
import {createBlackoutMicrodirector,validateMicroPlan,firstMicroLine} from '../src/blackout-microdirector-director.mjs';

const codes={SHANNY:['S07','S08','S09'],REV:['R11','R12']};
const plan={hinge:'Shanny resents the command while Rev notices her double standard.',
 lines:[
  {actor:'SHANNY',text:'You do not get to order me around just because you donated!',mood:'anger',delivery:'S07'},
  {actor:'REV',text:'You were fine with it when you thought the money was yours!',mood:'irritated',delivery:'R11'}
 ],rev_reason:'Rev calls out the money contradiction'};
function fixed(more={}){return {...plan,...more};}

test('microdirector uses evidence-gated optional lore, never gratuitously invokes legends',()=>{
 assert.deepEqual(selectGrievanceHooks('Can you two argue over my $5 donation?'),[]);
 assert.equal(selectGrievanceHooks('How many years was Rev stuck emptying the bucket?')[0].id,'bucket');
 assert.equal(selectGrievanceHooks('Ezzie was texting again')[0].id,'ezzie');
 assert.equal(selectGrievanceHooks('Why did you call him Baby Carrot?')[0].id,'baby-carrot');
 const congealed=selectGrievanceHooks('That story is congealed.')[0];
 assert.equal(congealed.id,'congealed');
 assert.match(congealed.grievance,/no verified|NO verified/i);
 assert.deepEqual(selectGrievanceHooks('I cooked bread today.'),[]);
 assert.equal(selectGrievanceHooks('Rev, the broken toilet means walking to the bathroom.')[0].id,'bucket');
 assert.deepEqual(selectGrievanceHooks('Rev says he wants to learn to walk more.'),[]);
});
test('context includes only relevant current hook and bounded played history',()=>{
 const input=makeMicroInput({text:'Rev, explain the bucket.',kind:'donation',
  history:[{actor:'SHANNY',text:'I was in the room.'},{actor:'REV',text:'You keep changing topics.'}],
  hinges:['An earlier argument had nothing to do with this.']});
 assert.equal(input.contextual_grievance_hooks.length,1);
 assert.equal(input.contextual_grievance_hooks[0].id,'bucket');
 assert.equal(input.recent_played_lines.length,2);
 assert.equal(input.recent_causes.length,1);
 assert.equal(input.kind,'donation');
});
test('one-pass causal prompt, verified voice codes, and no stale few-shot source quotes',async()=>{
 let observed;const director=createBlackoutMicrodirector({notes:'Historical example: stale refusal quote and old bakery sketch.',
  examples:[{kind:'donation',input:'Pizza',response:{lines:[],rev_reason:''}}],
  getDeliveryCodes:()=>codes,
  complete:async req=>{observed=req;return fixed();}});
 const returned=await director.generate({kind:'donation',text:'Why are you jealous about my five dollars?',
  history:[{actor:'REV',text:'I wanted to answer.'}]});
 assert.equal(returned.hinge,plan.hinge);
 assert.equal(returned.lines[0].delivery,'S07');
 assert.equal(observed.messages.length,2,'old episode examples must NOT contaminate live writing');
 assert.equal(observed.responseSchema.properties.lines.items.anyOf[0].properties.delivery.enum.includes('S07'),true);
 assert.match(observed.messages[0].content,/one Qwen completion|ONE Qwen completion/i);
 const payload=JSON.parse(observed.messages[1].content);
 assert.deepEqual(payload.contextual_grievance_hooks,[]);
 assert.match(observed.messages[0].content,/voice-reference clips.*BACKGROUND/i);
});
test('early line can be held without waiting for final Qwen JSON, but final validation gates playback',async()=>{
 let prep=null;
 const director=createBlackoutMicrodirector({notes:'Private stage rules',getDeliveryCodes:()=>codes,
  complete:async({onText})=>{
    const stream=JSON.stringify(plan);
    const at=stream.indexOf('},{')+1;
    onText?.(stream.slice(0,at+2));
    onText?.(stream);
    return stream;
  }});
 const answer=await director.generate({kind:'donation',text:'Do not tell me what to do.',
  onFirstLine:row=>prep=row});
 assert.equal(answer.lines.length,2);
 assert.equal(prep.actor,'SHANNY');
 assert.equal(prep.delivery,'S07');
 assert.deepEqual(firstMicroLine('{"lines":[{"actor":"SHANNY"}]},',codes),null);
});
test('invalid or invented voice categories and missing causes fail closed',()=>{
 assert.equal(validateMicroPlan(plan,'donation',codes).lines.length,2);
 assert.throws(()=>validateMicroPlan(fixed({hinge:'lame'}),'donation',codes),/causal/);
 assert.throws(()=>validateMicroPlan(fixed({lines:[{...plan.lines[0],delivery:'S06'},plan.lines[1]]}),'donation',codes),/Unqualified/);
 assert.throws(()=>validateMicroPlan(fixed({lines:[plan.lines[0],plan.lines[0]]}),'donation',codes),/both/);
 assert.throws(()=>validateMicroPlan({...plan,additional:'stage-command'},'donation',codes),/causal/);
});
test('private note/audition contamination audit returns booleans, never the source note text',()=>{
 const privateNotes='old exact refusal slogan: no means no; old bread clip from another project';
 const flags=echoFlags(privateNotes,[{text:'moldy bread'}],[{actor:'REV',text:'No means no!'}]);
 assert.equal(flags.old_notes_contain_no_means_no,true);
 assert.equal(flags.old_notes_contain_bread,true);
 assert.equal(flags.legacy_examples_contain_bread_or_refusal,true);
 assert.equal(flags.recent_spoken_echo,true);
 assert.doesNotMatch(JSON.stringify(flags),/old exact|another project|moldy bread/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationDirector,validateExchange} from '../src/conversation-director.mjs';
import {guardOriginalMsiBlackoutRemote} from '../src/msi-blackout-gold.mjs';
import {createQwenFailover} from '../src/providers/qwen-failover.mjs';

const good=JSON.stringify({
  lines:[
    {actor:'SHANNY',text:'No, I am not your personal customer service department!',mood:'anger'},
    {actor:'REV',text:'And I am not the complaints department either, Shanny.',mood:'irritated'}
  ],rev_reason:'Rev objects to the premise.'
});
const example={kind:'donation',input:'Why are you so grumpy?',response:JSON.parse(good)};
const notes='Private synthetic TEST personality: Shanny is absurdly defensive; Rev needles her.';

function gold(complete,options={}) {
  return createConversationDirector({complete,notes,examples:[example],...options});
}
function remoteWith(primary,fallback){
  return createQwenFailover({probe:async()=>true,
    primary:guardOriginalMsiBlackoutRemote(primary),
    fallback});
}

test('original MSI director is the real source: short hostile audience replies with private notes and approved examples',async()=>{
  let seen;
  const plan=await gold(async args=>{seen=args;return good;}).generate({
    text:'Can you two get along?',kind:'donation'
  });
  assert.deepEqual(plan,validateExchange(good,'donation'));
  assert.equal(seen.messages.length,4,'system, one approved user/assistant example, current user');
  const system=seen.messages[0].content;
  assert.match(system,/BLACKOUT_MODE audience antagonism/);
  assert.match(system,/Fast live improv: each line is ONE short sentence, ideally 8–16 words/);
  assert.match(system,/PRIVATE PRODUCER CHARACTER TREATMENT:\nPrivate synthetic TEST personality/);
  assert.match(system,/They are RUDE, UNGRATEFUL and openly argumentative/);
  assert.ok(!system.includes('shanny_blackout'));
  assert.ok(!system.includes('BLACKOUT_LIVE v0.1'));
  assert.equal(seen.messages[1].role,'user');
  assert.equal(seen.messages[2].role,'assistant');
  assert.deepEqual(JSON.parse(seen.messages[2].content),JSON.parse(good));
  const request=JSON.parse(seen.messages.at(-1).content);
  assert.deepEqual(Object.keys(request).sort(),['direction','history','input','kind']);
  assert.equal(request.input,'Can you two get along?');
  assert.equal(seen.responseSchema.properties.lines.maxItems,3);
  assert.equal(seen.responseSchema.properties.lines.items.anyOf.length,2);
});

test('V620 receives identical original MSI prompt and ONE generation; final validation precedes first-line prefetch',async()=>{
  let remoteCalls=0,msiCalls=0,observed,first=[];
  const complete=remoteWith(async args=>{
    remoteCalls++;observed=args;
    assert.equal(args.onText,undefined);
    assert.match(args.messages[0].content,/PRIVATE PRODUCER CHARACTER TREATMENT/);
    assert.deepEqual(Object.keys(JSON.parse(args.messages.at(-1).content)).sort(),
      ['direction','history','input','kind']);
    return good;
  },async()=>{msiCalls++;return good;});
  const plan=await gold(complete).generate({
    text:'Can you two get along?',kind:'donation',onFirstLine:line=>first.push(line)
  });
  assert.deepEqual(plan.lines.map(x=>x.actor),['SHANNY','REV']);
  assert.equal(remoteCalls,1);
  assert.equal(msiCalls,0);
  assert.equal(first.length,1);
  assert.equal(first[0].actor,'SHANNY');
  assert.equal(complete.status().last_route,'v620');
  assert.ok(observed.responseSchema);
});

test('invalid remote actor or punctuation fails BEFORE any remote speech and uses original MSI request once',async()=>{
  const malformed=JSON.stringify({lines:[
    {actor:'BUFF',text:'I am Buff!',mood:'anger'},
    {actor:'REV',text:'I am Rev!',mood:'irritated'}
  ],rev_reason:'Wrong actor'});
  let primary=0,backup=0,original,first=[];
  const complete=remoteWith(async args=>{primary++;original=args.messages;return malformed;},
    async args=>{backup++;assert.equal(args.messages,original,
      'fallback gets the EXACT same prompt, not a rewritten or added directive');
      args.onText?.(good);
      return good;
    });
  const plan=await gold(complete).generate({kind:'donation',text:'Can you two get along?',
    onFirstLine:line=>first.push(line)});
  assert.equal(primary,1);assert.equal(backup,1);
  assert.equal(first.length,1);
  assert.deepEqual(plan.lines.map(x=>x.actor),['SHANNY','REV']);
  assert.equal(complete.status().last_route,'msi');
  assert.equal(complete.status().last_reason,'remote-generation-failed');
});

test('remote malformed JSON, double sentence, too-long dialogue and invalid mood all use same old validator',async()=>{
  const tooMany=JSON.stringify({
    lines:[{actor:'SHANNY',text:'I refuse. I always refuse.',mood:'anger'},
      {actor:'REV',text:'No way.',mood:'irritated'}],
    rev_reason:'Rev objects.'
  });
  const invalidMood=JSON.stringify({
    lines:[{actor:'SHANNY',text:'Not a chance!',mood:'nonexistent'},
      {actor:'REV',text:'Fine.',mood:'irritated'}],
    rev_reason:'Rev objects.'
  });
  for(const raw of ['invalid-json',tooMany,invalidMood]){
    let backups=0;
    const complete=remoteWith(async()=>raw,async()=>{backups++;return good;});
    const plan=await gold(complete).generate({kind:'donation',text:'Are you serious?'});
    assert.equal(backups,1);
    assert.equal(complete.status().last_route,'msi');
    assert.deepEqual(plan.lines.map(v=>v.actor),['SHANNY','REV']);
  }
});

test('original MSI silent warmup remains JSON ready and cannot reach speech',async()=>{
  let primary=0,backup=0,parts;
  const complete=remoteWith(async args=>{
    primary++;parts=args;
    assert.equal(args.onText,undefined);
    return '{"ready":true}';
  },async()=>{backup++;throw Error('unused');});
  await gold(complete).warmup();
  assert.equal(primary,1);assert.equal(backup,0);
  assert.equal(complete.status().last_route,'v620');
  assert.equal(parts.responseSchema.properties.ready.const,true);
  assert.match(parts.messages.at(-1).content,/Silent startup check/);
});

test('STOP during V620 gold completion never calls MSI or first-line prefetch',async()=>{
  const controller=new AbortController();let backup=0,early=0;
  const complete=remoteWith(async()=>{
    controller.abort();throw Error('cancelled');
  },async()=>{backup++;return good;});
  await assert.rejects(
    gold(complete).generate({kind:'donation',text:'Are you listening?',
      signal:controller.signal,onFirstLine:()=>early++}),/cancelled/
  );
  assert.equal(backup,0);assert.equal(early,0);
});

test('V620 gold wrapper never alters MSI requests or requires synthetic lore hooks',async()=>{
  const complete=remoteWith(async ({messages})=>{
    const current=JSON.parse(messages.at(-1).content);
    assert.ok(!('contextual_grievance_hooks' in current));
    assert.ok(!('blackout_live_v01' in current));
    assert.ok(!('focus_terms' in current));
    assert.deepEqual(Object.keys(current).sort(),['direction','history','input','kind']);
    return good;
  },async()=>{throw Error('unexpected fallback');});
  await gold(complete).generate({kind:'donation',text:'Do you like this hat?'});
  assert.doesNotMatch(JSON.stringify(complete.status()),/Private synthetic TEST personality|Shanny is absurdly defensive/);
});

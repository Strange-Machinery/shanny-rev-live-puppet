import test from 'node:test';
import assert from 'node:assert/strict';
import {liveMood} from '../src/live-moods.mjs';
import {firstStreamedLine,validateExchange,createConversationDirector} from '../src/conversation-director.mjs';
import {createLiveServer} from '../src/live-server.mjs';
import {MockVoiceProvider} from '../src/providers/mock.mjs';
import {createLocalPuppetGateway} from '../src/donations/gateway-client.mjs';
test('actor mood whitelist and complete streamed mood preserve the exact prepared line',()=>{
 assert.equal(liveMood('SHANNY'),'anger');assert.equal(liveMood('REV'),'skeptical');
 assert.throws(()=>liveMood('REV','crying'));assert.throws(()=>liveMood('SHANNY','pacifying'));
 const plan={lines:[{actor:'SHANNY',text:'That money should be mine.',mood:'rage'},{actor:'REV',text:'Calm down and talk to him.',mood:'pacifying'}],rev_reason:'Pacifies her'};
 assert.deepEqual(firstStreamedLine(JSON.stringify(plan)),validateExchange(plan,'donation').lines[0]);
 assert.equal(firstStreamedLine('{"lines":[{"actor":"SHANNY","text":"Wait.","mood":"rag'),null);
 assert.throws(()=>validateExchange({...plan,lines:[{...plan.lines[0],mood:'play_animation'},plan.lines[1]]},'donation'));
});
test('held audio carries its validated mood only when released; panic invalidates the held mood',async()=>{
 const server=createLiveServer({provider:new MockVoiceProvider(),token:'mood-test-credential',port:0,startMuted:true});
 const {port}=await server.start(),g=createLocalPuppetGateway({url:'http://127.0.0.1:'+port,token:'mood-test-credential'});
 try {
  await g.resume();const scope=await g.status();
  const job=await g.speak({actor:'SHANNY',text:'Wait.',mood:'crying',prepare_only:true});
  for(let i=0;i<100;i++){if((await g.events()).events.some(e=>e.type==='speech.prepared'&&e.id===job.request_id))break;await new Promise(r=>setTimeout(r,10));}
  assert.equal((await g.events()).events.some(e=>e.type==='speech.ready'&&e.id===job.request_id),false);
  await g.release({id:job.request_id,session_id:scope.session_id,epoch:scope.epoch});
  assert.equal((await g.events()).events.find(e=>e.type==='speech.ready'&&e.id===job.request_id).mood,'crying');
  const late=await g.speak({actor:'REV',text:'Wait.',mood:'pacifying',prepare_only:true});await g.panic();
  await assert.rejects(g.release({id:late.request_id,session_id:scope.session_id,epoch:scope.epoch}),/Stale/);
  await g.resume();await assert.rejects(g.speak({actor:'REV',text:'Wait.',mood:'crying'}),/Invalid actor/);
 }finally{await server.close();}
});
test('Qwen output grammar pairs each actor with only their allowed moods',async()=>{
 let schema;const director=createConversationDirector({notes:'Private',complete:async request=>{
  schema=request.responseSchema;
  return {lines:[{actor:'SHANNY',text:'Why are you laughing?',mood:'crying'},{actor:'REV',text:'Take a breath and talk.',mood:'pacifying'}],rev_reason:'Pacifies her'};
 }});
 await director.generate({kind:'donation',text:'Buff got money.'});
 const branches=schema.properties.lines.items.anyOf;
 const shanny=branches.find(b=>b.properties.actor.enum.includes('SHANNY'));
 const rev=branches.find(b=>b.properties.actor.enum.includes('REV'));
 assert.equal(shanny.properties.actor.enum.length,1);assert.equal(rev.properties.actor.enum.length,1);
 assert.equal(shanny.properties.mood.enum.includes('crying'),true);assert.equal(shanny.properties.mood.enum.includes('pacifying'),false);
 assert.equal(rev.properties.mood.enum.includes('pacifying'),true);assert.equal(rev.properties.mood.enum.includes('crying'),false);
});

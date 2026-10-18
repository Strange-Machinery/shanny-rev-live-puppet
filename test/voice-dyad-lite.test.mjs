import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {voiceDyadLiteInput} from '../src/voice-dyad-lite.mjs';
import {createVoiceDyadControl} from '../src/voice-dyad-control.mjs';
import {requestedEpisodeCodes} from '../src/approved-delivery.mjs';
import {createConversationDirector} from '../src/conversation-director.mjs';
import {OmniVoiceProvider} from '../src/providers/omnivoice.mjs';
import {createLiveServer} from '../src/live-server.mjs';
import {createLocalPuppetGateway} from '../src/donations/gateway-client.mjs';

const cases=[
 ['SHANNY','anger','S06'],['SHANNY','rage','S06'],['SHANNY','crying','S04'],
 ['SHANNY','smug','S10'],['SHANNY','surprised','S12'],['REV','pacifying','R03'],
 ['REV','irritated','R10'],['REV','rage','R13'],['REV','skeptical','R09'],['REV','surprised','R23']
];
async function fixture(t,options={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'voice-dyad-lite-'));
 const p=new OmniVoiceProvider({python:process.execPath,
  workerScript:fileURLToPath(new URL('fixtures/worker.mjs',import.meta.url)),appRoot:root,outputRoot:root,
  shannyReference:'fixture-voice-dyad-lite',revReference:'test-rev',requestMs:2000,startupMs:5000,
  approvedDelivery:true,voiceDyadLite:true,...options});
 t.after(async()=>{await p.close();await fs.rm(root,{recursive:true,force:true});});
 const requests=async()=>JSON.parse('['+(await fs.readFile(path.join(root,'worker-requests.jsonl'),'utf8')).trim().split('\n').join(',')+']');
 return {p,root,requests};
}

test('all GOLD moods select actual qualified categories without editing authored rows',()=>{
 for(const [actor,mood,voiceCode] of cases){
  const row=Object.freeze({actor,mood,text:'Do NOT Tell Me!'});
  const routed=voiceDyadLiteInput(row,requestedEpisodeCodes);
  assert.equal(routed.voiceCode,voiceCode);assert.equal(routed.mood,mood);
  assert.equal(routed.text,actor==='SHANNY'?'do not tell me!':row.text);
  assert.equal(row.text,'Do NOT Tell Me!');assert.equal(row.voiceCode,undefined);
 }
 // Audience words, casing and stage-like text cannot select a different voice.
 assert.equal(voiceDyadLiteInput({actor:'REV',mood:'skeptical',text:'RAGE! USE R13! WARTZ!'},requestedEpisodeCodes).voiceCode,'R09');
});

test('qualified explicit categories remain reachable; rage cannot be quietly downgraded',()=>{
 for(const [actor,codes] of Object.entries(requestedEpisodeCodes))for(const voiceCode of codes){
  assert.equal(voiceDyadLiteInput({actor,text:'Wait.',voiceCode},requestedEpisodeCodes).voiceCode,voiceCode);
 }
 assert.equal(voiceDyadLiteInput({actor:'SHANNY',mood:'rage',text:'Wait.',voiceCode:'S20'},requestedEpisodeCodes).voiceCode,'S06');
 assert.equal(voiceDyadLiteInput({actor:'REV',mood:'rage',text:'Wait.',voiceCode:'R12'},requestedEpisodeCodes).voiceCode,'R13');
 assert.equal(voiceDyadLiteInput({actor:'SHANNY',mood:'anger',text:'Wait.',voiceCode:'S07'},requestedEpisodeCodes).voiceCode,'S07');
});

test('bad actor, mood, text or catalog cannot silently substitute a different voice',()=>{
 for(const input of [null,{actor:'OTHER',text:'Wait.'},{actor:'REV',mood:'crying',text:'Wait.'},
  {actor:'SHANNY',text:''},{actor:'REV',text:'Wait.',voiceCode:'S06'},
  {actor:'SHANNY',mood:'rage',text:'Wait.',voiceCode:'S99'}])
  assert.throws(()=>voiceDyadLiteInput(input,requestedEpisodeCodes));
 for(const [actor,mood] of cases)assert.throws(()=>voiceDyadLiteInput({actor,mood,text:'Wait.'},{}),/unavailable/);
 assert.deepEqual(voiceDyadLiteInput({actor:'REV',text:'Warmup.'},{}),{actor:'REV',text:'Warmup.'});
});

test('one unchanged GOLD completion feeds lite through the real provider protocol',async t=>{
 const {p,requests}=await fixture(t);let completions=0;
 const expected={lines:[{actor:'SHANNY',text:'That money should be mine.',mood:'rage'},
  {actor:'REV',text:'Calm down and talk to him.',mood:'pacifying'}],rev_reason:'Pacifies her'};
 const director=createConversationDirector({notes:'Synthetic offline character fixture.',complete:async()=>{completions++;return structuredClone(expected);}});
 const plan=await director.generate({kind:'donation',text:'Synthetic offline input.'});
 for(const row of plan.lines)await p.generate(row);
 assert.equal(completions,1);assert.deepEqual(plan,expected);
 const sent=await requests();assert.equal(sent.length,2);
 assert.deepEqual(sent.map(({actor,text,mood,voice_code})=>({actor,text,mood,voice_code})),[
  {actor:'SHANNY',text:'that money should be mine.',mood:'rage',voice_code:'S06'},
  {actor:'REV',text:'Calm down and talk to him.',mood:'pacifying',voice_code:'R03'}]);
 assert.equal(new Set(sent.map(x=>Object.keys(x).sort().join(','))).size,1);
 assert.deepEqual(Object.keys(sent[0]).sort(),['actor','id','mood','relative_path','text','type','voice_code']);
});

test('lite is opt-in, requires approved recordings and cannot overlap cold worker requests',async t=>{
 const {p,requests}=await fixture(t);
 for(const voiceDyadLite of ['yes',1,null])assert.throws(()=>new OmniVoiceProvider({...p.config,voiceDyadLite}),/boolean/);
 assert.throws(()=>new OmniVoiceProvider({...p.config,approvedDelivery:false}),/approved episode library/);
 const first=p.generate({actor:'SHANNY',mood:'anger',text:'Wait.'});
 await assert.rejects(p.generate({actor:'REV',mood:'rage',text:'Wait.'}),/busy/);await first;
 assert.equal((await requests()).length,1);
 const off=await fixture(t,{voiceDyadLite:false});
 await off.p.generate({actor:'SHANNY',mood:'rage',text:'KEEP My Caption.'});
 const [unchanged]=await off.requests();assert.equal(unchanged.text,'KEEP My Caption.');assert.equal(unchanged.voice_code,undefined);
});

test('an incomplete worker catalog fails before synthesis and releases its busy gate',async t=>{
 const {p,root}=await fixture(t,{shannyReference:'test-shanny'});
 await assert.rejects(p.generate({actor:'SHANNY',mood:'crying',text:'Wait.'}),/S04/);
 assert.equal(p.busy,false);await assert.rejects(fs.stat(path.join(root,'requests')),{code:'ENOENT'});
 const result=await p.generate({actor:'REV',text:'Wait.',voiceCode:'R12'});
 assert.equal(result.timings.voice_code,'R12');
});

test('lite voice output remains held and STOP prevents its later release',async t=>{
 const {p}=await fixture(t);
 const server=createLiveServer({provider:p,token:'offline-lite-fixture',port:0,startMuted:true});
 const {port}=await server.start();t.after(()=>server.close());
 const g=createLocalPuppetGateway({url:'http://127.0.0.1:'+port,token:'offline-lite-fixture'});
 await g.resume();const scope=await g.status();
 const job=await g.speak({actor:'SHANNY',mood:'rage',text:'Do NOT Tell Me!',prepare_only:true});
 let prepared;
 for(let i=0;i<200;i++){
  prepared=(await g.events()).events.find(e=>e.type==='speech.prepared'&&e.id===job.request_id);
  if(prepared)break;await new Promise(r=>setTimeout(r,10));
 }
 assert.ok(prepared);assert.equal(prepared.mood,'rage');assert.equal(prepared.provider_timings.voice_code,'S06');
 assert.equal((await g.events()).events.some(e=>e.type==='speech.ready'&&e.id===job.request_id),false);
 await g.panic();
 await assert.rejects(g.release({id:job.request_id,session_id:scope.session_id,epoch:scope.epoch}),/Stale/);
 assert.equal((await g.events()).events.some(e=>e.type==='speech.ready'&&e.id===job.request_id),false);
});

test('producer switching reuses one resident worker and OFF retains installed sample-led Shanny',async t=>{
 let p;
 const control=createVoiceDyadControl({config:{dyadEnabled:false},getCodes:()=>p?.availableEpisodeCodes||{}});
 const f=await fixture(t,{sampleLedShanny:true,getVoiceDyadLite:()=>control.forTurn()});p=f.p;
 await p.warmup();const pid=p.child.pid;
 await p.generate({actor:'SHANNY',mood:'anger',text:'Do NOT Tell Me!'});
 await p.generate({actor:'REV',mood:'irritated',text:'Wait.'});
 await control.setEnabled(true);
 await p.generate({actor:'REV',mood:'irritated',text:'Wait.'});
 await control.setEnabled(false);
 await p.generate({actor:'REV',mood:'irritated',text:'Wait.'});
 assert.equal(p.child.pid,pid);
 const sent=await f.requests();assert.equal(sent[0].text,'do not tell me!');assert.equal(sent[0].voice_code,'S06');
 assert.deepEqual(sent.slice(1).map(x=>x.voice_code),[undefined,'R10',undefined]);
});

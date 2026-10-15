import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyEpisodeCode,requestedEpisodeCodes,shortlistEpisodeCodes} from '../src/approved-delivery.mjs';
import {OmniVoiceProvider} from '../src/providers/omnivoice.mjs';
import {createLiveServer} from '../src/live-server.mjs';
import {mockSpeechWav} from '../src/wav.mjs';

test('all 43 episode delivery categories are actor-qualified, not guessed',()=>{
 assert.equal(requestedEpisodeCodes.SHANNY.length,20);
 assert.equal(requestedEpisodeCodes.REV.length,23);
 assert.equal(verifyEpisodeCode('SHANNY','S07'),true);
 assert.equal(verifyEpisodeCode('REV','S07'),false);
 assert.equal(verifyEpisodeCode('REV','R11'),true);
 assert.equal(verifyEpisodeCode('SHANNY','R11'),false);
 assert.equal(verifyEpisodeCode('REV','R99'),false);
});

test('every approved category is accessible through relevant fast cue, while Qwen menu stays small',()=>{
 const conditions=[
   'They are crying with grief and feel betrayed.',
   'Stop whining and complaining.',
   'Please help, I am scared.',
   'I am furious and humiliated.',
   'Really, what is so surprising and confusing?',
   'I love and appreciate you, thank you.',
   'You are funny, proud, and winning, haha!',
   'I am sorry and apologize.',
   'That is disgusting, filthy, and congealed.',
   'Stop being smug and superior.',
   'Stop, respect my boundaries.',
   'I am tired and exhausted; sigh.',
   'Please explain the evidence and facts.'
 ];
 const exposed={SHANNY:new Set(),REV:new Set()};
 for(const input of conditions){
   const menu=shortlistEpisodeCodes(requestedEpisodeCodes,input);
   for(const actor of ['SHANNY','REV']){
     assert.ok(menu[actor].length<=10);
     for(const code of menu[actor])exposed[actor].add(code);
   }
 }
 for(const actor of ['SHANNY','REV'])
   for(const code of requestedEpisodeCodes[actor])
     assert.ok(exposed[actor].has(code),actor+' '+code+' unreachable');
});

test('resident voice worker selects an episode category without changing pitch settings',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'buff-voice-menu-'));
 const provider=new OmniVoiceProvider({
  python:process.execPath,
  workerScript:fileURLToPath(new URL('./fixtures/worker.mjs',import.meta.url)),
  appRoot:dir,outputRoot:dir,shannyReference:'fixture-shanny',revReference:'fixture-rev',
  approvedDelivery:true,startupMs:3000,requestMs:1500
 });
 t.after(async()=>{await provider.close();await fs.rm(dir,{recursive:true,force:true})});
 await provider.warmup();
 assert.deepEqual(provider.availableEpisodeCodes.SHANNY,['S07','S08']);
 assert.deepEqual(provider.availableEpisodeCodes.REV,['R11','R12']);
 const result=await provider.generate({actor:'SHANNY',
  text:'Stop treating donations like orders!',mood:'anger',voiceCode:'S07'});
 assert.equal(result.timings.voice_code,'S07');
 assert.equal(result.timings.reference_id,'qualified-fixture-S07');
 await assert.rejects(provider.generate({actor:'SHANNY',text:'Bad',voiceCode:'S06'}),/Unqualified/);
 await assert.rejects(provider.generate({actor:'REV',text:'Bad',voiceCode:'S07'}),/Unqualified/);
});

test('gateway preserves queue semantics while forwarding separate voice_code',async t=>{
 const token='private-test-gateway-local-key',seen=[];
 const provider={async generate(job){seen.push(job);return mockSpeechWav('safe');}};
 const server=createLiveServer({provider,token,port:0,startMuted:false});
 const {port}=await server.start();
 t.after(()=>server.close());
 const api=async body=>{
  const r=await fetch('http://127.0.0.1:'+port+'/v1/speak',{method:'POST',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(body)});
  return {status:r.status,result:await r.json()};
 };
 assert.equal((await api({actor:'SHANNY',text:'Wait!',voice_code:'R11'})).status,400);
 assert.equal((await api({actor:'REV',text:'Wait!',voice_code:'S07'})).status,400);
 assert.equal((await api({actor:'SHANNY',text:'Wait!',delivery:'queue',voice_code:'S07'})).status,202);
 for(let i=0;i<80&&!seen.length;i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(seen.length,1);
 assert.equal(seen[0].voiceCode,'S07');
 assert.equal(seen[0].mood,'anger');
 assert.equal(seen[0].actor,'SHANNY');
});

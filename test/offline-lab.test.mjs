import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineLab } from '../src/testing/lab.mjs';
import { OfflineConversation, createFileWhisper } from '../src/testing/conversation.mjs';
import { flush } from './helpers/show-fixture.mjs';
import { wav } from './helpers/show-fixture.mjs';
import { fileURLToPath } from 'node:url';

test('offline lab drives real HTTP APIs, conversation replay, stop and retained test show',async()=>{
  const lab=await createOfflineLab();
  try {
    const cold=await lab.action({action:'status'});assert.equal(cold.mode,'muted');assert.equal(cold.whisper_available,false);
    const scope=await lab.action({action:'arm'});const response=await lab.action({action:'transcript',text:'Hi Rev',actor:'REV',session_id:scope.session_id,mode_epoch:scope.mode_epoch});
    assert.equal(response.status,'released');assert.equal(response.source,'OFFLINE_REPLAY');
    await new Promise(resolve=>setTimeout(resolve,900));
    const status=await lab.action({action:'status'});assert.ok(status.trace.some(e=>e.type==='playback.finished'));assert.equal(status.conversation_context_turns,1);
    await lab.action({action:'stop'});await lab.action({action:'stop'});assert.equal((await lab.action({action:'status'})).resume_count,1);
  } finally {await lab.close();}
});
test('offline conversation rejects partials and drops late Whisper results after stop/re-arm',async()=>{
  let resolveTranscript;let epoch=1;const spoken=[];
  const controller={mode:'live',modeEpoch:epoch,coordinator:{sessionId:'s'},aborter:new AbortController()};
  const conversation=new OfflineConversation({controller,gateway:{speak:async data=>spoken.push(data)},director:{generate:async()=>({})},
    whisper:{transcribe:()=>new Promise(resolve=>{resolveTranscript=resolve;})}});
  await assert.rejects(conversation.respond({text:'partial',final:false,session_id:'s',mode_epoch:epoch}),/partial/);
  const task=conversation.respond({audioPath:'fixture.wav',session_id:'s',mode_epoch:epoch,source:'BUFF_ISOLATED_MIC_TEST'});
  controller.modeEpoch=++epoch;controller.aborter.abort();controller.aborter=new AbortController();conversation.stop();
  resolveTranscript({text:'stale microphone',final:true});await assert.rejects(task,/Stale/);assert.equal(spoken.length,0);
});
test('offline speech cannot speak after stop while Qwen ignores cancellation',async()=>{
  let resolve;const spoken=[];const controller={mode:'live',modeEpoch:1,coordinator:{sessionId:'s'},aborter:new AbortController()};
  const conversation=new OfflineConversation({controller,gateway:{speak:async data=>spoken.push(data)},director:{generate:()=>new Promise(r=>{resolve=r;})}});
  const task=conversation.respond({text:'Buff speaks',session_id:'s',mode_epoch:1});await flush();
  controller.mode='show';conversation.stop();resolve({actor:'SHANNY',text:'stale',emotion:'neutral',intensity:.5});await assert.rejects(task,/Stale/);assert.equal(spoken.length,0);
});
test('Whisper subprocess cancellation kills only its test worker',async()=>{
  const provider=createFileWhisper({python:process.execPath,workerScript:fileURLToPath(new URL('./fixtures/whisper.mjs',import.meta.url)),modelPath:'fixture',timeoutMs:1000});
  const controller=new AbortController();const task=provider.transcribe({audioPath:'fixture',signal:controller.signal});controller.abort();
  await assert.rejects(task,/cancelled/);
});
test('desktop test audio waits for real output receipts before generating/releasing reaction',async()=>{
  const lab=await createOfflineLab({voiceProvider:{name:'fixture-for-desktop-driver',generate:async job=>wav(job.prepareOnly?10000:1000)},desktopAudio:true});
  try {
    await lab.action({action:'arm'});await lab.action({action:'donate',text:'Read this on the desktop test driver'});
    let status;
    for(let i=0;i<30;i++){status=await lab.action({action:'status'});if(status.trace.some(e=>e.type==='speech.ready'))break;await new Promise(resolve=>setTimeout(resolve,10));}
    const read=status.trace.find(e=>e.type==='speech.ready');assert.ok(read);
    assert.equal(status.trace.some(e=>e.type==='playback.started'),false);
    assert.ok((await lab.audio(read.id)).length>44);
    await lab.action({action:'playback',id:read.id,state:'started'});
    for(let i=0;i<30;i++){status=await lab.action({action:'status'});if(status.trace.some(e=>e.type==='speech.prepared'))break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.ok(status.trace.some(e=>e.type==='speech.prepared'));assert.equal(status.trace.filter(e=>e.type==='speech.ready').length,1);
    await lab.action({action:'playback',id:read.id,state:'finished'});
    for(let i=0;i<30;i++){status=await lab.action({action:'status'});if(status.trace.filter(e=>e.type==='speech.ready').length===2)break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(status.trace.filter(e=>e.type==='speech.ready').length,2);
    await lab.action({action:'stop'});await assert.rejects(lab.audio(read.id),/current/);
  } finally {await lab.close();}
});

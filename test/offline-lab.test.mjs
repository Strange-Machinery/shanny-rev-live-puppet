import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineLab } from '../src/testing/lab.mjs';
import { OfflineConversation, createFileWhisper } from '../src/testing/conversation.mjs';
import { flush } from './helpers/show-fixture.mjs';
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

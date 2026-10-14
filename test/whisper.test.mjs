import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {PersistentWhisper} from '../src/providers/whisper.mjs';
function worker(t){const value=new PersistentWhisper({python:process.execPath,workerScript:fileURLToPath(new URL('./fixtures/whisper-worker.mjs',import.meta.url)),modelPath:'fixture',startupMs:2000,requestMs:200});t.after(()=>value.close());return value;}
test('Whisper keeps one recognizer across successive final utterances',async t=>{
  const p=worker(t);await p.warmup();const pid=p.child.pid;
  const first=await p.transcribe({audioPath:'one'}),second=await p.transcribe({audioPath:'two'});
  assert.equal(p.child.pid,pid);assert.equal(first.text,second.text);assert.equal(second.final,true);
});
test('Whisper Stop cancels its worker; retry starts a fresh recognizer without stale output',async t=>{
  const p=worker(t);await p.warmup();const pid=p.child.pid,controller=new AbortController();
  const pending=p.transcribe({audioPath:'hang',signal:controller.signal});await delay(10);
  await assert.rejects(p.transcribe({audioPath:'overlap'}),/busy/);
  controller.abort();await assert.rejects(pending,/cancelled/);assert.equal(p.child,null);
  await p.transcribe({audioPath:'retry'});assert.notEqual(p.child.pid,pid);
});
test('Whisper times out and rejects partial worker output',async t=>{
  const p=worker(t);await assert.rejects(p.transcribe({audioPath:'hang'}),/timed out/);
  await assert.rejects(p.transcribe({audioPath:'malformed'}),/Invalid/);
  await p.close();await assert.rejects(p.transcribe({audioPath:'closed'}),/closed/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {OmniVoiceProvider} from '../src/providers/omnivoice.mjs';
import {inspectWav} from '../src/wav.mjs';
async function provider(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'puppet-worker-'));
 const p=new OmniVoiceProvider({python:process.execPath,workerScript:fileURLToPath(new URL('fixtures/worker.mjs',import.meta.url)),appRoot:root,outputRoot:root,shannyReference:'test-shanny',revReference:'test-rev',requestMs:500,startupMs:2000});
 t.after(async()=>{await p.close();await fs.rm(root,{recursive:true,force:true});});return {p,root};}
test('persistent adapter generates both actors and removes temporary WAVs',async t=>{
 const {p,root}=await provider(t);const first=await p.generate({actor:'SHANNY',text:'one'});const pid=p.child.pid;
 inspectWav(first.wav);assert.ok(first.timings.worker_cold_startup_ms>0);
 const second=await p.generate({actor:'REV',text:'two'});assert.equal(second.timings.worker_cold_startup_ms,null);assert.equal(p.child.pid,pid);
 assert.deepEqual(await fs.readdir(path.join(root,'requests')),[]);
});
test('worker timeout and exit recover on next request',async t=>{
 const {p}=await provider(t);
 await assert.rejects(p.generate({actor:'REV',text:'timeout'}),/timeout/);
 inspectWav((await p.generate({actor:'SHANNY',text:'recovered'})).wav);
 await assert.rejects(p.generate({actor:'REV',text:'crash'}),/exited/);
 inspectWav((await p.generate({actor:'REV',text:'recovered again'})).wav);
});
test('unexpected output path and concurrent calls are rejected',async t=>{
 const {p}=await provider(t);await assert.rejects(p.generate({actor:'REV',text:'wrong-path'}),/unexpected/);
 const active=p.generate({actor:'SHANNY',text:'one'});
 await assert.rejects(p.generate({actor:'REV',text:'two'}),/busy/);await active;
});

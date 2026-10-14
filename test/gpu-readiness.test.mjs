import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForVoiceMemory} from '../src/gpu-readiness.mjs';
test('launcher waits through a GPU memory spike and requires stable headroom',async()=>{
  let now=0,index=0;const updates=[];const values=[3000,4200,2900,4600,4700];
  const free=await waitForVoiceMemory({readFreeMiB:async()=>values[index++],progress:m=>updates.push(m),now:()=>now,sleep:async ms=>{now+=ms;}});
  assert.equal(free,4700);assert.equal(index,5);assert.match(updates[0],/retrying automatically/);
});
test('persistent GPU pressure reports the actual resource problem',async()=>{
  let now=0;
  await assert.rejects(waitForVoiceMemory({readFreeMiB:async()=>3072,now:()=>now,sleep:async ms=>{now+=ms;},timeoutMs:3000}),/GPU stayed busy: 3.0 GB/);
  await assert.rejects(waitForVoiceMemory({readFreeMiB:async()=>''+NaN}),/Could not read/);
});

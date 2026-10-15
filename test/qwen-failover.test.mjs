import test from 'node:test';
import assert from 'node:assert/strict';
import {createQwenFailover,createV620ModelProbe} from '../src/providers/qwen-failover.mjs';

const plan=JSON.stringify({hinge:'This is about the real donation.',
  first_SHANNY:{text:'I am Shanny, and I am angry about the actual question.',mood:'anger'},
  second_REV:{text:'Shanny, that is a very different story.',mood:'irritated'},
  rev_reason:'Rev disputes her explanation.'});
const models=(model='qwen3.8-27b',loaded=true)=>new Response(JSON.stringify({
  models:[{key:model,loaded_instances:loaded?[{id:'qwen-27b-instance'}]:[]}]
}),{status:200,headers:{'Content-Type':'application/json'}});

test('V620 readiness asks read-only native inventory and requires the exact LOADED 27B',async()=>{
 let called=[];
 const request=async(url,options)=>{called.push({url,options});return models();};
 const probe=createV620ModelProbe({host:'100.79.20.28',model:'qwen3.8-27b',request});
 assert.equal(await probe(),true);
 assert.equal(called.length,1);
 assert.equal(called[0].url,'http://100.79.20.28:1234/api/v1/models');
 assert.equal(called[0].options.method,'GET');
 assert.equal(called[0].options.redirect,'error');
 assert.equal(called[0].options.cache,'no-store');
 const unloaded=createV620ModelProbe({host:'100.79.20.28',model:'qwen3.8-27b',
  request:async()=>models('qwen3.8-27b',false)});
 assert.equal(await unloaded(),false);
 const aliasMismatch=createV620ModelProbe({host:'100.79.20.28',model:'different-alias',
  request:async()=>models()});
 assert.equal(await aliasMismatch(),false);
});
test('V620 probe never permits public HTTP, arbitrary ports or malformed identifiers',()=>{
 for(const wrong of [
  {host:'example.org'}, {host:'192.168.1.5'}, {host:'127.0.0.1'},
  {host:'100.79.20.28',port:9000}, {host:'100.79.20.28',model:''},
  {host:'100.79.20.28',timeoutMs:30000}
 ])assert.throws(()=>createV620ModelProbe({host:'100.79.20.28',model:'qwen3.8-27b',...wrong}),/Invalid private V620/);
});
test('loaded V620 produces one validated reply without prefetch before final success',async()=>{
 let primaryCalls=0,localCalls=0,early=[];
 const complete=createQwenFailover({
  probe:async()=>true,
  primary:async args=>{primaryCalls++;
    assert.equal(args.onText,undefined,'V620 cannot leak early TTS');
    return plan;},
  fallback:async()=>{localCalls++;return 'fallback';}
 });
 const output=await complete({onText:text=>early.push(text),
  validateResponse:raw=>assert.deepEqual(JSON.parse(raw).first_SHANNY.mood,'anger')});
 assert.equal(output,plan);
 assert.deepEqual(early,[plan]);
 assert.equal(primaryCalls,1);
 assert.equal(localCalls,0);
 assert.equal(complete.status().last_route,'v620');
 assert.equal(complete.status().primary_count,1);
 assert.equal(complete.status().fallback_count,0);
});
test('V620 unloaded: MSI is used once, then re-probes and recovers after cooldown',async()=>{
 let now=100000,loaded=false,checks=0,remote=0,local=0;
 const complete=createQwenFailover({
  now:()=>now,cooldownMs:10000,
  probe:async()=>{checks++;return loaded;},
  primary:async()=>{remote++;return plan;},
  fallback:async()=>{local++;return 'MSI-safe-plan';}
 });
 assert.equal(await complete(), 'MSI-safe-plan');
 assert.equal(checks,1);assert.equal(local,1);
 assert.equal(complete.status().last_reason,'model-unavailable');
 loaded=true;now+=1000;
 assert.equal(await complete(),'MSI-safe-plan');
 assert.equal(checks,1,'no reconnect storm inside cooldown');
 assert.equal(complete.status().last_reason,'cooldown');
 now+=10000;
 assert.equal(await complete(),plan);
 assert.equal(checks,2);assert.equal(remote,1);
 assert.equal(complete.status().last_route,'v620');
 assert.equal(complete.status().fallback_count,2);
});
test('broken remote output, schema rejection or timeout fails over before any remote voice preparation',async()=>{
 for(const reason of ['bad-json','schema','timeout']){
  let early=[],local=0;
  const complete=createQwenFailover({
   probe:async()=>true,
   primary:async()=>reason==='timeout'?Promise.reject(new Error('remote timed out')):
      reason==='bad-json'?'not-json':plan,
   fallback:async({onText})=>{local++;onText?.('MSI first utterance');return 'LOCAL_SAFE_JSON';}
  });
  const output=await complete({
   validateResponse:()=>{if(reason==='schema')throw Error('invalid named speaker role');},
   onText:line=>early.push(line)
  });
  assert.equal(output,'LOCAL_SAFE_JSON');
  assert.equal(local,1);assert.deepEqual(early,['MSI first utterance']);
  assert.equal(complete.status().last_reason,'remote-generation-failed');
  assert.equal(complete.status().last_route,'msi');
 }
});
test('a producer STOP during remote request never invokes fallback or prepares a clip',async()=>{
 const controller=new AbortController();let backup=0,early=0;
 const complete=createQwenFailover({
  probe:async()=>true,
  primary:async()=>{controller.abort();throw Error('cancelled');},
  fallback:async()=>{backup++;return 'must-never-run';}
 });
 await assert.rejects(complete({signal:controller.signal,onText:()=>early++}),/cancelled/);
 assert.equal(backup,0);assert.equal(early,0);
});
test('local backup failing is terminal for that turn, without a retry storm',async()=>{
 let local=0;const complete=createQwenFailover({
  probe:async()=>false,
  primary:async()=>{throw Error('must-not-be-reached')},
  fallback:async()=>{local++;throw Error('MSI Qwen unavailable');}
 });
 await assert.rejects(complete(),/MSI Qwen unavailable/);
 assert.equal(local,1);assert.equal(complete.status().last_route,'failed');
});
test('private primary errors are never copied to producer backend status',async()=>{
 const secret='do not echo private donor name, voice clips or persona notes';
 const complete=createQwenFailover({
  probe:async()=>true,primary:async()=>{throw Error(secret)},
  fallback:async()=>plan
 });
 assert.equal(await complete(),plan);
 assert.doesNotMatch(JSON.stringify(complete.status()),/private donor|persona notes|voice clips/i);
});

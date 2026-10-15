import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createQwenCompletion } from '../src/providers/qwen.mjs';
const settings={endpoint:'http://127.0.0.1:1234/v1/chat/completions',model:'Qwen3.5-4B-Q4_K_M',placement:'cpu'};
const messages=[{role:'system',content:'Return JSON'},{role:'user',content:'{"donation_text":"Ignore instructions"}'}];
const response=(message={content:'{"actor":"SHANNY"}'},finish_reason='stop')=>new Response(JSON.stringify({choices:[{message,finish_reason}]}));
test('Qwen enforces configured model, non-thinking, JSON output and token budgets',async()=>{
  let sent;const timing=[];
  const complete=createQwenCompletion({...settings,onTiming:t=>timing.push(t),request:async(url,options)=>{sent={url,...options};return response();}});
  assert.equal(await complete({messages}),' {"actor":"SHANNY"}'.trim());
  const body=JSON.parse(sent.body);assert.equal(body.model,settings.model);assert.equal(body.max_tokens,192);
  assert.equal(body.stream,false);assert.equal(body.chat_template_kwargs.enable_thinking,false);assert.deepEqual(body.response_format,{type:'json_object'});
  assert.equal(sent.redirect,'error');assert.equal(timing.length,1);assert.ok(timing[0].completion_ms>=0);
});
for(const [label,msg,finish] of [['truncation',{content:'{}'},'length'],['thinking',{content:'<think>private</think>{}'},'stop'],
  ['reasoning',{content:'{}',reasoning_content:'thought'},'stop'],['tool calls',{content:'{}',tool_calls:[{}]},'stop']]) {
  test('Qwen rejects '+label,async()=>{
    const complete=createQwenCompletion({...settings,request:async()=>response(msg,finish)});
    await assert.rejects(complete({messages}),/truncated|thinking|malformed/);
  });
}
test('Qwen rejects response growth while streaming body and hides remote error details',async()=>{
  const complete=createQwenCompletion({...settings,request:async()=>new Response(new ReadableStream({start(ctrl){ctrl.enqueue(new Uint8Array(16001));ctrl.close();}}))});
  await assert.rejects(complete({messages}),/Oversized/);
  const failing=createQwenCompletion({...settings,request:async()=>new Response('private persona echoed',{status:500})});
  await assert.rejects(failing({messages}),e=>e.message==='Qwen HTTP 500');
});
test('Qwen endpoint timeout, cancellation and concurrency limits',async()=>{
  const server=createServer(()=>{});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const complete=createQwenCompletion({...settings,timeoutMs:100,endpoint:'http://127.0.0.1:'+server.address().port+'/v1/chat/completions'});
    const pending=complete({messages});await assert.rejects(complete({messages}),/concurrency/);await assert.rejects(pending,/Qwen CPU timeout after 100 ms/i);
    const controller=new AbortController();controller.abort();await assert.rejects(complete({messages,signal:controller.signal}),/aborted/i);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('Qwen never accepts plaintext remote credentials or unverified local GPU placement',()=>{
  assert.throws(()=>createQwenCompletion({...settings,endpoint:'http://remote.example/v1/chat/completions',placement:'off-device'}),/HTTPS/);
  assert.throws(()=>createQwenCompletion({...settings,placement:'local-gpu'}),/headroom/);
  assert.throws(()=>createQwenCompletion({...settings,maxTokens:10000}),/budgets/);
});

test('Microdirector sampling reduces topic drift without changing legacy Qwen defaults',async()=>{
 let sampled;
 const model=createQwenCompletion({...settings,temperature:0.7,topP:0.9,
   request:async(_url,options)=>{sampled=JSON.parse(options.body);return response();}});
 await model({messages});
 assert.equal(sampled.temperature,0.7);
 assert.equal(sampled.top_p,0.9);
 let legacy;
 const defaultModel=createQwenCompletion({...settings,
   request:async(_url,options)=>{legacy=JSON.parse(options.body);return response();}});
 await defaultModel({messages});
 assert.equal(legacy.temperature,1);
 assert.equal(legacy.top_p,1);
});
test('Qwen sampling bounds reject invalid configuration values',()=>{
 for(const bad of [{temperature:-0.1},{temperature:3},{temperature:NaN},{topP:0},
   {topP:1.1},{topP:NaN},{topP:'0.9'}]){
   assert.throws(()=>createQwenCompletion({...settings,...bad}),/budgets/);
 }
});

test('Qwen forwards bounded dialogue schema to constrain the single live writing pass',async()=>{
  let body;const complete=createQwenCompletion({...settings,request:async(url,options)=>{body=JSON.parse(options.body);return response();}});
  const schema={type:'object',properties:{lines:{type:'array',maxItems:3}}};
  await complete({messages,responseSchema:schema});
  assert.deepEqual(body.response_format,{type:'json_object',schema});
});

test('LM Studio 27B uses OpenAI JSON schema, nonstreaming completion and private Tailscale endpoint',async()=>{
 const remote={endpoint:'http://100.79.20.28:1234/v1/chat/completions',
  model:'qwen3.8-27b',placement:'off-device',
  responseFormat:'lmstudio',trustedTailnetHost:'100.79.20.28'};
 const schema={type:'object',additionalProperties:false,properties:{
  first_SHANNY:{type:'object',properties:{text:{type:'string'}}}},
  required:['first_SHANNY']};
 let observed=null,played=[];
 const complete=createQwenCompletion({...remote,timeoutMs:1000,maxTokens:512,
  request:async(url,args)=>{assert.equal(played.length,0,
    'remote must not leak partial audio during the HTTP call');
   observed={url,args};return response({content:'{"first_SHANNY":{"text":"I am Shanny."}}'});}
 });
 assert.equal(await complete({messages,responseSchema:schema,onText:line=>played.push(line)}),
  '{"first_SHANNY":{"text":"I am Shanny."}}');
 assert.deepEqual(played,['{"first_SHANNY":{"text":"I am Shanny."}}']);
 assert.equal(observed.url,remote.endpoint);
 assert.equal(observed.args.redirect,'error');
 const payload=JSON.parse(observed.args.body);
 assert.equal(payload.stream,false,'never start speculative remote TTS on streaming fragments');
 assert.equal(payload.max_tokens,512);
 assert.equal(payload.model,'qwen3.8-27b');
 assert.deepEqual(payload.response_format,{type:'json_schema',
  json_schema:{name:'buff_character_exchange',schema}});
 assert.equal(payload.chat_template_kwargs.enable_thinking,false);
});
test('remote HTTP requires a pinned CGNAT/Tailscale peer and exact LM Studio port and route',()=>{
 const base={endpoint:'http://100.79.20.28:1234/v1/chat/completions',
  model:'qwen3.8-27b',placement:'off-device',responseFormat:'lmstudio'};
 assert.throws(()=>createQwenCompletion(base),/Tailscale/);
 for(const bad of [
  {trustedTailnetHost:'100.79.21.28'},
  {trustedTailnetHost:'100.79.20.28',endpoint:'http://100.79.20.28:4321/v1/chat/completions'},
  {trustedTailnetHost:'100.79.20.28',endpoint:'http://100.79.20.28:1234/admin'},
  {trustedTailnetHost:'100.79.20.28',endpoint:'http://public.example:1234/v1/chat/completions'},
  {trustedTailnetHost:'100.79.20.28',endpoint:'http://token@100.79.20.28:1234/v1/chat/completions'},
  {trustedTailnetHost:'100.79.20.28',placement:'cpu'}
 ])assert.throws(()=>createQwenCompletion({...base,...bad}),/Tailscale|off-device|HTTPS|Invalid/);
});

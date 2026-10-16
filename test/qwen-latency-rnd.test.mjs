import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ConversationSession} from '../src/conversation-session.mjs';
import {createQwenCompletion} from '../src/providers/qwen.mjs';

async function until(fn){
  for(let i=0;i<160;i++){if(fn())return;await delay(5);}
  throw Error('R&D test condition not reached');
}
const plan=()=>({hinge:'The viewer is winding both characters up.',
  lines:[{actor:'SHANNY',text:'You are not running my show, chat.',mood:'anger'},
    {actor:'REV',text:'You just proved their point yourself.',mood:'irritated'}],
  rev_reason:'Rev challenges Shanny rather than echoing her.'});
function stageFixture({director={generate:async()=>plan()}}={}){
  let epoch=0,muted=true,n=0;
  const history=[],spoken=[],released=[],stages=[];
  const emit=(type,id)=>history.push({type,id,seq:history.length+1,epoch,session_id:'s'});
  const gateway={
    panic:async()=>{epoch++;muted=true;emit('panic');},
    resume:async()=>{muted=false;emit('resume');},
    status:async()=>({session_id:'s',epoch,muted,cursor:history.length}),
    events:async({after})=>({session_id:'s',epoch,muted,cursor:history.length,events:history.slice(after)}),
    speak:async data=>{
      const id='clip-'+(++n);
      spoken.push({...data,id});
      if(data.prepare_only)emit('speech.prepared',id);
      return {request_id:id};
    },
    release:async data=>{released.push(data);}
  };
  const session=new ConversationSession({
    gateway,director,fastSeatedPlayback:true,
    presentation:{
      begin:async({rain,popup})=>{assert.equal(rain,false);stages.push('shown:'+popup.type);},
      waitVisible:async()=>true,
      end:async()=>{stages.push('hidden');},
      stop:()=>{stages.push('stopped');}
    }
  });
  return {session,spoken,released,stages,emit};
}
test('fast seated synthetic hotmic reveals after first WAV but before Rev is prepared',async()=>{
  const f=stageFixture();
  await f.session.initialize();const scope=await f.session.arm();
  await f.session.submit({kind:'microphone',text:'Chat wants to rile you up.',...scope});
  await until(()=>f.released.length===1);
  assert.deepEqual(f.stages,['shown:hotmic']);
  assert.equal(f.spoken.length,1,'only first approved actor WAV is needed');
  assert.equal(f.spoken[0].actor,'SHANNY');
  assert.ok(f.session.lastTiming.first_audio_ready_ms>=0);
  assert.equal(f.session.lastTiming.all_audio_ready_ms,undefined);
  f.emit('playback.started',f.spoken[0].id);
  await until(()=>f.spoken.length===2);
  assert.equal(f.spoken[1].actor,'REV');
  assert.equal(f.released.length,1,'Rev stays held during Shanny playback');
  f.emit('playback.finished',f.spoken[0].id);
  await until(()=>f.released.length===2);
  f.emit('playback.started',f.spoken[1].id);
  f.emit('playback.finished',f.spoken[1].id);
  await until(()=>!f.session.turn);
  assert.deepEqual(f.stages,['shown:hotmic','hidden']);
  assert.equal(f.session.error,'');
});
test('manual test donation reads first and schedules next actor only after first reply starts',async()=>{
  const f=stageFixture();
  await f.session.initialize();const scope=await f.session.arm();
  await f.session.submit({kind:'donation',text:'Hey Shanny, stop yelling!',...scope});
  await until(()=>f.released.length===1);
  assert.deepEqual(f.stages,['shown:test']);
  assert.equal(f.spoken.length,2,'reader and first actor ready; Rev not yet queued');
  assert.equal(f.spoken[0].actor,'SHANNY');
  f.emit('playback.started',f.spoken[0].id);f.emit('playback.finished',f.spoken[0].id);
  await until(()=>f.released.length===2);
  f.emit('playback.started',f.spoken[1].id);
  await until(()=>f.spoken.length===3);
  f.emit('playback.finished',f.spoken[1].id);
  await until(()=>f.released.length===3);
  f.emit('playback.started',f.spoken[2].id);f.emit('playback.finished',f.spoken[2].id);
  await until(()=>!f.session.turn);
  assert.deepEqual(f.stages,['shown:test','hidden']);
  assert.equal(f.session.error,'');
});
test('real paid donations are unchanged: all held speech must be ready before reveal',async()=>{
  const f=stageFixture();
  await f.session.initialize();const scope=await f.session.arm();
  await f.session.submit({kind:'donation',text:'No excuses.',
    donation:{provider:'streamlabs',donor:'Synthetic Test',amount:1,currency:'USD'},...scope});
  await until(()=>f.released.length===1);
  assert.deepEqual(f.stages,['shown:donation']);
  assert.equal(f.spoken.length,3,'paid route retained original all-voice preflight');
  assert.ok(f.session.lastTiming.all_audio_ready_ms>=0);
  await f.session.stop();await until(()=>!f.session.turn);
  assert.equal(f.released.length,1);
});
test('STOP during unvalidated speculative generation releases no audio',async()=>{
  let resolve;
  const f=stageFixture({director:{generate:async({onFirstLine})=>{
    onFirstLine({actor:'SHANNY',text:'You have no idea.',mood:'anger'});
    return new Promise(r=>{resolve=r;});
  }}});
  await f.session.initialize();const scope=await f.session.arm();
  await f.session.submit({kind:'microphone',text:'Testing STOP.',...scope});
  await until(()=>f.spoken.length===1);
  assert.equal(f.released.length,0);
  await f.session.stop();
  resolve(plan());
  await until(()=>!f.session.turn);
  assert.equal(f.released.length,0);
  assert.equal(f.stages.includes('shown:hotmic'),false);
});
test('Qwen metrics include backend tokens and request/header time, never prompt or dialogue',async()=>{
  const samples=[];
  const content='{"first_SHANNY":{"text":"I am Shanny."}}';
  const complete=createQwenCompletion({
    endpoint:'http://127.0.0.1:1234/v1/chat/completions',model:'test',placement:'cpu',
    onTiming:sample=>samples.push(sample),
    request:async()=>new Response(JSON.stringify({
      choices:[{message:{content},finish_reason:'stop'}],
      usage:{prompt_tokens:67,completion_tokens:21}
    }))
  });
  assert.equal(await complete({messages:[{role:'user',content:'Private fake test topic'}]}),content);
  assert.equal(samples.length,1);
  assert.equal(samples[0].status,'ok');
  assert.equal(samples[0].prompt_tokens,67);
  assert.equal(samples[0].completion_tokens,21);
  assert.ok(samples[0].response_headers_ms>=0);
  assert.ok(samples[0].completion_ms>=samples[0].response_headers_ms);
  assert.doesNotMatch(JSON.stringify(samples),/Private fake test topic|I am Shanny/);
});
test('stream timings measure first CONTENT separately; nonstream cannot claim TTFT',async()=>{
  const samples=[];
  const frame=(body,finish=null)=>'data: '+JSON.stringify({choices:[
    {index:0,delta:{content:body},finish_reason:finish}]})+'\n\n';
  const complete=createQwenCompletion({
    endpoint:'http://127.0.0.1:1234/v1/chat/completions',model:'test',placement:'cpu',
    onTiming:x=>samples.push(x),
    request:async()=>new Response(frame('Hello')+frame(' world','stop')+'data: [DONE]\n\n')
  });
  const result=await complete({messages:[],onText:()=>{}});
  assert.equal(result,'Hello world');
  assert.equal(samples[0].status,'ok');
  assert.ok(samples[0].first_content_ms>=0);
  assert.ok(samples[0].completion_ms>=samples[0].first_content_ms);
});

test('opt-in diagnostic LM Studio SSE keeps JSON schema and measures first content without TTS',async()=>{
  const timings=[],partial=[];let body;
  const remote={
    endpoint:'http://100.79.20.28:1234/v1/chat/completions',
    model:'qwen3.8-27b',placement:'off-device',
    trustedTailnetHost:'100.79.20.28',responseFormat:'lmstudio',
    diagnosticRemoteSse:true
  };
  const schema={type:'object',required:['ready'],properties:{ready:{type:'boolean'}}};
  const sse='data: '+JSON.stringify({choices:[{index:0,delta:{content:'{"ready":'},finish_reason:null}]})+'\n\n'+
    'data: '+JSON.stringify({choices:[{index:0,delta:{content:'true}'},finish_reason:'stop'}]})+'\n\n'+
    'data: [DONE]\n\n';
  const complete=createQwenCompletion({...remote,
    onTiming:x=>timings.push(x),
    request:async(_url,args)=>{
      body=JSON.parse(args.body);
      return new Response(sse);
    }});
  assert.equal(await complete({messages:[],responseSchema:schema,onText:raw=>partial.push(raw)}),'{"ready":true}');
  assert.equal(body.stream,true);
  assert.deepEqual(body.response_format,
    {type:'json_schema',json_schema:{name:'buff_character_exchange',schema}});
  assert.equal(partial.at(0),'{"ready":');
  assert.ok(timings[0].first_content_ms>=0);
  assert.equal(timings[0].status,'ok');
  assert.throws(()=>createQwenCompletion({
    endpoint:'http://127.0.0.1:1234/v1/chat/completions',
    model:'test',placement:'cpu',diagnosticRemoteSse:true
  }),/Invalid Qwen/);
});

#!/usr/bin/env node
/**
 * Explicit, sequential, synthetic-only V620 diagnostic.
 * No Unity, OBS, OmniVoice, local Qwen launch, credentials, model loads,
 * model changes, paid provider activation, or replay of private transcripts.
 * Run ONLY while the real show is idle; every sample generates model tokens.
 */
import {performance} from 'node:perf_hooks';
import {createQwenCompletion} from '../src/providers/qwen.mjs';
import {createV620ModelProbe} from '../src/providers/qwen-failover.mjs';
import {createBlackoutMicrodirector} from '../src/blackout-microdirector-director.mjs';

function parseArgs(args){
  const parsed={samples:3,tokens:512,mode:'both'};
  for(let i=0;i<args.length;i++){
    const key=args[i];
    if(key==='--idle-confirmed'){parsed.idleConfirmed=true;continue;}
    if(!['--host','--model','--samples','--tokens','--mode'].includes(key)||!args[i+1])
      throw Error('Invalid R&D arguments; see docs/QWEN_LATENCY_RND_20261015.md');
    parsed[key.slice(2)]=args[++i];
  }
  const samples=Number(parsed.samples),tokens=Number(parsed.tokens);
  if(!parsed.idleConfirmed)throw Error('Refusing to load-test a live show. Confirm idle with --idle-confirmed.');
  if(typeof parsed.host!=='string'||typeof parsed.model!=='string'||
     !Number.isInteger(samples)||samples<1||samples>10||
     ![256,384,512].includes(tokens)||!['normal','streaming','both'].includes(parsed.mode))
    throw Error('Invalid bounded V620 latency experiment configuration.');
  return {...parsed,samples,tokens};
}
const topics=[
  'Shanny, chat says you will interrupt Rev before he finishes one thought.',
  'Rev, explain why you argue with Shanny when chat is teasing you.',
  'Both of you, the audience wants to hear your argument about who controls the livestream.',
  'Shanny, are you actually upset by what the chat is saying?',
  'Rev, why is Shanny accusing you of siding with the audience?'
];
const round=value=>Number.isFinite(value)?Math.round(value*10)/10:null;
function percentile(values,q){
  if(!values.length)return null;
  const arr=[...values].sort((a,b)=>a-b);
  return round(arr[Math.min(arr.length-1,Math.ceil(q*arr.length)-1)]);
}
async function main(){
  const cfg=parseArgs(process.argv.slice(2));
  // Native loaded-instance check does not trigger LM Studio model loading.
  const probe=createV620ModelProbe({host:cfg.host,model:cfg.model,timeoutMs:1500});
  if(!await probe())throw Error('Exact V620 model is not currently loaded; no inference request sent.');
  const modes=cfg.mode==='both'?['normal','streaming']:[cfg.mode];
  const samples=[];
  for(let i=0;i<cfg.samples;i++){
    for(const mode of modes){
      let providerTiming=null;
      const complete=createQwenCompletion({
        endpoint:'http://'+cfg.host+':1234/v1/chat/completions',
        model:cfg.model,placement:'off-device',trustedTailnetHost:cfg.host,
        responseFormat:'lmstudio',diagnosticRemoteSse:mode==='streaming',
        timeoutMs:30000,maxTokens:cfg.tokens,temperature:0.7,topP:0.9,
        onTiming:timing=>{providerTiming=timing;}
      });
      // Reuse the project's real system instruction, named-role JSON schema,
      // topic gate and character validation, without private notes or speech.
      // Diagnostic SSE streams into this no-op, NEVER into OmniVoice.
      const completion=args=>complete({
        ...args,...(mode==='streaming'?{onText:()=>{}}:{})
      });
      const director=createBlackoutMicrodirector({
        complete:completion,notes:'Private character source notes withheld from synthetic Qwen research.',
        getDeliveryCodes:()=>({})
      });
      const started=performance.now();let valid=false;
      try{
        const plan=await director.generate({kind:'donation',text:topics[i%topics.length]});
        valid=plan.lines.length>=2&&plan.lines.some(x=>x.actor==='SHANNY')&&
          plan.lines.some(x=>x.actor==='REV');
      }catch{
        // Errors might contain provider internals. Never print exception data.
      }
      samples.push({
        iteration:i+1,mode,valid,
        wall_ms:round(performance.now()-started),
        provider_status:providerTiming?.status||'unavailable',
        completion_ms:round(providerTiming?.completion_ms),
        response_headers_ms:round(providerTiming?.response_headers_ms),
        first_content_ms:round(providerTiming?.first_content_ms),
        prompt_tokens:Number.isInteger(providerTiming?.prompt_tokens)?providerTiming.prompt_tokens:null,
        completion_tokens:Number.isInteger(providerTiming?.completion_tokens)?providerTiming.completion_tokens:null
      });
    }
  }
  const summary=modes.map(mode=>{
    const rows=samples.filter(x=>x.mode===mode);
    const times=rows.filter(x=>x.valid).map(x=>x.wall_ms);
    return {mode,samples:rows.length,valid:times.length,failed:rows.length-times.length,
      p50_wall_ms:percentile(times,0.5),p90_wall_ms:percentile(times,0.9),
      first_content_p50_ms:percentile(rows.map(x=>x.first_content_ms).filter(Number.isFinite),0.5)};
  });
  // No user text, generated dialogue, private model address or credentials.
  process.stdout.write(JSON.stringify({
    schema:'buff-qwen-latency-research/v1',model_size:'producer-selected',
    max_tokens:cfg.tokens,synthetic_only:true,output_was_spoken:false,
    samples,summary
  },null,2)+'\n');
}
main().catch(error=>{
  // Never echo a response or remote server diagnostic containing prompt text.
  process.stderr.write('V620 benchmark refused/failed: '+(
    error.message?.startsWith('Refusing')||error.message?.startsWith('Invalid')||
    error.message?.startsWith('Exact V620')?
      error.message:'check connection, private model inventory and benchmark arguments')+'\n');
  process.exitCode=1;
});

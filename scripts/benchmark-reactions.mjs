import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readJson } from '../src/http-json.mjs';
const count=Number(process.argv[2]||20);
if(!Number.isSafeInteger(count)||count<1||count>100)throw new Error('Use 1–100 samples');
const origin=process.env.SHOW_URL||'http://127.0.0.1:8771';
const parsed=new URL(origin);
if(parsed.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(parsed.hostname)||parsed.pathname!=='/'||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('Loopback controller required');
if(!process.env.BENCH_MODEL_LABEL)throw new Error('Set BENCH_MODEL_LABEL to the actual model, quantization and runtime');
async function call(path,data,donation=false) {
  const token=process.env[donation?'SHOW_DONATION_TOKEN':'SHOW_OPERATOR_TOKEN'];if(!token)throw new Error('Controller credentials required');
  const response=await fetch(parsed.origin+path,{method:data===undefined?'GET':'POST',signal:AbortSignal.timeout(10000),redirect:'error',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  if(!response.ok)throw new Error('Controller HTTP '+response.status);
  return readJson(response);
}
const first=await call('/status');
if(!first.live_available||first.reaction_metrics.sample_count!==0)throw new Error('Use a fresh controller with accepted real stage/player adapters');
await call('/live',{});
try {
  for(let i=0;i<count;i++) {
    const scope=await call('/status');
    const admitted=await call('/donations',{donation_id:randomUUID(),session_id:scope.session_id,mode_epoch:scope.mode_epoch,received_unix_ms:Date.now(),
      text:(i%2?'(rev) ':'')+'Buff, I have been watching this argument for a while. Can you explain why nobody seems willing to let the other person finish a sentence?'},true);
    if(admitted.status!=='accepted')throw new Error('Benchmark donation not accepted: '+admitted.status);
    const end=Date.now()+65000;
    while(true) {
      const status=await call('/status');
      if(status.mode!=='live')throw new Error('Controller failed closed during benchmark');
      if(!status.turn_busy&&status.reaction_metrics.sample_count>=i+1)break;
      if(Date.now()>end)throw new Error('Playback acceptance timed out');
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    if(i+1<count)await new Promise(resolve=>setTimeout(resolve,8000)); // respect admission rate
  }
  const result={model_label:process.env.BENCH_MODEL_LABEL,measured_unix_ms:Date.now(),samples_requested:count,
    receipt_kind:'Unity AudioSource HTTP receipts, not physical speaker onset',...((await call('/status')).reaction_metrics)};
  await writeFile(process.argv[3]||'benchmark.local.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
} finally {await call('/stop',{});}

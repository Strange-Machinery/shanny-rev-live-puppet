import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {voiceDyadLiteInput,voiceDyadLiteCodes} from '../../src/voice-dyad-lite.mjs';
import {requestedEpisodeCodes} from '../../src/approved-delivery.mjs';

// Offline lookup cost only. No writer, HTTP client, GPU, speech worker or audio.
export function benchmarkVoiceLite({samples=200,batchSize=1000}={}){
 if(!Number.isInteger(samples)||samples<1||samples>1000||!Number.isInteger(batchSize)||batchSize<1||batchSize>10000)
  throw Error('Invalid bounded benchmark size');
 const inputs=Object.entries(voiceDyadLiteCodes).flatMap(([actor,moods])=>
  Object.keys(moods).map(mood=>({actor,mood,text:'This Is A Synthetic Voice Routing Fixture.'})));
 let checksum=0;
 const batch=()=>{for(let i=0;i<batchSize;i++)for(const input of inputs){
  const routed=voiceDyadLiteInput(input,requestedEpisodeCodes);
  checksum+=routed.text.length+routed.voiceCode.charCodeAt(0);
 }};
 for(let i=0;i<20;i++)batch();
 const timings=[];
 for(let i=0;i<samples;i++){const start=performance.now();batch();timings.push((performance.now()-start)/(batchSize*inputs.length));}
 timings.sort((a,b)=>a-b);
 const files=['src/voice-dyad-lite.mjs','src/dyad/sample-led-voice.mjs','experiments/dyad/voice-lite-benchmark.mjs'];
 return {measurement:'offline local voice routing only; excludes GOLD, worker startup, TTS and playback',
  created_at:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,
  samples,batch_size:batchSize,lines_per_batch:batchSize*inputs.length,measured_lines:samples*batchSize*inputs.length,
  median_ms_per_line:timings[Math.floor(samples/2)],p95_ms_per_line:timings[Math.ceil(samples*0.95)-1],
  checksum,external_requests:0,source_sha256:Object.fromEntries(files.map(file=>[
   file,createHash('sha256').update(readFileSync(new URL('../../'+file,import.meta.url),'utf8').replace(/\r\n/g,'\n')).digest('hex')
  ])),routes:inputs.map(input=>({actor:input.actor,mood:input.mood,
   voice_code:voiceDyadLiteInput(input,requestedEpisodeCodes).voiceCode,
   intensity:input.actor==='SHANNY'&&['anger','rage'].includes(input.mood)?(input.mood==='rage'?'full':'medium'):null})),
  sorted_batch_ms_per_line:timings};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--out'))throw Error('Usage: node voice-lite-benchmark.mjs [--out path]');
 const result=benchmarkVoiceLite();
 if(args.length)writeFileSync(args[1],JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({...result,sorted_batch_ms_per_line:undefined},null,2));
}

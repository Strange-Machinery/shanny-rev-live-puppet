import {performance} from 'node:perf_hooks';
import {lookupLiveLore,liveLoreStats} from '../src/live-lore-index.mjs';
const inputs=[
  'Rev, go dump Shanny\'s bucket again.',
  'Wait, what happened when Will got dropkicked?',
  'Rev, are you becoming KittyDoomz again?',
  'Did the Viking and the lumberjack know about Ezzie?',
  'Would the audience be allowed to ask about the Norway DMs?',
  'That was Ezzie\'s shirt, right?',
  'The Tento coordinates? Across from the store?',
  'This is just an unrelated five-dollar superchat about space games.',
  'Can you explain the difference between encrypted DNS and TLS?',
  'Do you remember the wrestler Steve Austin\'s theme?',
  'B'.repeat(900)+' Shanny',
  'Could someone compare an AWS S3 bucket with a storage account?',
  'Congealed again? Seriously?',
  'Did Rev spend the 750k on gaming?',
  'Tell us about your show rather than talking about sandwiches.'
];
const sampleCount=20000;
for(let i=0;i<2000;i++)lookupLiveLore(inputs[i%inputs.length]);
const durations=[];
for(let i=0;i<sampleCount;i++){
 const began=performance.now();
 lookupLiveLore(inputs[i%inputs.length]);
 durations.push(performance.now()-began);
}
durations.sort((a,b)=>a-b);
const percentile=p=>durations[Math.ceil((durations.length-1)*p)];
const report={
 schema:'buff-fast-lore-benchmark-v1',
 source:'on-device Node; compiled static lore index; no Qwen/network/GPU',
 ...liveLoreStats(),
 iterations:sampleCount,
 lookup_ms:{p50:percentile(0.5),p95:percentile(0.95),p99:percentile(0.99)},
 target_ms:30,
 met_lookup_target:percentile(0.99)<30
};
console.log(JSON.stringify(report,null,2));
if(!report.met_lookup_target)process.exitCode=1;

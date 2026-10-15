import {performance} from 'node:perf_hooks';
import {lookupLiveLore,liveLoreStats} from '../src/live-lore-index.mjs';
import {makeMicroInput} from '../src/blackout-lore-router.mjs';
import {focusTerms,detectTopicDrift} from '../src/live-topic-focus.mjs';
import {validateMicroPlan} from '../src/blackout-microdirector-director.mjs';
import {identifyAudienceAddressee,audienceReplyContract} from '../src/audience-addressee.mjs';
import {chooseBlackoutShanny} from '../src/blackout-shanny-heat.mjs';
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
const history=[{actor:'REV',text:'You always talk about sandwiches.',input:'What ingredients are in your sandwich?'}];
const competing={hinge:'The first character answers the comment and their partner disputes it.',
 first:{text:'I can answer that question about responsibility.',mood:'anger'},
 second:{text:'Your answer ignores what I was trying to say.',mood:'irritated'},
 rev_reason:'Rev offers a competing perspective.'};
const focusDurations=[];
for(let i=0;i<2000;i++)lookupLiveLore(inputs[i%inputs.length]);
const durations=[];
for(let i=0;i<sampleCount;i++){
 const began=performance.now();
 lookupLiveLore(inputs[i%inputs.length]);
 durations.push(performance.now()-began);
 const focusStart=performance.now();
 const input=makeMicroInput({text:inputs[i%inputs.length],kind:'donation',history});
 const audience=identifyAudienceAddressee(input.input);
 audienceReplyContract(audience,'donation','SHANNY');
 chooseBlackoutShanny({text:input.input,address:audience,hooks:input.contextual_grievance_hooks,kind:'donation'});
 focusTerms(input.input);
 detectTopicDrift({input:input.input,hooks:input.contextual_grievance_hooks,plan:competing});
 validateMicroPlan(competing,'donation',{}, {input:input.input,
  hooks:input.contextual_grievance_hooks,audience_address:audience});
 focusDurations.push(performance.now()-focusStart);
}
durations.sort((a,b)=>a-b);
focusDurations.sort((a,b)=>a-b);
const percentile=p=>durations[Math.ceil((durations.length-1)*p)];
const focusPercentile=p=>focusDurations[Math.ceil((focusDurations.length-1)*p)];
const report={
 schema:'buff-fast-lore-benchmark-v1',
 source:'on-device Node; compiled static lore index; no Qwen/network/GPU',
 ...liveLoreStats(),
 iterations:sampleCount,
 lookup_ms:{p50:percentile(0.5),p95:percentile(0.95),p99:percentile(0.99)},
 topic_microcontroller_ms:{p50:focusPercentile(0.5),p95:focusPercentile(0.95),p99:focusPercentile(0.99)},
 target_ms:30,
 met_lookup_target:percentile(0.99)<30,
 met_microcontroller_target:focusPercentile(0.99)<30
};
console.log(JSON.stringify(report,null,2));
if(!report.met_lookup_target||!report.met_microcontroller_target)process.exitCode=1;

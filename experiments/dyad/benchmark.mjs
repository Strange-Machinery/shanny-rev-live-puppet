import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {performance} from 'node:perf_hooks';
import {compactDyadPrompt} from '../../src/dyad/prompt.mjs';
import {schemaForRecord,validateDyad} from '../../src/dyad/contract.mjs';
import {prepareDyadInput} from '../../src/dyad/input.mjs';
import {createDyadCompletion,sampling} from '../../src/dyad/completion.mjs';
import {dyadPrompt} from './full-control.mjs';
import {cases,caseChecks} from './cases.mjs';

export const hash = text => createHash('sha256').update(text).digest('hex');
export function schedule({fixtures=cases,rounds=2,warm=1,runId='offline'}) {
  const jobs=[];
  for(let round=0;round<rounds;round++) for(const [index,fixture] of fixtures.entries()) {
    const order=(round+index)%2?['compact','full']:['full','compact'];
    for(const arm of order) for(let repeat=0;repeat<=warm;repeat++) jobs.push({
      round,fixture,arm,repeat,phase:repeat?'repeat-prefix':'fresh-prefix',
      prefix:`Measurement ${runId}/${round}/${index}/${arm}. This identifier is not dialogue.\n\n`
    });
  }
  return jobs;
}
const median = values => {
  if(!values.length)return null;
  const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
};
export function summarize(runs) {
  return ['full','compact'].flatMap(arm => ['fresh-prefix','repeat-prefix'].map(phase => {
    const rows=runs.filter(r=>r.arm===arm&&r.phase===phase);
    return {arm,phase,attempts:rows.length,transport_failures:rows.filter(r=>r.failure_kind==='transport').length,
      contract_failures:rows.filter(r=>!r.valid&&r.failure_kind!=='transport').length,
      case_check_failures:rows.filter(r=>r.valid&&r.case_failures.length).length,
      median_ms_all:median(rows.map(r=>r.elapsed_ms)),median_ms_valid:median(rows.filter(r=>r.valid).map(r=>r.elapsed_ms)),
      median_prompt_tokens:median(rows.filter(r=>Number.isFinite(r.usage?.prompt_tokens)).map(r=>r.usage.prompt_tokens)),
      median_completion_tokens:median(rows.filter(r=>Number.isFinite(r.usage?.completion_tokens)).map(r=>r.usage.completion_tokens))};
  }));
}

export async function runBenchmark({notes='',fixtures=cases,rounds=2,warm=1,complete,signal,save=async()=>{}}={}) {
  const prompts={full:dyadPrompt(notes),compact:compactDyadPrompt(notes)};
  const result={started:new Date().toISOString(),model:'qwen3.8-27b',sampling,notes_sha256:hash(notes),
    mode:complete?'text-only paired comparison':'offline inventory; no inference',
    cache_method:'Fresh-prefix uses a unique leading identifier; repeat-prefix repeats that complete request immediately. Cache state is uninstrumented; neither phase proves cold/warm model residency. No reload, eviction, model mutation, voice or playback.',
    prompts:Object.fromEntries(Object.entries(prompts).map(([arm,p])=>[arm,{characters:p.length,sha256:hash(p)}])),
    runs:[]};
  const jobs=schedule({fixtures,rounds,warm,runId:randomUUID()});
  result.planned_calls=jobs.length;
  if(!complete)return result;
  await save(result);
  let consecutiveTransportFailures=0;
  for(const job of jobs) {
    signal?.throwIfAborted();
    const {record,announcement}=prepareDyadInput(job.fixture.args);
    const system=job.prefix+prompts[job.arm];
    const run={id:job.fixture.id,arm:job.arm,round:job.round,repeat:job.repeat,phase:job.phase,
      prompt_sha256:hash(system),input:record,announcement,review_criteria:job.fixture.review,
      valid:false,case_failures:[],quality_review:'pending'};
    const started=performance.now();
    try {
      run.raw=await complete({messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(record)}],signal,responseSchema:schemaForRecord(record),
        onResult:metrics=>Object.assign(run,metrics)});
      run.elapsed_ms=Math.round(performance.now()-started);
      run.plan=validateDyad(run.raw,record);
      run.valid=true;
      run.case_failures=caseChecks(run.plan,job.fixture);
    } catch(error) {
      run.elapsed_ms=Math.round(performance.now()-started);
      // Do not serialize arbitrary network errors which may contain local URLs.
      run.error=signal?.aborted?'cancelled':error instanceof SyntaxError?'invalid-json':
        /^(Invalid dyad|Only rage|Both characters|WARTZ requires|Dyad (returned|answer|V620 HTTP|writer|context))/.test(error.message)?error.message:'request-failed';
      run.failure_kind=run.error==='request-failed'||run.error==='cancelled'||run.error.startsWith('Dyad V620 HTTP')?'transport':'contract';
    }
    result.runs.push(run);
    result.summary=summarize(result.runs);
    await save(result);
    if(signal?.aborted)break;
    consecutiveTransportFailures=run.failure_kind==='transport'?consecutiveTransportFailures+1:0;
    if(consecutiveTransportFailures>=3){result.stopped_reason='Three consecutive transport failures; no further requests.';break;}
  }
  result.finished=new Date().toISOString();
  await save(result);
  return result;
}

export function renderReport(result) {
  return ['# Dyad writer comparison',`Mode: ${result.mode}. Planned calls: ${result.planned_calls}; recorded: ${result.runs.length}.`,
    result.cache_method,'Both arms: 1,024 maximum output tokens, temperature 1, top_p 1, thinking off, same JSON schema and validator. Writer request duration only; no time-to-first-speech or show-latency measurement.',
    ['| Arm | Cache proxy | N | Transport failures | Contract failures | Case failures | Median ms (all) | Median output tokens |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...(result.summary||[]).map(r=>`| ${r.arm} | ${r.phase} | ${r.attempts} | ${r.transport_failures} | ${r.contract_failures} | ${r.case_check_failures} | ${r.median_ms_all} | ${r.median_completion_tokens} |`)].join('\n'),
    '\nSchema compliance does not establish intelligibility, attribution, character quality or contextual accuracy. Every run needs review against its criteria; failures remain in denominators. Fewer generated tokens can reduce elapsed time even with equal maximum budgets.',
    ...result.runs.flatMap((r,i)=>[`\n## ${i+1}. ${r.id} / ${r.arm} / ${r.phase} / round ${r.round+1}`,
      `Input: ${r.input.input}`,`Review: ${r.review_criteria}`,r.announcement?`Host announcement: ${r.announcement}`:'',
      `${r.elapsed_ms} ms; contract ${r.valid?'PASS':'FAIL'}; case checks: ${r.case_failures.join(', ')||'none'}; quality review: ${r.quality_review}.`,
      ...(r.plan?r.plan.lines.map(l=>`- ${l.actor} (${l.mood}): ${l.text}`):['```json',r.raw||r.error,'```'])])].join('\n\n');
}

async function main() {
  const {values}=parseArgs({options:{live:{type:'boolean'},'quiet-window':{type:'boolean'},notes:{type:'string'},out:{type:'string'},cases:{type:'string'},rounds:{type:'string'},warm:{type:'string'}}});
  const fixtures=values.cases?values.cases.split(',').map(id=>{const c=cases.find(c=>c.id===id);if(!c)throw Error('Unknown benchmark case');return c;}):cases;
  const rounds=Number(values.rounds||2),warm=Number(values.warm||1);
  if(!Number.isInteger(rounds)||rounds<1||rounds>5||!Number.isInteger(warm)||warm<1||warm>5)throw Error('Use 1–5 rounds and warm repeats');
  if(values.live&&(!values['quiet-window']||!values.notes||!process.env.DYAD_V620_ENDPOINT))throw Error('Live measurement needs --quiet-window, --notes and DYAD_V620_ENDPOINT after producer confirms an idle show');
  const notes=values.notes?await readFile(values.notes,'utf8'):'';
  const controller=new AbortController();
  process.once('SIGINT',()=>controller.abort());
  const output=resolve(values.out||'evidence.local/dyad-comparison.json');
  await mkdir(dirname(output),{recursive:true});
  const complete=values.live?createDyadCompletion({endpoint:process.env.DYAD_V620_ENDPOINT}):undefined;
  let lastCount=0;
  const result=await runBenchmark({notes,fixtures,rounds,warm,complete,signal:controller.signal,save:async result=>{
    await writeFile(output,JSON.stringify(result,null,2)+'\n');
    if(result.runs.length>lastCount){lastCount=result.runs.length;const r=result.runs.at(-1);console.log(`${lastCount}/${result.planned_calls} ${r.id} ${r.arm} ${r.phase}: ${r.elapsed_ms} ms, ${r.valid?'valid':r.error}`);}
  }});
  await writeFile(output,JSON.stringify(result,null,2)+'\n');
  await writeFile(output.replace(/\.json$/,'')+'.md',renderReport(result));
  console.log(JSON.stringify({mode:result.mode,prompts:result.prompts,planned_calls:result.planned_calls,summary:result.summary},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(()=>{console.error('Dyad benchmark failed; check arguments and local configuration. No fallback attempted.');process.exitCode=1;});

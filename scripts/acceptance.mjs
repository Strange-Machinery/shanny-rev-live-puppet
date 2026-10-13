import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import {createLiveServer} from '../src/live-server.mjs';
import {MockVoiceProvider} from '../src/providers/mock.mjs';
import {OmniVoiceProvider} from '../src/providers/omnivoice.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const out=path.resolve(process.env.LIVE_EVIDENCE_ROOT || 'evidence.local');await fs.mkdir(out,{recursive:true});
const token=randomBytes(24).toString('hex');
let actual=new MockVoiceProvider();
const provider={name:'acceptance-switchable',generate:req=>actual.generate(req),close:()=>actual.close()};
const server=createLiveServer({provider,token,port:0});const {port}=await server.start();
const base='http://127.0.0.1:'+port;const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
const get=async route=>{const r=await fetch(base+route,{headers});if(!r.ok)throw Error('GET '+route+': '+r.status);return r.json();};
const post=async(route,body={})=>{const r=await fetch(base+route,{method:'POST',headers,body:JSON.stringify(body)});if(!r.ok)throw Error('POST '+route+': '+r.status);return r.json();};
const samples=[],resources=[];let player,timer,busy=false;
const report={schema_version:'shanny-rev-live-puppet/acceptance/v1',started_at:new Date().toISOString(),samples,resources,first_audible_output_ms:null,first_audible_note:'No calibrated loopback or physical speaker capture; AudioSource evidence only.'};
async function resource(){if(busy)return;busy=true;try{const {stdout}=await promisify(execFile)('nvidia-smi',['--query-gpu=memory.used,utilization.gpu','--format=csv,noheader,nounits'],{windowsHide:true});const [memory_mib,gpu_percent]=stdout.trim().split(',').map(Number);resources.push({at:new Date().toISOString(),memory_mib,gpu_percent});}catch{}finally{busy=false;}}
async function utterance(actor,text,mode){const {request_id:id}=await post('/v1/speak',{actor,text});const deadline=Date.now()+300000;let ready,finished,started;
 while(Date.now()<deadline){const events=(await get('/v1/events')).events;const failure=events.find(e=>e.id===id&&e.type==='speech.failed');if(failure)throw Error(failure.reason);
 ready=events.find(e=>e.id===id&&e.type==='speech.ready')||ready;
 const playback=(await get('/v1/metrics')).playback;started=playback.find(e=>e.id===id&&e.state==='started');finished=playback.find(e=>e.id===id&&e.state==='finished');
 if(ready&&finished)break;await sleep(100);}
 if(!finished)throw Error('No completed Unity playback for '+actor);
 if(!(finished.peak_jaw_weight>0&&finished.max_audio_sample>0&&finished.idle_jaw_weight===0))throw Error('No measured audio-driven face motion for '+actor);
 const sample={mode,actor,id,ready,started,finished};samples.push(sample);console.log(JSON.stringify({mode,actor,request_to_ready_ms:ready.request_to_ready_ms,provider_timings:ready.provider_timings,finished}));
 await fs.writeFile(path.join(out,'acceptance.json'),JSON.stringify(report,null,2));await sleep(350);
}
try{
 timer=setInterval(()=>void resource(),1000);await resource();
 async function waitStage(predicate, timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){const stage=(await get('/v1/metrics')).stage;if(stage && Date.now()-stage.received_unix_ms<1500 && predicate(stage))return stage;await sleep(50);}throw Error('Stage state timed out');}
 if(!process.env.LIVE_PLAYER)throw Error('LIVE_PLAYER required');
 const playerLog=path.join(out,'player.log');
 player=spawn(process.env.LIVE_PLAYER,['-screen-fullscreen','0','-logFile',playerLog],{windowsHide:true,stdio:'ignore',env:{...process.env,LIVE_PUPPET_TOKEN:token,LIVE_PUPPET_URL:base}});
 player.on('error',e=>console.error(e.message));await waitStage(s=>!s.muted,60000);
 if(player.exitCode!==null)throw Error('Unity player exited '+player.exitCode);
 report.player_pid=player.pid;report.stage_instance_id=(await get('/v1/metrics')).stage.instance_id;
 await utterance('SHANNY','Synthetic audio checks the moving mouth.','mock');
 await utterance('REV','Synthetic audio checks this speaker too.','mock');
 const long='This is a long synthetic audio test for independent speech playback and immediate operator interruption. '.repeat(4);
 await post('/v1/speak',{actor:'SHANNY',text:long});await post('/v1/speak',{actor:'REV',text:long});
 await waitStage(s=>s.shanny_playing&&s.rev_playing);report.independent_simultaneous_playback=true;
 const panicAt=performance.now();await post('/v1/panic');
 await waitStage(s=>s.muted&&!s.shanny_playing&&!s.rev_playing&&s.shanny_jaw===0&&s.rev_jaw===0);
 report.panic_to_observed_stopped_ms=performance.now()-panicAt;
 await post('/v1/resume');await waitStage(s=>!s.muted);
 await post('/v1/speak',{actor:'REV',text:long});await waitStage(s=>s.rev_playing);
 await post('/v1/speak',{actor:'SHANNY',text:long,delivery:'interrupt'});
 await waitStage(s=>s.shanny_playing&&!s.rev_playing);report.shanny_interrupts_rev=true;
 await post('/v1/panic');await waitStage(s=>s.muted&&!s.shanny_playing&&!s.rev_playing);
 await post('/v1/resume');await waitStage(s=>!s.muted);
 if(process.env.LIVE_PUPPET_PROVIDER==='omnivoice'){
 actual=new OmniVoiceProvider({python:process.env.OV_PYTHON,workerScript:process.env.OV_WORKER_SCRIPT,appRoot:process.env.OV_APP_ROOT,outputRoot:process.env.OV_OUTPUT_ROOT,shannyReference:process.env.OV_SHANNY_REFERENCE,revReference:process.env.OV_REV_REFERENCE,startupMs:300000,requestMs:300000});
 for(const [actor,text] of [['SHANNY','Buff, are you listening to me?'],['REV','Yes, I am listening to you.'],['SHANNY','I wanted to finish what I was saying.'],['REV','Go ahead. I will wait for my turn.'],['SHANNY','All right, Buff. We can get back to the show.'],['REV','That sounds good. Let us get back to the show.']])await utterance(actor,text,'omnivoice');
 }
 report.same_stage_instance=(await get('/v1/metrics')).stage.instance_id===report.stage_instance_id;
 report.status='PASSED_AUDIO_SOURCE_AND_FACE';report.same_player_through_all_samples=player.exitCode===null;
}catch(error){report.status='FAILED';report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{clearInterval(timer);await post('/v1/panic').catch(()=>{});player?.kill();await server.close();
 const q=(xs,p)=>xs.length?[...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1]:null;
 report.summary={};for(const mode of ['mock','omnivoice'])for(const actor of ['SHANNY','REV']){const group=samples.filter(x=>x.mode===mode&&x.actor===actor);report.summary[mode+'_'+actor]={n:group.length};for(const [key,fn] of Object.entries({request_to_ready_ms:x=>x.ready.request_to_ready_ms,warm_generation_ms:x=>x.ready.provider_timings?.worker_cold_startup_ms==null?x.ready.provider_timings?.generation_ms:null,transport_decode_ms:x=>x.started.transport_decode_ms,request_to_playback_ack_ms:x=>x.started.request_to_ack_ms})){const xs=group.map(fn).filter(Number.isFinite);report.summary[mode+'_'+actor][key]={n:xs.length,p50:q(xs,.5),p95:q(xs,.95)};}}
 await fs.writeFile(path.join(out,'acceptance.json'),JSON.stringify(report,null,2));console.log('Evidence saved; status: '+report.status);
}

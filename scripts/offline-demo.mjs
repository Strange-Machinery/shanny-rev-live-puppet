import { createOfflineLab } from '../src/testing/lab.mjs';
const lab=await createOfflineLab();
try {
  const scope=await lab.action({action:'arm'});
  console.log('OFFLINE FIXTURE: no microphone capture, no real Qwen/OmniVoice, no livestream.');
  console.log(await lab.action({action:'donate',text:'(rev) Buff, tell Shanny to let me finish.'}));
  for(let i=0;i<100;i++) {
    await new Promise(resolve=>setTimeout(resolve,40));
    const status=await lab.action({action:'status'});
    if(status.reaction_metrics.outcomes.released && status.trace.filter(e=>e.type==='playback.finished').length===2) {
      console.log(JSON.stringify({events:status.trace,metrics:status.reaction_metrics},null,2));break;
    }
    if(i===99)throw new Error('Offline donation demo timed out');
  }
  console.log(await lab.action({action:'transcript',text:'Shanny, why did you interrupt Rev?',session_id:scope.session_id,mode_epoch:scope.mode_epoch}));
  await lab.action({action:'stop'});await lab.action({action:'stop'});
  const status=await lab.action({action:'status'});
  console.log(JSON.stringify({mode:status.mode,resume_count:status.resume_count,microphone_enabled:status.microphone_enabled}));
} finally {await lab.close();}

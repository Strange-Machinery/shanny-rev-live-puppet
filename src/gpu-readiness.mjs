import {setTimeout as delay} from 'node:timers/promises';

/** Brief VRAM spikes and recently closed workers must not fail launcher startup. */
export async function waitForVoiceMemory({readFreeMiB,progress=()=>{},now=Date.now,sleep=delay,timeoutMs=90000}) {
  const end=now()+timeoutMs;let free=0,stable=0;
  while(now()<end){
    free=Number(await readFreeMiB());
    if(!Number.isFinite(free)||free<0)throw new Error('Could not read available GPU memory');
    stable=free>=4096?stable+1:0;
    if(stable>=2)return free;
    progress(free>=4096?'Checking room for the character voices...':
      'Waiting for GPU memory ('+(free/1024).toFixed(1)+' GB free); retrying automatically. Microphone off.');
    await sleep(1000);
  }
  throw new Error('The GPU stayed busy: '+(free/1024).toFixed(1)+' GB free; the voices need 4 GB. Let the rendering job finish, then click Restart testing.');
}

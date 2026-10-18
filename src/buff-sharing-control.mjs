import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

export const isTrialOrigin=value=>typeof value==='string'&&/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(value);

/** Owns only the installed trial helper. No shell input or credentials from the browser. */
export function createBuffSharingControl({root,isBusy,saveOrigin,run=spawn,read=readFile,alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}}}){
  let running=false,error='';
  const json=async name=>JSON.parse((await read(join(root,'private',name),'utf8')).replace(/^\uFEFF/,''));
  return {
    async status(){
      if(running)return {state:'preparing',message:'Creating and checking your new link…'};
      try{
        const receipt=await json('buff-trial-status.json'),process=await json('buff-tunnel-process.json');
        if(receipt.state==='ready'&&isTrialOrigin(receipt.origin)&&alive(process.pid))
          return {state:'ready',origin:receipt.origin,message:'Ready to send to Buff.'};
      }catch{}
      if(error)return {state:'error',message:error};
      return {state:'stopped',message:'Create a link when you are ready for Buff.'};
    },
    prepare(){
      if(running)return {state:'preparing'};
      if(isBusy())throw Error('Finish the current exchange before creating a new link.');
      running=true;error='';
      try{
        // No inherited pipes: the long-lived tunnel must not keep a completed
        // PowerShell invocation's captured stdout/stderr open.
        const child=run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'scripts','Start-Buff-Trial.ps1'),'-NewLink'],
          {cwd:root,windowsHide:true,stdio:'ignore',timeout:180000});
        let finished=false;
        const done=failed=>{if(finished)return;finished=true;running=false;
          if(failed)error='The link could not be prepared. Try again or use the desktop launcher.';};
        child.once('error',()=>done(true));child.once('exit',code=>done(code!==0));
      }catch(err){running=false;throw err;}
      return {state:'preparing'};
    },
    async setOrigin(origin){
      if(!isTrialOrigin(origin))throw Error('A Cloudflare trial HTTPS address is required.');
      await saveOrigin(origin);
      return {updated:true};
    }
  };
}

import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

/** One resident CPU recognizer. Stop kills only an active owned request worker. */
export class PersistentWhisper {
  constructor({python,workerScript,modelPath,startupMs=60000,requestMs=12000}){
    if(![python,workerScript,modelPath].every(x=>typeof x==='string'&&x))throw new Error('Local Whisper paths required');
    Object.assign(this,{python,workerScript,modelPath,startupMs,requestMs});
    this.child=null;this.ready=null;this.pending=null;this.closed=false;this.busy=false;
  }
  fail(error){
    clearTimeout(this.startTimer);this.startTimer=null;
    const child=this.child;this.child=null;this.ready=null;
    this.rejectReady?.(error);this.rejectReady=null;
    this.pending?.finish(error);this.pending=null;
    child?.kill();
  }
  async warmup(){
    if(this.closed)throw new Error('Whisper is closed');
    if(this.ready)return this.ready;
    this.ready=new Promise((resolve,reject)=>{
      this.rejectReady=reject;
      const child=spawn(this.python,[this.workerScript,'--model',this.modelPath,'--serve'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      this.child=child;let buffer='';
      this.startTimer=setTimeout(()=>this.fail(new Error('Whisper startup timed out')),this.startupMs);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',chunk=>{
        if(this.child!==child)return;
        buffer+=chunk;
        if(buffer.length>32000){this.fail(new Error('Whisper output exceeds limit'));return;}
        let newline;
        while((newline=buffer.indexOf('\n'))!==-1){
          const line=buffer.slice(0,newline).trim();buffer=buffer.slice(newline+1);
          if(!line.startsWith('LIVE_WHISPER '))continue;
          try {
            const message=JSON.parse(line.slice(13));
            if(message.type==='READY'){clearTimeout(this.startTimer);this.rejectReady=null;resolve();}
            else if(message.type==='RESULT'&&message.id===this.pending?.id){
              if(message.error)this.pending.finish(new Error('Local Whisper failed; check the test WAV'));
              else if(message.result?.final!==true||typeof message.result.text!=='string'||message.result.text.length>1000)this.fail(new Error('Invalid Whisper transcript'));
              else this.pending.finish(null,message.result);
            }
          }catch{this.fail(new Error('Invalid Whisper worker response'));return;}
        }
      });
      child.stderr.on('data',()=>{});
      child.stdin.on('error',()=>{if(this.child===child)this.fail(new Error('Whisper worker disconnected'));});
      child.on('error',()=>{if(this.child===child)this.fail(new Error('Whisper runtime unavailable'));});
      child.on('exit',()=>{if(this.child===child)this.fail(new Error('Whisper worker exited'));});
    });
    return this.ready;
  }
  async transcribe({audioPath,signal}){
    signal?.throwIfAborted();
    if(this.busy)throw new Error('Whisper is busy');
    if(typeof audioPath!=='string'||!audioPath||audioPath.length>2000)throw new Error('Invalid test WAV path');
    this.busy=true;
    const abort=()=>this.fail(new Error('Whisper cancelled'));
    signal?.addEventListener('abort',abort,{once:true});
    try {
      await this.warmup();signal?.throwIfAborted();
      return await new Promise((resolve,reject)=>{
        const id=randomUUID(),timer=setTimeout(()=>this.fail(new Error('Whisper request timed out')),this.requestMs);
        this.pending={id,finish:(error,value)=>{clearTimeout(timer);this.pending=null;error?reject(error):resolve(value);}};
        this.child.stdin.write(JSON.stringify({type:'TRANSCRIBE',id,audioPath})+'\n');
      });
    }finally{signal?.removeEventListener('abort',abort);this.busy=false;}
  }
  async close(){this.closed=true;this.fail(new Error('Whisper closed'));}
}

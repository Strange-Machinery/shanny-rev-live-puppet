import { spawn } from 'node:child_process';
import { validateReactionDraft } from '../donations/reaction.mjs';

export function createFileWhisper({ python, workerScript, modelPath, timeoutMs = 60_000 }) {
  if (![python,workerScript,modelPath].every(v=>typeof v==='string'&&v)) throw new Error('Local Whisper runtime and model folder required');
  return {
    transcribe({ audioPath, signal }) {
      signal?.throwIfAborted();
      return new Promise((resolve,reject)=>{
        const child=spawn(python,[workerScript,'--model',modelPath,'--audio',audioPath],{windowsHide:true,stdio:['ignore','pipe','pipe']});
        let out='',done=false;
        const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
        const abort=()=>{child.kill();finish(new Error('Whisper cancelled'));};
        const timer=setTimeout(()=>{child.kill();finish(new Error('Whisper timed out'));},timeoutMs);
        signal?.addEventListener('abort',abort,{once:true});
        child.stdout.on('data',chunk=>{out+=chunk;if(out.length>16000){child.kill();finish(new Error('Whisper output budget exceeded'));}});
        // Drain diagnostics without reflecting private paths or audio into API errors.
        child.stderr.on('data',()=>{});
        child.on('error',()=>finish(new Error('Whisper runtime unavailable')));
        child.on('exit',code=>{
          if(code!==0){finish(new Error('Local Whisper failed; check installed model/runtime'));return;}
          try {finish(null,JSON.parse(out));}catch{finish(new Error('Invalid Whisper result'));}
        });
        if(signal?.aborted)abort();
      });
    }
  };
}

/** Test-only microphone/file/replay ingress. No production microphone admission. */
export class OfflineConversation {
  constructor({ gateway, director, controller, whisper, now = Date.now }) {
    Object.assign(this,{gateway,director,controller,whisper,now});this.revision=0;this.context=[];this.pending=new Map();
  }
  stop() { this.revision++;this.aborter?.abort();this.pending.clear(); }
  async respond({ text, actor='SHANNY', final=true, audioPath, source='OFFLINE_REPLAY', session_id, mode_epoch }) {
    if (this.busy) throw new Error('Conversation turn already pending');
    if (this.controller.mode!=='live' || session_id!==this.controller.coordinator.sessionId || mode_epoch!==this.controller.modeEpoch ||
        !['OFFLINE_REPLAY','OFFLINE_WAV','BUFF_ISOLATED_MIC_TEST'].includes(source) || final!==true) throw new Error('Stale, partial or unauthenticated test transcript');
    this.busy=true;const revision=this.revision;const epoch=this.controller.modeEpoch;
    this.aborter=new AbortController();const signal=AbortSignal.any([this.aborter.signal,this.controller.aborter.signal]);
    let id;let scope;
    const started=this.now();
    const current=()=>revision===this.revision&&epoch===this.controller.modeEpoch&&this.controller.mode==='live'&&!signal.aborted;
    try {
      let transcriptMs=null;
      if(audioPath) {
        if(!this.whisper)throw new Error('Local Whisper is not configured');
        const transcript=await this.whisper.transcribe({audioPath,signal});
        if(transcript.final!==true||typeof transcript.text!=='string')throw new Error('Whisper final transcript required');
        text=transcript.text;transcriptMs=this.now()-started;
      }
      if(!current())throw new Error('Stale Whisper/transcript');
      if(typeof text!=='string'||!text.trim()||text.length>1000)throw new Error('Bounded final text required');
      const generatedAt=this.now();
      const draft=validateReactionDraft(await this.director.generate({donationText:text,actor,
        context:this.context.map(t=>t.actor+': '+t.text).join('\n').slice(-1200),signal}),actor);
      if(!current())throw new Error('Stale Qwen response');
      scope=await this.gateway.status();
      if(scope.muted||!current())throw new Error('Test stage muted');
      const response=await this.gateway.speak({actor:draft.actor,text:draft.text,delivery:'queue',prepare_only:true,session_id:scope.session_id,epoch:scope.epoch});
      id=response.request_id;
      for(let i=0;i<300;i++) {
        if(!current())throw new Error('Test conversation cancelled');
        const page=await this.gateway.events({after:scope.cursor,session_id:scope.session_id});
        if(page.epoch!==scope.epoch||page.muted)throw new Error('Test epoch changed');
        const ready=page.events.find(e=>e.id===id&&e.type==='speech.prepared');
        if(page.events.some(e=>e.id===id&&e.type==='speech.failed'))throw new Error('Test TTS failed');
        scope.cursor=page.cursor;
        if(ready) {
          if(!current())throw new Error('Test conversation cancelled');
          await this.gateway.release({id,session_id:scope.session_id,epoch:scope.epoch});
          this.pending.set(id,{actor:draft.actor,text:draft.text});
          return {status:'released',id,source,transcript:text,transcript_ms:transcriptMs,qwen_to_ready_ms:this.now()-generatedAt,
            duration_ms:ready.duration_ms,transcription_kind:audioPath?'LOCAL_WHISPER':'TEXT_REPLAY'};
        }
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      throw new Error('Test TTS readiness timed out');
    } catch(error) {
      if(id&&scope)await this.gateway.discard({id,session_id:scope.session_id,epoch:scope.epoch}).catch(()=>{});
      throw error;
    } finally {this.busy=false;}
  }
  onEvent(event) {
    if(event.session_id===this.controller.coordinator.sessionId &&
       (event.epoch<this.controller.coordinator.epoch || event.seq<=this.controller.coordinator.baselineCursor))return;
    if(['panic','interrupt','playback.stopped'].includes(event.type)){this.stop();return;}
    if(event.type==='playback.finished'&&this.pending.has(event.id)) {
      this.context.push(this.pending.get(event.id));this.pending.delete(event.id);
      if(this.context.length>8)this.context.shift();
    }
  }
}

import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

/** One conversation turn at a time. Only actual playback receipts advance speech. */
export class ConversationSession {
  constructor({gateway,director,whisper,onChange=()=>{},now=Date.now}) {
    Object.assign(this,{gateway,director,whisper,onChange,now});
    this.mode='muted';this.epoch=0;this.revision=0;this.history=[];this.trace=[];this.cursor=0;this.turn=null;this.error='';this.lastTiming=null;
  }
  async initialize(){await this.gateway.panic();this.scope=await this.gateway.status();this.cursor=this.scope.cursor;}
  async arm(){
    if(this.turn)throw new Error('A response is still running');
    const revision=this.revision;
    const scope=await this.gateway.status();await this.gateway.resume({session_id:scope.session_id,epoch:scope.epoch});
    if(revision!==this.revision){await this.gateway.panic();throw new Error('Arming cancelled');}
    this.scope=await this.gateway.status();
    if(revision!==this.revision){await this.gateway.panic();throw new Error('Arming cancelled');}
    this.cursor=this.scope.cursor;this.mode='live';this.error='';
    return {session_id:this.scope.session_id,mode_epoch:this.epoch};
  }
  async stop(){this.revision++;this.epoch++;this.mode='muted';this.turn?.abort.abort();await this.gateway.panic();}
  current(turn){return this.turn===turn&&!turn.abort.signal.aborted&&turn.revision===this.revision&&this.mode==='live';}
  check(turn){if(!this.current(turn))throw new Error('Conversation cancelled');}
  async events(turn){
    this.check(turn);const page=await this.gateway.events({after:this.cursor,session_id:this.scope.session_id});
    this.check(turn);
    if(page.epoch!==this.scope.epoch||page.muted)throw new Error('Player stopped this response (expected epoch '+this.scope.epoch+', observed '+page.epoch+', muted '+page.muted+')');
    this.cursor=Math.max(this.cursor,page.cursor);
    for(const event of page.events){this.trace.push(event);turn.events.push(event);}
    this.trace=this.trace.slice(-160);turn.events=turn.events.slice(-160);
    if(page.events.some(e=>['panic','interrupt','playback.stopped','speech.failed'].includes(e.type)))throw new Error('Playback interrupted or voice failed');
    return page;
  }
  async wait(turn,type,id,timeout=120000){
    const deadline=this.now()+timeout;
    while(this.now()<deadline){
      await this.events(turn);const event=turn.events.find(e=>e.type===type&&e.id===id);if(event)return event;
      await delay(40,undefined,{signal:turn.abort.signal});
    }
    throw new Error('Timed out waiting for '+type);
  }
  async queuePrepared(turn,line){
    this.check(turn);
    const job=await this.gateway.speak({...line,delivery:'queue',prepare_only:true,session_id:this.scope.session_id,epoch:this.scope.epoch});
    this.check(turn);return job.request_id;
  }
  async play(turn,line,id,after,onStarted){
    this.check(turn);
    await this.gateway.release({id,session_id:this.scope.session_id,epoch:this.scope.epoch,...(after?{after_read_id:after}:{})});
    const started=await this.wait(turn,'playback.started',id,15000);
    if(turn.timing.first_reply_ms===null){
      turn.timing.first_reply_ms=this.now()-turn.started;
      if(turn.kind==='donation'){
        const finished=turn.events.find(e=>e.id===after&&e.type==='playback.finished');
        turn.timing.donation_end_to_reply_ms=started.timestamp_unix_ms-finished?.timestamp_unix_ms;
      }
      turn.timing.within_target=(turn.kind==='donation'?turn.timing.donation_end_to_reply_ms:turn.timing.first_reply_ms)<=15000;
    }
    await onStarted?.();
    await this.wait(turn,'playback.finished',id,45000);
    this.check(turn);
    this.history.push({...line,input:turn.text,source:turn.kind});this.history=this.history.slice(-8);
    this.onChange({type:'line.finished',...line});
  }
  async submit({kind,text,audioPath,session_id,mode_epoch}){
    if(this.mode!=='live'||this.turn||session_id!==this.scope.session_id||mode_epoch!==this.epoch)throw new Error('Stopped, stale, or busy conversation');
    if(!['donation','microphone'].includes(kind))throw new Error('Unknown response kind');
    const turn={id:randomUUID(),kind,text,revision:this.revision,abort:new AbortController(),events:[],started:this.now(),
      timing:{kind,transcription_ms:0,model_ms:null,first_reply_ms:null,total_ms:null,within_target:null}};this.turn=turn;this.lastTiming=turn.timing;
    try {
      if(audioPath){if(!this.whisper)throw new Error('Whisper is unavailable');const result=await this.whisper.transcribe({audioPath,signal:turn.abort.signal});this.check(turn);if(result.final!==true)throw new Error('Whisper final transcript required');text=result.text;turn.timing.transcription_ms=this.now()-turn.started;}
      if(typeof text!=='string'||!text.trim()||text.length>1000)throw new Error('Enter bounded final speech');
      this.check(turn);turn.text=text;
      turn.task=this.run(turn).catch(async error=>{
        if(this.current(turn)){this.error=error.message;await this.stop().catch(()=>{});}
      }).finally(()=>{turn.timing.total_ms=this.now()-turn.started;if(this.turn===turn)this.turn=null;});
      return {status:'accepted',turn_id:turn.id,transcript:text,transcription_kind:audioPath?'LOCAL_WHISPER':'TEXT_REPLAY',kind:'REAL_CHARACTERS'};
    }catch(error){if(this.turn===turn)this.turn=null;throw error;}
  }
  async run(turn){
    let prior;
    if(turn.kind==='donation'){
      const read=await this.gateway.speak({actor:'SHANNY',text:turn.text,delivery:'queue',session_id:this.scope.session_id,epoch:this.scope.epoch});
      await this.wait(turn,'playback.started',read.request_id,120000);prior=read.request_id;
    }
    const generatedAt=this.now();
    const plan=await this.director.generate({kind:turn.kind,text:turn.text,history:this.history,signal:turn.abort.signal});this.check(turn);
    turn.timing.model_ms=this.now()-generatedAt;
    this.onChange({type:'plan.ready',turn_id:turn.id,lines:plan.lines});
    // One line ahead: synthesize the next line while the current one is heard.
    // A bounded lookahead avoids filling a backlog of held clips that can expire.
    let nextId=await this.queuePrepared(turn,plan.lines[0]);
    for(let index=0;index<plan.lines.length;index++){
      const line=plan.lines[index],id=nextId;
      await this.wait(turn,'speech.prepared',id);
      if(prior)await this.wait(turn,'playback.finished',prior,45000);
      await this.play(turn,line,id,prior,async()=>{
        if(index+1<plan.lines.length)nextId=await this.queuePrepared(turn,plan.lines[index+1]);
      });prior=id;
    }
  }
  status(){return {mode:this.mode,session_id:this.scope?.session_id,mode_epoch:this.epoch,gateway_epoch:this.scope?.epoch,
    turn_busy:Boolean(this.turn),conversation_busy:Boolean(this.turn),active_audio:0,trace:this.trace,
    history:this.history,error:this.error,latency:this.lastTiming,real_characters:true,playback:'UNITY_AUDIO',qwen:'LOCAL_QWEN35_2B_CPU',
    speech:'PRIVATE_OMNIVOICE',whisper_available:Boolean(this.whisper),reaction_metrics:{sample_count:0},resume_count:0};}
}

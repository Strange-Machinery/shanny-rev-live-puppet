import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {parseDonationText} from './donations/parse.mjs';
import {preparePopupDetails} from './popup-details.mjs';
import {RAIN_CUE_DURATION_MS,RAIN_DANCE_MIN_MS,RAIN_SEAT_SETTLE_MS} from './rain-cue.mjs';

/** One conversation turn at a time. Only actual playback receipts advance speech. */
export class ConversationSession {
  constructor({gateway,director,whisper,presentation,onChange=()=>{},now=Date.now,pause=delay}) {
    Object.assign(this,{gateway,director,whisper,presentation,onChange,now,pause});
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
  async stop(){
    this.revision++;this.epoch++;this.mode='muted';
    this.turn?.abort.abort();this.turn=null;
    this.presentation?.stop();await this.gateway.panic();
  }
  /**
   * "Shut up" is an interrupt, NOT the sticky operator STOP.
   * Hide the OBS presentation synchronously, invalidate stale model/voice
   * continuations, panic the voice gateway, then re-arm the same operator
   * session for the next TTS. No old turn may release or commit a line.
   */
  async silence(){
    const wasLive=this.mode==='live';
    const revision=++this.revision;
    this.epoch++;
    this.mode=wasLive?'silencing':'muted';
    this.turn?.abort.abort();this.turn=null;
    this.presentation?.stop();
    try {
      await this.gateway.panic();
      if(!wasLive||revision!==this.revision)return {silenced:true,waiting_for_tts:false};
      const stopped=await this.gateway.status();
      if(revision!==this.revision)return {silenced:true,waiting_for_tts:false};
      await this.gateway.resume({session_id:stopped.session_id,epoch:stopped.epoch});
      if(revision!==this.revision){
        // A concurrent master STOP must win over the interrupt's resume.
        if(this.mode!=='live')await this.gateway.panic().catch(()=>{});
        return {silenced:true,waiting_for_tts:false};
      }
      const resumed=await this.gateway.status();
      if(resumed.muted||resumed.session_id!==stopped.session_id)
        throw new Error('Voice gateway did not resume the same session');
      if(revision!==this.revision){
        if(this.mode!=='live')await this.gateway.panic().catch(()=>{});
        return {silenced:true,waiting_for_tts:false};
      }
      this.scope=resumed;this.cursor=resumed.cursor;this.mode='live';this.error='';
      return {silenced:true,waiting_for_tts:true,session_id:resumed.session_id,mode_epoch:this.epoch};
    }catch(error){
      if(revision===this.revision){
        this.mode='muted';this.error='Could not safely resume after interrupt: '+error.message;
        await this.gateway.panic().catch(()=>{});
      }
      throw error;
    }
  }
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
    const releaseDeadline=this.now()+45000;
    while(true){
      this.check(turn);
      try {
        await this.gateway.release({id,session_id:this.scope.session_id,epoch:this.scope.epoch,...(after?{after_read_id:after}:{})});break;
      }catch(error){
        // A manual stage clip may still be playing after our preceding line.
        // Keep the server's no-overlap guard and wait for its actual finish.
        if(error.status!==409||!error.message.endsWith('Donation has not finished or stage still speaking')||this.now()>=releaseDeadline)throw error;
        await this.events(turn);await delay(40,undefined,{signal:turn.abort.signal});
      }
    }
    const started=await this.wait(turn,'playback.started',id,15000);
    if(turn.timing.first_reply_ms===null){
      turn.timing.first_reply_ms=this.now()-turn.started;
      if(turn.kind==='donation'){
        const finished=turn.events.find(e=>e.id===after&&e.type==='playback.finished');
        turn.timing.donation_end_to_reply_ms=started.timestamp_unix_ms-finished?.timestamp_unix_ms;
      }
      turn.timing.within_target=(turn.kind==='donation'?turn.timing.donation_end_to_reply_ms:turn.timing.first_reply_ms)<=turn.timing.target_ms;
    }
    // Await the at-most-one optional native reaction receipt before
    // advancing the voice turn. The speaker is ALREADY audible; this avoids
    // a presentation_end racing a pending camera-flip command.
    await this.onChange({type:'line.started',turn_id:turn.id,...line});
    this.check(turn);
    await onStarted?.();
    await this.wait(turn,'playback.finished',id,45000);
    this.check(turn);
    this.history.push({...line,input:turn.text,source:turn.kind});this.history=this.history.slice(-8);
    this.onChange({type:'line.finished',...line});
  }
  async submit({kind,text,audioPath,session_id,mode_epoch,make_it_rain=false,donation}){
    if(this.mode!=='live'||this.turn||session_id!==this.scope.session_id||mode_epoch!==this.epoch)throw new Error('Stopped, stale, or busy conversation');
    if(!['donation','microphone'].includes(kind))throw new Error('Unknown response kind');
    if(typeof make_it_rain!=='boolean')throw new Error('Make it rain must be a checkbox choice');
    if(make_it_rain&&!this.presentation)throw new Error('The paired rain presentation is unavailable');
    const turn={id:randomUUID(),kind,text,make_it_rain,revision:this.revision,abort:new AbortController(),events:[],started:this.now(),
      timing:{kind,target_ms:kind==='donation'?15000:8000,transcription_ms:0,model_ms:null,first_reply_ms:null,total_ms:null,within_target:null}};this.turn=turn;this.lastTiming=turn.timing;
    try {
      if(audioPath){if(!this.whisper)throw new Error('Whisper is unavailable');const result=await this.whisper.transcribe({audioPath,signal:turn.abort.signal});this.check(turn);if(result.final!==true)throw new Error('Whisper final transcript required');text=result.text;turn.timing.transcription_ms=this.now()-turn.started;}
      if(typeof text!=='string'||!text.trim()||text.length>1000)throw new Error('Enter bounded final speech');
      this.check(turn);
      if(kind==='donation'){
        const parsed=parseDonationText(text);
        turn.readActor=parsed.actor;text=parsed.text;
      }
      turn.text=text;
      // Public popup data is strictly whitelisted; never publish private
      // transaction IDs or invent donor/amount fields for hotmic turns.
      turn.popup=preparePopupDetails({kind,donation,text});
      turn.task=this.run(turn).catch(async error=>{
        if(this.current(turn)){this.error=error.message;await this.stop().catch(()=>{});}
      }).finally(()=>{turn.timing.total_ms=this.now()-turn.started;if(this.turn===turn)this.turn=null;});
      return {status:'accepted',turn_id:turn.id,transcript:text,transcription_kind:audioPath?'LOCAL_WHISPER':'TEXT_REPLAY',kind:'REAL_CHARACTERS'};
    }catch(error){if(this.turn===turn)this.turn=null;throw error;}
  }
  /**
   * Trusted operator-only manual celebration for a membership bomb.
   * Plays the native paired rain choreography, without Qwen, TTS,
   * a fake payment, or any change to the automatic donation feed.
   * This is busy-guarded and fully aborted by STOP/Shut up.
   */
  startRainNow(){
    if(this.mode!=='live'||this.turn||!this.presentation)
      throw new Error('Characters must be armed and idle before manual money rain');
    const turn={id:randomUUID(),kind:'celebration',revision:this.revision,
      abort:new AbortController(),started:this.now(),events:[]};
    this.turn=turn;
    turn.task=(async()=>{
      const performance=await this.presentation.begin({
        rain:true,popup:{type:'celebration'},signal:turn.abort.signal});
      this.check(turn);
      await this.presentation.waitVisible?.({signal:turn.abort.signal});
      this.check(turn);
      const startedAt=this.now();
      const duration=Math.max(RAIN_DANCE_MIN_MS,RAIN_CUE_DURATION_MS,
        Math.min(60000,performance?.duration_ms||RAIN_DANCE_MIN_MS))+RAIN_SEAT_SETTLE_MS;
      const remaining=duration-(this.now()-startedAt);
      if(remaining>0)await this.pause(remaining,undefined,{signal:turn.abort.signal});
      this.check(turn);
      if(typeof this.presentation.seat!=='function')
        throw new Error('Native desk recovery is required after manual rain');
      await this.presentation.seat({signal:turn.abort.signal});
      this.check(turn);
      await this.presentation.waitVisible?.({signal:turn.abort.signal});
      this.check(turn);
      await this.presentation.end({signal:turn.abort.signal});
      this.check(turn);
    })().catch(async error=>{
      if(this.current(turn)){
        this.error='Manual rain could not finish: '+error.message;
        await this.stop().catch(()=>{});
      }
    }).finally(()=>{
      if(this.turn===turn)this.turn=null;
    });
    return {status:'accepted',kind:'MEMBERSHIP_CELEBRATION',paid_donation:false,
      turn_id:turn.id};
  }
  async run(turn){
    if(this.presentation)return this.runPresentation(turn);
    let prior;
    if(turn.kind==='donation'){
      const read=await this.gateway.speak({actor:turn.readActor||'SHANNY',text:turn.text,delivery:'queue',session_id:this.scope.session_id,epoch:this.scope.epoch});
      await this.wait(turn,'playback.started',read.request_id,120000);prior=read.request_id;
    }
    const generatedAt=this.now();
    let preparation;
    const plan=await this.director.generate({kind:turn.kind,text:turn.text,history:this.history,signal:turn.abort.signal,
      onFirstLine:line=>{
        this.check(turn);
        if(!preparation){
          turn.timing.first_line_ms=this.now()-generatedAt;
          preparation=this.queuePrepared(turn,line).then(id=>({id}),error=>({error}));
        }
      }});this.check(turn);
    turn.timing.model_ms=this.now()-generatedAt;
    this.onChange({type:'plan.ready',turn_id:turn.id,lines:plan.lines});
    // One line ahead: synthesize the next line while the current one is heard.
    // A bounded lookahead avoids filling a backlog of held clips that can expire.
    const prepared=preparation?await preparation:null;this.check(turn);
    if(prepared?.error)throw prepared.error;
    let nextId=prepared?.id||await this.queuePrepared(turn,plan.lines[0]);
    for(let index=0;index<plan.lines.length;index++){
      const line=plan.lines[index],id=nextId;
      await this.wait(turn,'speech.prepared',id);
      if(prior)await this.wait(turn,'playback.finished',prior,45000);
      await this.play(turn,line,id,prior,async()=>{
        if(index+1<plan.lines.length)nextId=await this.queuePrepared(turn,plan.lines[index+1]);
      });prior=id;
    }
  }
  async preparePresentationRows(turn){
    // The exact same voice/plan verification is shared by both paths.
    // Seated starts hidden until this finishes; RAIN starts on stage first,
    // while these fully held voices are prepared in parallel.
    const read=turn.kind==='donation'?{actor:turn.readActor||'SHANNY',text:turn.text}:null;
    const readId=read?await this.queuePrepared(turn,read):null;
    const generatedAt=this.now();let early;
    const plan=await this.director.generate({kind:turn.kind,text:turn.text,history:this.history,signal:turn.abort.signal,
      onFirstLine:line=>{this.check(turn);if(!early)early=this.queuePrepared(turn,line).then(id=>({id}),error=>({error}));}});
    this.check(turn);turn.timing.model_ms=this.now()-generatedAt;
    const first=early?await early:null;this.check(turn);if(first?.error)throw first.error;
    const rows=[];if(read)rows.push({line:read,id:readId,read:true});
    for(let i=0;i<plan.lines.length;i++)rows.push({line:plan.lines[i],id:i===0&&first?.id?first.id:await this.queuePrepared(turn,plan.lines[i])});
    for(const row of rows)await this.wait(turn,'speech.prepared',row.id);
    this.check(turn);this.onChange({type:'plan.ready',turn_id:turn.id,lines:plan.lines});
    return rows;
  }
  async playPreparedPresentationRows(turn,rows){
    let prior;
    for(const row of rows){
      if(row.read){
        await this.gateway.release({id:row.id,session_id:this.scope.session_id,epoch:this.scope.epoch});
        await this.wait(turn,'playback.started',row.id,15000);
        this.onChange({type:'line.started',turn_id:turn.id,...row.line});
        await this.wait(turn,'playback.finished',row.id,45000);
        this.check(turn);this.onChange({type:'line.finished',turn_id:turn.id,...row.line});
      }else await this.play(turn,row.line,row.id,prior);
      prior=row.id;
    }
  }
  async runPresentation(turn){
    let visibleAt,rows;
    if(turn.make_it_rain){
      // Paid $100+ and the checked-rain option are SHOW FIRST.
      // Issue the native stage request BEFORE Qwen or any TTS call.
      // Render held voices concurrently with the 20s choreography+music.
      const started=this.presentation.begin({
        rain:true,popup:turn.popup,signal:turn.abort.signal});
      // Capture both successes and failures immediately so Stop during
      // rain never creates an unhandled rejection from a late worker.
      const preparing=this.preparePresentationRows(turn).then(
        value=>({value}),error=>({error}));
      const performance=await started;
      this.check(turn);
      await this.presentation.waitVisible?.({signal:turn.abort.signal});
      this.check(turn);
      visibleAt=this.now();
      // The producer-approved audio cut is 22.152s, a little longer
      // than the native dance. Never start the donor's first word until
      // the "lit-lit-lit" echo tail and actual chair recovery are done.
      const choreography=Math.max(RAIN_DANCE_MIN_MS,
        Number.isFinite(performance?.duration_ms)?performance.duration_ms:RAIN_DANCE_MIN_MS);
      const target=Math.max(choreography,RAIN_CUE_DURATION_MS)+RAIN_SEAT_SETTLE_MS;
      const remaining=target-(this.now()-visibleAt);
      if(remaining>0)await this.pause(remaining,undefined,{signal:turn.abort.signal});
      this.check(turn);
      if(typeof this.presentation.seat!=='function')
        throw new Error('Native seated camera/desk recovery is required after rain');
      await this.presentation.seat({signal:turn.abort.signal});
      this.check(turn);
      // Seating keeps the same popup visible but rotates presentation nonce,
      // causing the OBS page to stop music and show the desk before speech.
      await this.presentation.waitVisible?.({signal:turn.abort.signal});
      this.check(turn);
      const result=await preparing;
      if(result.error)throw result.error;
      rows=result.value;
    }else{
      // Ordinary/small donation and hotmic MUST remain transparent until
      // the complete validated plan and every speaker's audio is prepared.
      rows=await this.preparePresentationRows(turn);
      this.check(turn);
      await this.presentation.begin({rain:false,popup:turn.popup,signal:turn.abort.signal});
      this.check(turn);
      await this.presentation.waitVisible?.({signal:turn.abort.signal});
      this.check(turn);
      visibleAt=this.now();
    }
    await this.playPreparedPresentationRows(turn,rows);
    this.check(turn);
    // Once speech finishes, hide immediately. Only genuine rain uses the
    // long musical prelude; it never continues behind speech.
    await this.presentation.end({signal:turn.abort.signal});this.check(turn);
    turn.timing.presentation_ms=this.now()-visibleAt;
  }
  status(){return {mode:this.mode,session_id:this.scope?.session_id,mode_epoch:this.epoch,gateway_epoch:this.scope?.epoch,
    turn_busy:Boolean(this.turn),conversation_busy:Boolean(this.turn),active_audio:0,trace:this.trace,
    history:this.history,error:this.error,latency:this.lastTiming,real_characters:true,playback:'UNITY_AUDIO',qwen:'LOCAL_QWEN35_2B_CPU',
    speech:'PRIVATE_OMNIVOICE',whisper_available:Boolean(this.whisper),reaction_metrics:{sample_count:0},resume_count:0};}
}

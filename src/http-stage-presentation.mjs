import {setTimeout as delay} from 'node:timers/promises';

/**
 * Gate native speech on playback by the selected HTTP receiver. Publisher
 * receipts describe the input; they can never stand in for remote playback.
 * This adapter does not change native animation or output ownership.
 */
export function createHttpStagePresentation({transport,getStage,
  now=Date.now,pause=(ms,signal)=>delay(ms,undefined,{signal}),
  pollMs=50,viewerTimeoutMs=6000,rainTimeoutMs=40000}={}){
  if(typeof transport?.presentationStatus!=='function'||typeof getStage!=='function'||
      typeof now!=='function'||typeof pause!=='function')
    throw new Error('HTTP presentation requires its transport and native stage');
  for(const value of [pollMs,viewerTimeoutMs,rainTimeoutMs])
    if(!Number.isFinite(value)||value<=0||value>120000)
      throw new Error('Invalid HTTP presentation deadline');
  const accepted=new Map();
  const timeout=(value,fallback)=>{
    const result=value??fallback;
    if(!Number.isFinite(result)||result<=0||result>120000)
      throw new Error('Invalid HTTP presentation deadline');
    return result;
  };
  function aborted(signal){
    if(signal?.aborted)throw signal.reason||new Error('HTTP presentation cancelled');
  }
  function begin(signal,{rain=false}={}){
    aborted(signal);
    const stage=getStage();
    if(stage?.available!==true||stage.presentation_visible!==true||
        typeof stage.presentation_nonce!=='string'||!stage.presentation_nonce||
        (rain&&stage.presentation_mode!=='rain'))
      throw new Error(rain?'HTTP rain requires a visible native rain presentation':
        'HTTP presentation requires a visible native stage');
    const nonce=stage.presentation_nonce;
    const snapshot=transport.presentationStatus(nonce);
    if(typeof snapshot?.stream_epoch!=='string'||!snapshot.stream_epoch)
      throw new Error('HTTP presentation has no media epoch');
    return {nonce,epoch:snapshot.stream_epoch};
  }
  function current(scope,signal,{rain=false}={}){
    aborted(signal);
    const stage=getStage();
    if(stage?.available!==true)throw new Error('Native stage disconnected during HTTP presentation');
    if(stage.presentation_visible!==true||stage.presentation_nonce!==scope.nonce||
        (rain&&stage.presentation_mode!=='rain'))
      throw new Error('HTTP presentation was interrupted');
    const snapshot=transport.presentationStatus(scope.nonce);
    if(snapshot?.stream_epoch!==scope.epoch)
      throw new Error('HTTP media epoch changed during presentation');
    if(!['starting','live'].includes(snapshot.state)||
        (snapshot.state==='live'&&snapshot.source_available!==true))
      throw new Error('HTTP publisher disconnected during presentation');
    if(!Array.isArray(snapshot.receivers))
      throw new Error('HTTP receiver status is unavailable');
    return snapshot;
  }
  function visibleReceiver(receiver,scope){
    return receiver?.role==='obs'&&typeof receiver.id==='string'&&
      receiver.fresh===true&&receiver.progressing===true&&receiver.playing===true&&
      receiver.muted===false&&Number.isFinite(receiver.volume)&&receiver.volume>0&&
      receiver.audio_present===true&&receiver.presentation_visible===true&&
      receiver.presentation_nonce===scope.nonce&&
      Number.isSafeInteger(receiver.playback_generation)&&receiver.playback_generation>=0&&
      Number.isFinite(receiver.current_time)&&receiver.current_time>=0;
  }
  function remember(scope,receiver){
    accepted.set(scope.nonce,{...scope,receiverId:receiver.id,
      generation:receiver.playback_generation});
    while(accepted.size>16)accepted.delete(accepted.keys().next().value);
  }
  return {
    /** All HTTP presentations fail closed, including synthetic test/hotmic. */
    async waitForViewer({signal,timeoutMs}={}){
      const scope=begin(signal),deadline=now()+timeout(timeoutMs,viewerTimeoutMs);
      while(true){
        const snapshot=current(scope,signal);
        if(now()>=deadline)
          throw new Error('HTTP receiver did not confirm visible video and unmuted audio before speech');
        const receiver=snapshot.receivers.find(row=>visibleReceiver(row,scope));
        if(receiver){remember(scope,receiver);return true;}
        await pause(Math.min(pollMs,deadline-now()),signal);
      }
    },
    /**
     * A source audio-ended event is necessary but insufficient. The SAME
     * receiver that showed this nonce must play past that event's media time.
     * Reinitialization/live-edge jumps cannot masquerade as hearing the cue.
     * HTTP always requires a receiver, even if a legacy caller passes
     * requireViewer:false; no producer-only nominal timing fallback is used.
     */
    async waitForRainEnd({signal,timeoutMs}={}){
      const scope=begin(signal,{rain:true});
      const observed=accepted.get(scope.nonce);
      if(!observed||observed.epoch!==scope.epoch)
        throw new Error('HTTP rain must first be acknowledged by its remote receiver');
      const deadline=now()+timeout(timeoutMs,rainTimeoutMs);
      while(true){
        const snapshot=current(scope,signal,{rain:true});
        const receiver=snapshot.receivers.find(row=>row.id===observed.receiverId);
        if(!receiver||receiver.role!=='obs'||receiver.fresh!==true)
          throw new Error('HTTP rain receiver disconnected before soundtrack completion');
        if(receiver.playback_generation!==observed.generation)
          throw new Error('HTTP rain receiver skipped or reinitialized soundtrack playback');
        if(receiver.playing!==true||receiver.muted!==false||!(receiver.volume>0)||
            receiver.audio_present!==true||receiver.presentation_visible!==true||
            receiver.presentation_nonce!==scope.nonce)
          throw new Error('HTTP rain receiver stopped audible playback');
        if(snapshot.source_rain_state==='failed')
          throw new Error('Source rain soundtrack failed');
        if(now()>=deadline)
          throw new Error('HTTP receiver did not finish the rain soundtrack before speech');
        const end=snapshot.source_rain_end_time;
        if(snapshot.source_rain_state==='ended'&&Number.isFinite(end)&&end>=0&&
            visibleReceiver(receiver,scope)&&receiver.current_time>=end)
          return {verified:true,reason:'HTTP-PLAYBACK-ENDED'};
        await pause(Math.min(pollMs,deadline-now()),signal);
      }
    },
    reset(){accepted.clear();},
  };
}

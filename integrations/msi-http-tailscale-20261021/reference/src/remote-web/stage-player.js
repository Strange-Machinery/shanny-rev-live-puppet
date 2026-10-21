/**
 * Private OBS Browser Source receiver.
 * The WebRTC connection may remain alive between popups; the stage page alone
 * controls video reveal and muting based on authenticated presentation state.
 */
export class StagePlayer {
  constructor({video,key,onStatus=()=>{},onStats=()=>{},onPresentation=()=>{},autoReconnect=true,ingest=false}){
    Object.assign(this,{video,key,onStatus,onStats,onPresentation,autoReconnect,ingest});
    this.revision=0;this.pc=null;this.id=null;this.timer=null;this.reconnectTimer=null;
    this.connectionLossTimer=null;this.lastVideo=null;this.closed=false;this.retries=0;
  }
  async api(body){
    const response=await fetch(location.pathname==='/live'?'/api/media-live':'/api/media',{method:'POST',headers:{
      Authorization:'Bearer '+this.key,'Content-Type':'application/json'
    },body:JSON.stringify(body),redirect:'error',cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Stage connection unavailable');
    return data;
  }
  dismiss(){
    this.onPresentation(false,{available:false,presentation_visible:false,popup:null});
  }
  async close({permanent=false}={}){
    if(permanent)this.closed=true;
    this.revision++;
    clearTimeout(this.timer);clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectionLossTimer);
    this.timer=null;this.reconnectTimer=null;this.connectionLossTimer=null;
    this.dismiss();this.video.muted=true;
    this.pc?.close();this.pc=null;
    this.video.srcObject=null;this.lastVideo=null;
    const id=this.id;this.id=null;
    if(id)await this.api({action:'media-close',id}).catch(()=>{});
  }
  retryLater(message){
    this.dismiss();this.onStatus(message);
    if(!this.autoReconnect||this.closed||this.reconnectTimer)return;
    const ms=Math.min(30000,1000*Math.pow(2,Math.min(this.retries++,5)));
    this.reconnectTimer=setTimeout(()=>{
      this.reconnectTimer=null;
      if(!this.closed)void this.connect();
    },ms);
  }
  async connect(){
    if(this.closed)return;
    await this.close();
    const revision=this.revision;
    this.onStatus('Connecting to Stank Tank…');
    try{
      const setup=await this.api({action:'media-open',...(this.ingest?{ingest:true}:{})});
      if(revision!==this.revision){await this.api({action:'media-close',id:setup.id}).catch(()=>{});return;}
      this.id=setup.id;
      const pc=new RTCPeerConnection({iceServers:setup.iceServers,bundlePolicy:'max-bundle'});
      this.pc=pc;
      const stream=new MediaStream();
      this.video.muted=true;this.video.srcObject=stream;
      pc.ontrack=event=>{
        if(revision!==this.revision)return;
        stream.addTrack(event.track);
        if('jitterBufferTarget' in event.receiver)event.receiver.jitterBufferTarget=0;
        void this.video.play().catch(()=>this.onStatus('OBS browser blocked autoplay; verify Control Audio via OBS.'));
      };
      pc.onconnectionstatechange=()=>{
        if(revision!==this.revision)return;
        if(pc.connectionState==='connected'){
          clearTimeout(this.connectionLossTimer);this.connectionLossTimer=null;
          this.retries=0;this.onStatus('Connected · live Stank Tank');
        }else if(['failed','disconnected'].includes(pc.connectionState)){
          this.dismiss();this.video.muted=true;
          this.onStatus('Stage connection interrupted; trying to reconnect…');
          if(!this.connectionLossTimer)this.connectionLossTimer=setTimeout(()=>{
            this.connectionLossTimer=null;
            if(revision!==this.revision||pc.connectionState==='connected')return;
            void this.close().then(()=>this.retryLater('Reconnecting to producer stage…'));
          },pc.connectionState==='failed'?100:1600);
        }
      };
      const videoReceiver=pc.addTransceiver('video',{direction:'recvonly'});
      pc.addTransceiver('audio',{direction:'recvonly'});
      const codecs=RTCRtpReceiver.getCapabilities('video').codecs.filter(c=>c.mimeType.toLowerCase()==='video/h264');
      if(!codecs.length)throw new Error('OBS browser cannot decode the H.264 stage stream');
      videoReceiver.setCodecPreferences(codecs);
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise(resolve=>{
        const timer=setTimeout(resolve,8500);
        pc.onicegatheringstatechange=()=>{
          if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}
        };
        if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}
      });
      if(revision!==this.revision)return;
      await this.api({action:'media-offer',id:this.id,sdp:pc.localDescription.sdp});
      const deadline=performance.now()+20000;
      while(revision===this.revision){
        const result=await this.api({action:'media-poll',id:this.id});
        if(result.error)throw new Error(result.error);
        if(result.answer){await pc.setRemoteDescription({type:'answer',sdp:result.answer});break;}
        if(performance.now()>deadline)throw new Error('Producer did not answer the stage offer');
        await new Promise(r=>setTimeout(r,250));
      }
      if(revision===this.revision)void this.heartbeat(revision);
    }catch(error){
      if(revision===this.revision){
        await this.close();
        this.retryLater(error.message);
      }
    }
  }
  async heartbeat(revision){
    if(revision!==this.revision||!this.pc||this.closed)return;
    try{
      const status=await this.api({action:'media-poll',id:this.id});
      if(!status.available)throw new Error('Producer stage is offline');
      if(revision!==this.revision||this.closed)return;
      this.onPresentation(status.presentation_visible===true,status);
      const stats=await this.pc.getStats();
      let frame=null,pair=null,codec=null,audio=null,transport=null;
      for(const row of stats.values()){
        if(row.type==='inbound-rtp'&&row.kind==='video')frame=row;
        if(row.type==='inbound-rtp'&&row.kind==='audio')audio=row;
        if(row.type==='candidate-pair'&&row.state==='succeeded'&&row.nominated)pair=row;
        if(row.type==='transport'&&row.selectedCandidatePairId)transport=row;
      }
      // The transport's selected pair is authoritative, even if another pair
      // remains nominated after an ICE restart. Report failures without video.
      if(transport)pair=stats.get(transport.selectedCandidatePairId)||null;
      const local=pair?stats.get(pair.localCandidateId):null;
      const remote=pair?stats.get(pair.remoteCandidateId):null;
      const bounded={};
      for(const k of ['width','height','fps','rtt_ms','jitter_buffer_ms','frames_decoded','frames_dropped'])bounded[k]=null;
      if(frame){
        codec=stats.get(frame.codecId);
        const prev=this.lastVideo;
        const count=prev?frame.jitterBufferEmittedCount-prev.jitterBufferEmittedCount:0;
        const delay=count>0?(frame.jitterBufferDelay-prev.jitterBufferDelay)*1000/count:null;
        const mbps=prev?(frame.bytesReceived-prev.bytesReceived)*8/(frame.timestamp-prev.timestamp)/1000:null;
        const metrics={width:frame.frameWidth,height:frame.frameHeight,fps:frame.framesPerSecond,
          codec:codec?.mimeType,mbps,rtt_ms:pair?.currentRoundTripTime*1000,jitter_buffer_ms:delay,
          frames_decoded:frame.framesDecoded,frames_dropped:frame.framesDropped,relay:local?.candidateType==='relay'||remote?.candidateType==='relay'};
        this.lastVideo=frame;this.onStats(metrics);
        for(const k of Object.keys(bounded))bounded[k]=Number.isFinite(metrics[k])?metrics[k]:null;
        if(frame.frameWidth&&frame.frameWidth<1920)
          this.onStatus('Quality reduced by the connection; check before going live');
      }
      if(!this.lastTelemetryAt||performance.now()-this.lastTelemetryAt>=1000){
        this.lastTelemetryAt=performance.now();
        const finite=v=>Number.isFinite(v)?v:null;
        Object.assign(bounded,{audio_jitter_ms:finite(audio?.jitter*1000),audio_packets_lost:finite(audio?.packetsLost),audio_packets_received:finite(audio?.packetsReceived),audio_concealed_samples:finite(audio?.concealedSamples),audio_level:finite(audio?.audioLevel),
          bytes_received:finite(pair?.bytesReceived),video_muted:this.video.muted,music_paused:document.getElementById('rain-cue')?.paused!==false,
          connection_state:this.pc.connectionState||null,ice_state:this.pc.iceConnectionState||null,pair_state:pair?.state||null,
          local_candidate_type:local?.candidateType||null,remote_candidate_type:remote?.candidateType||null,candidate_protocol:local?.protocol||null,relay_protocol:local?.relayProtocol||null,
          relay:local?.candidateType==='relay'||remote?.candidateType==='relay'});
        await this.api({action:'media-stats',id:this.id,stats:bounded});
      }
    }catch(error){
      if(revision!==this.revision)return;
      this.dismiss();this.video.muted=true;
      await this.close();
      this.retryLater(error.message);
      return;
    }
    if(revision===this.revision&&!this.closed)this.timer=setTimeout(()=>void this.heartbeat(revision),200);
  }
}

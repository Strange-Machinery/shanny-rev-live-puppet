export class StagePlayer {
  constructor({video,key,onStatus=()=>{},onStats=()=>{},onPresentation=()=>{}}){Object.assign(this,{video,key,onStatus,onStats,onPresentation});this.revision=0;this.pc=null;this.id=null;this.timer=null;this.lastVideo=null;}
  async api(body){const response=await fetch('/api/media',{method:'POST',headers:{Authorization:'Bearer '+this.key,'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Stage connection unavailable');return data;}
  async close(){this.revision++;clearTimeout(this.timer);this.pc?.close();this.pc=null;this.video.srcObject=null;this.lastVideo=null;const id=this.id;this.id=null;if(id)await this.api({action:'media-close',id}).catch(()=>{});}
  async connect(){
    await this.close();const revision=this.revision;this.onStatus('Connecting to StankTank…');
    try {
      const setup=await this.api({action:'media-open'});
      if(revision!==this.revision){await this.api({action:'media-close',id:setup.id});return;}
      this.id=setup.id;const pc=new RTCPeerConnection({iceServers:setup.iceServers,bundlePolicy:'max-bundle'});this.pc=pc;
      const stream=new MediaStream();this.video.srcObject=stream;
      pc.ontrack=event=>{if(revision!==this.revision)return;stream.addTrack(event.track);if('jitterBufferTarget' in event.receiver)event.receiver.jitterBufferTarget=0;void this.video.play().catch(()=>this.onStatus('Click Enable sound to start playback.'));};
      pc.onconnectionstatechange=()=>{if(revision!==this.revision)return;
        if(pc.connectionState==='connected')this.onStatus('Connected · live StankTank');
        else if(['failed','disconnected'].includes(pc.connectionState)){this.video.pause();this.onStatus('Stage connection interrupted. Reconnect before going live.');}
      };
      const videoReceiver=pc.addTransceiver('video',{direction:'recvonly'});pc.addTransceiver('audio',{direction:'recvonly'});
      const codecs=RTCRtpReceiver.getCapabilities('video').codecs.filter(c=>c.mimeType.toLowerCase()==='video/h264');
      if(!codecs.length)throw new Error('This browser cannot receive the H.264 stage feed. Use Edge or Chrome.');
      videoReceiver.setCodecPreferences(codecs);
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise(resolve=>{const timer=setTimeout(resolve,8500);pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}};if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}});
      if(revision!==this.revision)return;
      await this.api({action:'media-offer',id:this.id,sdp:pc.localDescription.sdp});
      const deadline=performance.now()+20000;
      while(revision===this.revision){
        const result=await this.api({action:'media-poll',id:this.id});
        if(result.error)throw new Error(result.error);
        if(result.answer){await pc.setRemoteDescription({type:'answer',sdp:result.answer});break;}
        if(performance.now()>deadline)throw new Error('Stage did not answer. Reconnect.');
        await new Promise(r=>setTimeout(r,250));
      }
      if(revision===this.revision)this.heartbeat(revision);
    }catch(error){if(revision===this.revision){await this.close();this.onStatus(error.message);}}
  }
  async heartbeat(revision){
    if(revision!==this.revision||!this.pc)return;
    try {
      const status=await this.api({action:'media-poll',id:this.id});this.onPresentation(status.presentation_visible===true);if(!status.available)throw new Error('Producer stage is offline');
      const stats=await this.pc.getStats();let frame=null,pair=null,codec=null;
      for(const row of stats.values()){
        if(row.type==='inbound-rtp'&&row.kind==='video')frame=row;
        if(row.type==='candidate-pair'&&row.state==='succeeded'&&row.nominated)pair=row;
      }
      if(frame){
        codec=stats.get(frame.codecId);const prev=this.lastVideo;
        const count=prev?frame.jitterBufferEmittedCount-prev.jitterBufferEmittedCount:0;
        const delay=count>0?(frame.jitterBufferDelay-prev.jitterBufferDelay)*1000/count:null;
        const mbps=prev?(frame.bytesReceived-prev.bytesReceived)*8/(frame.timestamp-prev.timestamp)/1000:null;
        const remote=pair?stats.get(pair.remoteCandidateId):null;
        const metrics={width:frame.frameWidth,height:frame.frameHeight,fps:frame.framesPerSecond,
          codec:codec?.mimeType,mbps,rtt_ms:pair?.currentRoundTripTime*1000,jitter_buffer_ms:delay,
          frames_decoded:frame.framesDecoded,frames_dropped:frame.framesDropped,relay:remote?.candidateType==='relay'};
        this.lastVideo=frame;this.onStats(metrics);
        if(frame.frameWidth&&frame.frameWidth<1920)this.onStatus('Quality reduced by the connection · check before going live');
      }
    }catch(error){this.onPresentation(false);this.video.pause();this.onStatus(error.message);}
    if(revision===this.revision)this.timer=setTimeout(()=>this.heartbeat(revision),200);
  }
}

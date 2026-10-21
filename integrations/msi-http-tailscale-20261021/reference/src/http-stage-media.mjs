import {spawn as nodeSpawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {sanitizePresentation,validEpoch} from './remote-web/http-stage-protocol.js';

/**
 * Opt-in, single-publisher browser-media bridge. The public side only reads
 * complete H264/AAC fragmented MP4 units and reports observed playback.
 * Network routing/permission to carry video is the caller's responsibility.
 * No TURN account, hosted media service, disk spool, or OBS peer is created.
 */
export const HTTP_STAGE_DEFAULT_LIMITS=Object.freeze({
  maxChunkBytes:2*1024*1024,maxInputQueuedBytes:4*1024*1024,
  maxInitBytes:512*1024,maxFragmentBytes:8*1024*1024,
  maxRingBytes:24*1024*1024,maxFragments:24,maxReceivers:4,
  receiverTtlMs:15000,receiptFreshMs:4000,publisherIdleMs:15000,
  startupTimeoutMs:30000,inputWriteTimeoutMs:10000,
  maxPresentationEvents:256,maxPresentationBytes:192*1024,
  targetBufferSeconds:1.5,maxBufferSeconds:6,
});

export class HttpStageError extends Error{
  constructor(code,message,status=400){super(message);this.name='HttpStageError';this.code=code;this.status=status;}
}
const fail=(code,message,status)=>{throw new HttpStageError(code,message,status);};
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const headerFlags=(b)=>b.readUInt32BE(0)&0xffffff;

function boxes(buffer,start=0,end=buffer.length){
  const list=[];let at=start;
  while(at<end){
    if(end-at<8)fail('invalid_mp4','Incomplete MP4 box');
    let size=buffer.readUInt32BE(at),header=8;
    if(size===1){
      if(end-at<16)fail('invalid_mp4','Incomplete extended MP4 box');
      const large=buffer.readBigUInt64BE(at+8);
      if(large>BigInt(Number.MAX_SAFE_INTEGER))fail('invalid_mp4','MP4 box too large');
      size=Number(large);header=16;
    }
    if(size<header||at+size>end)fail('invalid_mp4','Invalid MP4 box bounds');
    list.push({type:buffer.toString('ascii',at+4,at+8),data:buffer.subarray(at+header,at+size)});
    at+=size;
  }
  return list;
}
const child=(b,type)=>boxes(b).find(x=>x.type===type)?.data;
function need(buffer,bytes){if(!buffer||buffer.length<bytes)fail('invalid_mp4','Incomplete MP4 metadata');return buffer;}

/** Parse only the structure emitted by our fixed FFmpeg packager. */
function inspectInit(moov){
  const tracks=new Map(),defaults=new Map();let avcCodec=null,audioPresent=false;
  const movieHeader=child(moov,'mvhd');
  const movieTimescale=movieHeader?need(movieHeader,movieHeader[0]===1?24:16).readUInt32BE(movieHeader[0]===1?20:12):null;
  for(const box of boxes(moov)){
    if(box.type==='mvex')for(const item of boxes(box.data))if(item.type==='trex'){
      const b=need(item.data,24);defaults.set(b.readUInt32BE(4),{duration:b.readUInt32BE(12),flags:b.readUInt32BE(20)});
    }
    if(box.type!=='trak')continue;
    const tkhd=need(child(box.data,'tkhd'),24),mdia=need(child(box.data,'mdia'),8);
    const trackId=tkhd.readUInt32BE(tkhd[0]===1?20:12);
    const hdlr=need(child(mdia,'hdlr'),12),mdhd=need(child(mdia,'mdhd'),24);
    const kind=hdlr.toString('ascii',8,12),timescale=mdhd.readUInt32BE(mdhd[0]===1?20:12);
    if(!timescale||tracks.has(trackId))fail('invalid_mp4','Invalid MP4 track');
    const stsd=need(child(need(child(need(child(mdia,'minf'),8),'stbl'),8),'stsd'),8);
    const entries=boxes(stsd,8);
    if(kind==='vide'){
      const entry=entries.find(x=>x.type==='avc1');
      if(!entry)fail('unsupported_codec','H264 output required');
      const avcc=need(boxes(need(entry.data,78),78).find(x=>x.type==='avcC')?.data,4);
      avcCodec='avc1.'+avcc.subarray(1,4).toString('hex').toUpperCase();
    }else if(kind==='soun'){
      const entry=entries.find(x=>x.type==='mp4a');
      if(!entry||!boxes(need(entry.data,28),28).some(x=>x.type==='esds'))fail('unsupported_codec','AAC output required');
      audioPresent=true;
    }
    let timelineOffset=0;
    const edits=child(box.data,'edts');
    if(edits){
      const elst=need(child(edits,'elst'),8),count=elst.readUInt32BE(4),wide=elst[0]===1;
      if(!movieTimescale||count>2)fail('invalid_mp4','Unsupported MP4 timeline edits');
      let emptyDuration=0,p=8,mediaEdit=false;
      for(let i=0;i<count;i++){
        need(elst,p+(wide?20:12));
        const duration=wide?Number(elst.readBigUInt64BE(p)):elst.readUInt32BE(p);p+=wide?8:4;
        const mediaTime=wide?Number(elst.readBigInt64BE(p)):elst.readInt32BE(p);p+=wide?8:4;
        const rate=elst.readUInt32BE(p);p+=4;
        if(!Number.isSafeInteger(duration)||!Number.isSafeInteger(mediaTime)||rate!==0x10000||mediaEdit)
          fail('invalid_mp4','Unsupported MP4 timeline edit');
        if(mediaTime===-1)emptyDuration+=duration/movieTimescale;
        else if(mediaTime>=0){timelineOffset=emptyDuration-mediaTime/timescale;mediaEdit=true;}
        else fail('invalid_mp4','Invalid MP4 media time');
      }
      if(!mediaEdit||p!==elst.length)fail('invalid_mp4','Incomplete MP4 timeline edit');
    }
    tracks.set(trackId,{kind,timescale,timelineOffset});
  }
  if(!avcCodec||!audioPresent)fail('missing_tracks','Output must contain both video and audio');
  return {tracks,defaults,audioPresent,mime:'video/mp4; codecs="'+avcCodec+',mp4a.40.2"'};
}

function inspectFragment(moof,metadata){
  let video=null,audio=null;
  for(const traf of boxes(moof).filter(x=>x.type==='traf')){
    const fields=boxes(traf.data),tfhd=need(fields.find(x=>x.type==='tfhd')?.data,8);
    const flags=headerFlags(tfhd),trackId=tfhd.readUInt32BE(4),track=metadata.tracks.get(trackId);
    if(!track)fail('invalid_mp4','Unknown fragment track');
    let pos=8,defaultDuration=metadata.defaults.get(trackId)?.duration||0,defaultFlags=metadata.defaults.get(trackId)?.flags||0;
    if(flags&1)pos+=8;if(flags&2)pos+=4;
    if(flags&8){need(tfhd,pos+4);defaultDuration=tfhd.readUInt32BE(pos);pos+=4;}
    if(flags&16)pos+=4;
    if(flags&32){need(tfhd,pos+4);defaultFlags=tfhd.readUInt32BE(pos);pos+=4;}
    need(tfhd,pos);
    const tfdt=need(fields.find(x=>x.type==='tfdt')?.data,8);
    const base=tfdt[0]===1?Number(need(tfdt,12).readBigUInt64BE(4)):tfdt.readUInt32BE(4);
    if(!Number.isSafeInteger(base))fail('invalid_mp4','Fragment timestamp exceeds safe range');
    let duration=0,firstFlags=null,sampleCount=0;
    for(const run of fields.filter(x=>x.type==='trun')){
      const b=need(run.data,8),rf=headerFlags(b),count=b.readUInt32BE(4);let p=8,runFirst=null;
      if(count>100000)fail('invalid_mp4','Excessive MP4 sample count');
      if(rf&1)p+=4;
      if(rf&4){need(b,p+4);runFirst=b.readUInt32BE(p);p+=4;}
      for(let i=0;i<count;i++){
        let d=defaultDuration,sf=i===0&&runFirst!==null?runFirst:defaultFlags;
        if(rf&0x100){need(b,p+4);d=b.readUInt32BE(p);p+=4;}
        if(rf&0x200)p+=4;
        if(rf&0x400){need(b,p+4);sf=b.readUInt32BE(p);p+=4;}
        if(rf&0x800)p+=4;
        need(b,p);if(!d)fail('invalid_mp4','Missing MP4 sample duration');
        if(firstFlags===null)firstFlags=sf;
        duration+=d;sampleCount++;
      }
      if(p!==b.length)fail('invalid_mp4','Unexpected MP4 run data');
    }
    const data={start_time:base/track.timescale+track.timelineOffset,end_time:(base+duration)/track.timescale+track.timelineOffset,
      keyframe:sampleCount>0&&(firstFlags&0x10000)===0&&((firstFlags>>>24)&3)===2};
    if(track.kind==='vide')video=data;else if(track.kind==='soun')audio=data;
  }
  if(!video&&!audio)fail('invalid_mp4','Empty MP4 fragment');
  const result=video||audio;
  return {...result,keyframe:Boolean(video?.keyframe),audio_present:Boolean(audio)};
}

/** Bounded incremental parser. Never publishes partial boxes or moof without mdat. */
export function createFragmentedMp4Parser({maxInitBytes=512*1024,maxFragmentBytes=8*1024*1024,onInit,onFragment}={}){
  let pending=Buffer.alloc(0),initParts=[],initBytes=0,metadata=null,fragmentParts=[],fragmentBytes=0,fragmentInfo=null,ended=false;
  function accept(type,whole,body){
    if(!metadata){
      if(!['ftyp','free','skip','moov'].includes(type))fail('invalid_mp4','Expected MP4 initialization');
      initBytes+=whole.length;if(initBytes>maxInitBytes)fail('init_too_large','MP4 initialization too large');
      initParts.push(whole);
      if(type==='moov'){
        if(!initParts.some(b=>b.toString('ascii',4,8)==='ftyp'))fail('invalid_mp4','Missing MP4 file type');
        metadata=inspectInit(body);onInit?.(Buffer.concat(initParts,initBytes),metadata);initParts=[];
      }
      return;
    }
    if(type==='moof'){
      if(fragmentInfo)fail('invalid_mp4','Fragment has no media data');
      fragmentInfo=inspectFragment(body,metadata);fragmentParts.push(whole);fragmentBytes+=whole.length;
    }else if(type==='mdat'){
      if(!fragmentInfo)fail('invalid_mp4','Media data has no fragment header');
      fragmentParts.push(whole);fragmentBytes+=whole.length;
      if(fragmentBytes>maxFragmentBytes)fail('fragment_too_large','MP4 fragment too large');
      onFragment?.(Buffer.concat(fragmentParts,fragmentBytes),fragmentInfo);
      fragmentParts=[];fragmentBytes=0;fragmentInfo=null;
    }else if(['styp','sidx','free','skip'].includes(type)){
      fragmentParts.push(whole);fragmentBytes+=whole.length;
    }else if(type==='mfra'){
      if(fragmentInfo)fail('invalid_mp4','Incomplete final fragment');
      ended=true;
    }else fail('invalid_mp4','Unexpected MP4 box');
    if(fragmentBytes>maxFragmentBytes)fail('fragment_too_large','MP4 fragment too large');
  }
  return {
    push(value){
      if(ended&&value.length)fail('invalid_mp4','Data after MP4 trailer');
      const bytes=Buffer.from(value);if(!bytes.length)return;
      if(pending.length+bytes.length>maxFragmentBytes+maxInitBytes+64*1024)fail('parser_overflow','MP4 parser buffer full');
      pending=Buffer.concat([pending,bytes]);
      while(pending.length>=8){
        let length=pending.readUInt32BE(0),header=8;
        if(length===1){if(pending.length<16)return;const large=pending.readBigUInt64BE(8);if(large>BigInt(maxFragmentBytes))fail('fragment_too_large','MP4 box too large');length=Number(large);header=16;}
        if(length<header||length>maxFragmentBytes)fail('invalid_mp4','Invalid MP4 box size');
        if(pending.length<length)return;
        const whole=Buffer.from(pending.subarray(0,length));pending=pending.subarray(length);
        accept(whole.toString('ascii',4,8),whole,whole.subarray(header));
      }
    },
    finish(){if(pending.length||fragmentInfo||!metadata)fail('truncated_mp4','Incomplete MP4 output');},
    bufferedBytes:()=>pending.length+initBytes*(metadata?0:1)+fragmentBytes,
  };
}

export function buildHttpStageFfmpegArgs(mimeType){
  if(typeof mimeType!=='string'||mimeType.length>160||!/^video\/(webm|mp4)(?:\s*;\s*codecs=[a-zA-Z0-9.," _-]+)?$/.test(mimeType))
    fail('unsupported_input','Publisher must provide WebM or MP4 video with audio',415);
  return ['-hide_banner','-loglevel','error','-nostdin','-threads','2','-filter_threads','2','-max_alloc','67108864','-fflags','+genpts','-copyts','-start_at_zero',
    '-probesize','1048576','-analyzeduration','1000000','-protocol_whitelist','pipe','-max_pixels','8294400',
    '-f',mimeType.startsWith('video/webm')?'webm':'mp4','-i','pipe:0',
    '-map','0:v:0','-map','0:a:0','-sn','-dn',
    '-vf',"scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    '-c:v','libx264','-threads','2','-preset','ultrafast','-tune','zerolatency','-profile:v','baseline','-level:v','4.0',
    '-pix_fmt','yuv420p','-r','30','-g','30','-keyint_min','30','-sc_threshold','0','-bf','0',
    '-b:v','4000k','-maxrate','6000k','-bufsize','4000k',
    '-c:a','aac','-b:a','128k','-ar','48000','-ac','2',
    // delay_moov preserves the common A/V origin in initialization metadata.
    // empty_moov alone resets a delayed first audio track to zero in FFmpeg.
    '-avoid_negative_ts','make_zero','-movflags','+delay_moov+frag_keyframe+default_base_moof','-flush_packets','1','-f','mp4','pipe:1'];
}

export function createHttpStageMedia({enabled=false,ffmpegPath='ffmpeg',limits:overrides={},now=Date.now,spawn=nodeSpawn}={}){
  if(typeof enabled!=='boolean'||typeof ffmpegPath!=='string'||!ffmpegPath||ffmpegPath.length>2000)throw new Error('Invalid HTTP stage configuration');
  if(Object.keys(overrides).some(k=>!(k in HTTP_STAGE_DEFAULT_LIMITS)))throw new Error('Unknown HTTP stage limit');
  const limits={...HTTP_STAGE_DEFAULT_LIMITS,...overrides};
  for(const [name,n] of Object.entries(limits))if(!Number.isFinite(n)||n<=0||(!name.endsWith('Seconds')&&!Number.isSafeInteger(n)))throw new Error('Invalid HTTP stage limit: '+name);
  if(limits.maxRingBytes<limits.maxFragmentBytes||limits.maxInputQueuedBytes<limits.maxChunkBytes||limits.maxBufferSeconds<=limits.targetBufferSeconds)throw new Error('Inconsistent HTTP stage limits');
  let epoch=randomUUID(),state=enabled?'idle':'disabled',closed=false,publisher=null,init=null,mime=null,fragments=[],ringBytes=0,nextFragment=0,lastError=null,lastMediaAt=null;
  let presentationEvents=[],presentationBytes=0,nextPresentation=0;
  const receivers=new Map(),children=new Set(),rainCues=new Map();
  const publicManifest=()=>({transport:'http-fmp4',state,stream_epoch:epoch,mime_type:mime,
    audio_present:Boolean(init),first_sequence:fragments[0]?.sequence??null,latest_sequence:fragments.at(-1)?.sequence??null,
    fragments:fragments.map(({data,...rest})=>rest),max_chunk_bytes:limits.maxChunkBytes,
    presentation_events:presentationEvents.map(({bytes,...event})=>event),
    // A shared FFmpeg input origin preserves inter-track offsets. The browser
    // records cue times on its recording clock; deployment must verify capture
    // clock alignment. Never claim measured physical speaker audibility.
    media_time_offset:0,presentation_clock:'recorder-elapsed',
    target_buffer_seconds:limits.targetBufferSeconds,max_buffer_seconds:limits.maxBufferSeconds,
    error:lastError,source_age_ms:lastMediaAt!==null?Math.max(0,now()-lastMediaAt):null});
  function assertEnabled(){if(closed)fail('closed','HTTP stage is closed',410);if(!enabled)fail('disabled','HTTP stage is disabled',409);}
  function clearMedia(){init=null;mime=null;fragments=[];ringBytes=0;nextFragment=0;lastMediaAt=null;presentationEvents=[];presentationBytes=0;nextPresentation=0;rainCues.clear();for(const r of receivers.values()){r.baseline=null;r.videoReady=false;r.audioOutputUnmuted=false;r.audioPresent=false;r.receiptAt=null;r.initEpoch=null;r.servedSequence=-1;r.observed=null;r.playbackGeneration++;}}
  function killPublisher(){
    const old=publisher;publisher=null;
    if(!old)return;
    old.closed=true;old.process.stdin?.destroy();old.process.kill('SIGTERM');
    const force=setTimeout(()=>{if(children.has(old.process))old.process.kill('SIGKILL');},1500);force.unref();
  }
  function invalidate(nextState,error=null){epoch=randomUUID();killPublisher();clearMedia();state=nextState;lastError=error;}
  function sourceFailed(code){if(!publisher)return;invalidate('error',code);}
  function checkPublisher(id,streamEpoch){assertEnabled();if(!publisher||publisher.id!==id||streamEpoch!==epoch)fail('stale_publisher','Publisher session has expired',409);return publisher;}
  function getReceiver(id){
    const r=receivers.get(id);if(!r||now()-r.seen>limits.receiverTtlMs){receivers.delete(id);fail('receiver_expired','Receiver session has expired',410);}
    r.seen=now();return r;
  }
  function checkEpoch(streamEpoch){if(streamEpoch!==epoch)fail('stale_epoch','Media epoch has changed',409);}
  function sourceAvailable(){return state==='live'&&lastMediaAt!==null&&now()-lastMediaAt<=limits.publisherIdleMs;}
  function fresh(r){return r.receiptAt!==null&&now()-r.receiptAt<=limits.receiptFreshMs;}
  // Transport readiness includes an audio track even while the reactive stage
  // is hidden or muted. Audible presentation is checked separately.
  function receiverReady(r){return sourceAvailable()&&r.videoReady&&r.audioPresent&&fresh(r);}
  function prunePresentations(){
    const firstTime=fragments[0]?.start_time;if(firstTime===undefined)return;
    while(presentationEvents.length>1&&presentationEvents[1].media_time<=firstTime)
      presentationBytes-=presentationEvents.shift().bytes;
  }
  function presentationAt(time){let event=null;for(const e of presentationEvents){if(e.media_time>time)break;event=e;}return event?.presentation||null;}
  function rainAt(time){let cue=null;for(const value of rainCues.values())for(const item of value.events)if(item.media_time<=time&&(!cue||item.media_time>=cue.media_time))cue=item;return cue;}
  function sweep(){
    for(const [id,r] of receivers)if(now()-r.seen>limits.receiverTtlMs)receivers.delete(id);
    if(publisher){
      if(now()-publisher.lastInputAt>limits.publisherIdleMs)sourceFailed('publisher_timeout');
      else if(state==='starting'&&now()-publisher.openedAt>limits.startupTimeoutMs)sourceFailed('publisher_start_timeout');
      else if(state==='live'&&now()-lastMediaAt>limits.publisherIdleMs)sourceFailed('media_stalled');
    }
  }
  const timer=setInterval(sweep,1000);timer.unref();
  return {
    limits:Object.freeze({...limits}),
    openPublisher({mime_type}={}){
      assertEnabled();if(publisher)fail('publisher_busy','A publisher is already active',409);
      if(children.size>=2)fail('packager_restarting','Wait for the previous media packager to exit',429);
      const args=buildHttpStageFfmpegArgs(mime_type);epoch=randomUUID();clearMedia();lastError=null;state='starting';
      let process;
      try{process=spawn(ffmpegPath,args,{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});}
      catch{state='error';lastError='ffmpeg_spawn_failed';fail('ffmpeg_spawn_failed','Could not start media packager',503);}
      const session={id:randomUUID(),epoch,process,openedAt:now(),lastInputAt:now(),nextSequence:0,inputQueuedBytes:0,writing:false,closed:false};
      publisher=session;children.add(process);
      const parser=createFragmentedMp4Parser({maxInitBytes:limits.maxInitBytes,maxFragmentBytes:limits.maxFragmentBytes,
        onInit(data,metadata){if(publisher!==session)return;init=data;mime=metadata.mime;},
        onFragment(data,details){
          if(publisher!==session)return;
          if(data.length>limits.maxRingBytes)return sourceFailed('fragment_overflow');
          fragments.push({sequence:nextFragment++,bytes:data.length,...details,data});ringBytes+=data.length;lastMediaAt=now();
          while(fragments.length>limits.maxFragments||ringBytes>limits.maxRingBytes){ringBytes-=fragments.shift().data.length;}
          while(fragments.length&&!fragments[0].keyframe){ringBytes-=fragments.shift().data.length;}
          prunePresentations();
          if(init&&fragments.length)state='live';
        }});
      process.stdout.on('data',data=>{if(publisher!==session)return;try{parser.push(data);}catch(error){sourceFailed(error.code||'invalid_mp4');}});
      // Drain stderr without persisting it: source paths and media metadata must
      // not leak to a viewer, logs, or an unbounded diagnostic buffer.
      process.stderr.on('data',()=>{});
      process.stdin.on('error',()=>{if(publisher===session)sourceFailed('publisher_input_failed');});
      process.on('error',()=>{if(publisher===session)sourceFailed('ffmpeg_unavailable');});
      process.on('close',()=>{children.delete(process);if(publisher===session)sourceFailed('ffmpeg_exited');});
      return {publisher_id:session.id,stream_epoch:epoch,next_sequence:0,max_chunk_bytes:limits.maxChunkBytes};
    },
    setPresentation({publisher_id,stream_epoch,media_time,presentation}={}){
      const p=checkPublisher(publisher_id,stream_epoch);
      if(!Number.isFinite(media_time)||media_time<0||media_time>(now()-p.openedAt)/1000+3||
        media_time<(presentationEvents.at(-1)?.media_time??0)||!presentation||typeof presentation!=='object'||Array.isArray(presentation))
        fail('invalid_presentation','Invalid recording presentation time');
      const clean=sanitizePresentation(presentation),bytes=Buffer.byteLength(JSON.stringify(clean))+80;
      const nonce=clean.presentation_nonce,priorCue=rainCues.get(nonce);
      if(clean.rain_audio==='ended'&&priorCue?.state!=='playing'&&priorCue?.state!=='ended')
        fail('invalid_rain_transition','Soundtrack end requires its earlier playing marker',409);
      if(clean.rain_audio==='playing'&&['ended','failed'].includes(priorCue?.state))
        fail('invalid_rain_transition','A completed soundtrack requires a new presentation nonce',409);
      prunePresentations();
      if(presentationEvents.length>=limits.maxPresentationEvents||presentationBytes+bytes>limits.maxPresentationBytes)
        fail('presentation_overflow','Presentation timeline is full',429);
      const event={sequence:nextPresentation++,media_time,presentation:clean,bytes};presentationEvents.push(event);presentationBytes+=bytes;
      if(nonce&&['playing','ended','failed'].includes(clean.rain_audio)){
        let cue=rainCues.get(nonce);
        if(!cue){cue={events:[]};rainCues.set(nonce,cue);while(rainCues.size>64)rainCues.delete(rainCues.keys().next().value);}
        if(cue.state!==clean.rain_audio){
          cue.state=clean.rain_audio;cue.events.push({nonce,state:clean.rain_audio,media_time});
          if(cue.events.length>4)cue.events.shift();
          if(clean.rain_audio==='ended')cue.ended=media_time;
        }
      }
      return {accepted:true,stream_epoch:epoch,sequence:event.sequence};
    },
    async writePublisherChunk({publisher_id,stream_epoch,sequence,body}={}){
      const p=checkPublisher(publisher_id,stream_epoch),data=Buffer.from(body||[]);
      if(!integer(sequence,0,Number.MAX_SAFE_INTEGER)||sequence!==p.nextSequence)fail('chunk_order','Publisher chunk is out of order',409);
      if(!data.length||data.length>limits.maxChunkBytes)fail('chunk_size','Publisher chunk has invalid size',413);
      if(p.writing||p.inputQueuedBytes+data.length>limits.maxInputQueuedBytes)fail('backpressure','Publisher must wait for the prior chunk',429);
      p.writing=true;p.inputQueuedBytes+=data.length;p.lastInputAt=now();
      try{
        await new Promise((resolve,reject)=>{
          let done=false;
          const timeout=setTimeout(()=>finish(new HttpStageError('input_timeout','Media packager did not accept input',503)),limits.inputWriteTimeoutMs);timeout.unref();
          const finish=error=>{if(done)return;done=true;clearTimeout(timeout);error?reject(error):resolve();};
          try{p.process.stdin.write(data,error=>finish(error?new HttpStageError('input_failed','Media packager rejected input',503):null));}
          catch{finish(new HttpStageError('input_failed','Media packager rejected input',503));}
        });
        checkPublisher(publisher_id,stream_epoch);p.nextSequence++;p.lastInputAt=now();
        return {accepted:true,stream_epoch:epoch,next_sequence:p.nextSequence};
      }catch(error){if(publisher===p)sourceFailed(error.code||'input_failed');throw error;}
      finally{p.writing=false;p.inputQueuedBytes-=data.length;}
    },
    closePublisher({publisher_id,stream_epoch}={}){checkPublisher(publisher_id,stream_epoch);invalidate('stopped');return {closed:true,stream_epoch:epoch};},
    openReceiver({viewer_role='preview'}={}){
      assertEnabled();sweep();if(!['preview','obs'].includes(viewer_role))fail('invalid_role','Invalid receiver role');
      if(receivers.size>=limits.maxReceivers)fail('receiver_limit','Close an unused receiver',429);
      const id=randomUUID();receivers.set(id,{id,role:viewer_role,seen:now(),baseline:null,videoReady:false,audioOutputUnmuted:false,audioPresent:false,receiptAt:null,initEpoch:null,servedSequence:-1,observed:null,playbackGeneration:0});
      return {viewer_id:id,...publicManifest()};
    },
    manifest({viewer_id}={}){if(viewer_id)getReceiver(viewer_id);sweep();return publicManifest();},
    getInit({viewer_id,stream_epoch}={}){const r=getReceiver(viewer_id);checkEpoch(stream_epoch);if(!init)fail('media_not_ready','Media initialization is not ready',425);if(r.initEpoch===epoch)r.playbackGeneration++;r.initEpoch=epoch;r.baseline=null;r.videoReady=false;r.receiptAt=null;r.servedSequence=-1;return init;},
    getFragment({viewer_id,stream_epoch,sequence}={}){
      const r=getReceiver(viewer_id);checkEpoch(stream_epoch);
      if(r.initEpoch!==epoch)fail('initialization_required','Fetch this epoch initialization first',409);
      if(!integer(sequence,0,Number.MAX_SAFE_INTEGER))fail('invalid_sequence','Invalid fragment sequence');
      const fragment=fragments.find(x=>x.sequence===sequence);if(!fragment)fail('fragment_expired','Fragment no longer available; resynchronize',410);
      r.servedSequence=Math.max(r.servedSequence,sequence);return fragment.data;
    },
    receipt({viewer_id,stream_epoch,sequence,frames_decoded,current_time,playing,muted,volume,audio_present,
      presentation_nonce=null,presentation_visible=false,rain_nonce=null,rain_state=null}={}){
      const r=getReceiver(viewer_id);checkEpoch(stream_epoch);
      if(r.initEpoch!==epoch||!integer(sequence,0,r.servedSequence)||!integer(frames_decoded,0,Number.MAX_SAFE_INTEGER)||
        !Number.isFinite(current_time)||current_time<0||typeof playing!=='boolean'||typeof muted!=='boolean'||
        !Number.isFinite(volume)||volume<0||volume>1||!(audio_present===null||typeof audio_present==='boolean')||
        !(presentation_nonce===null||validEpoch(presentation_nonce))||typeof presentation_visible!=='boolean'||
        !(rain_nonce===null||validEpoch(rain_nonce))||!(rain_state===null||['playing','ended','failed'].includes(rain_state)))
        fail('invalid_receipt','Invalid playback progress receipt');
      const fragment=fragments.find(x=>x.sequence===sequence);
      if(!fragment||current_time>fragment.end_time+1||current_time<Math.max(0,(fragments[0]?.start_time||0)-1))fail('stale_receipt','Playback receipt is outside available media',409);
      const expected=presentationAt(current_time),rain=rainAt(current_time);
      if(presentation_nonce!==null&&(expected?.presentation_nonce!==presentation_nonce||expected?.presentation_visible!==presentation_visible))
        fail('invalid_presentation_receipt','Presentation receipt is not on the trusted timeline',409);
      if(rain_nonce!==null&&(rain?.nonce!==rain_nonce||rain?.state!==rain_state))
        fail('invalid_rain_receipt','Soundtrack receipt is not on the trusted timeline',409);
      const prev=r.baseline;
      const discontinuity=Boolean(prev&&(sequence<prev.sequence||frames_decoded<prev.frames||current_time<prev.time||
        current_time-prev.time>(now()-prev.receiptAt)/1000+1));
      if(discontinuity)r.playbackGeneration++;
      const progress=Boolean(prev&&!discontinuity&&sequence>=prev.sequence&&frames_decoded>prev.frames&&current_time>prev.time&&playing);
      r.videoReady=progress;r.audioPresent=audio_present===true;r.audioOutputUnmuted=playing&&!muted&&volume>0&&r.audioPresent;r.receiptAt=now();
      r.baseline={sequence,frames:frames_decoded,time:current_time,receiptAt:now()};
      r.observed={playing,muted,volume,audio_present:r.audioPresent,current_time,presentation_nonce,presentation_visible,
        rain_nonce,rain_state,frames_decoded};
      return {accepted:true,video_ready:r.videoReady,audio_track_present:Boolean(init),audio_output_unmuted:r.audioOutputUnmuted,remote_ready:receiverReady(r),audio_audibility_verified:false};
    },
    closeReceiver({viewer_id}={}){receivers.delete(viewer_id);return {closed:true};},
    presentationStatus(nonce){
      sweep();const cue=rainCues.get(nonce);
      return {stream_epoch:epoch,state,available:sourceAvailable(),source_available:sourceAvailable(),
        source_rain_state:cue?.state??null,source_rain_end_time:cue?.ended??null,
        receivers:[...receivers.values()].map(r=>({id:r.id,role:r.role,fresh:fresh(r),progressing:r.videoReady,
          playback_generation:r.playbackGeneration,...(r.observed||{playing:false,muted:true,volume:0,audio_present:false,current_time:0,presentation_nonce:null,presentation_visible:false})}))};
    },
    info(){sweep();return {...publicManifest(),enabled,available:state==='live',publisher_active:Boolean(publisher),
      receiver_count:receivers.size,ready_receivers:[...receivers.values()].filter(receiverReady).length,
      ready_viewers:[...receivers.values()].filter(receiverReady).length,
      ready_obs_receivers:[...receivers.values()].filter(r=>r.role==='obs'&&receiverReady(r)).length,
      buffered_bytes:ringBytes+(init?.length||0),presentation_bytes:presentationBytes,input_queued_bytes:publisher?.inputQueuedBytes||0,
      audio_audibility_verified:false};},
    stop(){if(closed)return;invalidate(enabled?'stopped':'disabled');return {stopped:true,stream_epoch:epoch};},
    async close(){
      if(closed)return;closed=true;invalidate('stopped');clearInterval(timer);receivers.clear();
      await Promise.all([...children].map(process=>new Promise(resolve=>{
        const timeout=setTimeout(()=>{process.kill('SIGKILL');resolve();},2000);
        process.once('close',()=>{clearTimeout(timeout);resolve();});
      })));
    },
  };
}

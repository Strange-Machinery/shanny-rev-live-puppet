import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createFragmentedMp4Parser,createHttpStageMedia,buildHttpStageFfmpegArgs} from '../src/http-stage-media.mjs';
import {createHttpStageRoutes,isDirectLocalPublisher} from '../src/http-stage-routes.mjs';

const box=(type,...parts)=>{const data=Buffer.concat(parts),header=Buffer.alloc(8);header.writeUInt32BE(data.length+8);header.write(type,4);return Buffer.concat([header,data]);};
const u32=(n)=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
function syntheticInit(){
  const track=(id,kind)=>{
    const tkhd=Buffer.alloc(24);tkhd.writeUInt32BE(id,12);
    const mdhd=Buffer.alloc(24);mdhd.writeUInt32BE(1000,12);
    const hdlr=Buffer.alloc(12);hdlr.write(kind,8);
    const entry=kind==='vide'?box('avc1',Buffer.alloc(78),box('avcC',Buffer.from([1,66,192,40]))):box('mp4a',Buffer.alloc(28),box('esds',Buffer.alloc(4)));
    return box('trak',box('tkhd',tkhd),box('mdia',box('mdhd',mdhd),box('hdlr',hdlr),box('minf',box('stbl',box('stsd',Buffer.alloc(4),u32(1),entry)))));
  };
  const trex=id=>box('trex',Buffer.alloc(4),u32(id),u32(1),u32(1000),u32(0),u32(0x02000000));
  return Buffer.concat([box('ftyp',Buffer.from('iso6'),u32(0)),box('moov',track(1,'vide'),track(2,'soun'),box('mvex',trex(1),trex(2)))]);
}
function syntheticFragment(second,{keyframe=true,payloadBytes=32}={}){
  const track=id=>box('traf',box('tfhd',u32(0),u32(id)),box('tfdt',u32(0),u32(second*1000)),
    box('trun',u32(4),u32(1),u32(keyframe?0x02000000:0x01010000)));
  return Buffer.concat([box('moof',box('mfhd',u32(0),u32(second+1)),track(1),track(2)),box('mdat',Buffer.alloc(payloadBytes))]);
}
function fakePackager({holdWrites=false}={}){
  const processes=[];
  const spawnImpl=()=>{
    const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.writes=[];p.callbacks=[];
    p.stdin=new Writable({write(chunk,encoding,cb){p.writes.push(Buffer.from(chunk));if(holdWrites)p.callbacks.push(cb);else cb();}});
    p.kill=signal=>{p.killed=signal;queueMicrotask(()=>p.emit('close',null,signal));return true;};
    processes.push(p);return p;
  };
  return {spawn:spawnImpl,processes};
}
const receipt=(viewer,session,overrides={})=>({viewer_id:viewer.viewer_id,stream_epoch:session.stream_epoch,sequence:1,
  frames_decoded:10,current_time:0.3,playing:true,muted:true,volume:1,audio_present:true,...overrides});

test('MP4 parser publishes only complete init and moof/mdat across arbitrary boundaries',()=>{
  const seen=[],init=syntheticInit(),fragment=syntheticFragment(0);
  const parser=createFragmentedMp4Parser({onInit:(bytes,metadata)=>seen.push({init:bytes.length,mime:metadata.mime}),onFragment:(bytes,metadata)=>seen.push({bytes:bytes.length,...metadata})});
  for(let i=0;i<init.length;i++)parser.push(init.subarray(i,i+1));
  assert.equal(seen.length,1);assert.match(seen[0].mime,/avc1.42C028,mp4a.40.2/);
  parser.push(fragment.subarray(0,-1));assert.equal(seen.length,1);
  parser.push(fragment.subarray(-1));parser.finish();
  assert.deepEqual(seen[1],{bytes:fragment.length,start_time:0,end_time:1,keyframe:true,audio_present:true});
  assert.equal(parser.bufferedBytes(),0);
});

test('MP4 parser rejects truncated output, oversized headers, and media without moof',()=>{
  const parser=createFragmentedMp4Parser();parser.push(syntheticInit());parser.push(syntheticFragment(0).subarray(0,-5));
  assert.throws(()=>parser.finish(),{code:'truncated_mp4'});
  assert.throws(()=>createFragmentedMp4Parser({maxFragmentBytes:1024}).push(Buffer.concat([u32(1025),Buffer.from('mdat')])),{code:'invalid_mp4'});
  const missing=createFragmentedMp4Parser();missing.push(syntheticInit());
  assert.throws(()=>missing.push(box('mdat',Buffer.from('payload'))),{code:'invalid_mp4'});
});

test('disabled by default; codec and encoder command cannot be selected through a media type',async()=>{
  const media=createHttpStageMedia();assert.equal(media.info().state,'disabled');
  assert.throws(()=>media.openPublisher({mime_type:'video/webm'}),{code:'disabled'});await media.close();
  assert.throws(()=>buildHttpStageFfmpegArgs('video/webm; -i https://example.test/input'),{code:'unsupported_input'});
  const args=buildHttpStageFfmpegArgs('video/webm;codecs=vp8,opus');
  assert.equal(args[args.indexOf('-i')+1],'pipe:0');assert.ok(args.includes('-copyts'));assert.ok(args.includes('-start_at_zero'));
  assert.equal(args.at(-1),'pipe:1');assert.ok(!args.some(x=>x.includes('PTS-STARTPTS')));
});

test('bounded ring, actual playback progress, idle mute readiness, and immediate STOP epoch revocation',async()=>{
  let clock=1000;const fake=fakePackager(),media=createHttpStageMedia({enabled:true,spawn:fake.spawn,now:()=>clock,limits:{maxFragments:2}});
  try{
    const session=media.openPublisher({mime_type:'video/webm'}),viewer=media.openReceiver({viewer_role:'obs'});
    fake.processes[0].stdout.write(syntheticInit());
    for(let i=0;i<4;i++)fake.processes[0].stdout.write(syntheticFragment(i));
    const info=media.info();assert.equal(info.state,'live');assert.deepEqual(info.fragments.map(f=>f.sequence),[2,3]);
    assert.equal(info.ready_obs_receivers,0);assert.ok(info.buffered_bytes<media.limits.maxRingBytes+media.limits.maxInitBytes);
    assert.throws(()=>media.getFragment({viewer_id:viewer.viewer_id,stream_epoch:session.stream_epoch,sequence:3}),{code:'initialization_required'});
    media.getInit({viewer_id:viewer.viewer_id,stream_epoch:session.stream_epoch});
    assert.throws(()=>media.getFragment({viewer_id:viewer.viewer_id,stream_epoch:session.stream_epoch,sequence:0}),{code:'fragment_expired'});
    media.getFragment({viewer_id:viewer.viewer_id,stream_epoch:session.stream_epoch,sequence:3});
    media.receipt(receipt(viewer,session,{sequence:3,current_time:2.2}));assert.equal(media.info().ready_viewers,0);
    clock+=300;const answer=media.receipt(receipt(viewer,session,{sequence:3,current_time:2.5,frames_decoded:20}));
    assert.equal(answer.remote_ready,true);assert.equal(answer.audio_output_unmuted,false);
    assert.equal(media.info().ready_obs_receivers,1);assert.equal(media.info().audio_audibility_verified,false);
    clock+=4100;assert.equal(media.info().ready_viewers,0);
    const stopped=media.stop();assert.notEqual(stopped.stream_epoch,session.stream_epoch);assert.equal(media.info().buffered_bytes,0);
    assert.equal(media.info().ready_obs_receivers,0);assert.equal(media.info().state,'stopped');
    assert.throws(()=>media.getInit({viewer_id:viewer.viewer_id,stream_epoch:session.stream_epoch}),{code:'stale_epoch'});
    await assert.rejects(media.writePublisherChunk({...session,sequence:0,body:Buffer.from('late')}),{code:'stale_publisher'});
    assert.equal(fake.processes[0].killed,'SIGTERM');
  }finally{await media.close();}
});

test('ordered uploads apply backpressure without dropping or accepting duplicate chunks',async()=>{
  const fake=fakePackager({holdWrites:true}),media=createHttpStageMedia({enabled:true,spawn:fake.spawn,limits:{maxChunkBytes:16,maxInputQueuedBytes:16}});
  try{
    const session=media.openPublisher({mime_type:'video/webm'});
    await assert.rejects(media.writePublisherChunk({...session,sequence:1,body:Buffer.from('one')}),{code:'chunk_order'});
    await assert.rejects(media.writePublisherChunk({...session,sequence:0,body:Buffer.alloc(17)}),{code:'chunk_size'});
    const pending=media.writePublisherChunk({...session,sequence:0,body:Buffer.from('one')});
    await assert.rejects(media.writePublisherChunk({...session,sequence:0,body:Buffer.from('two')}),{code:'backpressure'});
    assert.equal(media.info().input_queued_bytes,3);fake.processes[0].callbacks.shift()();
    assert.equal((await pending).next_sequence,1);assert.equal(media.info().input_queued_bytes,0);
    await assert.rejects(media.writePublisherChunk({...session,sequence:0,body:Buffer.from('duplicate')}),{code:'chunk_order'});
  }finally{await media.close();}
});

test('bounded trusted timeline follows playhead and does not accept invented presentation or end receipts',async()=>{
  let clock=1000;const fake=fakePackager(),media=createHttpStageMedia({enabled:true,spawn:fake.spawn,now:()=>clock,limits:{maxFragments:2,maxPresentationEvents:4}});
  try{
    const session=media.openPublisher({mime_type:'video/webm'}),viewer=media.openReceiver({viewer_role:'obs'});
    const post=(time,presentation)=>media.setPresentation({...session,media_time:time,presentation});
    post(0,{presentation_visible:false,private_api_key:'never-visible'});
    assert.throws(()=>post(0.2,{presentation_visible:true,presentation_nonce:'bad',rain_audio:'ended'}),{code:'invalid_rain_transition'});
    post(0.5,{presentation_visible:true,presentation_mode:'rain',presentation_nonce:'cue1',rain_audio:'playing'});
    clock=3000;post(1.5,{presentation_visible:true,presentation_mode:'rain',presentation_nonce:'cue1',rain_audio:'ended'});
    fake.processes[0].stdout.write(Buffer.concat([syntheticInit(),syntheticFragment(0),syntheticFragment(1)]));
    media.getInit({viewer_id:viewer.viewer_id,stream_epoch:session.stream_epoch});media.getFragment({viewer_id:viewer.viewer_id,stream_epoch:session.stream_epoch,sequence:1});
    assert.equal(JSON.stringify(media.manifest()).includes('private_api_key'),false);
    assert.throws(()=>media.receipt(receipt(viewer,session,{presentation_nonce:'fake',presentation_visible:true})),{code:'invalid_presentation_receipt'});
    assert.throws(()=>media.receipt(receipt(viewer,session,{rain_nonce:'cue1',rain_state:'ended',current_time:1})),{code:'invalid_rain_receipt'});
    media.receipt(receipt(viewer,session,{current_time:0.6,presentation_nonce:'cue1',presentation_visible:true,rain_nonce:'cue1',rain_state:'playing',muted:false}));
    clock+=1000;media.receipt(receipt(viewer,session,{current_time:1.6,frames_decoded:40,presentation_nonce:'cue1',presentation_visible:true,rain_nonce:'cue1',rain_state:'ended',muted:false}));
    const status=media.presentationStatus('cue1');assert.equal(status.source_rain_state,'ended');assert.equal(status.source_rain_end_time,1.5);
    assert.equal(status.receivers[0].progressing,true);assert.equal(status.receivers[0].presentation_nonce,'cue1');
    assert.equal(status.receivers[0].playback_generation,0);
    assert.throws(()=>post(1.6,{presentation_visible:true,presentation_nonce:'cue1',rain_audio:'playing'}),{code:'invalid_rain_transition'});
    media.getInit({viewer_id:viewer.viewer_id,stream_epoch:session.stream_epoch});
    assert.equal(media.presentationStatus('cue1').receivers[0].playback_generation,1);
    assert.equal(media.info().ready_viewers,0);
    clock=5000;post(2.5,{presentation_visible:false});fake.processes[0].stdout.write(syntheticFragment(2));
    assert.deepEqual(media.manifest().presentation_events.map(e=>e.media_time),[0.5,1.5,2.5]);
    assert.throws(()=>post(0.2,{}),{code:'invalid_presentation'});
    media.stop();assert.equal(media.presentationStatus('cue1').source_rain_end_time,null);assert.deepEqual(media.manifest().presentation_events,[]);
  }finally{await media.close();}
});

test('malformed packager output and source inactivity revoke the epoch without unbounded buffers',async()=>{
  let clock=1000;const fake=fakePackager(),media=createHttpStageMedia({enabled:true,spawn:fake.spawn,now:()=>clock});
  try{
    const first=media.openPublisher({mime_type:'video/webm'});fake.processes[0].stdout.write(Buffer.concat([u32(0xffffffff),Buffer.from('mdat')]));
    assert.equal(media.info().state,'error');assert.notEqual(media.info().stream_epoch,first.stream_epoch);
    const second=media.openPublisher({mime_type:'video/webm'});clock+=16000;
    assert.equal(media.info().error,'publisher_timeout');assert.notEqual(media.info().stream_epoch,second.stream_epoch);
  }finally{await media.close();}
});

test('publisher locality rejects tunnels, spoofed origins, and remote sockets',()=>{
  const base={socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:1234',origin:'http://127.0.0.1:1234'}};
  assert.equal(isDirectLocalPublisher(base,'http://127.0.0.1:1234'),true);
  for(const header of ['cf-connecting-ip','cf-ray','x-forwarded-for','x-forwarded-host','forwarded','x-real-ip'])
    assert.equal(isDirectLocalPublisher({...base,headers:{...base.headers,[header]:'anything'}},'http://127.0.0.1:1234'),false);
  assert.equal(isDirectLocalPublisher({...base,socket:{remoteAddress:'192.0.2.1'}},'http://127.0.0.1:1234'),false);
  assert.equal(isDirectLocalPublisher({...base,headers:{...base.headers,origin:'https://remote.example'}},'http://127.0.0.1:1234'),false);
});

test('HTTP receiver-only boundary cannot open publisher, mutate media, or bypass body limits',async()=>{
  const fake=fakePackager(),media=createHttpStageMedia({enabled:true,spawn:fake.spawn});let origin;
  const handler=createHttpStageRoutes({media});
  const server=createServer(async(req,res)=>{
    const operator=req.headers.authorization==='Bearer operator';
    const handled=await handler(req,res,{operator,viewer:req.headers.authorization==='Bearer viewer',
      role:req.headers['x-test-local']==='yes'?'all':'receiver',localOrigin:origin});
    if(!handled){res.writeHead(404);res.end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');origin='http://127.0.0.1:'+server.address().port;
  const post=(path,body={},extra={})=>fetch(origin+'/api/http-stage'+path,{method:'POST',headers:{Authorization:'Bearer viewer','Content-Type':'application/json',Origin:origin,...extra},body:JSON.stringify(body)});
  try{
    assert.equal((await post('/publisher/open',{mime_type:'video/webm'})).status,403);
    assert.equal((await post('/publisher/open',{mime_type:'video/webm'},{Authorization:'Bearer operator'})).status,403);
    assert.equal((await post('/publisher/open',{mime_type:'video/webm'},{Authorization:'Bearer operator','x-test-local':'yes','cf-ray':'tunnel'})).status,403);
    const local=await post('/publisher/open',{mime_type:'video/webm'},{Authorization:'Bearer operator','x-test-local':'yes'});assert.equal(local.status,200);
    const viewer=await post('/receiver/open',{viewer_role:'obs'});assert.equal(viewer.status,200);assert.equal(viewer.headers.get('cache-control'),'no-store, no-cache, must-revalidate');
    assert.equal((await post('/receiver/open',{oversized:'x'.repeat(17000)})).status,413);
    assert.equal((await fetch(origin+'/api/http-stage/manifest')).status,403);
    assert.equal((await post('/manifest')).status,405);
    const session=await local.json();
    assert.equal((await post('/publisher/close',session)).status,403);assert.equal(media.info().publisher_active,true);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await media.close();}
});

function run(command,args,input){
  return new Promise((resolve,reject)=>{
    const process=spawn(command,args,{stdio:['pipe','pipe','pipe']}),chunks=[],errors=[];let bytes=0,settled=false;
    const finish=(err,result)=>{if(settled)return;settled=true;clearTimeout(timeout);err?reject(err):resolve(result);};
    const timeout=setTimeout(()=>{process.kill('SIGKILL');finish(new Error(command+' timed out'));},15000);
    process.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>24*1024*1024){process.kill('SIGKILL');finish(new Error('Fixture output limit'));}else chunks.push(chunk);});
    process.stderr.on('data',chunk=>{if(errors.length<100)errors.push(chunk);});
    process.on('error',error=>finish(error));process.stdin.on('error',()=>{});
    process.on('close',code=>finish(code===0?null:new Error(command+' failed: '+Buffer.concat(errors).toString()),Buffer.concat(chunks)));
    process.stdin.end(input);
  });
}

test('real FFmpeg preserves an intentional audio offset and emits independently decodable H264/AAC fragments',{timeout:45000},async(t)=>{
  try{await run('ffmpeg',['-version']);await run('ffprobe',['-version']);}catch(error){if(error.code==='ENOENT'){t.skip('FFmpeg/ffprobe not installed');return;}throw error;}
  const source=await run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30',
    '-itsoffset','0.4','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-map','0:v','-map','1:a','-t','3',
    '-c:v','libvpx','-deadline','realtime','-cpu-used','8','-threads','2','-c:a','libopus','-f','webm','pipe:1']);
  const output=await run('ffmpeg',buildHttpStageFfmpegArgs('video/webm;codecs=vp8,opus'),source);
  let init,metadata;const fragments=[];
  const parser=createFragmentedMp4Parser({onInit:(data,info)=>{init=data;metadata=info;},onFragment:(data,info)=>fragments.push({data,...info})});
  for(let i=0;i<output.length;i+=1777)parser.push(output.subarray(i,i+1777));parser.finish();
  assert.match(metadata.mime,/^video\/mp4; codecs="avc1\.[A-F0-9]{6},mp4a.40.2"$/);
  assert.equal(fragments.length,3);assert.ok(fragments.every(x=>x.keyframe&&x.audio_present));
  for(let i=0;i<3;i++){assert.ok(Math.abs(fragments[i].start_time-i)<0.05);assert.ok(Math.abs(fragments[i].end_time-i-1)<0.05);}
  const probe=async bytes=>JSON.parse((await run('ffprobe',['-v','error','-show_packets','-show_streams','-of','json','pipe:0'],bytes)).toString());
  const sourceProbe=await probe(source),outputProbe=await probe(output);
  const first=(p,type)=>Number(p.packets.find(x=>x.codec_type===type).pts_time);
  const before=first(sourceProbe,'audio')-first(sourceProbe,'video'),after=first(outputProbe,'audio')-first(outputProbe,'video');
  assert.ok(before>0.35&&before<0.45);assert.ok(Math.abs(after-before)<0.05,'AAC encoder offset: source='+before+' output='+after);
  assert.deepEqual(outputProbe.streams.map(s=>s.codec_name),['h264','aac']);
  const last=await probe(Buffer.concat([init,fragments.at(-1).data]));
  assert.ok(last.packets.some(x=>x.codec_type==='video'&&x.flags.includes('K')));
  const firstOutputVideo=first(outputProbe,'video');assert.ok(Math.abs(firstOutputVideo)<0.05,'recording-origin marker aligns within one frame in this fixture');
  // Chromium may choose MediaRecorder's fragmented MP4 input before WebM.
  const mp4InputOutput=await run('ffmpeg',buildHttpStageFfmpegArgs('video/mp4;codecs=avc1.42E01E,mp4a.40.2'),output);
  const mp4Probe=await probe(mp4InputOutput);assert.deepEqual(mp4Probe.streams.map(s=>s.codec_name),['h264','aac']);
  assert.ok(Math.abs((first(mp4Probe,'audio')-first(mp4Probe,'video'))-after)<0.05);
  // Exercise the actual bounded process ingress without closing stdin: a live
  // publisher must emit complete media before its recording ends.
  const bridge=createHttpStageMedia({enabled:true});
  try{
    const session=bridge.openPublisher({mime_type:'video/webm;codecs=vp8,opus'});
    let sequence=0;
    for(let at=0;at<source.length;at+=32768)await bridge.writePublisherChunk({...session,sequence:sequence++,body:source.subarray(at,at+32768)});
    const deadline=Date.now()+5000;
    while(bridge.info().state==='starting'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(bridge.info().state,'live');assert.equal(bridge.info().audio_present,true);
    assert.equal(bridge.info().ready_viewers,0,'successful ingest alone does not make a remote receiver ready');
    const epoch=bridge.info().stream_epoch;bridge.stop();assert.notEqual(bridge.info().stream_epoch,epoch);
    assert.equal(bridge.info().buffered_bytes,0);
  }finally{await bridge.close();}
  t.diagnostic('Synthetic offset source='+before.toFixed(3)+'s output='+after.toFixed(3)+'s; Windows capture-to-cue alignment remains a deployment check.');
});

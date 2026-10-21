#!/usr/bin/env node
/** Local, bounded browser fixture. Never contacts a model or external service. */
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHttpStageMedia} from '../src/http-stage-media.mjs';
import {createHttpStageRoutes,isDirectLocalPublisher} from '../src/http-stage-routes.mjs';

const argv=process.argv.slice(2),settings={duration:180,ffmpeg:'ffmpeg',selfCheck:false};
for(let i=0;i<argv.length;i++){
  if(argv[i]==='--duration-seconds')settings.duration=Number(argv[++i]);
  else if(argv[i]==='--ffmpeg')settings.ffmpeg=argv[++i];
  else if(argv[i]==='--self-check')settings.selfCheck=true;
  else if(argv[i]==='--help'){
    process.stdout.write('node scripts/http-stage-browser-smoke.mjs [--ffmpeg PATH] [--duration-seconds 30..600] [--self-check]\n');
    process.exit(0);
  }else throw Error('Unknown smoke-test argument');
}
if(!Number.isInteger(settings.duration)||settings.duration<30||settings.duration>600||
  typeof settings.ffmpeg!=='string'||!settings.ffmpeg||settings.ffmpeg.length>2000)throw Error('Invalid smoke-test settings');
const probe=spawnSync(settings.ffmpeg,['-hide_banner','-version'],{encoding:'utf8',timeout:5000,windowsHide:true,shell:false});
if(probe.error||probe.status!==0)throw Error('An existing FFmpeg executable is required; pass --ffmpeg PATH');

const operatorKey=randomBytes(32).toString('hex'),viewerKey=randomBytes(32).toString('hex');
const equal=(supplied,expected)=>{
  const a=Buffer.from(String(supplied||'')),b=Buffer.from('Bearer '+expected);
  return a.length===b.length&&timingSafeEqual(a,b);
};
const staticFiles=new Map([
  ['/',new URL('../test/fixtures/http-stage-smoke.html',import.meta.url)],
  ['/smoke-source.js',new URL('../test/fixtures/http-stage-smoke-source.js',import.meta.url)],
  ...['stage.html','stage.css','stage-page.js','stage-player.js','popup-view.js','message-scroll.js',
    'http-stage-player.js','http-stage-protocol.js','local-media-publisher.js'].map(name=>
      ['/'+name,new URL('../src/remote-web/'+name,import.meta.url)])
]);
staticFiles.set('/watch',staticFiles.get('/stage.html'));
staticFiles.set('/stage',staticFiles.get('/stage.html'));
const assets=new Map();
for(const [route,path] of staticFiles)assets.set(route,{bytes:await readFile(path),
  type:path.pathname.endsWith('.html')?'text/html; charset=utf-8':path.pathname.endsWith('.css')?
    'text/css; charset=utf-8':'text/javascript; charset=utf-8'});
const media=createHttpStageMedia({enabled:true,ffmpegPath:settings.ffmpeg});
const routes=createHttpStageRoutes({media});
let origin,closing=false,lastStop=null,progressSeen=false;
const expires=new Date(Date.now()+settings.duration*1000).toISOString();
const send=(res,status,value)=>{
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
};
const status=()=>{
  const info=media.info();progressSeen||=info.ready_viewers>0;
  return {fixture:'synthetic-http-stage',expires_at:expires,external_calls:false,disk_recordings:false,
    state:info.state,stream_epoch:info.stream_epoch,publisher_active:info.publisher_active,
    ready_viewers:info.ready_viewers,ready_program_receivers:info.ready_obs_receivers,
    buffered_bytes:info.buffered_bytes,error:info.error,playback_progress_seen:progressSeen,
    physical_audio_verified:false,actual_OBS_verified:false,last_stop:lastStop};
};
const server=createServer((req,res)=>{void(async()=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.headers.host!==new URL(origin).host)return send(res,403,{error:'wrong_host'});
  const operator=equal(req.headers.authorization,operatorKey),viewer=equal(req.headers.authorization,viewerKey);
  const path=new URL(req.url,origin).pathname;
  if(path.startsWith('/api/')){
    if(!operator&&!viewer)return send(res,401,{error:'ephemeral_fixture_key_required'});
    if(path==='/api/smoke/status'&&req.method==='GET')return send(res,200,status());
    if(path==='/api/smoke/stop'&&req.method==='POST'){
      req.resume();
      if(!operator||!isDirectLocalPublisher(req,origin))return send(res,403,{error:'local_operator_required'});
      const previous=media.info().stream_epoch,result=media.stop(),after=media.info();
      lastStop={epoch_changed:previous!==result.stream_epoch,buffered_bytes:after.buffered_bytes,
        ready_viewers:after.ready_viewers};
      process.stdout.write(JSON.stringify({type:'http_stage_smoke_stop',...lastStop})+'\n');
      return send(res,200,result);
    }
    if(await routes(req,res,{operator,viewer,role:'all',localOrigin:origin}))return;
    return send(res,404,{error:'unknown_fixture_api'});
  }
  const asset=assets.get(path);
  if(req.method!=='GET'||!asset)return send(res,404,{error:'not_found'});
  res.writeHead(200,{'Content-Type':asset.type,'Content-Length':asset.bytes.length});res.end(asset.bytes);
})().catch(()=>{if(!res.headersSent)send(res,500,{error:'fixture_request_failed'});else res.destroy();});});
server.requestTimeout=10000;server.headersTimeout=5000;
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
origin='http://127.0.0.1:'+server.address().port;
// These are freshly generated fixture-only credentials, never production keys.
process.stdout.write(JSON.stringify({type:'http_stage_smoke_start',expires_at:expires,
  producer_url:origin+'/#key='+operatorKey,receiver_url:origin+'/watch#transport=http&key='+viewerKey,
  obs_source_url:origin+'/stage#transport=http&key='+viewerKey,
  browser_decode_test:'pending — open the producer and receiver; click their start/sound buttons'})+'\n');
let interval,deadline;
async function close(reason){
  if(closing)return;closing=true;clearInterval(interval);clearTimeout(deadline);
  const final=status();media.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await media.close();process.stdout.write(JSON.stringify({type:'http_stage_smoke_result',reason,...final})+'\n');
}
process.once('SIGINT',()=>void close('operator_stop'));
process.once('SIGTERM',()=>void close('process_stop'));
if(settings.selfCheck){
  try{
  const unauthorized=await fetch(origin+'/api/smoke/status');
  const ready=await fetch(origin+'/api/smoke/status',{headers:{Authorization:'Bearer '+viewerKey}});
  const forbidden=await fetch(origin+'/api/http-stage/publisher/open',{method:'POST',headers:{
    Authorization:'Bearer '+viewerKey,Origin:origin,'Content-Type':'application/json'},body:'{"mime_type":"video/webm"}'});
  const asset=await fetch(origin+'/watch');
  if(unauthorized.status!==401||ready.status!==200||forbidden.status!==403||asset.status!==200)
    throw Error('Local fixture boundary self-check failed');
  process.stdout.write(JSON.stringify({type:'http_stage_smoke_self_check',passed:true,
    checks:['unauthenticated_rejected','viewer_cannot_publish','status_accessible','real_stage_page_served'],
    actual_browser_decode_test:false})+'\n');
  }finally{await close('self_check_only');}
}else{
  interval=setInterval(()=>process.stdout.write(JSON.stringify({type:'http_stage_smoke_status',...status()})+'\n'),5000);
  deadline=setTimeout(()=>void close('bounded_duration_expired'),settings.duration*1000);
}

/** Narrow remote testing UI; the model/runtime and private files stay on the producer. */
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual,createHmac} from 'node:crypto';
import {readFile,mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectWav} from './wav.mjs';
import {readJson} from './http-json.mjs';

export async function serveRemotePanel({action, publicOrigin, scratch, token=randomBytes(32).toString('hex'), port=0,allowLocalPreview=false}) {
  const origin=new URL(publicOrigin);
  if((origin.protocol!=='https:'&&!(allowLocalPreview&&origin.protocol==='http:'&&origin.hostname==='127.0.0.1'))||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||token.length<32)
    throw new Error('A private HTTPS origin and strong access key are required');
  const assets=new Map();
  const viewToken=createHmac('sha256',token).update('buff-obs-view-v1').digest('hex');
  for(const [route,file,type] of [['/','index.html','text/html'],['/stage','stage.html','text/html'],['/stage-player.js','stage-player.js','text/javascript'],['/stage-page.js','stage-page.js','text/javascript'],['/panel.js','panel.js','text/javascript'],['/mic-worklet.js','mic-worklet.js','text/javascript'],['/panel.css','panel.css','text/css'],['/stage.css','stage.css','text/css']])
    assets.set(route,{body:await readFile(new URL('./remote-web/'+file,import.meta.url)),type});
  await mkdir(scratch,{recursive:true});
  let closed=false,busy=false,revision=0,lease=0;
  const halt=async()=>{revision++;lease=0;await action({action:'stop'});};
  const timer=setInterval(()=>{if(lease&&Date.now()>lease)void halt().catch(()=>{});},1000);
  timer.unref();
  const server=createServer((req,res)=>{
    const requestRevision=revision;
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    void(async()=>{
      if(closed)return send(503,{error:'Producer sharing is closed.'});
      if(req.method==='GET'&&assets.has(req.url)) {const asset=assets.get(req.url);res.writeHead(200,{'Content-Type':asset.type});res.end(asset.body);return;}
      const supplied=Buffer.from(String(req.headers.authorization||''));
      const matches=value=>{const expected=Buffer.from('Bearer '+value);return supplied.length===expected.length&&timingSafeEqual(supplied,expected);};
      const operator=matches(token),viewer=matches(viewToken);
      if(!operator&&!viewer)return send(401,{error:'Reopen the private launcher supplied by your producer.'});
      const localOrigin='http://127.0.0.1:'+server.address().port;
      if(req.headers.origin&&req.headers.origin!==origin.origin&&!(allowLocalPreview&&req.headers.origin===localOrigin))return send(403,{error:'Origin rejected.'});
      if(req.method==='POST'&&req.url==='/api/media'){
        let size=0;const parts=[];
        for await(const chunk of req){size+=chunk.length;if(size>64000)throw new Error('Stage message too large');parts.push(chunk);}
        const input=JSON.parse(Buffer.concat(parts).toString('utf8'));
        if(!['media-status','media-open','media-offer','media-poll','media-close'].includes(input?.action)||Object.keys(input).some(k=>!['action','id','sdp'].includes(k)))return send(400,{error:'Unsupported stage request'});
        return send(200,await action(input));
      }
      if(!operator)return send(403,{error:'This OBS link is view-only.'});
      if(req.method==='GET'&&req.url==='/api/obs-link')return send(200,{url:(allowLocalPreview?localOrigin:origin.origin)+'/stage#key='+viewToken});
      if(req.method==='GET'&&req.url==='/api/animations')return send(200,await action({action:'animations'}));
      if(req.method==='GET'&&req.url==='/api/status') {
        const s=await action({action:'status'});
        if(lease)lease=Date.now()+15000;
        return send(200,{mode:s.mode,whisper:s.whisper_available,qwen:s.qwen,speech:s.speech,
          busy:s.turn_busy||s.conversation_busy||s.active_audio>0,kind:'REMOTE_TESTING',production_ready:false,
            real_characters:Boolean(s.real_characters),history:s.history||[],error:s.error||'',latency:s.latency||null,media:s.media||null});
      }
      if(req.method!=='POST'||req.url!=='/api/action')return send(404,{error:'Unavailable.'});
      if(!String(req.headers['content-type']).startsWith('application/json'))return send(415,{error:'JSON required.'});
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>4_000_000)throw new Error('Request exceeds limit');chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['action','text','audio','id','target','context','catalogRevision','make_it_rain'].includes(k))||input.make_it_rain!==undefined&&typeof input.make_it_rain!=='boolean')return send(400,{error:'Unsupported input.'});
      if(input.action==='stop'){await halt();return send(200,{stopped:true});}
      if(requestRevision!==revision)return send(409,{error:'Cancelled.'});
      if(input.action==='animate') {
        const result=await action({action:'animate',id:input.id,target:input.target,context:input.context,catalogRevision:input.catalogRevision});
        if(requestRevision!==revision)return send(409,{error:'Cancelled.'});
        lease=Date.now()+15000;
        return send(200,{...result,message:'Animation command accepted by the player.'});
      }
      if(!['donate','transcript','microphone'].includes(input.action))return send(400,{error:'Unsupported test.'});
      if(busy)return send(409,{error:'A test is running. Wait or press STOP.'});
      if(input.action!=='microphone'&&(typeof input.text!=='string'||!input.text.trim()||input.text.length>1000))return send(400,{error:'Enter 1–1000 characters.'});
      busy=true;const captured=revision;let folder;
      try {
        const current=()=>!closed&&captured===revision;
        let audioPath;
        if(input.action==='microphone') {
          if(typeof input.audio!=='string'||!input.audio.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.audio))throw new Error('Invalid audio');
          const bytes=Buffer.from(input.audio,'base64');
          if(bytes.length>2_900_000||inspectWav(bytes).duration_ms>30000)throw new Error('Audio exceeds limit');
          folder=await mkdtemp(join(scratch,'remote-'));audioPath=join(folder,'utterance.wav');await writeFile(audioPath,bytes,{mode:0o600});
        }
        if(!current())return send(409,{error:'Cancelled.'});
        const scope=await action({action:'arm'});
        if(!current()){await halt();return send(409,{error:'Cancelled.'});}
        lease=Date.now()+15000;
        const result=await action({action:input.action==='donate'?'donate':'transcript',text:input.text,make_it_rain:input.make_it_rain===true,
          ...(audioPath?{audioPath,source:'OFFLINE_WAV'}:{}),actor:'SHANNY',session_id:scope.session_id,mode_epoch:scope.mode_epoch});
        if(!current())return send(409,{error:'Cancelled.'});
        send(200,{status:result.status,transcript:result.transcript,kind:result.kind,
          message:result.kind==='REAL_CHARACTERS'?'The characters are responding. Watch the stage preview.':input.action==='donate'?'Test donation accepted.':'Response test completed on the producer computer.'});
      } finally {if(folder)await rm(folder,{recursive:true,force:true});busy=false;}
    })().catch(()=>{if(!res.headersSent)send(409,{error:'Test could not finish. Press STOP and try again; the producer can check local diagnostics.'});else res.end();});
  });
  server.requestTimeout=20000;server.headersTimeout=10000;server.maxConnections=16;
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});
  return {port:server.address().port,token,origin:origin.origin,
    async close(){closed=true;clearInterval(timer);await halt().catch(()=>{});server.closeAllConnections();await new Promise(done=>server.close(done));}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const config=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
  const upstream=new URL(config.endpoint);
  if(upstream.protocol!=='http:'||upstream.hostname!=='127.0.0.1'||upstream.pathname!=='/action')throw new Error('Local producer backend required');
  const app=await serveRemotePanel({...config,action:async data=>{
    const reply=await fetch(upstream,{method:'POST',headers:{Authorization:'Bearer '+config.upstreamToken,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(75000),redirect:'error'});
    const result=await readJson(reply,256000);if(!reply.ok)throw new Error('Producer action failed');return result;
  }});
  process.stdout.write(JSON.stringify({port:app.port})+'\n');
  let closing=false;const close=async()=>{if(closing)return;closing=true;await app.close();};
  process.stdin.resume();process.stdin.on('end',()=>void close());process.on('SIGTERM',()=>void close());
}

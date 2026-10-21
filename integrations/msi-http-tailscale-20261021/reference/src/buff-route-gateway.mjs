import {createServer,request} from 'node:http';

const STATIC=new Set(['/', '/stage','/watch','/live',...['index.html','panel.js','panel.css','stage.html','stage.css','stage-page.js','stage-player.js','presentation-ready.js','http-stage-player.js','http-stage-protocol.js','local-media-publisher.js','popup-view.js','message-scroll.js','mic-worklet.js','rain-intro.mp3','popup-art.webp','popup-hotmic.webp','popup-art-still.webp','popup-hotmic-still.webp'].map(p=>'/'+p)]);
const MEDIA=new Map([['/api/http-stage/receiver/open','POST'],['/api/http-stage/receiver/receipt','POST'],['/api/http-stage/receiver/close','POST'],['/api/http-stage/manifest','GET'],['/api/http-stage/init','GET'],['/api/http-stage/fragment','GET']]);
const JSON_GET=new Set(['/api/status','/api/animations','/api/obs-link','/api/http-stage-link','/api/http-stage/config']);
const ACTIONS=new Set(['stop','silence','rain-now','donation-test-message','donation-test-empty','chat-test','argue-now','reset-grievances','dyad-config','corpus-config','output-mode','animate','chat-disable','donation-stop','donation-mode']);
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
export const isPrivateVideoOrigin=value=>typeof value==='string'&&/^http:\/\/[a-z0-9-]+\.tail[a-z0-9]+\.ts\.net:17862$/.test(value);

/** Only HTTP program receivers and bounded manual controls can cross this hop.
 * It deliberately has no publisher, native-ingest, filesystem or admin route. */
export async function createBuffRouteGateway({upstream,getOrigin,port=17863,maxConcurrent=16}){
 const base=new URL(upstream);if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||base.pathname!=='/')throw Error('Fixed loopback backend required');
 let active=0;const sockets=new Set();
 const server=createServer((req,res)=>{void(async()=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  const origin=getOrigin();if(!isPrivateVideoOrigin(origin))return send(res,503,{error:'The private Tailscale route is not ready.'});
  if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin)return send(res,403,{error:'Origin rejected.'});
  const url=new URL(req.url,'http://gateway.invalid'),p=url.pathname;
  if(url.search.length>800)return send(res,400,{error:'Invalid query.'});
  const staticGet=req.method==='GET'&&STATIC.has(p)&&!url.search;
  const jsonGet=req.method==='GET'&&JSON_GET.has(p)&&!url.search;
  const media=MEDIA.get(p)===req.method;
  const action=req.method==='POST'&&p==='/api/action'&&!url.search;
  if(!staticGet&&!jsonGet&&!media&&!action){req.resume();return send(res,403,{error:'Remote publishing, ingestion, automatic intake and local administration are unavailable.'});}
  if(active>=maxConcurrent){req.resume();return send(res,429,{error:'Route is busy; retry shortly.'});}
  let body;
  if(req.method==='POST'){
   if(!String(req.headers['content-type']).startsWith('application/json')){req.resume();return send(res,415,{error:'JSON required.'});}
   const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>64000)return send(res,413,{error:'Request too large.'});parts.push(chunk);}body=Buffer.concat(parts);
   const data=JSON.parse(body.toString('utf8'));
   if(action&&(!ACTIONS.has(data.action)||Object.hasOwn(data,'audio')||Object.hasOwn(data,'audioPath')))return send(res,403,{error:'Only manual off-air controls are enabled. Paid/chat intake stays off.'});
  }
  active++;let released=false;const release=()=>{if(!released){released=true;active--;}};res.once('close',release);res.once('finish',release);
  // The fixed loopback hop uses the existing authorization unchanged. No
  // remote header can select a backend, gain a key, or enter native ingest.
  const headers={Host:base.host,Origin:base.origin};
  if(req.headers.authorization)headers.Authorization=req.headers.authorization;
  if(body){headers['Content-Type']='application/json';headers['Content-Length']=body.length;}
  const out=request({hostname:'127.0.0.1',port:base.port,path:p+url.search,method:req.method,headers},incoming=>{
   const transform=jsonGet&&['/api/obs-link','/api/http-stage-link','/api/http-stage/config'].includes(p);
   if(transform){let chunks=[],size=0;incoming.on('data',b=>{size+=b.length;if(size>64000){out.destroy();return;}chunks.push(b);});incoming.on('end',()=>{try{const data=JSON.parse(Buffer.concat(chunks));if(incoming.statusCode===200){if(p==='/api/http-stage/config')data.can_publish=false;else for(const field of ['url','watch_url'])if(data[field]){const link=new URL(data[field]);data[field]=origin+link.pathname+link.hash;}}send(res,incoming.statusCode,data);}catch{if(!res.headersSent)send(res,502,{error:'Invalid local link response.'});}});return;}
   const pass={};for(const key of ['content-type','content-length','content-security-policy','cache-control','referrer-policy','x-content-type-options'])if(incoming.headers[key])pass[key]=incoming.headers[key];res.writeHead(incoming.statusCode,pass);incoming.pipe(res);incoming.on('error',()=>res.destroy());
  });
  out.setTimeout(15000,()=>out.destroy(Error('Local route timeout')));out.on('error',()=>{if(!res.headersSent)send(res,502,{error:'Local show is unavailable.'});else res.destroy();});res.once('close',()=>out.destroy());out.end(body);
 })().catch(()=>{if(!res.headersSent)send(res,400,{error:'Invalid route request.'});else res.destroy();});});
 server.requestTimeout=20000;server.headersTimeout=5000;server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {port:server.address().port,close:async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}

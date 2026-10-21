import {HttpStageError} from './http-stage-media.mjs';

const PREFIX='/api/http-stage';
const PUBLISHER_PATHS=new Set(['/publisher/open','/publisher/chunk','/publisher/presentation','/publisher/close']);
const RECEIVER_PATHS=new Set(['/receiver/open','/manifest','/init','/fragment','/receiver/receipt','/receiver/close']);
const LOOPBACK=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);

function fail(code,message,status=400){throw new HttpStageError(code,message,status);}

/** A Cloudflare connection is also loopback, so the socket check is not enough. */
export function isDirectLocalPublisher(req,localOrigin){
  if(!LOOPBACK.has(req.socket?.remoteAddress)||typeof localOrigin!=='string'||!localOrigin)return false;
  if(Object.keys(req.headers||{}).some(name=>/^(forwarded$|x-forwarded-|cf-|x-real-ip$)/i.test(name)))return false;
  try{
    const origin=new URL(localOrigin);
    if(!['http:','https:'].includes(origin.protocol)||!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)||
      origin.origin!==localOrigin||req.headers.origin!==localOrigin||req.headers.host!==origin.host)return false;
  }catch{return false;}
  return true;
}

function readBody(req,maxBytes,timeoutMs=10000){
  const declared=req.headers['content-length'];
  if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes)){
    req.resume();return Promise.reject(new HttpStageError('body_size','Request body is too large',413));
  }
  return new Promise((resolve,reject)=>{
    const parts=[];let size=0,done=false;
    const cleanup=()=>{clearTimeout(timer);req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',aborted);};
    const finish=err=>{if(done)return;done=true;cleanup();if(err){req.resume();reject(err);}else resolve(Buffer.concat(parts,size));};
    const data=part=>{size+=part.length;if(size>maxBytes)return finish(new HttpStageError('body_size','Request body is too large',413));parts.push(part);};
    const end=()=>finish();
    const error=()=>finish(new HttpStageError('body_interrupted','Request body was interrupted',400));
    const aborted=()=>error();
    const timer=setTimeout(()=>finish(new HttpStageError('body_timeout','Request body timed out',408)),timeoutMs);timer.unref();
    req.on('data',data);req.once('end',end);req.once('error',error);req.once('aborted',aborted);
  });
}

async function jsonBody(req){
  if((req.headers['content-type']||'').split(';',1)[0].trim().toLowerCase()!=='application/json')
    fail('content_type','JSON request body required',415);
  const bytes=await readBody(req,16384,5000);let result;
  try{result=JSON.parse(bytes.toString('utf8'));}catch{fail('invalid_json','Invalid JSON request body');}
  if(!result||typeof result!=='object'||Array.isArray(result))fail('invalid_json','JSON object required');
  return result;
}

function queryOf(url){
  const result=Object.fromEntries(url.searchParams);
  for(const key of url.searchParams.keys())if(url.searchParams.getAll(key).length!==1)fail('duplicate_query','Duplicate query parameter');
  if(result.sequence!==undefined){
    if(!/^(0|[1-9]\d*)$/.test(result.sequence))fail('invalid_sequence','Invalid media sequence');
    result.sequence=Number(result.sequence);
  }
  return result;
}

function send(res,status,body,type='application/json; charset=utf-8'){
  if(res.destroyed||res.writableEnded)return;
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
  res.writeHead(status,{'Content-Type':type,'Content-Length':String(bytes.length),
    'Cache-Control':'no-store, no-cache, must-revalidate','Pragma':'no-cache',
    'X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
  res.end(bytes);
}

/**
 * Token authentication and receiver Origin/Host policy stay in the caller's
 * existing HTTP boundary. Pass only server-derived booleans in context.
 *
 * handle(req,res,{operator,viewer,role:'all'|'publisher'|'receiver',localOrigin})
 * -> Promise<boolean> (true means this module handled the request).
 *
 * The public proxy MUST choose role:'receiver'. A viewer token cannot publish,
 * stop, configure, choose an encoder, or open another process. Publisher paths
 * additionally require direct loopback + exact local Origin/Host and reject
 * proxy headers, even when a gateway connection itself appears as loopback.
 */
export function createHttpStageRoutes({media}={}){
  if(!media?.openPublisher||!media?.openReceiver)throw new Error('HTTP stage media instance required');
  let ingressActive=false;
  const binaryTransfers=new Set();
  function sendMedia(res,viewerId,getBytes){
    if(binaryTransfers.has(viewerId)||binaryTransfers.size>=media.limits.maxReceivers)
      fail('receiver_backpressure','Wait for the previous media response',429);
    binaryTransfers.add(viewerId);
    const cleanup=()=>{clearTimeout(timeout);binaryTransfers.delete(viewerId);res.off('finish',cleanup);res.off('close',cleanup);};
    const timeout=setTimeout(()=>{cleanup();res.destroy();},10000);timeout.unref();
    res.once('finish',cleanup);res.once('close',cleanup);
    try{send(res,200,getBytes(),'video/mp4');}catch(error){cleanup();throw error;}
  }
  return async function handleHttpStage(req,res,{operator=false,viewer=false,role='receiver',localOrigin=''}={}){
    if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//'))return false;
    const url=new URL(req.url,'http://stage.invalid');
    if(url.pathname!==PREFIX&&!url.pathname.startsWith(PREFIX+'/'))return false;
    try{
      const path=url.pathname.slice(PREFIX.length),publisher=PUBLISHER_PATHS.has(path),receiver=RECEIVER_PATHS.has(path);
      if(!publisher&&!receiver)fail('not_found','HTTP stage route not found',404);
      if(publisher){
        if(!['all','publisher'].includes(role)||operator!==true)fail('forbidden','Publisher access is restricted to the local operator',403);
        if(!isDirectLocalPublisher(req,localOrigin))fail('local_publisher_only','Publisher requests must come directly from the local show browser',403);
      }else if(!['all','receiver'].includes(role)||!(viewer===true||operator===true))fail('forbidden','Receiver access denied',403);
      const expected=['/manifest','/init','/fragment'].includes(path)?'GET':'POST';
      if(req.method!==expected){res.setHeader('Allow',expected);fail('method_not_allowed','Method not allowed',405);}
      let result;
      if(path==='/publisher/chunk'){
        if((req.headers['content-type']||'').split(';',1)[0].trim().toLowerCase()!=='application/octet-stream')
          fail('content_type','Binary media request body required',415);
        if(ingressActive)fail('backpressure','Wait for the previous publisher upload',429);
        ingressActive=true;
        try{const query=queryOf(url),body=await readBody(req,media.limits.maxChunkBytes);
          result=await media.writePublisherChunk({...query,body});
        }finally{ingressActive=false;}
      }else if(path==='/manifest')result=media.manifest(queryOf(url));
      else if(path==='/init'){const query=queryOf(url);sendMedia(res,query.viewer_id,()=>media.getInit(query));return true;}
      else if(path==='/fragment'){const query=queryOf(url);sendMedia(res,query.viewer_id,()=>media.getFragment(query));return true;}
      else{
        const body=await jsonBody(req);
        if(path==='/publisher/open')result=media.openPublisher(body);
        else if(path==='/publisher/presentation')result=media.setPresentation(body);
        else if(path==='/publisher/close')result=media.closePublisher(body);
        else if(path==='/receiver/open')result=media.openReceiver(body);
        else if(path==='/receiver/receipt')result=media.receipt(body);
        else if(path==='/receiver/close')result=media.closeReceiver(body);
      }
      send(res,200,result);return true;
    }catch(error){
      const known=error instanceof HttpStageError;
      send(res,known?error.status:500,{error:known?error.code:'http_stage_failed',
        message:known?error.message:'HTTP stage request failed'});return true;
    }
  };
}

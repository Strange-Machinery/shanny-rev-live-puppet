import {readJson} from './http-json.mjs';

const BASE='/api/http-stage';
const ROUTES=new Map([
  ['/receiver/open','POST'],['/receiver/receipt','POST'],['/receiver/close','POST'],
  ['/manifest','GET'],['/init','GET'],['/fragment','GET']
]);
const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};

/** Receiver-only hop to the already authenticated producer host. Never proxies
 * publisher ingress, arbitrary paths, URLs, redirects or caller credentials.
 * The enclosing remote panel must authenticate its operator/view-only key.
 */
export function createHttpStageProxy({endpoint,token,fetchImpl=fetch,maxConcurrent=8,maxPerViewer=2}){
  const upstream=new URL(endpoint);
  if(upstream.protocol!=='http:'||upstream.hostname!=='127.0.0.1'||
      !upstream.port||upstream.pathname!=='/action'||upstream.search||upstream.hash||
      upstream.username||upstream.password||typeof token!=='string'||token.length<32||
      !Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>16||
      !Number.isInteger(maxPerViewer)||maxPerViewer<1||maxPerViewer>4)
    throw new Error('HTTP media proxy requires the existing loopback producer endpoint');
  let active=0;
  const perViewer=new Map();
  return async function proxy(req,res){
    if(!req.url?.startsWith(BASE+'/'))return false;
    const url=new URL(req.url,'http://local.invalid');
    const route=url.pathname.slice(BASE.length);
    if(ROUTES.get(route)!==req.method){send(res,403,{error:'This connection only receives the show.'});return true;}
    const allowed=route==='/fragment'?['viewer_id','stream_epoch','sequence']:
      route==='/init'?['viewer_id','stream_epoch']:route==='/manifest'?['viewer_id']:[];
    if([...url.searchParams.keys()].some(k=>!allowed.includes(k))||
        allowed.some(k=>url.searchParams.getAll(k).length>1)||url.search.length>600){
      send(res,400,{error:'Invalid media request.'});return true;
    }
    // Bound aggregate memory as well as each response. A receiver normally
    // has one media fetch and one receipt/manifest request in flight.
    const viewerId=url.searchParams.get('viewer_id')||'control';
    if(active>=maxConcurrent||(perViewer.get(viewerId)||0)>=(viewerId==='control'?maxConcurrent:maxPerViewer)){
      send(res,429,{error:'Media connection is busy; retry shortly.'});return true;
    }
    active++;perViewer.set(viewerId,(perViewer.get(viewerId)||0)+1);
    let released=false;
    const release=()=>{
      if(released)return;released=true;clearTimeout(deadline);
      res.removeListener('finish',release);res.removeListener('close',release);
      active--;const n=perViewer.get(viewerId)-1;if(n)perViewer.set(viewerId,n);else perViewer.delete(viewerId);
    };
    // res.end can leave a large body queued for a slow client. Keep its slot
    // until the bytes finish or the bounded transfer is disconnected.
    const deadline=setTimeout(()=>{res.destroy();release();},15000);deadline.unref?.();
    res.once('finish',release);res.once('close',release);
    let body;
    try{if(req.method==='POST'){
      if(!String(req.headers['content-type']).startsWith('application/json')){
        send(res,415,{error:'JSON required.'});return true;
      }
      let bytes=0;const parts=[];
      for await(const chunk of req){bytes+=chunk.length;if(bytes>8192){send(res,413,{error:'Media receipt exceeds limit.'});return true;}parts.push(chunk);}
      body=Buffer.concat(parts);
    }
    const abort=new AbortController(),cancel=()=>{if(!res.writableEnded)abort.abort();};
    req.once('aborted',cancel);res.once('close',cancel);
    try{
      const response=await fetchImpl(upstream.origin+BASE+route+url.search,{
        method:req.method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
        body,redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(12000)])
      });
      if(!response.ok){
        // Keep credentials, native paths and FFmpeg diagnostics on the producer.
        const data=await readJson(response,8192).catch(()=>({}));
        send(res,response.status,{error:typeof data.error==='string'?data.error.slice(0,180):'Media connection unavailable.',
          ...(typeof data.code==='string'?{code:data.code.slice(0,80)}:{})});
        return true;
      }
      const binary=route==='/init'||route==='/fragment';
      const limit=route==='/init'?512*1024:route==='/fragment'?8*1024*1024:256*1024;
      if(Number(response.headers.get('content-length'))>limit)throw new Error('Oversized upstream media response');
      const chunks=[];let length=0;
      for await(const value of response.body||[]){
        length+=value.length;if(length>limit){abort.abort();throw new Error('Oversized upstream media response');}
        chunks.push(value);
      }
      res.writeHead(200,{'Content-Type':binary?'video/mp4':'application/json','Cache-Control':'no-store',
        'Content-Length':length,'X-Content-Type-Options':'nosniff'});
      res.end(Buffer.concat(chunks,length));
    }catch{
      if(!res.headersSent&&!res.destroyed)send(res,502,{error:'Producer media connection unavailable.'});
      else if(!res.writableEnded)res.end();
    }finally{req.removeListener('aborted',cancel);res.removeListener('close',cancel);}
    return true;
    }finally{if(!res.writableEnded||res.writableFinished||res.destroyed)release();}
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {createHttpStageProxy} from '../src/http-stage-proxy.mjs';

const endpoint='http://127.0.0.1:12345/action',token='local-host-test-key-'.repeat(3);
function request(url,method='GET',body='',headers={}){
  return Object.assign(Readable.from(body?[Buffer.from(body)]:[]),{url,method,
    headers:{authorization:'Bearer must-not-forward',cookie:'private=do-not-forward',...headers}});
}
class Reply extends EventEmitter{
  constructor(){super();this.status=0;this.headersSent=false;this.writableEnded=false;this.destroyed=false;}
  writeHead(status,headers){this.status=status;this.headers=headers;this.headersSent=true;}
  end(body){this.body=body;this.writableEnded=true;this.writableFinished=true;this.emit('finish');}
  destroy(){this.destroyed=true;this.emit('close');}
}
const json=(body={})=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});

test('media proxy is fixed to loopback and refuses publisher, arbitrary URL, method and query inputs',async()=>{
  for(const wrong of ['https://127.0.0.1:123/action','http://localhost:123/action',
    'http://127.0.0.1:123/config','http://user:pass@127.0.0.1:123/action',
    endpoint+'?url=http://other.example',endpoint+'#secret'])
    assert.throws(()=>createHttpStageProxy({endpoint:wrong,token}),/loopback/);
  let called=0;
  const proxy=createHttpStageProxy({endpoint,token,fetchImpl:async()=>{called++;return json();}});
  for(const [url,method,status] of [
    ['/api/http-stage/publisher/open','POST',403],['/api/http-stage/config','GET',403],
    ['/api/http-stage/status','GET',403],['/api/http-stage/fragment','POST',403],
    ['/api/http-stage/manifest?url=http://other.example','GET',400],
    ['/api/http-stage/init?viewer_id=a&viewer_id=b','GET',400],
    ['/api/http-stage/receiver/open?publisher_id=bad','POST',400]]){
    const reply=new Reply();assert.equal(await proxy(request(url,method),reply),true);
    assert.equal(reply.status,status,url);
  }
  assert.equal(await proxy(request('/api/action'),new Reply()),false);
  assert.equal(called,0);
});

test('media proxy forwards only its host credential and bounded receiver payload',async()=>{
  let forwarded;
  const proxy=createHttpStageProxy({endpoint,token,fetchImpl:async(url,options)=>{
    forwarded={url,options};return json({viewer_id:'test-viewer'});
  }});
  const payload=JSON.stringify({viewer_role:'obs'}),reply=new Reply();
  await proxy(request('/api/http-stage/receiver/open','POST',payload,{'content-type':'application/json'}),reply);
  assert.equal(reply.status,200);
  assert.equal(forwarded.url,'http://127.0.0.1:12345/api/http-stage/receiver/open');
  assert.deepEqual(forwarded.options.headers,{Authorization:'Bearer '+token,'Content-Type':'application/json'});
  assert.equal(forwarded.options.body.toString(),payload);
  assert.equal(forwarded.options.redirect,'error');
  assert.equal(reply.headers['Cache-Control'],'no-store');
  const large=new Reply();
  await proxy(request('/api/http-stage/receiver/receipt','POST','x'.repeat(8193),{'content-type':'application/json'}),large);
  assert.equal(large.status,413);
  const wrongType=new Reply();await proxy(request('/api/http-stage/receiver/open','POST','{}'),wrongType);
  assert.equal(wrongType.status,415);
});

test('proxy limits aggregate concurrency, per-viewer fetches and response bytes',async()=>{
  let release,entered;
  const started=new Promise(resolve=>entered=resolve);
  let slow=true;
  const proxy=createHttpStageProxy({endpoint,token,maxConcurrent:1,fetchImpl:async()=>{
    if(slow){entered();await new Promise(resolve=>release=resolve);}
    return json({ready:true});
  }});
  const first=new Reply(),pending=proxy(request('/api/http-stage/manifest?viewer_id=one'),first);
  await started;
  const busy=new Reply();await proxy(request('/api/http-stage/manifest?viewer_id=two'),busy);
  assert.equal(busy.status,429);
  slow=false;release();await pending;assert.equal(first.status,200);
  const recovered=new Reply();await proxy(request('/api/http-stage/manifest?viewer_id=two'),recovered);
  assert.equal(recovered.status,200,'completed fetch releases its slot');

  let finish;
  const hold=new Promise(resolve=>finish=resolve);
  const perViewer=createHttpStageProxy({endpoint,token,maxPerViewer:1,fetchImpl:async()=>{await hold;return json();}});
  const one=perViewer(request('/api/http-stage/init?viewer_id=one'),new Reply());
  const same=new Reply();await perViewer(request('/api/http-stage/manifest?viewer_id=one'),same);
  assert.equal(same.status,429);
  finish();await one;

  const oversize=createHttpStageProxy({endpoint,token,fetchImpl:async()=>new Response('oversize',{
    headers:{'content-length':String(512*1024+1)}
  })});
  const rejected=new Reply();await oversize(request('/api/http-stage/init?viewer_id=one'),rejected);
  assert.equal(rejected.status,502);
  assert.doesNotMatch(rejected.body,/12345|oversize/);
});

test('slow downstream responses keep their memory slot until finish or disconnect',async()=>{
  const proxy=createHttpStageProxy({endpoint,token,maxConcurrent:1,fetchImpl:async()=>json()});
  const slow=new Reply();slow.end=function(body){this.body=body;this.writableEnded=true;};
  await proxy(request('/api/http-stage/manifest?viewer_id=one'),slow);
  const blocked=new Reply();await proxy(request('/api/http-stage/manifest?viewer_id=two'),blocked);
  assert.equal(blocked.status,429);
  slow.destroy();
  const next=new Reply();await proxy(request('/api/http-stage/manifest?viewer_id=two'),next);
  assert.equal(next.status,200);
});

test('receiver disconnect aborts upstream work and releases the proxy slot',async()=>{
  let entered,upstreamSignal;
  const started=new Promise(resolve=>entered=resolve);
  const proxy=createHttpStageProxy({endpoint,token,maxConcurrent:1,fetchImpl:async(_url,{signal})=>{
    upstreamSignal=signal;entered();
    return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  }});
  const req=request('/api/http-stage/fragment?viewer_id=one&stream_epoch=epoch&sequence=0'),reply=new Reply();
  const pending=proxy(req,reply);await started;req.emit('aborted');await pending;
  assert.equal(upstreamSignal.aborted,true);assert.equal(reply.status,502);
});

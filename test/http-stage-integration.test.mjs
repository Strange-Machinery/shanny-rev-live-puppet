import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {serveRemotePanel} from '../src/remote-panel.mjs';
import {createStageMedia} from '../src/stage-media.mjs';
import {createHttpStageMedia} from '../src/http-stage-media.mjs';

// Fixture-only keys. These never authorize an external account or production.
const operatorKey='1'.repeat(64),viewerKey='2'.repeat(64),sourceKey='3'.repeat(64);

async function fixture(t,{http=true,local=true}={}){
  const scratch=await mkdtemp(join(tmpdir(),'http-stage-integration-')),processes=[],calls=[];
  const bridge=http?createHttpStageMedia({enabled:true,spawn(){
    const process=new EventEmitter();process.stdout=new PassThrough();process.stderr=new PassThrough();
    process.stdin=new Writable({write(chunk,encoding,done){done();}});
    process.kill=signal=>{process.killed=signal;queueMicrotask(()=>process.emit('close',null,signal));return true;};
    processes.push(process);return process;
  }}):null;
  let stopCount=0;
  const stage=await createStageMedia({token:sourceKey,onStop(){stopCount++;bridge?.stop();}});
  const action=async input=>{
    calls.push(input);
    if(input.action.startsWith('media-'))return stage.viewer(input);
    if(input.action==='stop'){stage.stopAnimations();return {stopped:true};}
    if(input.action==='status')return {mode:'episode',media:stage.info()};
    return {status:'accepted'};
  };
  const app=await serveRemotePanel({action,publicOrigin:local?'http://127.0.0.1':'https://producer.example',
    allowLocalPreview:local,scratch,token:operatorKey,viewerKey,httpStage:bridge});
  const base='http://127.0.0.1:'+app.port,origin=local?base:'https://producer.example';
  t.after(async()=>{await app.close();await stage.close();await bridge?.close();await rm(scratch,{recursive:true,force:true});});
  async function request(path,{body,key=viewerKey,headers={}}={}){
    return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,Origin:origin,
      ...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
  }
  async function source(path,body){
    const reply=await fetch(stage.url+path,{method:'POST',headers:{Authorization:'Bearer '+sourceKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(reply.status,200,'fixture native source '+path);return reply.json();
  }
  async function command(id){
    const pending=stage.animate({id,targets:['SHANNY','REV']});
    const poll=await source('/poll',{state:'ready'}),row=poll.commands.find(item=>item.alias===id);
    assert.ok(row,'native command must reach its source');
    await source('/command-receipt',{id:row.id,accepted:true});await pending;
  }
  await source('/poll',{state:'ready'});
  return {app,stage,bridge,processes,calls,request,source,command,base,get stopCount(){return stopCount;}};
}

test('configured view-only key receives HTTP manifests but cannot publish, request a source link, or become native ingest',async t=>{
  const f=await fixture(t);
  const config=await (await f.request('/api/http-stage/config')).json();
  assert.equal(config.enabled,true);assert.equal(config.can_publish,false);
  const opened=await f.request('/api/http-stage/receiver/open',{body:{viewer_role:'obs'}});
  assert.equal(opened.status,200);const receiver=await opened.json();assert.ok(receiver.viewer_id);
  const manifest=await f.request('/api/http-stage/manifest?viewer_id='+receiver.viewer_id);
  assert.equal(manifest.status,200);assert.equal((await manifest.json()).transport,'http-fmp4');
  assert.equal((await fetch(f.base+'/api/http-stage/manifest')).status,401);
  for(const path of ['/publisher/open','/publisher/chunk','/publisher/presentation','/publisher/close'])
    assert.equal((await f.request('/api/http-stage'+path,{body:{mime_type:'video/webm'}})).status,403,path);
  for(const path of ['/api/http-stage-source-link','/api/http-stage-link','/api/obs-link'])
    assert.equal((await f.request(path)).status,403,path);
  assert.equal((await f.request('/api/media',{body:{action:'media-open',ingest:true}})).status,403);
  assert.equal((await f.request('/api/media',{body:{action:'media-open',viewer_role:'ingest'}})).status,400);
  assert.equal((await f.request('/api/action',{body:{action:'stop'}})).status,403);
  assert.equal(f.processes.length,0);assert.equal(f.calls.length,0);
  const obsLink=await (await f.request('/api/obs-link',{key:operatorKey})).json();
  const params=new URLSearchParams(new URL(obsLink.url).hash.slice(1));
  assert.equal(params.get('transport'),'http');assert.equal(params.get('key'),viewerKey);
  assert.equal(obsLink.url.includes(operatorKey),false);
});

test('only a direct local operator can publish or create ingest; tunnel proxy headers remove that capability',async t=>{
  const f=await fixture(t);
  const directConfig=await (await f.request('/api/http-stage/config',{key:operatorKey})).json();
  assert.equal(directConfig.can_publish,true);
  for(const header of ['forwarded','x-forwarded-for','x-forwarded-host','cf-ray','cf-connecting-ip','x-real-ip']){
    const headers={[header]:'192.0.2.123'},context={key:operatorKey,headers};
    const config=await (await f.request('/api/http-stage/config',context)).json();assert.equal(config.can_publish,false,header);
    assert.equal((await f.request('/api/http-stage-source-link',context)).status,403,header+' source link');
    assert.equal((await f.request('/api/http-stage/publisher/open',{...context,body:{mime_type:'video/webm'}})).status,403,header+' publisher');
    assert.equal((await f.request('/api/media',{...context,body:{action:'media-open',ingest:true}})).status,403,header+' native ingest');
  }
  assert.equal(f.processes.length,0);assert.equal(f.calls.length,0);
  const sourceLink=await f.request('/api/http-stage-source-link',{key:operatorKey});assert.equal(sourceLink.status,200);
  const url=new URL((await sourceLink.json()).url);assert.equal(url.origin,f.base);
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('source'),'http');
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('key'),operatorKey);
  const opened=await f.request('/api/http-stage/publisher/open',{key:operatorKey,body:{mime_type:'video/webm'}});
  assert.equal(opened.status,200);assert.equal(f.processes.length,1);
  const ingest=await f.request('/api/media',{key:operatorKey,body:{action:'media-open',ingest:true}});
  assert.equal(ingest.status,200);assert.equal(f.calls.at(-1).viewer_role,'ingest');assert.equal(f.stage.info().obs_viewers,0);
});

test('public remote panel keeps publisher and native ingest disabled even with the operator key',async t=>{
  const f=await fixture(t,{local:false});
  const config=await (await f.request('/api/http-stage/config',{key:operatorKey})).json();
  assert.equal(config.enabled,true);assert.equal(config.can_publish,false);
  assert.equal((await f.request('/api/http-stage/publisher/open',{key:operatorKey,body:{mime_type:'video/webm'}})).status,403);
  assert.equal((await f.request('/api/http-stage-source-link',{key:operatorKey})).status,403);
  assert.equal((await f.request('/api/media',{key:operatorKey,body:{action:'media-open',ingest:true}})).status,403);
  assert.equal((await f.request('/api/http-stage/receiver/open',{body:{viewer_role:'obs'}})).status,200);
  assert.equal(f.processes.length,0);assert.equal(f.calls.length,0);
});

test('native ingest receipts never count as an OBS viewer or verify remote soundtrack completion',async t=>{
  const f=await fixture(t);
  const sourceViewer=await (await f.request('/api/media',{key:operatorKey,body:{action:'media-open',ingest:true}})).json();
  await f.command('make_it_rain');const nonce=f.stage.info().presentation_nonce;
  for(const action of ['media-presented','media-rain-started','media-rain-ended','media-rain-failed']){
    const result=await f.request('/api/media',{key:operatorKey,body:{action,id:sourceViewer.id,nonce}});
    assert.equal(result.status,200);assert.deepEqual(await result.json(),{accepted:true,ingest_only:true});
    assert.equal(f.stage.info().obs_viewers,0);assert.equal(f.stage.info().rain_audio,'pending');
    assert.equal(f.bridge.info().ready_obs_receivers,0);
  }
  await assert.rejects(f.stage.waitForRainEnd({timeoutMs:100,requireViewer:true}),/viewer unavailable/);
  const obs=await (await f.request('/api/media',{body:{action:'media-open'}})).json();
  assert.equal(f.stage.info().obs_viewers,1);
  assert.equal(await f.stage.waitForViewer({timeoutMs:60}),false,'local source presented receipt must not acknowledge the actual OBS peer');
  for(const action of ['media-presented','media-rain-started'])
    assert.equal((await f.request('/api/media',{body:{action,id:obs.id,nonce}})).status,200);
  assert.equal(f.stage.info().rain_audio,'playing');
  await f.request('/api/media',{key:operatorKey,body:{action:'media-rain-ended',id:sourceViewer.id,nonce}});
  assert.equal(f.stage.info().rain_audio,'playing');
  await assert.rejects(f.stage.waitForRainEnd({timeoutMs:60,requireViewer:true}),/did not finish/);
  assert.equal((await f.request('/api/media',{body:{action:'media-rain-ended',id:obs.id,nonce}})).status,200);
  assert.deepEqual(await f.stage.waitForRainEnd({timeoutMs:60,requireViewer:true}),{verified:true,reason:'OBS-ENDED'});
});

test('normal presentation end preserves buffered HTTP epoch; STOP and internal native abort revoke it immediately',async t=>{
  const f=await fixture(t);
  const publisher=await (await f.request('/api/http-stage/publisher/open',{key:operatorKey,body:{mime_type:'video/webm'}})).json();
  await f.command('seated_response');await f.command('presentation_end');
  assert.equal(f.bridge.info().stream_epoch,publisher.stream_epoch);assert.equal(f.bridge.info().publisher_active,true);
  assert.equal(f.stopCount,0,'normal queued end is not emergency STOP');
  const stop=await f.request('/api/action',{key:operatorKey,body:{action:'stop'}});assert.equal(stop.status,200);
  assert.equal(f.stopCount,1);assert.equal(f.bridge.info().state,'stopped');assert.equal(f.bridge.info().buffered_bytes,0);
  assert.notEqual(f.bridge.info().stream_epoch,publisher.stream_epoch);assert.equal(f.processes[0].killed,'SIGTERM');
  const next=f.bridge.openPublisher({mime_type:'video/webm'}),abort=new AbortController();
  const pending=f.stage.animate({id:'seated_response',targets:['SHANNY','REV'],signal:abort.signal});
  const rejected=assert.rejects(pending,/Animation stopped/);abort.abort();await rejected;
  assert.equal(f.stopCount,2);assert.equal(f.bridge.info().state,'stopped');assert.notEqual(f.bridge.info().stream_epoch,next.stream_epoch);
  assert.equal(f.processes[1].killed,'SIGTERM');
});

test('HTTP disabled keeps the existing native OBS link and native signaling behavior',async t=>{
  const f=await fixture(t,{http:false});
  const config=await (await f.request('/api/http-stage/config',{key:operatorKey})).json();
  assert.equal(config.enabled,false);assert.equal(config.can_publish,false);
  assert.equal((await f.request('/api/http-stage/receiver/open',{body:{viewer_role:'obs'}})).status,503);
  assert.equal((await f.request('/api/http-stage-source-link',{key:operatorKey})).status,403);
  assert.equal((await f.request('/api/media',{key:operatorKey,body:{action:'media-open',ingest:true}})).status,403);
  const obsLink=await (await f.request('/api/obs-link',{key:operatorKey})).json();
  const params=new URLSearchParams(new URL(obsLink.url).hash.slice(1));assert.equal(params.get('transport'),null);assert.equal(params.get('key'),viewerKey);
  const obs=await f.request('/api/media',{body:{action:'media-open'}});assert.equal(obs.status,200);
  assert.equal(f.calls.at(-1).viewer_role,'obs');assert.equal(f.stage.info().obs_viewers,1);
  const preview=await f.request('/api/media',{key:operatorKey,body:{action:'media-open'}});assert.equal(preview.status,200);
  assert.equal(f.calls.at(-1).viewer_role,'preview');assert.equal(f.stage.info().obs_viewers,1);
  const page=await f.request('/stage');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/media-src 'self' blob:/);
});

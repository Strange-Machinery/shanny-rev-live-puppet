import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serveRemotePanel} from '../src/remote-panel.mjs';
import {mockSpeechWav} from '../src/wav.mjs';

async function fixture(t,override) {
  const scratch=await mkdtemp(join(tmpdir(),'buff-remote-')),calls=[];
  const action=override|| (async data=>{calls.push(data);return data.action==='status'?{mode:'episode',whisper_available:true,qwen:'DETERMINISTIC_FIXTURE',speech:'SILENT_PCM_FIXTURE'}:data.action==='arm'?{session_id:'session',mode_epoch:1}:{status:'accepted'};});
  const app=await serveRemotePanel({action,publicOrigin:'https://producer.example',scratch});
  t.after(async()=>{await app.close();await rm(scratch,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+app.port;
  const send=(data,headers={})=>fetch(base+'/api/action',{method:'POST',headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  return {app,calls,scratch,base,send};
}
test('remote launcher serves static UI but protects status/actions and rejects arbitrary local paths',async t=>{
  const f=await fixture(t);
  const page=await fetch(f.base);assert.equal(page.status,200);assert.match(await page.text(),/Buff launcher/);
  assert.equal((await fetch(f.base+'/api/status')).status,401);
  assert.equal((await fetch(f.base+'/api/animations')).status,401);
  assert.equal((await f.send({action:'donate',text:'hello'},{Origin:'https://attacker.example'})).status,403);
  assert.equal((await f.send({action:'transcript',audioPath:'C:/private.wav'})).status,400);
  assert.equal((await f.send({action:'shell',text:'command'})).status,400);
  assert.equal(f.calls.length,0);
  assert.equal((await f.send({action:'donate',text:'hello'})).status,200);
  assert.deepEqual(f.calls.map(x=>x.action),['arm','donate']);
  assert.equal((await f.send({action:'stop'})).status,200);
  assert.equal(f.calls.at(-1).action,'stop');
});
test('animation catalog and selected target/context travel through the authenticated boundary',async t=>{
  const f=await fixture(t);
  assert.equal((await fetch(f.base+'/api/animations',{headers:{Authorization:'Bearer '+f.app.token}})).status,200);
  assert.equal(f.calls.at(-1).action,'animations');
  const command={action:'animate',id:'explain',target:'BOTH',context:'Standing',catalogRevision:'version'};
  assert.equal((await f.send(command)).status,200);
  assert.deepEqual(f.calls.at(-1),command);
});
test('remote microphone audio is bounded, written only in owned scratch and removed after inference',async t=>{
  let audioPath;
  const f=await fixture(t,async data=>{
    if(data.action==='arm')return {session_id:'session',mode_epoch:1};
    if(data.action==='transcript'){audioPath=data.audioPath;assert.deepEqual(await readFile(audioPath),mockSpeechWav('test'));return {status:'released',transcript:'test'};}
    return {};
  });
  const response=await f.send({action:'microphone',audio:mockSpeechWav('test').toString('base64')});
  assert.equal(response.status,200);assert.equal((await response.json()).transcript,'test');
  for(let n=0;n<20&&(await readdir(f.scratch)).length;n++)await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(await readdir(f.scratch),[]);
  assert.equal((await f.send({action:'microphone',audio:Buffer.from('not wav').toString('base64')})).status,409);
});
test('remote stop during pending arm prevents transcript admission even when backend finishes late',async t=>{
  let release,armed=false;const calls=[];
  const f=await fixture(t,async data=>{calls.push(data.action);if(data.action==='arm'){armed=true;await new Promise(r=>release=r);return {session_id:'session',mode_epoch:1};}return {};});
  const pending=f.send({action:'transcript',text:'late'});
  while(!armed)await new Promise(r=>setTimeout(r,5));
  assert.equal((await f.send({action:'stop'})).status,200);
  release();assert.equal((await pending).status,409);
  assert.ok(!calls.includes('transcript'));assert.equal(calls.at(-1),'stop');
});

test('OBS link only permits bounded media signaling and cannot operate the show',async t=>{
 const f=await fixture(t);const headers={Authorization:'Bearer '+f.app.token};
 const link=await (await fetch(f.base+'/api/obs-link',{headers})).json();
 const url=new URL(link.url);assert.equal(url.origin,'https://producer.example');assert.equal(url.pathname,'/stage');
 const viewHeaders={Authorization:'Bearer '+new URLSearchParams(url.hash.slice(1)).get('key'),'Content-Type':'application/json'};
 assert.equal((await fetch(f.base+'/stage')).status,200);
 for(const path of ['status','animations','obs-link'])assert.equal((await fetch(f.base+'/api/'+path,{headers:viewHeaders})).status,403);
 assert.equal((await fetch(f.base+'/api/action',{method:'POST',headers:viewHeaders,body:JSON.stringify({action:'stop'})})).status,403);
 const media=body=>fetch(f.base+'/api/media',{method:'POST',headers:viewHeaders,body:JSON.stringify(body)});
 assert.equal((await media({action:'stop'})).status,400);
 assert.equal((await media({action:'media-open',audioPath:'C:/private.wav'})).status,400);
 assert.equal((await media({action:'media-open'})).status,200);
 assert.deepEqual(f.calls,[{action:'media-open',viewer_role:'obs'}]);
});

test('manual membership rain is operator-only; OBS viewer cannot trigger a fake donation',async t=>{
  const f=await fixture(t);
  const response=await f.send({action:'rain-now'});
  assert.equal(response.status,200);
  assert.deepEqual(f.calls.at(-1),{action:'rain-now'});
  assert.deepEqual(f.calls.filter(x=>x.action==='donate'),[]);
  const headers={Authorization:'Bearer '+f.app.token};
  const url=(await (await fetch(f.base+'/api/obs-link',{headers})).json()).url;
  const viewToken=new URLSearchParams(new URL(url).hash.slice(1)).get('key');
  const blocked=await fetch(f.base+'/api/action',{
    method:'POST',headers:{Authorization:'Bearer '+viewToken,'Content-Type':'application/json'},
    body:JSON.stringify({action:'rain-now'})
  });
  assert.equal(blocked.status,403);
  const invalid=await f.send({action:'rain-now',donor:'faked',amount:100});
  assert.equal(invalid.status,400);
});

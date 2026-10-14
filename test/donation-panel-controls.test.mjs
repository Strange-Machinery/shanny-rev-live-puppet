import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {serveRemotePanel} from '../src/remote-panel.mjs';
import {loadOrCreateViewerKey} from '../src/obs-viewer-key.mjs';
async function until(pred){
 for(let i=0;i<150;i++){if(pred())return;await delay(5);}
 throw Error('Remote control not reached');
}
test('independent viewer key keeps OBS URL stable even when operator key rotates',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'buff-obs-private-'));
 const viewerKey=loadOrCreateViewerKey(join(dir,'viewer-key.local.json'));
 assert.equal(loadOrCreateViewerKey(join(dir,'viewer-key.local.json')),viewerKey);
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const make=()=>serveRemotePanel({action:async()=>({}),viewerKey,
  publicOrigin:'https://buff-private.example',scratch:dir});
 const one=await make(),two=await make();
 t.after(async()=>{await one.close();await two.close();});
 const uri=async app=>(await (await fetch('http://127.0.0.1:'+app.port+'/api/obs-link',
  {headers:{Authorization:'Bearer '+app.token}})).json()).url;
 const u1=await uri(one),u2=await uri(two);
 assert.equal(u1,u2);assert.match(u1,/^https:\/\/buff-private\.example\/stage#key=/);
 assert.notEqual(one.token,two.token);
 const viewToken=new URLSearchParams(new URL(u1).hash.slice(1)).get('key');
 const action=await fetch('http://127.0.0.1:'+one.port+'/api/action',{
  method:'POST',headers:{Authorization:'Bearer '+viewToken,'Content-Type':'application/json'},
  body:JSON.stringify({action:'donation-enable'})});
 assert.equal(action.status,403);
});
test('operator can enable, change mode, stop, and interrupt while manual arm is pending',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'buff-control-')),calls=[];
 let pendingArm,unlock,armed=false;
 const action=async input=>{
  calls.push(input);
  if(input.action==='status')return {real_characters:true,donations:{
   enabled:false,pending:0,providers:{youtube:'connected'},requires_setup:false}};
  if(input.action==='arm'){armed=true;return new Promise(r=>{unlock=()=>r({session_id:'test',mode_epoch:1});});}
  if(input.action==='donation-enable')return {enabled:true,providers:{youtube:'connected'}};
  if(input.action==='donation-mode')return {enabled:true,providers:{youtube:'connected'},make_it_rain:input.make_it_rain};
  if(input.action==='donation-stop')return {enabled:false,providers:{youtube:'disconnected'}};
  if(input.action==='silence')return {silenced:true,waiting_for_tts:true};
  return {stopped:true};
 };
 const app=await serveRemotePanel({action,publicOrigin:'https://producer.example',scratch:dir});
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const send=input=>fetch('http://127.0.0.1:'+app.port+'/api/action',{method:'POST',
  headers:{Authorization:'Bearer '+app.token,'Content-Type':'application/json'},
  body:JSON.stringify(input)});
 assert.equal((await send({action:'donation-enable',make_it_rain:true})).status,200);
 assert.equal((await send({action:'donation-mode',make_it_rain:false})).status,200);
 pendingArm=send({action:'donate',text:'manual test'});
 await until(()=>armed);
 const silent=await send({action:'silence'});
 assert.equal(silent.status,200);
 assert.equal((await silent.json()).waiting_for_tts,true);
 unlock();assert.equal((await pendingArm).status,409);
 assert.equal(calls.filter(c=>c.action==='stop').length,0,
  'Shut up must not become sticky STOP after a delayed arm');
 assert.equal((await send({action:'donation-stop'})).status,200);
 assert.ok(calls.some(c=>c.action==='donation-stop'));
});

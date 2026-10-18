import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {EventEmitter} from 'node:events';
import {createBuffSharingControl,isTrialOrigin} from '../src/buff-sharing-control.mjs';
import {serveRemotePanel} from '../src/remote-panel.mjs';

test('trial addresses cannot smuggle credentials, paths, ports or other hosts',async()=>{
 for(const bad of ['http://good.trycloudflare.com','https://good.trycloudflare.com.evil.test','https://good.trycloudflare.com/x','https://user@good.trycloudflare.com','https://good.trycloudflare.com:443','https://good.trycloudflare.com#key','https://.trycloudflare.com'])assert.equal(isTrialOrigin(bad),false);
 let saved;
 const c=createBuffSharingControl({root:'fixture',isBusy:()=>false,saveOrigin:async origin=>{saved=origin;}});
 await assert.rejects(c.setOrigin('https://evil.test'));
 await c.setOrigin('https://a-new-link.trycloudflare.com');assert.equal(saved,'https://a-new-link.trycloudflare.com');
});
test('prepare rejects a busy show and coalesces double clicks into one hidden helper',async()=>{
 let busy=true,calls=0,child;
 const c=createBuffSharingControl({root:'fixture',isBusy:()=>busy,saveOrigin:async()=>{},run:(exe,args,options)=>{
  calls++;assert.equal(exe,'powershell.exe');assert.equal(args.at(-1),'-NewLink');assert.equal(options.windowsHide,true);assert.equal(options.stdio,'ignore');return child=new EventEmitter();
 }});
 assert.throws(()=>c.prepare(),/Finish/);assert.equal(calls,0);busy=false;
 c.prepare();c.prepare();assert.equal(calls,1);assert.equal((await c.status()).state,'preparing');
 child.emit('exit',1);assert.equal((await c.status()).state,'error');
});
test('a stopped or missing tunnel never yields a copyable ready link',async()=>{
 let live=true;
 const c=createBuffSharingControl({root:'fixture',isBusy:()=>false,saveOrigin:async()=>{},alive:()=>live,
  read:async path=>JSON.stringify(path.endsWith('buff-trial-status.json')?{state:'ready',origin:'https://ready.trycloudflare.com'}:{pid:123})});
 assert.equal((await c.status()).state,'ready');live=false;assert.equal((await c.status()).state,'stopped');
});

test('only the local producer can renew links; remote operators and viewers are denied',async t=>{
 const scratch=await mkdtemp(join(tmpdir(),'buff-links-'));let calls=0,origin;
 const sharing={status:async()=>({state:'ready'}),prepare:()=>{calls++;return {state:'preparing'};},setOrigin:async value=>{origin=value;return {updated:true};}};
 const app=await serveRemotePanel({action:async()=>({}),scratch,publicOrigin:'https://old.trycloudflare.com',allowLocalPreview:true,buffSharing:sharing});
 t.after(async()=>{await app.close();await rm(scratch,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.port,headers={Authorization:'Bearer '+app.token,Origin:base,'Content-Type':'application/json'};
 const post=(path,body={},extra={})=>fetch(base+'/api/'+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
 assert.equal((await post('buff-link',{})).status,202);assert.equal(calls,1);
 for(const extra of [{Origin:'https://old.trycloudflare.com'},{'cf-ray':'proxied'},{'cf-connecting-ip':'203.0.113.1'},{'x-forwarded-for':'203.0.113.1'},{Origin:''}])assert.equal((await post('buff-link',{},extra)).status,403,JSON.stringify(extra));
 // Node fetch normalizes Host; use HTTP directly to exercise the proxy Host boundary.
 const hostCode=await new Promise((resolve,reject)=>{const req=request(base+'/api/buff-link',{method:'POST',headers:{...headers,Host:'old.trycloudflare.com'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end('{}');});
 assert.equal(hostCode,403);
 assert.equal(calls,1);
 assert.equal((await post('buff-link',{command:'anything'})).status,400);
 const link=await (await fetch(base+'/api/obs-link',{headers})).json();
 const viewer=new URLSearchParams(new URL(link.url).hash.slice(1)).get('key');
 assert.equal((await post('buff-link',{}, {Authorization:'Bearer '+viewer})).status,403);
 assert.equal((await post('buff-origin',{origin:'https://new.trycloudflare.com'})).status,200);assert.equal(origin,'https://new.trycloudflare.com');
 assert.equal((await fetch(base+'/api/buff-link',{headers})).status,200);
});
test('origin renewal keeps the same server and changes accepted remote origin immediately',async t=>{
 const scratch=await mkdtemp(join(tmpdir(),'buff-origin-'));
 const app=await serveRemotePanel({action:async()=>({}),scratch,publicOrigin:'https://old.trycloudflare.com',allowLocalPreview:true});
 t.after(async()=>{await app.close();await rm(scratch,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.port;
 app.setPublicOrigin('https://new.trycloudflare.com');
 const get=origin=>fetch(base+'/api/obs-link',{headers:{Authorization:'Bearer '+app.token,Origin:origin}});
 assert.equal((await get('https://old.trycloudflare.com')).status,403);
 assert.equal((await get('https://new.trycloudflare.com')).status,200);
 assert.match((await (await get(base)).json()).url,/^https:\/\/new\.trycloudflare\.com\/stage#/);
 assert.throws(()=>app.setPublicOrigin('http://unsafe.test'));
});

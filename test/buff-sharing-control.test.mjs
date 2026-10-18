import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createBuffSharingControl,isTrialOrigin} from '../src/buff-sharing-control.mjs';

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

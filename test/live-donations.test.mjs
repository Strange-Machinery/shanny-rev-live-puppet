import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {LiveDonations} from '../src/donations/live-donations.mjs';

async function until(predicate,ms=1800){
 const end=Date.now()+ms;
 while(Date.now()<end){
  if(predicate())return;
  await sleep(5);
 }
 throw new Error('Donation bridge did not reach expected state');
}
const chat=(id,comment=id)=>({id,snippet:{type:'superChatEvent',
 publishedAt:'2026-10-14T09:00:00Z',superChatDetails:{amountMicros:'2000000',
 currency:'USD',userComment:comment}}});
function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'buff-live-feeds-'));
 let running=false,busy=false,epoch=0;
 const hostCalls=[],sources={};
 const host=async data=>{
  hostCalls.push(data);
  if(data.action==='arm'){running=true;return {session_id:'live-test',mode_epoch:epoch};}
  if(data.action==='stop'){running=false;busy=false;return {stopped:true};}
  if(data.action==='silence'){busy=false;epoch++;return {silenced:true,waiting_for_tts:true,session_id:'live-test',mode_epoch:epoch};}
  if(data.action==='status')return {mode:running?'live':'muted',turn_busy:busy,conversation_busy:busy,presentation_visible:busy,error:''};
  if(data.action==='donate'){if(!running)throw new Error('not armed');busy=true;return {status:'accepted'};}
  throw new Error('unsupported request');
 };
 const manager=new LiveDonations({directory,host,config:{
  youtube:{liveChatId:'live-chat',accessToken:'AUTH_ONLY_FOR_TEST'},
  streamlabs:{socketToken:'PRIVATE_STREAMLABS_SOCKET'},
  streamelements:{room:'room',token:'PRIVATE_ASTRO'},
 },factories:Object.fromEntries(['youtube','streamlabs','streamelements'].map(provider=>[
  provider,args=>{
   const source={provider,args,started:false,
    async start(){this.started=true;args.onStatus('connected');},
    async stop(){this.started=false;args.onStatus('disconnected');},
    emit(payload){if(this.started)return args.onEvent(payload);return [];}
   };sources[provider]=source;return source;
  }
 ]))});
 t.after(async()=>{await manager.close();rmSync(directory,{recursive:true,force:true});});
 return {manager,sources,hostCalls,finish:()=>busy=false,get busy(){return busy;}};
}
test('explicit Enable, authenticated source dispatch, pay-once ID and frozen rain choice',async t=>{
 const f=fixture(t);
 assert.equal(f.manager.status().enabled,false);
 assert.equal(f.manager.status().requires_setup,false);
 assert.equal(f.hostCalls.length,0);
 await f.manager.enable({make_it_rain:true});
 assert.equal(f.manager.status().enabled,true);
 assert.equal(f.manager.status().providers.youtube,'connected');
 f.sources.youtube.emit(chat('first'));
 await until(()=>f.hostCalls.some(x=>x.action==='donate'));
 assert.equal(f.hostCalls.find(x=>x.action==='donate').make_it_rain,true);
 f.manager.setMode(false);
 f.sources.youtube.emit(chat('second'));
 assert.deepEqual(f.sources.youtube.emit(chat('first')).map(x=>x.status),['duplicate']);
 f.finish();
 await until(()=>f.hostCalls.filter(x=>x.action==='donate').length===2);
 assert.equal(f.hostCalls.filter(x=>x.action==='donate')[1].make_it_rain,false);
 f.finish();
 await until(()=>f.manager.status().pending===0&&f.manager.status().inflight===0);
 assert.equal(f.hostCalls.filter(x=>x.action==='arm').length,1);
 await f.manager.stop();
 assert.equal(f.manager.status().enabled,false);
 f.sources.youtube.emit(chat('third'));await sleep(10);
 assert.equal(f.hostCalls.filter(x=>x.action==='donate').length,2);
});
test('Streamlabs mirrors and chat are excluded while native tip remains payable',async t=>{
 const f=fixture(t);await f.manager.enable();
 f.sources.streamlabs.emit({type:'superchat',for:'youtube_account',message:[{id:'mirror',amount:1000000,currency:'USD'}]});
 f.sources.streamlabs.emit({type:'subscription',for:'youtube_account',message:[{id:'subscriber'}]});
 assert.equal(f.hostCalls.filter(x=>x.action==='donate').length,0);
 f.sources.streamlabs.emit({type:'donation',for:'youtube_account',message:[{id:123,amount:'3.50',currency:'USD',message:'Real payment'}]});
 await until(()=>f.hostCalls.some(x=>x.action==='donate'));
 assert.equal(f.hostCalls.find(x=>x.action==='donate').text,'Real payment');
 f.finish();
});
test('Shut up clears current popup yet keeps same armed feed and advances mode scope',async t=>{
 const f=fixture(t);await f.manager.enable();
 f.sources.youtube.emit(chat('one'));f.sources.youtube.emit(chat('two'));
 await until(()=>f.hostCalls.filter(x=>x.action==='donate').length===1);
 const first=f.hostCalls.find(x=>x.action==='donate');assert.equal(first.mode_epoch,0);
 const result=await f.manager.silence();
 assert.equal(result.enabled,true);assert.equal(result.waiting_for_tts,true);
 await until(()=>f.hostCalls.filter(x=>x.action==='donate').length===2);
 const second=f.hostCalls.filter(x=>x.action==='donate')[1];
 assert.equal(second.mode_epoch,1);
 assert.equal(f.hostCalls.filter(x=>x.action==='arm').length,1);
 f.finish();
});
test('no provider account is contacted or silently armed with missing credentials',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'buff-unconfigured-')),calls=[];
 const manager=new LiveDonations({directory,host:async v=>{calls.push(v);return {};}});
 t.after(async()=>{await manager.close();rmSync(directory,{recursive:true,force:true});});
 assert.equal(manager.status().requires_setup,true);
 assert.equal(manager.status().enabled,false);
 await assert.rejects(manager.enable(),/No donation provider/);
 assert.equal(calls.length,0);
});

test('USD $100+ always rains automatically; $99.99 and 100 JPY do not',async t=>{
 const f=fixture(t);
 await f.manager.enable({make_it_rain:false});
 const emit=(id,micros,currency='USD')=>f.sources.youtube.emit({
  id,snippet:{type:'superChatEvent',publishedAt:'2026-10-14T09:00:00Z',
   superChatDetails:{amountMicros:String(micros),currency,userComment:'Donation '+id}}
 });
 emit('below',99990000);
 emit('yen',100000000,'JPY');
 emit('threshold',100000000);
 await until(()=>f.hostCalls.filter(x=>x.action==='donate').length===1);
 const calls=()=>f.hostCalls.filter(x=>x.action==='donate');
 assert.equal(calls()[0].make_it_rain,false);
 assert.equal(calls()[0].donation.amount,99.99);
 f.finish();
 await until(()=>calls().length===2);
 assert.equal(calls()[1].donation.currency,'JPY');
 assert.equal(calls()[1].make_it_rain,false);
 f.finish();
 await until(()=>calls().length===3);
 assert.equal(calls()[2].donation.amount,100);
 assert.equal(calls()[2].make_it_rain,true);
 // The mode is frozen even though Buff did not check make-it-rain.
 assert.equal(f.manager.status().make_it_rain,false);
 f.finish();
 await until(()=>f.manager.status().pending===0&&f.manager.status().inflight===0);
});

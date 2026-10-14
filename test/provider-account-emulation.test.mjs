import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LiveDonations} from '../src/donations/live-donations.mjs';
import {StreamlabsPaidSource,StreamElementsPaidSource} from '../src/donations/provider-sources.mjs';

const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label,ms=3200){
 const end=Date.now()+ms;
 while(Date.now()<end){if(predicate())return;await wait(12);}
 throw Error('Offline provider emulation not completed: '+label);
}
class FakeAstro {
 constructor(url){this.url=url;this.messages=[];this.callbacks=new Map();}
 addEventListener(event,handler){this.callbacks.set(event,handler);}
 send(value){this.messages.push(JSON.parse(value));}
 emit(event,data={}){this.callbacks.get(event)?.(event==='message'?{data:JSON.stringify(data)}:{});}
 close(){this.emit('close');}
}
test('authenticated Streamlabs socket and StreamElements tips feed one durable queue; fake alert/chat ignored; $100+ rains',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'buff-account-emulation-'));
 let lab,astro,running=false,busy=false,epoch=0;
 const calls=[],accepted=[];
 const host=async data=>{
  calls.push(data);
  switch(data.action){
   case 'arm':running=true;return {session_id:'fixture-1',mode_epoch:epoch};
   case 'stop':running=false;busy=false;return {stopped:true};
   case 'status':return {mode:running?'live':'muted',turn_busy:busy,
     conversation_busy:busy,presentation_visible:busy,error:''};
   case 'donate':
    assert.equal(running,true);busy=true;accepted.push(data);return {status:'accepted'};
   default:throw Error('Unexpected producer action '+data.action);
  }
 };
 const manager=new LiveDonations({directory,host,config:{
  streamlabs:{socketToken:'NEVER_REAL_SOCKET_TOKEN'},
  streamelements:{room:'channel-demo',token:'NEVER_REAL_ASTRO_TOKEN'}
 },factories:{
  streamlabs:args=>new StreamlabsPaidSource({...args,connect:(url,options)=>{
   assert.equal(url,'https://sockets.streamlabs.com');
   assert.equal(options.query.token,'NEVER_REAL_SOCKET_TOKEN');
   lab=new EventEmitter();
   lab.disconnect=()=>{};return lab;
  }}),
  streamelements:args=>new StreamElementsPaidSource({...args,websocketFactory:url=>{
   assert.match(url,/^wss:\/\/astro\.streamelements\.com/);
   astro=new FakeAstro(url);return astro;
  }})
 }});
 t.after(async()=>{await manager.close();rmSync(directory,{recursive:true,force:true});});
 assert.equal(calls.length,0);
 assert.equal(manager.status().enabled,false);
 await manager.enable({make_it_rain:false});
 assert.equal(calls.filter(x=>x.action==='arm').length,1);
 assert.equal(manager.status().enabled,true);

 const direct=(id,amount,message='Argue with us, Shanny')=>({
  type:'donation',message:[{id,name:'Streamer Test',amount:String(amount),currency:'USD',message}]});
 const tip=(id,amount,status='success',approved='allowed')=>({
  type:'message',topic:'channel.tips',room:'channel-demo',
  data:{_id:id,channel:'channel-demo',status,approved,
   donation:{user:{username:'Tip Test'},amount,currency:'USD',
    message:'Argue with us, Shanny'},createdAt:'2026-10-14T10:00:00Z'}});
 // Without socket authorization, provider-looking donations do nothing.
 lab.emit('event',direct(1,100));astro.emit('message',tip('t1',100));
 assert.equal(accepted.length,0);
 lab.emit('connect');
 astro.emit('open');
 assert.equal(astro.messages.length,1);
 assert.equal(astro.messages[0].data.topic,'channel.tips');
 astro.emit('message',{type:'response',nonce:astro.messages[0].nonce,
  data:{topic:'channel.tips',room:'channel-demo'}});
 assert.equal(manager.status().providers.streamlabs,'connected');
 assert.equal(manager.status().providers.streamelements,'connected');
 // Test alerts/replays, chat and unapproved/pending payments MUST NOT
 // masquerade as a genuine donation or a $100 celebration.
 lab.emit('event',{type:'subscription',message:[{id:55,amount:200}]});
 lab.emit('event',{type:'donation_test',message:[{id:56,amount:200}]});
 lab.emit('event',{type:'superchat',for:'youtube_account',
   message:[{id:57,amount:100000000,currency:'USD'}]});
 astro.emit('message',{type:'message',topic:'channel.activities',room:'channel-demo',
  data:{type:'tip',amount:100}});
 astro.emit('message',tip('pending',100,'success','pending'));
 astro.emit('message',tip('declined',100,'failed','allowed'));
 await wait(25);assert.equal(accepted.length,0);

 // Two real *simulated payload structures* through authenticated factories,
 // same text, distinct purchase IDs, both independently admitted.
 lab.emit('event',direct(1,5));
 lab.emit('event',direct(2,100));
 astro.emit('message',tip('se-99',99.99));
 astro.emit('message',tip('se-100',100));
 astro.emit('message',tip('se-100',100)); // provider replay is deduped.
 await until(()=>accepted.length===1,'first paid event');
 assert.equal(accepted[0].donation.provider,'streamlabs');
 assert.equal(accepted[0].make_it_rain,false);
 const finish=()=>{busy=false;};
 finish();await until(()=>accepted.length===2,'streamlabs whale');
 assert.equal(accepted[1].donation.amount,100);
 assert.equal(accepted[1].make_it_rain,true);
 finish();await until(()=>accepted.length===3,'StreamElements small tip');
 assert.equal(accepted[2].donation.amount,99.99);
 assert.equal(accepted[2].make_it_rain,false);
 finish();await until(()=>accepted.length===4,'StreamElements whale');
 assert.equal(accepted[3].donation.amount,100);
 assert.equal(accepted[3].make_it_rain,true);
 assert.equal(accepted[3].donation.provider,'streamelements');
 finish();await until(()=>manager.status().pending===0&&manager.status().inflight===0,'queue drain');
 assert.equal(manager.status().make_it_rain,false,'default checkbox must remain OFF');
 assert.equal(calls.filter(x=>x.action==='arm').length,1);
 await manager.stop();
 assert.equal(manager.status().enabled,false);
 lab.emit('event',direct(3,100));
 astro.emit('message',tip('se-late',100));
 await wait(25);assert.equal(accepted.length,4,'STOP is sticky for both providers');
});

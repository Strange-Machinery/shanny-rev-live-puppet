import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {DonationLedger} from '../src/donations/ledger.mjs';
import {DurableDonationQueue} from '../src/donations/durable-queue.mjs';

const payment=(n,text='Same amount, same text',source='youtube')=>({
 source,donation_id:(source==='youtube'?'youtube:superchat:':
  source==='streamlabs'?'streamlabs:donation:':'streamelements:tip:')+n,text
});
async function until(predicate,ms=1000) {
 const end=Date.now()+ms;
 while(Date.now()<end) {
  if(predicate())return;
  await delay(5);
 }
 throw new Error('Expected asynchronous queue transition did not occur');
}
function hostFixture() {
 let mode='muted',busy=false,arms=0;
 const calls=[];
 const host=async data=>{
  calls.push(data);
  if(data.action==='arm'){mode='live';arms++;return {session_id:'mock-host',mode_epoch:arms};}
  if(data.action==='stop'){mode='muted';busy=false;return {stopped:true};}
  if(data.action==='status')return {mode,turn_busy:busy,conversation_busy:busy,
   presentation_visible:busy,error:''};
  if(data.action==='donate') {
   if(mode!=='live'||busy)throw new Error('overlap / STOP');
   busy=true;return {status:'accepted',turn_id:'mock-'+calls.length};
  }
  throw new Error('unsupported host request');
 };
 return {host,calls,finish:()=>{busy=false;},get busy(){return busy;},get arms(){return arms;}};
}
function fixture(t,options={}) {
 const directory=mkdtempSync(join(tmpdir(),'buff-donation-'));
 const ledgerPath=join(directory,'ledger.local');
 const ledger=new DonationLedger(ledgerPath);
 const mock=hostFixture();
 const queue=new DurableDonationQueue({directory,ledger,host:mock.host,pollMs:5,timeoutMs:2000,...options});
 t.after(async()=>{await queue.close();ledger.close();rmSync(directory,{recursive:true,force:true});});
 return {queue,directory,ledger,ledgerPath,mock};
}
test('explicit Enable arms host exactly once; each payment retains selected rain mode',async t=>{
 const f=fixture(t);
 assert.equal(f.queue.status().enabled,false);
 await f.queue.enable();assert.equal(f.mock.arms,1);
 assert.equal(f.queue.ingest(payment('A'),{make_it_rain:true}).status,'queued');
 assert.equal(f.queue.ingest(payment('B'),{make_it_rain:false}).status,'queued');
 await until(()=>f.mock.calls.filter(c=>c.action==='donate').length===1);
 const first=f.mock.calls.find(c=>c.action==='donate');
 assert.equal(first.make_it_rain,true);assert.equal(first.session_id,'mock-host');
 assert.equal(first.mode_epoch,1);
 assert.equal(f.mock.busy,true);
 assert.equal(f.queue.ingest(payment('A')).status,'duplicate');
 f.mock.finish();
 await until(()=>f.mock.calls.filter(c=>c.action==='donate').length===2);
 const second=f.mock.calls.filter(c=>c.action==='donate')[1];
 assert.equal(second.make_it_rain,false);
 f.mock.finish();
 await until(()=>f.queue.status().pending===0&&f.queue.status().inflight===0);
 assert.equal(f.mock.arms,1);
});
test('distinct matching-text payments are not deduplicated; bounded queue fails without ledger burn',async t=>{
 const f=fixture(t,{maxPending:2});
 await f.queue.enable();
 assert.equal(f.queue.ingest(payment('one')).status,'queued');
 assert.equal(f.queue.ingest(payment('two')).status,'queued');
 assert.equal(f.queue.ingest(payment('three')).status,'busy');
 assert.equal(f.ledger.has(payment('three').donation_id),false);
 await until(()=>f.mock.calls.some(c=>c.action==='donate'));
 f.mock.finish();
 await until(()=>f.mock.calls.filter(c=>c.action==='donate').length===2);
 f.mock.finish();
 await until(()=>f.queue.status().inflight===0);
 assert.equal(f.queue.ingest(payment('three')).status,'queued');
 await until(()=>f.mock.calls.filter(c=>c.action==='donate').length===3);
 f.mock.finish();
});
test('STOP prevents further dispatch and explicit re-enable resumes only queued work',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'buff-stop-')),ledgerPath=join(dir,'ledger.local');
 let ledger=new DonationLedger(ledgerPath),mock=hostFixture();
 let q=new DurableDonationQueue({directory:dir,ledger,host:mock.host,pollMs:5,timeoutMs:2000});
 t.after(async()=>{await q.close();ledger.close();rmSync(dir,{recursive:true,force:true});});
 await q.enable();
 q.ingest(payment('running'),{make_it_rain:true});
 q.ingest(payment('pending'),{make_it_rain:false});
 await until(()=>mock.calls.some(c=>c.action==='donate'));
 await q.stop();
 assert.equal(q.status().enabled,false);
 await q.close();ledger.close();
 const before=mock.calls.filter(c=>c.action==='donate').length;
 ledger=new DonationLedger(ledgerPath);mock=hostFixture();
 q=new DurableDonationQueue({directory:dir,ledger,host:mock.host,pollMs:5,timeoutMs:2000});
 assert.equal(q.status().enabled,false);assert.equal(q.status().pending,1);
 assert.equal(q.ingest(payment('running')).status,'duplicate');
 await delay(35);
 assert.equal(mock.calls.filter(c=>c.action==='donate').length,0);
 await q.enable();
 await until(()=>mock.calls.some(c=>c.action==='donate'));
 assert.equal(mock.calls.find(c=>c.action==='donate').text,payment('pending').text);
 assert.equal(mock.calls.find(c=>c.action==='donate').make_it_rain,false);
 mock.finish();
 assert.equal(before,1);
});
test('crash recovery abandons potentially issued donation without replaying it',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'buff-crash-')),ledgerPath=join(dir,'ledger.local');
 const ledger=new DonationLedger(ledgerPath),mock=hostFixture();
 const old=payment('uncertain'),pending=payment('never-started');
 ledger.reserve(old.donation_id);ledger.reserve(pending.donation_id);
 const row=(p,state)=>({donation_id:p.donation_id,source:p.source,text:p.text,
  make_it_rain:false,received_unix_ms:Date.now(),state});
 writeFileSync(join(dir,'donations-queue.local.json'),JSON.stringify({
  version:1,items:[row(old,'started'),row(pending,'queued')]
 }));
 const q=new DurableDonationQueue({directory:dir,ledger,host:mock.host,pollMs:5,timeoutMs:2000});
 t.after(async()=>{await q.close();ledger.close();rmSync(dir,{recursive:true,force:true});});
 assert.equal(q.status().enabled,false);assert.equal(q.status().recovered_abandoned,1);
 assert.equal(q.ingest(old).status,'duplicate');
 await q.enable();await until(()=>mock.calls.some(c=>c.action==='donate'));
 assert.equal(mock.calls.filter(c=>c.action==='donate').length,1);
 mock.finish();
 await until(()=>q.status().inflight===0);
});
test('events received while stopped are durably suppressed, not replayed on Enable',async t=>{
 const f=fixture(t);
 const value=payment('while-muted');
 assert.equal(f.queue.ingest(value).status,'disabled');
 assert.equal(f.ledger.has(value.donation_id),true);
 await f.queue.enable();
 assert.equal(f.queue.ingest(value).status,'duplicate');
 await delay(20);
 assert.equal(f.mock.calls.some(c=>c.action==='donate'),false);
});
test('Stop cancels a pending host arm and prevents stale automatic rearming',async t=>{
 let release;const calls=[];const dir=mkdtempSync(join(tmpdir(),'buff-race-'));
 const ledger=new DonationLedger(join(dir,'ledger.local'));
 const host=async data=>{
  calls.push(data.action);
  if(data.action==='arm')return new Promise(resolve=>release=()=>resolve({session_id:'mock',mode_epoch:0}));
  if(data.action==='stop')return {stopped:true};
  return {mode:'muted'};
 };
 const q=new DurableDonationQueue({directory:dir,ledger,host});
 t.after(async()=>{await q.close();ledger.close();rmSync(dir,{recursive:true,force:true});});
 const starting=q.enable();
 await until(()=>Boolean(release));
 await q.stop();
 release();
 await assert.rejects(starting,/cancelled by STOP/);
 assert.equal(q.status().enabled,false);
 assert.equal(calls.filter(x=>x==='arm').length,1);
});
test('invalid/partial queue snapshot fails closed instead of losing replay protection',t=>{
 const directory=mkdtempSync(join(tmpdir(),'buff-torn-'));
 const ledger=new DonationLedger(join(directory,'ledger.local'));
 t.after(()=>{ledger.close();rmSync(directory,{recursive:true,force:true});});
 writeFileSync(join(directory,'donations-queue.local.json'),'{"version":1,"items":[');
 assert.throws(()=>new DurableDonationQueue({directory,ledger,host:async()=>({})}));
});

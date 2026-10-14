import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ConversationSession} from '../src/conversation-session.mjs';
async function until(pred){for(let i=0;i<200;i++){if(pred())return;await delay(5);}throw Error('Wait exceeded');}
function setup(director){
 let epoch=0,muted=true,updates=0;const events=[],spoken=[],released=[];
 const gateway={
  panic:async()=>{epoch++;muted=true;events.push({type:'panic',epoch,seq:events.length+1,session_id:'scope'});},
  status:async()=>({session_id:'scope',epoch,muted,cursor:events.length}),
  resume:async()=>{updates++;muted=false;},
  events:async({after})=>({session_id:'scope',epoch,muted,cursor:events.length,events:events.slice(after)}),
  speak:async data=>{const request_id='id-'+spoken.length;spoken.push(data);
   return {request_id};},
  release:async data=>{released.push(data);}
 };
 const hidden={n:0};
 const session=new ConversationSession({gateway,director,presentation:{stop:()=>hidden.n++,
  begin:async()=>({duration_ms:20000}),end:async()=>{}}});
 return {session,gateway,hidden,spoken,released,updates:()=>updates};
}
test('Shut up cancels in-flight Qwen/voice before reveal yet immediately permits next scoped TTS',async()=>{
 let releaseFirst,calls=0;
 const f=setup({generate:async()=>{
  if(++calls===1)return new Promise(resolve=>releaseFirst=resolve);
  return {lines:[{actor:'SHANNY',text:'New reply.'},{actor:'REV',text:'New response.'}],rev_reason:''};
 }});
 await f.session.initialize();const scope=await f.session.arm();
 await f.session.submit({kind:'donation',text:'Old payment',...scope});
 await until(()=>Boolean(releaseFirst));
 const nextScope=await f.session.silence();
 assert.equal(nextScope.waiting_for_tts,true);
 assert.equal(nextScope.session_id,scope.session_id);
 assert.ok(nextScope.mode_epoch>scope.mode_epoch);
 assert.equal(f.hidden.n,1);
 assert.equal(f.session.mode,'live');
 assert.equal(f.released.length,0);
 releaseFirst({lines:[{actor:'SHANNY',text:'Stale result.'},{actor:'REV',text:'Stale Rev.'}]});
 await until(()=>!f.session.turn);
 assert.equal(f.released.length,0);
 assert.equal(f.session.history.length,0);
 const result=await f.session.submit({kind:'microphone',text:'New TTS',...nextScope});
 assert.equal(result.status,'accepted');
 await f.session.stop();
 assert.equal(f.session.mode,'muted');
});
test('Shut up while already STOPPED cannot rearm a muted host',async()=>{
 const f=setup({generate:async()=>({lines:[]})});
 await f.session.initialize();
 const x=await f.session.silence();
 assert.equal(x.waiting_for_tts,false);
 assert.equal(f.session.mode,'muted');
 assert.equal(f.updates(),0);
});
test('concurrent master STOP beats a delayed Shut up resume',async()=>{
 const f=setup({generate:async()=>({lines:[]})});
 await f.session.initialize();await f.session.arm();
 const base=f.gateway.resume;let unlock,entered=false;
 f.gateway.resume=async()=>{entered=true;await new Promise(resolve=>unlock=resolve);return base();};
 const pending=f.session.silence();
 await until(()=>entered);
 await f.session.stop();
 unlock();
 const outcome=await pending;
 assert.equal(outcome.waiting_for_tts,false);
 assert.equal(f.session.mode,'muted');
 assert.equal((await f.gateway.status()).muted,true);
});

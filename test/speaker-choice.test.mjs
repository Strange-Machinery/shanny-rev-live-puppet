import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ConversationSession} from '../src/conversation-session.mjs';
async function until(fn){for(let n=0;n<100;n++){if(fn())return;await delay(5);}throw Error('Timeout');}
test('leading (rev) selects Rev only for donation reading; control tag is not spoken',async()=>{
 let epoch=0,muted=true;const spoken=[],events=[];
 const gateway={
  panic:async()=>{epoch++;muted=true;},
  status:async()=>({epoch,session_id:'s',muted,cursor:0}),
  resume:async()=>{muted=false;},
  events:async()=>({epoch,session_id:'s',muted,cursor:0,events}),
  speak:async data=>{spoken.push(data);return {request_id:'clip-'+spoken.length};},
  release:async()=>{}
 };
 const session=new ConversationSession({gateway,director:{
  generate:async()=>({lines:[{actor:'SHANNY',text:'Fine.'},{actor:'REV',text:'Okay.'}]})
 }});
 await session.initialize();const scope=await session.arm();
 await session.submit({kind:'donation',text:'  (rev) Hello Buff!',...scope});
 await until(()=>spoken.length===1);
 assert.equal(spoken[0].actor,'REV');assert.equal(spoken[0].text,'Hello Buff!');
 assert.equal(session.turn.text,'Hello Buff!');
 await session.stop();
});

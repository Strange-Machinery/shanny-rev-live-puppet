import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ConversationSession} from '../src/conversation-session.mjs';
import {createBlackoutMicrodirector} from '../src/blackout-microdirector-director.mjs';
import {preparePopupDetails} from '../src/popup-details.mjs';
import {popupView} from '../src/remote-web/popup-view.js';
import {createStageMedia} from '../src/stage-media.mjs';

async function until(fn){
 for(let i=0;i<80;i++){if(fn())return;await delay(5);}
 throw Error('Expected async response did not reach gateway');
}
function fixture(){
 let epoch=0,muted=true,n=0;
 const events=[],spoken=[],released=[],calls=[];
 const emit=(type,id)=>events.push({type,id,seq:events.length+1,epoch,session_id:'s'});
 const gateway={
   panic:async()=>{epoch++;muted=true;emit('panic');},
   resume:async()=>{muted=false;emit('resume');},
   status:async()=>({session_id:'s',epoch,muted,cursor:events.length}),
   events:async({after})=>({session_id:'s',epoch,muted,cursor:events.length,events:events.slice(after)}),
   speak:async data=>{
     const id='clip-'+(++n);spoken.push({...data,id});
     if(data.prepare_only)emit('speech.prepared',id);
     return {request_id:id};
   },
   release:async data=>{released.push(data);}
 };
 const director={generate:async args=>{
   calls.push(args);
   return {lines:[{actor:'SHANNY',text:'That comment does not settle the bucket argument.'},
     {actor:'REV',text:'I still had to carry the bucket.'}],
     hinge:'A viewer reopened the argument.',rev_reason:'Rev disputes her claim'};
 }};
 return {session:new ConversationSession({gateway,director}),gateway,calls,spoken,released,emit};
}
test('chat React is never spoken as a donation; uses existing live director',async()=>{
 const f=fixture();await f.session.initialize();const scope=await f.session.arm();
 await f.session.submit({kind:'chat',chatAuthor:'Viewer',text:'Shanny, why that bucket?',...scope});
 await until(()=>f.calls.length===1);
 assert.equal(f.calls[0].kind,'chat');
 assert.equal(f.calls[0].chatAuthor,'Viewer');
 assert.equal(f.spoken.length>0,true);
 assert.equal(f.spoken[0].text,'That comment does not settle the bucket argument.');
 assert.equal(f.session.turn.popup.type,'chat');
 assert.equal(f.session.turn.popup.amount,undefined);
 await f.session.stop();
});
test('chat Read + React first reads message by addressed character',async()=>{
 const f=fixture();await f.session.initialize();const scope=await f.session.arm();
 await f.session.submit({kind:'chat',chatAuthor:'Viewer',
   text:'Rev, what happened to the bucket?',readChat:true,...scope});
 await until(()=>f.spoken.length===1);
 assert.equal(f.spoken[0].actor,'REV');
 assert.equal(f.spoken[0].text,'Rev, what happened to the bucket?');
 assert.equal(f.calls.length,0,'Qwen starts after the chat read playback starts');
 f.emit('playback.started',f.spoken[0].id);
 await until(()=>f.calls.length===1);
 await f.session.stop();
});
test('ordinary viewer chat cannot use rain, or inject chat fields into paid request',async()=>{
 const f=fixture();await f.session.initialize();const scope=await f.session.arm();
 await assert.rejects(
   f.session.submit({kind:'chat',chatAuthor:'Viewer',text:'hello',make_it_rain:true,...scope}),
   /paired rain presentation|Make it rain/i);
 await assert.rejects(
   f.session.submit({kind:'donation',chatAuthor:'Viewer',text:'a payment',...scope}),
   /Chat metadata/);
 await assert.rejects(
   f.session.submit({kind:'chat',chatAuthor:'x'.repeat(61),text:'hi',...scope}),
   /Invalid live-chat metadata/);
 await f.session.stop();
});
test('Qwen Microdirector handles chat with fixed roles and one completion',async()=>{
 let args=null,calls=0;
 const director=createBlackoutMicrodirector({
   notes:'Private performance instructions',
   getDeliveryCodes:()=>({}),
   complete:async req=>{
     calls++;args=req;
     return {hinge:'The bucket accusation humiliates Rev again.',
       first_REV:{text:'I carried that bucket because somebody had to do the job.',mood:'irritated'},
       second_SHANNY:{text:'Rev, you act like that bucket makes you some kind of hero.',mood:'anger'},
       rev_reason:'Rev challenges the accusation'};
   }
 });
 const plan=await director.generate({kind:'chat',
   text:'Rev, who carried the bucket?',chatAuthor:'Viewer42'});
 assert.equal(calls,1);
 assert.deepEqual(plan.lines.map(x=>x.actor),['REV','SHANNY']);
 const input=JSON.parse(args.messages[1].content);
 assert.equal(input.kind,'chat');
 assert.equal(input.chat_event.viewer_name,'Viewer42');
 assert.equal(input.chat_event.source,'youtube');
 assert.equal(input.audience_address.target,'REV');
 assert.equal(args.messages.some(x=>x.role==='system'&&/untrusted/i.test(x.content)),true);
 assert.equal(args.responseSchema.properties.first_REV.type,'object');
});
test('chat public popup is not a donation or payment-capable payload',async t=>{
 const details=preparePopupDetails({kind:'chat',chatAuthor:'Viewer',
   text:'Rev, please <script>alert(1)</script>.'});
 assert.deepEqual(details,{type:'chat',donor:'Viewer',
   message:'Rev, please <script>alert(1)</script>.'});
 const view=popupView({available:true,presentation_visible:true,popup:details});
 assert.equal(view.kind,'chat');assert.equal(view.amount,'');
 assert.equal(view.heading,'YOUTUBE LIVE CHAT');
 assert.throws(()=>preparePopupDetails({kind:'chat',chatAuthor:'x'.repeat(61),text:'hi'}));
 const stage=await createStageMedia({token:'read-only-test-token-1234567890'});
 t.after(()=>stage.close());
 assert.doesNotThrow(()=>stage.setPopup(details));
 assert.throws(()=>stage.setPopup({type:'chat',donor:'Viewer',message:'',amount:999}));
});

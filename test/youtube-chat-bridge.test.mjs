import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createYouTubeChatBridge} from '../src/youtube-chat-bridge.mjs';

function fixture(options={}) {
  let now=1700000000000;
  let paid=false;
  const submissions=[];
  const session={mode:'live',epoch:4,scope:{session_id:'test-session'},turn:null,
    async submit(packet){submissions.push(packet);return {status:'accepted'};}};
  const processes=[];
  function fakeSpawn(){const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kill=()=>{p.emit('exit',0);};processes.push(p);return p;}
  const chat=createYouTubeChatBridge({session,paidBusy:()=>paid,
    videoId:'abcdefghijk',now:()=>now,spawnProcess:fakeSpawn,minGapMs:5000,...options});
  const message=(id,text='Rev, explain yourself.',changes={})=>({
    source:'youtube',type:'textMessage',id,text,author:'Fan',published_ms:now,...changes
  });
  return {chat,session,submissions,processes,message,advance:ms=>now+=ms,setPaid:v=>paid=v};
}
test('feature OFF and collector requires explicit operator enable',async()=>{
 const f=fixture();assert.equal(f.chat.ingest(f.message('1')),false);
 assert.equal(f.chat.status().enabled,false);assert.equal(f.processes.length,0);
 await f.chat.enable();assert.equal(f.processes.length,1);
 await f.chat.disable();assert.equal(f.chat.status().enabled,false);
});
test('normal chat is a non-payment kind and never a STOP action',async()=>{
 const f=fixture();await f.chat.enable();
 assert.equal(f.chat.ingest(f.message('1','shut up')),true);
 await f.chat.tick();assert.equal(f.submissions.length,1);
 assert.equal(f.submissions[0].kind,'chat');
 assert.equal(f.submissions[0].text,'shut up');
 assert.equal(f.submissions[0].readChat,false);
 assert.equal(f.submissions[0].make_it_rain,undefined);
 await f.chat.disable();
});
test('does not double-read Super Chats, stickers or membership events',async()=>{
 const f=fixture();await f.chat.enable();
 for(const type of ['superChat','superSticker','newSponsor','giftMembershipReceived'])
  assert.equal(f.chat.ingest(f.message(type,'Pay me.',{type})),false);
 await f.chat.tick();assert.equal(f.submissions.length,0);
 await f.chat.disable();
});
test('filters history, TTL, duplicates and very-future packets',async()=>{
 const f=fixture();await f.chat.enable();
 assert.equal(f.chat.ingest(f.message('old','old',{published_ms:1699999980000})),false);
 assert.equal(f.chat.ingest(f.message('future','future',{published_ms:1700000100000})),false);
 assert.equal(f.chat.ingest(f.message('fresh')),true);
 assert.equal(f.chat.ingest(f.message('fresh')),false);
 await f.chat.tick();assert.equal(f.submissions.length,1);
 await f.chat.disable();
});
test('low priority chat cannot preempt paid queues, operator STOP or active speech',async()=>{
 const f=fixture();await f.chat.enable();f.chat.ingest(f.message('1'));
 f.setPaid(true);await f.chat.tick();assert.equal(f.submissions.length,0);
 f.setPaid(false);f.session.turn={id:'busy'};await f.chat.tick();assert.equal(f.submissions.length,0);
 f.session.turn=null;f.session.mode='muted';await f.chat.tick();assert.equal(f.submissions.length,0);
 f.session.mode='live';await f.chat.tick();assert.equal(f.submissions.length,1);
 await f.chat.disable();assert.equal(f.chat.ingest(f.message('2')),false);
});
test('moderator first, named author bounded, read mode and cooldown',async()=>{
 const f=fixture({mode:'read'});await f.chat.enable();
 f.chat.ingest(f.message('1','ordinary'));
 f.chat.ingest(f.message('2','mod',{is_moderator:true,author:'M'.repeat(100)}));
 await f.chat.tick();assert.equal(f.submissions[0].text,'mod');
 assert.equal(f.submissions[0].chatAuthor.length,60);
 assert.equal(f.submissions[0].readChat,true);
 await f.chat.tick();assert.equal(f.submissions.length,1);
 f.advance(5000);await f.chat.tick();assert.equal(f.submissions[1].text,'ordinary');
 await f.chat.disable();
});
test('bounded backlog, no raw chat in diagnostics, and structured stdout',async()=>{
 const f=fixture();await f.chat.enable();
 for(let i=0;i<60;i++)f.chat.ingest(f.message('m'+i,'secret viewer text '+i));
 assert.equal(f.chat.status().queue_depth,24);
 assert.equal(JSON.stringify(f.chat.status()).includes('secret'),false);
 f.processes[0].stdout.write(JSON.stringify(f.message('streaming','Hello'))+'\n');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.chat.status().queue_depth,24);
 await f.chat.disable();
});

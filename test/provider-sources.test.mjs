import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {YouTubePaidSource,StreamlabsPaidSource,StreamElementsPaidSource} from '../src/donations/provider-sources.mjs';

async function until(fn,ms=2000) {
 const deadline=Date.now()+ms;
 while(Date.now()<deadline) {
  if(fn())return;
  await delay(10);
 }
 throw new Error('Expected provider transition missing');
}
const youtube=(id,type='superChatEvent')=>({id,snippet:{type,publishedAt:'2026-10-14T07:00:00Z',
 superChatDetails:{amountMicros:'1000000',currency:'USD',userComment:id}}});
test('YouTube OAuth header, restart checkpoint, initial history suppression and recovery',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'buff-youtube-')),seen=[],queries=[],headers=[];
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const pages=[
  {nextPageToken:'one',pollingIntervalMillis:7000,items:[youtube('old')]},
  {nextPageToken:'two',pollingIntervalMillis:10000,items:[youtube('new'),youtube('chat','textMessageEvent')]},
  {nextPageToken:'three',pollingIntervalMillis:5000,items:[youtube('restart')]}
 ];
 const fetcher=async(url,options)=>{
  queries.push(new URL(url));headers.push(options.headers);
  return {ok:true,json:async()=>pages.shift()};
 };
 const cursorFile=join(dir,'youtube-cursor.local.json');
 const source=new YouTubePaidSource({liveChatId:'chat-1',cursorFile,
  fetcher,getAccessToken:async()=> 'PRIVATE_OAUTH_TOKEN',
  onEvent:row=>seen.push(row),minPollMs:5000});
 assert.equal(await source.pollOnce(),7000);
 assert.equal(seen.length,0);
 assert.equal(await source.pollOnce(),10000);
 assert.deepEqual(seen.map(row=>row.id),['new','chat']);
 assert.equal(queries[1].searchParams.get('pageToken'),'one');
 assert.equal(queries[1].searchParams.get('liveChatId'),'chat-1');
 assert.ok(!queries[1].href.includes('PRIVATE_OAUTH_TOKEN'));
 assert.equal(headers[1].Authorization,'Bearer PRIVATE_OAUTH_TOKEN');
 const resumed=new YouTubePaidSource({liveChatId:'chat-1',cursorFile,fetcher,
  getAccessToken:async()=> 'PRIVATE_OAUTH_TOKEN',onEvent:row=>seen.push(row)});
 await resumed.pollOnce();
 assert.deepEqual(seen.map(row=>row.id),['new','chat','restart']);
 assert.equal(queries[2].searchParams.get('pageToken'),'two');
 await resumed.stop();
 const reset=new YouTubePaidSource({liveChatId:'chat-1',cursorFile,fetcher,
  getAccessToken:async()=> 'PRIVATE_OAUTH_TOKEN',onEvent:row=>seen.push(row)});
 assert.equal(reset.ready,false);
});
test('YouTube invalid cursor/auth failure is fail-closed rather than silently replaying past gifts',async t=>{
 const src=new YouTubePaidSource({liveChatId:'chat',
  getAccessToken:async()=> 'token',onEvent:()=>assert.fail('must not emit'),
  fetcher:async()=>({ok:false,status:403})});
 await assert.rejects(src.pollOnce(),error=>error.permanent===true);
 t.after(()=>src.stop());
});
test('Streamlabs Socket.IO receives paid event only after authenticated connect, disconnects cleanly',async()=>{
 let socket,options;const seen=[],states=[];
 const source=new StreamlabsPaidSource({socketToken:'SOCKET_PRIVATE_TOKEN',
  onEvent:row=>seen.push(row),onStatus:value=>states.push(value),
  connect:(url,opts)=>{
   assert.equal(url,'https://sockets.streamlabs.com');options=opts;
   socket=new EventEmitter();socket.disconnect=()=>{};socket.removeAllListeners=socket.removeAllListeners.bind(socket);
   return socket;
  }});
 await source.start();
 const gift={type:'donation',for:'youtube_account',message:[{id:5,amount:'2',currency:'USD'}]};
 socket.emit('event',gift);await delay(5);assert.equal(seen.length,0);
 socket.emit('connect');socket.emit('event',gift);await until(()=>seen.length===1);
 assert.equal(options.query.token,'SOCKET_PRIVATE_TOKEN');
 assert.equal(options.reconnection,true);
 await source.stop();socket.emit('event',gift);await delay(5);
 assert.equal(seen.length,1);assert.equal(states.at(-1),'disconnected');
});
class FakeWebSocket {
 constructor(url){this.url=url;this.listeners={};this.sent=[];this.closed=false;}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
 send(data){this.sent.push(JSON.parse(data));}
 emit(type,data){for(const fn of this.listeners[type]||[])fn(type==='message'?{data:JSON.stringify(data)}:{});}
 close(){this.closed=true;this.emit('close');}
}
test('Astro authenticates tips:read topic before accepting events and gracefully reconnects',async()=>{
 const sockets=[],seen=[],states=[];
 const source=new StreamElementsPaidSource({room:'channel-1',token:'PRIVATE_JWT',
  onEvent:row=>seen.push(row),onStatus:v=>states.push(v),backoffMs:100,
  websocketFactory:url=>{const ws=new FakeWebSocket(url);sockets.push(ws);return ws;}});
 await source.start();
 const ws=sockets[0];
 const tip={type:'message',topic:'channel.tips',room:'channel-1',
  data:{_id:'tip-1',channel:'channel-1',status:'success',approved:'allowed'}};
 ws.emit('message',tip);assert.equal(seen.length,0);
 ws.emit('open');const subscribe=ws.sent[0];
 assert.equal(subscribe.type,'subscribe');
 assert.equal(subscribe.data.topic,'channel.tips');
 assert.equal(subscribe.data.token_type,'jwt');
 assert.equal(subscribe.data.token,'PRIVATE_JWT');
 ws.emit('message',{type:'response',nonce:subscribe.nonce,data:{topic:'channel.tips',room:'channel-1'}});
 ws.emit('message',tip);await until(()=>seen.length===1);
 ws.emit('message',{type:'reconnect',data:{reconnect_token:'resume-token'}});
 await until(()=>sockets.length===2);assert.match(sockets[1].url,/reconnect_token=resume-token/);
 sockets[1].emit('open');assert.equal(sockets[1].sent.length,0);
 sockets[1].emit('message',{type:'welcome'});
 sockets[1].emit('message',tip);await until(()=>seen.length===2);
 await source.stop();assert.equal(states.at(-1),'disconnected');
});
test('Astro ignores unrelated and unauthorized responses',async()=>{
 const sockets=[],seen=[];
 const source=new StreamElementsPaidSource({room:'channel-1',token:'PRIVATE',
  onEvent:row=>seen.push(row),websocketFactory:url=>{
   const ws=new FakeWebSocket(url);sockets.push(ws);return ws;
  }});
 await source.start();const ws=sockets[0];ws.emit('open');
 ws.emit('message',{type:'response',nonce:ws.sent[0].nonce,error:'err_unauthorized'});
 ws.emit('message',{type:'message',topic:'channel.tips',room:'channel-1',
  data:{_id:'not-allowed',status:'success',approved:'allowed'}});
 await delay(5);assert.equal(seen.length,0);assert.equal(source.state,'error');
 await source.stop();
});

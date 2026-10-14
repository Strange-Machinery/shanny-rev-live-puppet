import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DEFAULT_DONATION_AUTHORITY,normalizeYoutubeSuperChat,
 normalizeStreamlabsEvent,normalizeStreamElementsTip,normalizeProviderEvent
} from '../src/donations/provider-events.mjs';

// Payload field names are drawn from the official YouTube liveChatMessages,
// Streamlabs Socket API, and StreamElements Astro channel.tips documentation.
const youtube={
 kind:'youtube#liveChatMessage',id:'LCC.Cg8KDQ-12345',snippet:{
  type:'superChatEvent',publishedAt:'2026-10-14T04:00:01Z',
  superChatDetails:{amountMicros:'2000000',currency:'USD',userComment:'Hello Buff'}
 },authorDetails:{displayName:'Patron'}
};
const streamlabs={
 type:'donation',for:'youtube_account',message:[
  {id:96164121,_id:'0820c9d5bafd768c9843f5e35c885e71',
   name:'Tipper',amount:'13.37',message:'Buy a pizza',currency:'USD'}
 ]};
const elements={
 id:'01JMFBZF7KSRDDXXV0EH7G8X6G',type:'message',topic:'channel.tips',
 room:'5ad23dcc18fff500d78c5348',
 data:{_id:'67b5f39d07ecd4c594e60f73',channel:'5ad23dcc18fff500d78c5348',
  provider:'paypal',status:'success',approved:'allowed',
  createdAt:'2026-10-14T04:00:02Z',
  donation:{user:{username:'Styler'},message:'Rain please',amount:4.2,currency:'USD'}}
};
test('only purchased YouTube Super Chat produces a canonical payment',()=>{
 const result=normalizeYoutubeSuperChat(youtube);
 assert.deepEqual(result.map(x=>x.donation_id),['youtube:superchat:LCC.Cg8KDQ-12345']);
 assert.equal(result[0].amount,2);assert.equal(result[0].text,'Hello Buff');
 assert.equal(result[0].timestamp,'2026-10-14T04:00:01.000Z');
 for(const type of ['textMessageEvent','superStickerEvent','newSponsorEvent','membershipGiftingEvent','memberMilestoneChatEvent'])
  assert.deepEqual(normalizeYoutubeSuperChat({...youtube,snippet:{...youtube.snippet,type}}),[]);
 assert.deepEqual(normalizeYoutubeSuperChat({...youtube,id:'same',snippet:{
  ...youtube.snippet,superChatDetails:{...youtube.snippet.superChatDetails,amountMicros:'0'}
 }}),[]);
});
test('historical Super Chat structure is supported for deliberate reconciliation, not auto-replayed',()=>{
 const result=normalizeYoutubeSuperChat({
  kind:'youtube#superChatEvent',id:'LCC.paid-002',
  snippet:{createdAt:'2026-10-14T04:01:00Z',amountMicros:'1500000',
   currency:'USD',commentText:'Hi',supporterDetails:{displayName:'Buyer'},isSuperStickerEvent:false}
 });
 assert.equal(result.length,1);assert.equal(result[0].amount,1.5);
 assert.deepEqual(normalizeYoutubeSuperChat({kind:'youtube#superChatEvent',id:'STICKER',
  snippet:{amountMicros:'5000000',currency:'USD',isSuperStickerEvent:true}}),[]);
});
test('Streamlabs normalizes direct tips, even from a linked YouTube channel, but excludes YouTube mirrors',()=>{
 const result=normalizeStreamlabsEvent(streamlabs);
 assert.equal(result.length,1);
 assert.equal(result[0].donation_id,'streamlabs:donation:96164121');
 assert.equal(result[0].amount,13.37);
 const mirror={type:'superchat',for:'youtube_account',message:[
  {id:youtube.id,name:'Patron',amount:'2000000',currency:'USD',comment:'Hello Buff'}
 ]};
 assert.deepEqual(normalizeStreamlabsEvent(mirror),[]);
 const viaMirror=normalizeStreamlabsEvent(mirror,{authority:{...DEFAULT_DONATION_AUTHORITY,superchat:'streamlabs'}});
 assert.equal(viaMirror.length,1);
 assert.equal(viaMirror[0].donation_id,normalizeYoutubeSuperChat(youtube)[0].donation_id);
 for(const type of ['follow','subscription','donation_test','bits'])
  assert.deepEqual(normalizeStreamlabsEvent({...streamlabs,type}),[]);
});
test('two Streamlabs payments are not collapsed because their text and amounts match',()=>{
 const both={...streamlabs,message:[streamlabs.message[0],{...streamlabs.message[0],id:96164122}]};
 const rows=normalizeStreamlabsEvent(both);
 assert.equal(rows.length,2);assert.equal(rows[0].text,rows[1].text);
 assert.notEqual(rows[0].donation_id,rows[1].donation_id);
});
test('StreamElements Astro tips require success plus allowed moderation and matching room',()=>{
 const result=normalizeStreamElementsTip(elements);
 assert.equal(result.length,1);assert.equal(result[0].donation_id,'streamelements:tip:67b5f39d07ecd4c594e60f73');
 assert.equal(result[0].amount,4.2);
 assert.deepEqual(normalizeStreamElementsTip({...elements,data:{...elements.data,approved:'pending'}}),[]);
 assert.deepEqual(normalizeStreamElementsTip({...elements,data:{...elements.data,status:'pending'}}),[]);
 assert.deepEqual(normalizeStreamElementsTip({...elements,room:'different'}),[]);
 assert.deepEqual(normalizeStreamElementsTip({...elements,topic:'channel.activities'}),[]);
});
test('blank tip text receives a spoken donation acknowledgment, not a subscriber cue',()=>{
 const row=normalizeStreamElementsTip({...elements,data:{...elements.data,
  donation:{...elements.data.donation,message:''}}})[0];
 assert.match(row.text,/Styler donated USD 4.20/);
 assert.deepEqual(normalizeProviderEvent('streamelements',{type:'message',topic:'channel.chat.message'}),[]);
 assert.throws(()=>normalizeProviderEvent('unknown',elements),/Unknown authenticated provider/);
});

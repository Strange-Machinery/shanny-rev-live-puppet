/**
 * Buff OFFLINE provider smoke lab.
 * All credentials, sockets, polling responses and payments here are invented.
 * Exercises the real production transport adapters -> normalizers -> durable
 * queue -> single serialized host. Never opens a public connection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {LiveDonations} from '../src/donations/live-donations.mjs';
import {YouTubePaidSource, StreamlabsPaidSource, StreamElementsPaidSource} from '../src/donations/provider-sources.mjs';

async function until(predicate, label, ms=4500) {
  const deadline=Date.now()+ms;
  while(Date.now()<deadline) {
    if(predicate())return;
    await sleep(15);
  }
  throw new Error('Offline smoke-lab timeout: '+label);
}
class FakeAstro {
  constructor(url) { this.url=url; this.sent=[]; this.handlers=new Map(); }
  addEventListener(type,handler) { this.handlers.set(type,handler); }
  send(body) { this.sent.push(JSON.parse(body)); }
  emit(type,packet) {
    this.handlers.get(type)?.(type==='message'?{data:JSON.stringify(packet)}:{});
  }
  close() { this.emit('close'); }
}
const slDonation=(id,sum,text='Shanny and Rev, argue about this!')=>({
  type:'donation',message:[{id,name:'Fixture Donor',amount:String(sum),currency:'USD',message:text}]
});
const astroTip=(id,sum,{room='canon-room',status='success',approved='allowed'}={})=>({
  type:'message',topic:'channel.tips',room,
  data:{_id:id,channel:room,status,approved,createdAt:'2026-10-14T19:00:00Z',
    donation:{user:{username:'Fixture Viewer'},amount:sum,currency:'USD',
      message:'Shanny and Rev, argue about this!'}}
});
const youtubeChat=(id,amount=5,type='superChatEvent')=>({
  kind:'youtube#liveChatMessage',id,authorDetails:{displayName:'Fixture Viewer'},
  snippet:{type,publishedAt:'2026-10-14T19:00:00Z',
    superChatDetails:{amountMicros:String(Math.round(amount*1e6)),currency:'USD',
      userComment:'Shanny and Rev, argue about this!'}}
});

test('SMOKELAB three real adapters: authenticated-shaped intake, YouTube fresh cursor, $100 rain, dedup, queue, STOP',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'buff-smokelab-three-'));
  const hostState={armed:false,busy:false,viewers:1,epoch:0};
  const hostCalls=[];
  const host=async row=>{
    hostCalls.push(row);
    if(row.action==='arm'){hostState.armed=true;return {session_id:'fixture-smokelab',mode_epoch:hostState.epoch};}
    if(row.action==='stop'){hostState.armed=false;hostState.busy=false;return {stopped:true};}
    if(row.action==='status')return {
      mode:hostState.armed?'live':'muted',turn_busy:hostState.busy,
      conversation_busy:hostState.busy,presentation_visible:hostState.busy,
      media:{available:true,obs_viewers:hostState.viewers},error:''
    };
    if(row.action==='donate'){
      assert.equal(hostState.armed,true);
      assert.equal(hostState.viewers,1);
      hostState.busy=true;
      return {status:'accepted'};
    }
    throw new Error('Unexpected host action '+row.action);
  };
  let slSocket,astro,ytSource,ytPolls=0;
  const pages=[
    {nextPageToken:'after-history',pollingIntervalMillis:7000,items:[youtubeChat('old-should-never-replay',500)]},
    {nextPageToken:'after-live',pollingIntervalMillis:5000,items:[
      youtubeChat('not-a-purchase',0,'textMessageEvent'),
      youtubeChat('yt-small',5),youtubeChat('yt-whale',100)
    ]}
  ];
  const manager=new LiveDonations({directory,host,config:{
    youtube:{liveChatId:'offline-live-chat',accessToken:'SYNTHETIC_YOUTUBE_ONLY'},
    streamlabs:{socketToken:'SYNTHETIC_STREAMLABS_ONLY'},
    streamelements:{room:'display-room',token:'SYNTHETIC_ASTRO_ONLY'}
  },factories:{
    youtube:args=>{
      ytSource=new YouTubePaidSource({...args,minPollMs:1000,
        fetcher:async(url,options)=>{
          ytPolls++;
          const request=new URL(url);
          assert.equal(request.hostname,'www.googleapis.com');
          assert.equal(request.searchParams.get('liveChatId'),'offline-live-chat');
          assert.equal(options.headers.Authorization,'Bearer SYNTHETIC_YOUTUBE_ONLY');
          assert.equal(request.searchParams.get('pageToken'),ytPolls===1?null:'after-history');
          const page=pages.shift();
          if(!page)throw Error('Unexpected mock YouTube page');
          return {ok:true,json:async()=>page};
        }});
      // Drive pollOnce explicitly: no background timer or real Google API.
      ytSource.start=async()=>{ytSource.running=true;ytSource.report('connected');};
      ytSource.stop=async()=>{ytSource.running=false;ytSource.report('disconnected');};
      return ytSource;
    },
    streamlabs:args=>new StreamlabsPaidSource({...args,connect:(url,opts)=>{
      assert.equal(url,'https://sockets.streamlabs.com');
      assert.equal(opts.query.token,'SYNTHETIC_STREAMLABS_ONLY');
      slSocket=new EventEmitter();slSocket.disconnect=()=>{};
      return slSocket;
    }}),
    streamelements:args=>new StreamElementsPaidSource({...args,websocketFactory:url=>{
      assert.match(url,/^wss:\/\/astro\.streamelements\.com/);
      astro=new FakeAstro(url);return astro;
    }})
  }});
  t.after(async()=>{await manager.close();rmSync(directory,{recursive:true,force:true});});
  assert.equal(manager.status().enabled,false);
  assert.equal(hostCalls.length,0);
  await manager.enable({make_it_rain:false});
  assert.equal(hostCalls.filter(row=>row.action==='arm').length,1);
  // First YouTube list page is history: bookmark, NEVER replay its $500.
  assert.equal(await ytSource.pollOnce(),7000);
  assert.equal(manager.status().intake_diagnostics.counts.youtube.observed,0);

  // Packet-looking events before socket/subscription authentication are ignored.
  slSocket.emit('event',slDonation('no-auth',100));
  astro.emit('message',astroTip('no-auth',100));
  await sleep(20);
  assert.equal(manager.status().pending,0);
  slSocket.emit('connect');
  astro.emit('open');
  const subscription=astro.sent[0];
  assert.equal(subscription.type,'subscribe');
  assert.equal(subscription.data.topic,'channel.tips');
  assert.equal(subscription.data.room,'display-room');
  assert.equal(subscription.data.token_type,'jwt');
  // Canonical server room ID differs from the user-entered display room.
  astro.emit('message',{type:'response',nonce:subscription.nonce,
    data:{topic:'channel.tips',room:'canon-room'}});
  assert.equal(manager.status().providers.streamlabs,'connected');
  assert.equal(manager.status().providers.streamelements,'connected');

  // False donation-like alerts and non-approved transfers must fail closed.
  slSocket.emit('event',{type:'donation_test',message:[{id:10,amount:500,currency:'USD'}]});
  slSocket.emit('event',{type:'superchat',for:'youtube_account',message:[{id:11,amount:500000000,currency:'USD'}]});
  astro.emit('message',{...astroTip('activity',200),topic:'channel.activities'});
  astro.emit('message',astroTip('held',200,{approved:'pending'}));
  astro.emit('message',astroTip('wrong-room',200,{room:'different-room'}));
  await sleep(20);
  assert.equal(manager.status().pending,0);

  slSocket.emit('event',slDonation('sl-5',5));
  await until(()=>manager.status().intake_diagnostics.counts.streamlabs.accepted===1,'Streamlabs $5');
  slSocket.emit('event',slDonation('sl-100',100));
  await until(()=>manager.status().intake_diagnostics.counts.streamlabs.accepted===2,'Streamlabs $100');
  astro.emit('message',astroTip('se-9999',99.99));
  await until(()=>manager.status().intake_diagnostics.counts.streamelements.accepted===1,'Astro $99.99');
  astro.emit('message',astroTip('se-100',100));
  await until(()=>manager.status().intake_diagnostics.counts.streamelements.accepted===2,'Astro $100');
  assert.equal(await ytSource.pollOnce(),5000);
  await until(()=>manager.status().intake_diagnostics.counts.youtube.accepted===2,'YouTube current Super Chats');

  // Replays must not schedule duplicate performances.
  slSocket.emit('event',slDonation('sl-100',100));
  astro.emit('message',astroTip('se-100',100));
  await sleep(25);
  const snapshot=manager.status();
  assert.equal(snapshot.intake_diagnostics.counts.streamlabs.duplicate,1);
  assert.equal(snapshot.intake_diagnostics.counts.streamelements.duplicate,1);
  assert.equal(snapshot.pending+snapshot.inflight,6);

  const donations=()=>hostCalls.filter(row=>row.action==='donate');
  const expected=[
    ['streamlabs',5,false],['streamlabs',100,true],
    ['streamelements',99.99,false],['streamelements',100,true],
    ['youtube',5,false],['youtube',100,true]
  ];
  for(let i=0;i<expected.length;i++){
    await until(()=>donations().length===i+1,'serialized donation '+(i+1));
    const [provider,sum,rain]=expected[i],row=donations()[i];
    assert.equal(row.donation.provider,provider);
    assert.equal(row.donation.amount,sum);
    assert.equal(row.make_it_rain,rain);
    hostState.busy=false; // Simulated finished speech and reaction receipts.
  }
  await until(()=>manager.status().pending===0&&manager.status().inflight===0,'drained queue');
  const publicDiagnostics=JSON.stringify(manager.status().intake_diagnostics);
  assert.doesNotMatch(publicDiagnostics,/SYNTHETIC_|Fixture Donor|Fixture Viewer|argue about this|sl-100|yt-whale/);
  assert.equal(manager.status().make_it_rain,false);
  await manager.stop();
  slSocket.emit('event',slDonation('after-stop',200));
  await sleep(25);
  assert.equal(donations().length,6,'STOP must be sticky');
});

test('SMOKELAB YouTube page replay after failed durable admission retains cursor and deduplicates',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'buff-smokelab-cursor-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const cursorFile=join(directory,'youtube-cursor.local.json');
  const accepted=new Set();
  let rejectSecond=true,firstPage=true;
  const source=new YouTubePaidSource({liveChatId:'fixture-channel',cursorFile,
    getAccessToken:async()=> 'SYNTHETIC_TOKEN_ONLY',minPollMs:1000,
    fetcher:async url=>{
      const token=new URL(url).searchParams.get('pageToken');
      const payload=token===null
        ?{nextPageToken:'history',items:[youtubeChat('old',500)]}
        :{nextPageToken:'live',items:[youtubeChat('fresh-1',5),youtubeChat('fresh-2',100)]};
      if(firstPage){assert.equal(token,null);firstPage=false;}
      return {ok:true,json:async()=>payload};
    },
    onEvent:async row=>{
      if(row.id==='fresh-2'&&rejectSecond){rejectSecond=false;throw Error('injected durable-admission failure');}
      accepted.add(row.id);
    }});
  await source.pollOnce();
  assert.deepEqual([...accepted],[]);
  await assert.rejects(source.pollOnce(),/injected durable-admission failure/);
  assert.equal(JSON.parse(readFileSync(cursorFile,'utf8')).pageToken,'history');
  await source.pollOnce();
  assert.deepEqual([...accepted],['fresh-1','fresh-2']);
  assert.equal(JSON.parse(readFileSync(cursorFile,'utf8')).pageToken,'live');
  await source.stop();
});

test('SMOKELAB blocked OBS viewer prevents speech; 32 pending maximum, overflow fail closed, STOP retains backlog',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'buff-smokelab-backlog-'));
  let armed=false,viewers=0,busy=false;
  const delivered=[];
  const host=async row=>{
    if(row.action==='arm'){armed=true;return {session_id:'local-viewer',mode_epoch:0};}
    if(row.action==='stop'){armed=false;busy=false;return {};}
    if(row.action==='status')return {mode:armed?'live':'muted',
      conversation_busy:busy,turn_busy:busy,presentation_visible:busy,
      media:{available:true,obs_viewers:viewers},error:''};
    if(row.action==='donate'){delivered.push(row);busy=true;return {status:'accepted'};}
    throw new Error('Unexpected host action '+row.action);
  };
  const manager=new LiveDonations({directory,host,config:{streamlabs:{socketToken:'SYNTHETIC_ONLY'}},
    factories:{streamlabs:args=>({
      async start(){args.onStatus('connected');},
      async stop(){args.onStatus('disconnected');}
    })}});
  t.after(async()=>{await manager.close();rmSync(directory,{recursive:true,force:true});});
  await manager.enable();
  for(let i=1;i<=32;i++){
    assert.deepEqual(manager.ingest('streamlabs',slDonation('backlog-'+i,2))
      .map(x=>x.status),['queued']);
  }
  assert.equal(manager.status().pending,32);
  assert.throws(()=>manager.ingest('streamlabs',slDonation('overflow',2)),/queue full/);
  await sleep(180);
  assert.equal(delivered.length,0,'no authenticated OBS viewer means NO delivery');
  assert.equal(manager.status().intake_diagnostics.counts.streamlabs.busy,1);
  viewers=1;
  await until(()=>delivered.length>0,'viewer resumes delivery');
  await manager.stop();
  assert.equal(manager.status().enabled,false);
  assert.ok(manager.status().pending>0,'unstarted accepted contributions stay durable');
});

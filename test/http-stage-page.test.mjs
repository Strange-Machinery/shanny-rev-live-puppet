import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {popupView} from '../src/remote-web/popup-view.js';

// Exercise the actual page orchestration with its transport/DOM boundaries
// supplied by the fixture. Codec and transport lifecycle tests live separately.
const source=(await readFile(new URL('../src/remote-web/stage-page.js',import.meta.url),'utf8'))
  .replace(/^import[^\n]*\n/gm,'');
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(setImmediate);};
const deferred=()=>{
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
};
const stream=name=>({name,getVideoTracks:()=>[{kind:'video',readyState:'live'}],
  getAudioTracks:()=>[{kind:'audio',readyState:'live'}]});
const presentation=(nonce,mode='seated')=>({available:true,presentation_visible:true,control_epoch:0,
  presentation_nonce:nonce,presentation_mode:mode,rain_audio:mode==='rain'?'pending':null,
  popup:mode==='rain'?{type:'celebration'}:{type:'test',message:'Synthetic HTTP presentation'},
  caption:{actor:'SHANNY',text:'Synthetic caption'}});

async function page(mode){
  const elements=new Map(),listeners=new Map(),legacy=[],http=[],publishers=[],requests=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{id,hidden:false,textContent:'',dataset:{},attributes:{},
      paused:true,muted:true,volume:1,readyState:4,playCalls:0,pauseCalls:0,
      srcObject:id==='stage'?stream('first'):null,currentTime:0,
      setAttribute(name,value){this.attributes[name]=value;},
      async play(){this.playCalls++;this.paused=false;},
      pause(){this.pauseCalls++;this.paused=true;}});
    return elements.get(id);
  };
  class Player {
    constructor(options){this.options=options;this.id='viewer';this.pc={connectionState:'connected'};
      this.isReady=true;this.calls=[];this.connects=0;this.closed=false;}
    async connect(){this.connects++;}
    async api(body){this.calls.push(body);return {accepted:true};}
    async close(){this.closed=true;}
  }
  class NativePlayer extends Player {constructor(options){super(options);legacy.push(this);}}
  class HttpPlayer extends Player {constructor(options){super(options);http.push(this);}}
  class Publisher {
    constructor(options){this.options=options;this.running=false;this.starting=false;
      this.starts=0;this.stops=0;this.startedSources=[];this.revision=0;this.cleanupPending=false;
      this.context={resume:async()=>{}};publishers.push(this);}
    async start(){
      this.starts++;this.startedSources.push(this.options.video.srcObject);
      if(this.cleanupPending)throw new Error('Started before old publisher cleanup');
      const revision=++this.revision;this.starting=true;
      await Promise.resolve();
      if(revision!==this.revision)throw new Error('Cancelled old publisher start');
      this.running=true;this.starting=false;
    }
    stop(){
      ++this.revision;this.stops++;this.running=false;this.starting=false;this.cleanupPending=true;
      const task=this.stopGate?.promise||Promise.resolve();
      return task.finally(()=>{this.cleanupPending=false;});
    }
    setPresentation(status){this.presentation=status;}
    setRainPlayback(status){this.rain=status;}
    fail(status){this.running=false;const error=new Error('Publisher failed');error.status=status;this.options.onError(error);}
  }
  const context={document:{getElementById:element},
    location:{pathname:mode==='http'?'/watch':'/stage',hash:mode==='http'?
      '#transport=http&key=fixture-viewer':'#source=http&key=fixture-operator'},
    history:{replaceState(){}},URLSearchParams,
    window:{addEventListener:(name,callback)=>listeners.set(name,callback)},
    StagePlayer:NativePlayer,HttpStagePlayer:HttpPlayer,LocalMediaPublisher:Publisher,popupView,
    createMessageScroller:()=>({show(){},reset(){}}),
    fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({enabled:true,can_publish:true})};}};
  vm.runInNewContext(source,context,{filename:'stage-page.js'});
  await settle();
  const player=mode==='http'?http[0]:legacy[0];
  return {element,legacy,http,publishers,requests,player,
    status:status=>player.options.onPresentation(status.presentation_visible===true,status),
    stats:()=>player.options.onStats({frames_decoded:1}),
    async dispose(){listeners.get('pagehide')?.();await settle();}};
}

test('HTTP program page renders muxed rain without legacy signaling or a second soundtrack',async t=>{
  const f=await page('http');t.after(()=>f.dispose());
  assert.equal(f.http.length,1);assert.equal(f.legacy.length,0);assert.equal(f.publishers.length,0);
  f.status(presentation('rain-one','rain'));await settle();
  assert.equal(f.element('stank-popup').hidden,false);
  assert.equal(f.element('stage').muted,false);
  assert.equal(f.element('subtitle-words').textContent,'Synthetic caption');
  assert.equal(f.element('rain-cue').playCalls,0);
  assert.equal(f.player.calls.length,0,'HTTP playback must not send native media-presented/rain receipts');
  assert.equal(f.requests.length,0,'HTTP receiver must not initialize publisher ingress');
  f.status({available:false,presentation_visible:false});
  assert.equal(f.element('stank-popup').hidden,true);
  assert.equal(f.element('stage').muted,true);
});

test('source 409 latches manual resume even when a new native nonce and frame stats arrive',async t=>{
  const f=await page('source');t.after(()=>f.dispose());
  const publisher=f.publishers[0];
  assert.equal(f.player.options.ingest,true);
  f.status(presentation('one'));await settle();
  assert.equal(publisher.starts,1);assert.equal(publisher.running,true);
  publisher.fail(409);
  f.status(presentation('two'));f.stats();await settle();
  assert.equal(publisher.starts,1,'a new presentation cannot bypass the STOP click latch');
  assert.match(f.element('state').textContent,/Click Start Buff feed/);
  f.element('sound').onclick();await settle();
  assert.equal(publisher.starts,2);assert.equal(publisher.running,true);
});

test('native stream identity replacement waits for old publisher cleanup before recording the new stream',async t=>{
  const f=await page('source');t.after(()=>f.dispose());
  const publisher=f.publishers[0],closing=deferred();
  f.status(presentation('one'));await settle();
  const replacement=stream('replacement');publisher.stopGate=closing;
  f.element('stage').srcObject=replacement;f.stats();await settle();
  assert.equal(publisher.stops,1);assert.equal(publisher.cleanupPending,true);
  f.stats();f.stats();await settle();
  assert.equal(publisher.starts,1,'repeated frame callbacks must not race the outstanding close');
  closing.resolve();await settle();
  assert.equal(publisher.starts,2);assert.equal(publisher.startedSources[1],replacement);
  assert.equal(publisher.running,true);assert.equal(publisher.cleanupPending,false);
});

test('source loss serializes cleanup before fresh status can restart the publisher',async t=>{
  const f=await page('source');t.after(()=>f.dispose());
  const publisher=f.publishers[0],closing=deferred();
  f.status(presentation('one'));await settle();publisher.stopGate=closing;
  f.status({available:false,presentation_visible:false});await settle();
  assert.equal(publisher.stops,1);assert.equal(publisher.cleanupPending,true);
  const replacement=stream('reconnected');f.element('stage').srcObject=replacement;
  f.status(presentation('two'));f.stats();await settle();
  assert.equal(publisher.starts,1);
  closing.resolve();await settle();
  assert.equal(publisher.starts,2);assert.equal(publisher.startedSources[1],replacement);
  assert.equal(publisher.running,true);assert.equal(publisher.cleanupPending,false);
});

test('native STOP epoch latches manual resume without a 409 while ordinary presentation end keeps queued media',async t=>{
  const f=await page('source');t.after(()=>f.dispose());
  const publisher=f.publishers[0];
  f.status({...presentation('one'),control_epoch:7});await settle();
  assert.equal(publisher.starts,1,'first observed epoch only establishes the source baseline');
  f.status({available:true,presentation_visible:false,presentation_nonce:null,control_epoch:7});
  f.stats();await settle();
  assert.equal(publisher.running,true);assert.equal(publisher.stops,0,
    'ordinary presentation end must remain on the delayed media timeline');
  f.status({available:false,presentation_visible:false,control_epoch:8});await settle();
  assert.equal(publisher.stops,1);
  f.status({...presentation('two'),control_epoch:8});f.stats();await settle();
  assert.equal(publisher.starts,1,'native STOP must survive an unavailable source and a fresh nonce');
  f.element('sound').onclick();await settle();
  assert.equal(publisher.starts,2);assert.equal(publisher.running,true);
});

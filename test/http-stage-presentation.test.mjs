import test from 'node:test';
import assert from 'node:assert/strict';
import {createHttpStagePresentation} from '../src/http-stage-presentation.mjs';

function fixture(){
  let clock=0,onPause=()=>{};
  const stage={available:true,presentation_visible:true,presentation_nonce:'rain-1',presentation_mode:'rain'};
  const receiver={id:'buff',role:'obs',fresh:true,progressing:true,playing:true,
    muted:false,volume:1,audio_present:true,current_time:1,
    presentation_nonce:'rain-1',presentation_visible:true,playback_generation:1};
  const snapshot={stream_epoch:'epoch-1',state:'live',available:true,source_available:true,
    source_rain_state:'playing',source_rain_end_time:null,receivers:[receiver]};
  const adapter=createHttpStagePresentation({
    transport:{presentationStatus:nonce=>{assert.equal(nonce,'rain-1');return snapshot;}},
    getStage:()=>stage,now:()=>clock,pollMs:10,viewerTimeoutMs:100,rainTimeoutMs:100,
    pause:async(ms,signal)=>{if(signal?.aborted)throw signal.reason;clock+=ms;onPause(clock);}
  });
  return {stage,receiver,snapshot,adapter,setPause:fn=>{onPause=fn;},time:()=>clock};
}

test('ingest, preview, wrong nonce, muted, and non-progressing receivers never release HTTP speech',async()=>{
  for(const change of [{role:'ingest'},{role:'preview'},{presentation_nonce:'old'},
    {muted:true},{progressing:false},{audio_present:false},{presentation_visible:false},
    {playback_generation:undefined}]){
    const f=fixture();Object.assign(f.receiver,change);
    await assert.rejects(f.adapter.waitForViewer(),/did not confirm/);
    assert.equal(f.time(),100);
  }
});

test('HTTP visible gate waits for real presentation progress, including manual tests',async()=>{
  const f=fixture();f.stage.popup={type:'test'};f.receiver.progressing=false;
  f.setPause(time=>{if(time===30)f.receiver.progressing=true;});
  assert.equal(await f.adapter.waitForViewer(),true);
  assert.equal(f.time(),30);
});

test('source-ended alone cannot release TTS until same receiver plays through its media timestamp',async()=>{
  const f=fixture();await f.adapter.waitForViewer();
  f.snapshot.source_rain_state='ended';f.snapshot.source_rain_end_time=24;
  f.receiver.current_time=23.9;
  f.setPause(time=>{if(time===30)f.receiver.current_time=24;});
  assert.deepEqual(await f.adapter.waitForRainEnd(),{verified:true,reason:'HTTP-PLAYBACK-ENDED'});
  assert.equal(f.time(),30);
});

test('no nominal or producer-only rain fallback, even if requireViewer is false',async()=>{
  const f=fixture();await f.adapter.waitForViewer();
  f.receiver.current_time=80;
  await assert.rejects(f.adapter.waitForRainEnd({requireViewer:false}),/did not finish/);
  f.snapshot.source_rain_state='ended';f.snapshot.source_rain_end_time=null;
  await assert.rejects(f.adapter.waitForRainEnd({requireViewer:false}),/did not finish/);
});

test('rain requires a prior visible acknowledgment',async()=>{
  const f=fixture();
  f.snapshot.source_rain_state='ended';f.snapshot.source_rain_end_time=0.5;
  await assert.rejects(f.adapter.waitForRainEnd(),/first be acknowledged/);
});

test('HTTP rain rejects disconnect, replaced receiver, mute, seek/reinitialize, source failure, and STOP',async()=>{
  for(const [change,pattern] of [
    [f=>{f.snapshot.receivers=[];},/disconnected/],
    [f=>{f.receiver.id='replacement';},/disconnected/],
    [f=>{f.receiver.fresh=false;},/disconnected/],
    [f=>{f.receiver.muted=true;},/stopped audible/],
    [f=>{f.receiver.playback_generation++;},/skipped or reinitialized/],
    [f=>{f.snapshot.source_rain_state='failed';},/soundtrack failed/],
    [f=>{f.snapshot.source_available=false;},/publisher disconnected/],
    [f=>{f.stage.available=false;},/Native stage disconnected/],
    [f=>{f.snapshot.stream_epoch='epoch-2';},/epoch/],
    [f=>{f.stage.presentation_nonce='new';},/interrupted/]
  ]){
    const f=fixture();await f.adapter.waitForViewer();f.setPause(()=>change(f));
    await assert.rejects(f.adapter.waitForRainEnd(),pattern);
    assert.equal(f.time(),10,'known interruption must fail on the next status read');
  }
});

test('caller timeout is preserved for full-length rain instead of a short default',async()=>{
  const f=fixture();await f.adapter.waitForViewer();
  f.setPause(time=>{if(time===250){f.snapshot.source_rain_state='ended';f.snapshot.source_rain_end_time=1;}});
  assert.equal((await f.adapter.waitForRainEnd({timeoutMs:300})).verified,true);
  assert.equal(f.time(),250);
});

test('visible wait rejects abort or epoch change and respects its explicit deadline',async()=>{
  const f=fixture();const abort=new AbortController();const reason=new Error('operator STOP');
  abort.abort(reason);await assert.rejects(f.adapter.waitForViewer({signal:abort.signal}),error=>error===reason);
  f.receiver.progressing=false;f.setPause(()=>{f.snapshot.stream_epoch='epoch-2';});
  await assert.rejects(f.adapter.waitForViewer(),/epoch/);
  const g=fixture();g.receiver.progressing=false;
  await assert.rejects(g.adapter.waitForViewer({timeoutMs:25}),/did not confirm/);
  assert.equal(g.time(),25);
});

test('a delayed poll cannot accept readiness or soundtrack completion after the deadline',async()=>{
  const f=fixture();f.receiver.progressing=false;
  f.setPause(time=>{if(time>=100)f.receiver.progressing=true;});
  await assert.rejects(f.adapter.waitForViewer(),/did not confirm/);
  const g=fixture();await g.adapter.waitForViewer();
  g.setPause(time=>{if(time>=100){g.snapshot.source_rain_state='ended';g.snapshot.source_rain_end_time=0.5;}});
  await assert.rejects(g.adapter.waitForRainEnd(),/did not finish/);
});

test('reset prevents an old accepted nonce from satisfying later rain',async()=>{
  const f=fixture();await f.adapter.waitForViewer();f.adapter.reset();
  await assert.rejects(f.adapter.waitForRainEnd(),/first be acknowledged/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForPresentationReady} from '../src/remote-web/presentation-ready.js';

const media=()=>({paused:false,muted:false,readyState:2,play:async()=>{}});

test('background Live Show confirms playback without waiting for suspended paint callbacks',async()=>{
  let paints=0,plays=0;const video=media();video.play=async()=>{plays++;};
  await waitForPresentationReady({video,liveDisplay:true,frame:()=>{paints++;}});
  assert.equal(plays,1);assert.equal(paints,0);
});

test('OBS still waits for two actual paint callbacks',async()=>{
  const frames=[];let done=false;
  const task=waitForPresentationReady({video:media(),frame:f=>frames.push(f)}).then(()=>{done=true;});
  await Promise.resolve();assert.equal(frames.length,1);assert.equal(done,false);
  frames.shift()();assert.equal(frames.length,1);assert.equal(done,false);
  frames.shift()();await task;assert.equal(done,true);
});

test('a blocked or muted output cannot acknowledge presentation in either mode',async()=>{
  for(const liveDisplay of [false,true]){
    for(const change of [{muted:true},{paused:true},{readyState:1},{play:async()=>{throw Error('autoplay blocked');}}]){
      await assert.rejects(waitForPresentationReady({video:{...media(),...change},liveDisplay,frame:()=>assert.fail('No painting before playback')}));
    }
  }
});

test('OBS rejects playback that stopped while painting',async()=>{
  const video=media();let paints=0;
  await assert.rejects(waitForPresentationReady({video,frame:f=>{if(++paints===2)video.paused=true;f();}}),/stopped/);
});

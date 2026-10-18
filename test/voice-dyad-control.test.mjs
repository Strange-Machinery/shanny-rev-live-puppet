import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceDyadControl} from '../src/voice-dyad-control.mjs';
import {requestedEpisodeCodes} from '../src/approved-delivery.mjs';

const make=(options={})=>createVoiceDyadControl({config:{},getCodes:()=>requestedEpisodeCodes,...options});

test('producer Dyad defaults on for qualified voices and persists an explicit off choice',async()=>{
 let saved;
 const config={save:async()=>{saved=config.dyadEnabled;}};
 const d=make({config});assert.equal(d.forTurn(),true);
 assert.deepEqual(d.status(),{kind:'voice-dyad-lite',enabled:true,available:true,changing:false,state:'ready',writer:'gold',extra_model_calls:0,error:''});
 const result=await d.setEnabled(false);assert.equal(saved,false);assert.equal(result.state,'off');assert.equal(result.changing,false);
 assert.equal(make({config:{dyadEnabled:saved}}).forTurn(),false);
 await d.setEnabled(true);assert.equal(saved,true);assert.equal(d.forTurn(),true);
});

test('invalid, unavailable and busy switches cannot mutate or persist configuration',async()=>{
 let saves=0;const config={dyadEnabled:false,save:async()=>{saves++;}};
 for(const choice of [null,0,'true'])await assert.rejects(make({config}).setEnabled(choice),/on\/off/);
 await assert.rejects(make({config,isBusy:()=>true}).setEnabled(true),/Finish/);
 await assert.rejects(make({config,getCodes:()=>({SHANNY:['S06'],REV:['R10']})}).setEnabled(true),/unavailable/);
 await assert.rejects(make({config,eligible:false}).setEnabled(true),/unavailable/);
 assert.equal(config.dyadEnabled,false);assert.equal(saves,0);
});

test('a save failure restores the original selection including an absent default field',async()=>{
 const config={save:async()=>{throw Error('disk failed');}};const d=make({config});
 await assert.rejects(d.setEnabled(false),/disk failed/);
 assert.equal(Object.hasOwn(config,'dyadEnabled'),false);assert.equal(d.forTurn(),true);assert.equal(d.status().changing,false);
});

test('a turn admitted during a pending save keeps one voice route across all its rows',async()=>{
 let finish,turn=null;
 const config={dyadEnabled:false,save:()=>new Promise(resolve=>{finish=resolve;})};
 const d=make({config,getTurn:()=>turn});
 const setting=d.setEnabled(true);assert.equal(d.status().changing,true);assert.equal(d.status().enabled,false);
 await assert.rejects(d.setEnabled(false),/Finish/);
 turn={};assert.equal(d.forTurn(),false);
 finish();await setting;assert.equal(d.status().enabled,true);assert.equal(d.forTurn(),false);
 turn={};assert.equal(d.forTurn(),true);
 turn=null;assert.equal(d.forTurn(),true);
});

test('availability follows the actual resident catalog, never an imagined category list',()=>{
 let codes={};const d=make({getCodes:()=>codes});
 assert.equal(d.status().available,false);assert.equal(d.forTurn(),false);assert.match(d.status().error,/unavailable/);
 codes=requestedEpisodeCodes;assert.equal(d.status().available,true);assert.equal(d.forTurn(),true);
});

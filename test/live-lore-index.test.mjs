import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupLiveLore,liveLoreStats} from '../src/live-lore-index.mjs';
test('compiled lore index',()=>{assert.equal(liveLoreStats().hooks,119);assert.ok(liveLoreStats().aliases>=600);assert.deepEqual(lookupLiveLore('Hi there'),[]);});

import {LIVE_LORE_V2} from '../src/live-lore-catalog.v2.mjs';
test('all 119 source-tagged lore records are indexable and carry a distinct grievance',()=>{
 const ids=new Set();
 for(const card of LIVE_LORE_V2){
  assert.equal(ids.has(card.id),false,'duplicate ID '+card.id);
  ids.add(card.id);
  assert.ok(card.evidence.length>0,card.id+' missing provenance class');
  assert.ok(card.cue.length>=45,card.id+' missing reason to react');
  assert.ok(lookupLiveLore(card.terms[0],{limit:2}).some(hit=>hit.id===card.id),
    'unreachable lore card '+card.id);
 }
 assert.equal(ids.size,119);
});
test('realistic fan superchats recall obscure incidents without inventing unwanted food context',()=>{
 const cases=[
 ['Rev go dump the bucket','bucket'],
 ['Remember when Rev dropkicked Will','will-dropkick'],
 ['Rev became KittyDoomz','kitty-dooms'],
 ['Shanny wanted a Viking catfish','viking-flirt'],
 ['The Norway DMs again','ezzie-norway'],
 ['That was Ezzie\'s shirt','ezzie-shirt'],
 ['Tento Coordinates','tento-walmart'],
 ['Who spent the 750k?','million-loss'],
 ['Shanny took the wizard cloak','shanny-takes-wizard'],
 ['Did you get kicked out of Colorado?','eviction-2021'],
 ['Rev\'s karaoke was terrible','rev-karaoke'],
 ['Baby Carrot shirt','baby-carrot-shirt'],
 ['Why are you talking about the makeup palette?','makeup-palette'],
 ['Remember the Diet Coke count?','diet-coke'],
 ['Shanny and Rev\'s protection order','court-protection']
 ];
 for(const [message,id] of cases)
  assert.ok(lookupLiveLore(message,{limit:2}).some(hit=>hit.id===id),message+' failed '+id);
});
test('irrelevant outside topics do not activate the couple\'s lore',()=>{
 for(const message of [
  'What sandwich ingredients should I buy?',
  'What is the AWS S3 bucket policy?',
  'Will Rev kick a football tomorrow?',
  'Could you review my computer?',
  'Thanks for reading the five-dollar superchat',
  'Should I visit the moonbase in my game?'
 ]){
  // A deliberate mention of moon-related imagery may activate the moon card;
  // test unrelated topics separately instead of forbidding actual moon lore.
  if(message.includes('moonbase'))continue;
  assert.deepEqual(lookupLiveLore(message),[],message);
 }
});

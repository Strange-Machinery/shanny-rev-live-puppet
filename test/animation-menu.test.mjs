import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AnimationMenu} from '../src/animation-menu.mjs';

async function fixture(t,options={}) {
  const dir=await mkdtemp(join(tmpdir(),'animation-menu-')),catalogPath=join(dir,'catalog.json');
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const rows=[{id:'explain',kind:'gesture',status:'runtime_candidate',actors:['SHANNY','REV'],contexts:['standing'],bindings:{SHANNY:'s_explain',REV:'r_explain'}},
    {id:'partner',kind:'paired',status:'pending_asset',roles:2}];
  const write=()=>writeFile(catalogPath,JSON.stringify({items:rows}));await write();
  const scope={enabled:true,session_id:'session',epoch:1};
  const menu=new AnimationMenu({catalogPath,getScope:()=>({...scope}),...options});
  return {menu,rows,write,scope};
}
test('catalog metadata alone cannot enable playback; paired entries appear only under Both',async t=>{
  const f=await fixture(t),catalog=await f.menu.menu();
  assert.equal(catalog.items.length,4);
  assert.ok(catalog.items.every(row=>!row.playable&&!('bindings' in row)));
  assert.equal(catalog.items.find(row=>row.id==='partner').target,'BOTH');
  await assert.rejects(f.menu.play({id:'explain',target:'BOTH',context:'Standing',catalogRevision:catalog.revision}),/not available/);
});
test('accepted Both playback submits one synchronized batch with actor bindings and context',async t=>{
  const calls=[],adapter={accepted:true,canPlay:async()=>true,playBatch:async data=>{calls.push(data);return {accepted:true};}};
  const f=await fixture(t,{adapter,now:()=>1000}),catalog=await f.menu.menu();
  await f.menu.play({id:'explain',target:'BOTH',context:'Standing',catalogRevision:catalog.revision});
  assert.equal(calls.length,1);assert.deepEqual(calls[0].targets,['SHANNY','REV']);
  assert.deepEqual(calls[0].bindings,{SHANNY:'s_explain',REV:'r_explain'});
  assert.equal(calls[0].start_at_ms,1100);assert.equal(calls[0].context,'Standing');
  assert.equal(calls[0].epoch,1);
  await assert.rejects(f.menu.play({id:'explain',target:'BOTH',context:'Seated',catalogRevision:catalog.revision}),/not available/);
  f.rows[0].status='rejected_fit';await f.write();
  await assert.rejects(f.menu.play({id:'explain',target:'BOTH',context:'Standing',catalogRevision:catalog.revision}),/not available/);
  assert.equal(calls.length,1);
});
test('Stop aborts pending playback and rejects its late completion',async t=>{
  let release,started,stops=0;
  const adapter={accepted:true,canPlay:async()=>true,playBatch:data=>{started=data;return new Promise(r=>release=r);},stopNow:()=>stops++};
  const f=await fixture(t,{adapter}),catalog=await f.menu.menu();
  const pending=f.menu.play({id:'explain',target:'SHANNY',context:'Standing',catalogRevision:catalog.revision});
  const rejected=assert.rejects(pending,/stopped/);
  while(!started)await new Promise(r=>setImmediate(r));
  f.menu.stop();assert.equal(started.signal.aborted,true);release({accepted:true});await rejected;
  assert.equal(stops,1);
});
test('scope change while checking the player prevents an obsolete animation request',async t=>{
  let mutate=false,plays=0;
  const f=await fixture(t,{adapter:{accepted:true,canPlay:async()=>{if(mutate)f.scope.epoch++;return true;},playBatch:async()=>plays++}});
  const catalog=await f.menu.menu();mutate=true;
  await assert.rejects(f.menu.play({id:'explain',target:'REV',context:'Standing',catalogRevision:catalog.revision}),/Stale/);
  assert.equal(plays,0);
});

test('selected M16 actor bindings are usable without inventing qualification for generic unscoped rows',async t=>{
 const f=await fixture(t,{adapter:{accepted:true,canPlay:async()=>true}});
 f.rows.push({id:'m16_objection',kind:'animation',status:'runtime_candidate',roles:1,contexts:['seated'],bindings:{SHANNY:'m16_objection_SHANNY',REV:'m16_objection_REV'},local_use_authorization:'M16_PRODUCER_SELECTED_20261014'});
 await f.write();let catalog=await f.menu.menu();assert.equal(catalog.items.filter(r=>r.id==='m16_objection'&&r.playable).length,3);
 delete f.rows[2].local_use_authorization;await f.write();catalog=await f.menu.menu();assert.ok(catalog.items.filter(r=>r.id==='m16_objection').every(r=>!r.playable));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {importM16} from '../src/m16-package.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'buff-m16-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const bindings=[],items=[];
 for(const actor of ['SHANNY','REV'])for(const alias of ['conversation','directed_point','objection','open_explanation','quiet_listening','seated_listening']){
  const id=actor+'-'+alias,file=join(root,id+'.json'),bank={id,format:'retargeted_body',source_sha256:'source',duration_seconds:4,rights_cleared:false,contact_qualified:false,roles:[{actor_id:actor,bones:['hip'],frames:[{},{}]}]};
  const bytes=Buffer.from(JSON.stringify(bank)),sha=createHash('sha256').update(bytes).digest('hex');await writeFile(file,bytes);
  bindings.push({actor,alias,motion_id:id,source_sha256:'source',duration_seconds:4,frame_count:2,body_bones:1,motion_bank_file:file,motion_bank_sha256:sha,contact_qualified:false,production_enabled:true,status:'SOURCE_INSTALLED_FOR_NEXT_BUILD'});
  items.push({actor,motion_id:id,motion_bank_sha256:sha,left:.001,right:.002});
 }
 const support_profiles=join(root,'supports.json');await writeFile(support_profiles,JSON.stringify({items}));
 const contractPath=join(root,'contract.json'),contract={schema:'m16-separate-live-consumer-contract-v1',bindings,support_profiles,available_semantics:{crying:{qualified_body:null}}};
 const save=()=>writeFile(contractPath,JSON.stringify(contract));await save();
 return {root,contract,save,contractPath,destination:join(root,'imported')};
}
test('M16 import preserves exact source bytes and qualification flags',async t=>{
 const f=await fixture(t),result=await importM16(f);assert.equal(result.bindings.length,12);assert.equal(result.live_player_validated,false);
 assert.equal(result.available_semantics.crying.qualified_body,null);
 for(let i=0;i<12;i++)assert.deepEqual(await readFile(join(f.destination,result.bindings[i].file)),await readFile(f.contract.bindings[i].motion_bank_file));
});
test('changed or duplicate M16 banks are rejected before creating a destination',async t=>{
 const f=await fixture(t);await writeFile(f.contract.bindings[11].motion_bank_file,'changed');
 await assert.rejects(importM16(f),/checksum/);await assert.rejects(access(f.destination));
 f.contract.bindings[11]=f.contract.bindings[0];await f.save();await assert.rejects(importM16(f),/duplicate/);
});

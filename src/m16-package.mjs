import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

const aliases=['conversation','directed_point','objection','open_explanation','quiet_listening','seated_listening'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=bytes=>JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
/** Build-time import only. Original bank bytes and qualification flags are preserved. */
export async function importM16({contractPath,destination}){
  const contractBytes=await readFile(contractPath),contract=json(contractBytes);
  if(contract.schema!=='m16-separate-live-consumer-contract-v1'||contract.bindings?.length!==12)throw new Error('Expected twelve actor-specific M16 bindings');
  const supports=json(await readFile(contract.support_profiles));
  const seen=new Set(),prepared=[];
  for(const row of contract.bindings){
    const key=row.actor+':'+row.alias;
    if(!['SHANNY','REV'].includes(row.actor)||!aliases.includes(row.alias)||seen.has(key))throw new Error('Invalid or duplicate M16 binding');
    seen.add(key);
    if(row.production_enabled!==true||row.status!=='SOURCE_INSTALLED_FOR_NEXT_BUILD')throw new Error('M16 producer selection is not installed: '+key);
    const bytes=await readFile(row.motion_bank_file);
    if(hash(bytes)!==row.motion_bank_sha256)throw new Error('M16 checksum mismatch: '+key);
    const bank=json(bytes),motion=bank.id===row.motion_id?bank:bank.motions?.find(m=>m.id===row.motion_id);
    if(!motion||motion.source_sha256!==row.source_sha256||motion.format!=='retargeted_body'||motion.roles?.length!==1||motion.roles[0].actor_id!==row.actor)throw new Error('M16 actor/source mismatch: '+key);
    if(motion.roles[0].frames.length!==row.frame_count||motion.roles[0].bones.length!==row.body_bones||Math.abs(motion.duration_seconds-row.duration_seconds)>.001)throw new Error('M16 timing/shape mismatch: '+key);
    if(motion.roles[0].bones.some(b=>/eye|jaw/i.test(b)))throw new Error('M16 bank overlaps face ownership');
    const support=supports.items?.find(s=>s.actor===row.actor&&s.motion_id===row.motion_id);
    if(!support||support.motion_bank_sha256!==row.motion_bank_sha256||![support.left,support.right].every(v=>Number.isFinite(v)&&Math.abs(v)<=.02))throw new Error('M16 support profile mismatch: '+key);
    prepared.push({row,bytes,support});
  }
  // Verify the complete set before writing any replacement asset.
  await mkdir(destination,{recursive:true});
  const bindings=[];
  for(const {row,bytes,support} of prepared){
    const file=row.actor+'-'+row.alias+'.json';await writeFile(join(destination,file),bytes);
    bindings.push({actor:row.actor,alias:row.alias,motion_id:row.motion_id,file,sha256:row.motion_bank_sha256,
      source_sha256:row.source_sha256,duration_seconds:row.duration_seconds,frame_count:row.frame_count,
      arm_clearance_profile:row.arm_clearance_profile,left_sole_adjust_y:support.left,right_sole_adjust_y:support.right,
      contact_qualified:row.contact_qualified,source_status:row.status});
  }
  const manifest={schema:'buff-m16-preload-v1',contract_sha256:hash(contractBytes),bindings,
    available_semantics:contract.available_semantics,ownership:contract.ownership,presentation:contract.presentation,
    live_player_validated:false};
  await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

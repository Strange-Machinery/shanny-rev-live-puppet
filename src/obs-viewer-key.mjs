/** Persist only the OBS viewer key across restarts; never reuse the operator token.
 * File lives under producer scratch/work (never in source control).
 */
import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export function loadOrCreateViewerKey(path) {
  if(typeof path!=='string'||!path.endsWith('.local.json'))
    throw new Error('Private viewer-key path required');
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  let key;
  try{
    const value=JSON.parse(readFileSync(path,'utf8'));
    key=value.key;
  }catch(error){
    if(error.code!=='ENOENT')throw error;
    key=randomBytes(32).toString('hex');
    // Exclusive create. Existing keys must never be silently regenerated.
    writeFileSync(path,JSON.stringify({key})+'\n',{flag:'wx',mode:0o600});
  }
  if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))
    throw new Error('Invalid private OBS viewer key; repair manually');
  return key;
}

import {LIVE_LORE_V2} from './live-lore-catalog.v2.mjs';

const fold=value=>String(value).toLowerCase().normalize('NFKC')
  .replace(/\b([a-z][a-z0-9]+)['’]s\b/g,'$1')
  .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const byId=new Map(), byWord=new Map();
for(const source of LIVE_LORE_V2){
  if(byId.has(source.id))throw Error('Duplicate fast lore id');
  byId.set(source.id,source);
  for(const term of source.terms){
    const phrase=fold(term),first=phrase.split(' ')[0];
    const entries=byWord.get(first)||[];
    entries.push({source,phrase});
    byWord.set(first,entries);
  }
}
export const LIVE_LORE_IDS=Object.freeze([...byId.keys()]);
export const LIVE_LORE_SIZE=byId.size;
function qualified(source,raw,normal){
  if(source.id==='will-dropkick'){
    if(!/\b(?:dropkick|kicked|drop kicked)/i.test(raw))return false;
    if(!/\bwill\b/i.test(raw))return false;
    if(/^will\s+(?:rev|jason|he)\s+(?:dropkick|kick)/i.test(raw))return false;
  }
  if(source.id==='bucket'&&/\b(?:s3|aws|cloud|storage) bucket\b/.test(normal)&&
    !/\b(?:rev|shanny|shit|poop|toilet|dump|empty)\b/.test(normal))return false;
  return true;
}
export function lookupLiveLore(input,{limit=1}={}){
  if(typeof input!=='string'||!input.trim()||input.length>1000)return [];
  if(!Number.isInteger(limit)||limit<0||limit>2)throw Error('Lore lookup limit');
  if(limit===0)return [];
  const normal=fold(input),padded=' '+normal+' ';
  const found=new Map();
  for(const token of new Set(normal.split(' '))){
    for(const item of byWord.get(token)||[]){
      if(!padded.includes(' '+item.phrase+' ')||!qualified(item.source,input,normal))continue;
      const score=item.source.weight+Math.min(item.phrase.length,40);
      if(score>(found.get(item.source.id)?.score??-1))found.set(item.source.id,{source:item.source,score});
    }
  }
  return [...found.values()].sort((a,b)=>b.score-a.score||a.source.id.localeCompare(b.source.id))
    .slice(0,limit).map(v=>({id:v.source.id,label:v.source.name,grievance:v.source.cue}));
}
export function liveLoreStats(){
  return {hooks:byId.size,aliases:[...byWord.values()].reduce((n,v)=>n+v.length,0)};
}

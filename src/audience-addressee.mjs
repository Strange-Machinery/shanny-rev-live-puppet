/**
 * Resolve WHO the viewer addresses, independently of the voice that
 * reads a donation aloud. Merely mentioning a name is not addressing it.
 * No model, network, history, or source file access.
 */
const NAME_PART='(?:ai[_ -]?shanny|shannyforchrist|shanny|shan|ai[_ -]?rev|revelation(?:[ _-]?news)?|reverend|jason|rev|1buffweeb|buffweeb|buff)';
const NAME_RE=new RegExp('\\b'+NAME_PART+'\\b','gi');
const HEAD_NAME=new RegExp('^@?('+NAME_PART+')\\b','i');
const ASK_FOR=new RegExp('^(?:question\\s+for|asking|for|to)\\s+@?('+NAME_PART+')\\s*[:,-]','i');
const TRAILING=new RegExp(',\\s*@?('+NAME_PART+')\\s*[.!?]*\\s*$','i');
const HELLO=/^(?:(?:hey|hi|hello|yo|okay|ok|listen|sup)[\s,!:]+){1,2}/i;
const FOLLOW_WORD=/^(?:why|what|when|where|how|who|whose|which|please|tell|explain|show|give|go|stop|listen|answer|say|think|remember|you|your|youre|you're|dont|don't|let)\b|^(?:can|could|would|will|do|does|did|are|were|have|has|should|shall|may|might)\s+you\b/i;
const DIRECT_PAIR=/^\s*(?:and|&|plus|,)\s*/i;
const COLLECTIVE=/\b(?:you\s+two|you\s+both|both\s+of\s+you|you\s+guys|hey\s+guys|hi\s+guys|to\s+both\s+of\s+you)\b/i;

function actorOf(raw){
 const name=String(raw||'').toLowerCase().replace(/^@/,'').replace(/[\s_-]/g,'');
 if(/^(?:shanny|shan|aishanny|shannyforchrist)$/.test(name))return 'SHANNY';
 if(/^(?:rev|airev|revelation|revelationnews|reverend|jason)$/.test(name))return 'REV';
 if(/^(?:buff|buffweeb|1buffweeb)$/.test(name))return 'BUFF';
 return null;
}
function isAddressTail(tail){
 if(/^\s*[,!:?]/.test(tail))return true;
 const text=tail.trimStart();
 return !text||FOLLOW_WORD.test(text);
}
function mentionList(text){
 const actors=[];
 for(const match of text.matchAll(NAME_RE)){
  const actor=actorOf(match[0]);
  if(actor&&!actors.includes(actor))actors.push(actor);
 }
 return actors;
}
export function identifyAudienceAddressee(text){
 if(typeof text!=='string'||!text.trim()||text.length>1000)
  return {target:'UNSPECIFIED',basis:'none',mentioned:[]};
 const message=text.trim(),mentioned=mentionList(message);
 const head=message.replace(HELLO,'').trimStart();
 const requested=ASK_FOR.exec(head);
 if(requested){
  return {target:actorOf(requested[1])||'UNSPECIFIED',basis:'named-request',mentioned};
 }
 const start=HEAD_NAME.exec(head);
 if(start){
  const primary=actorOf(start[1]),tail=head.slice(start[0].length);
  const pair=DIRECT_PAIR.exec(tail);
  if(pair){
   const suffix=tail.slice(pair[0].length),second=HEAD_NAME.exec(suffix);
   if(second){
    const other=actorOf(second[1]);
    if(['SHANNY','REV'].includes(primary)&&
       ['SHANNY','REV'].includes(other)&&other!==primary&&
       isAddressTail(suffix.slice(second[0].length)))
      return {target:'BOTH',basis:'dual-vocative',mentioned};
   }
  }
  if(isAddressTail(tail))
   return {target:primary||'UNSPECIFIED',basis:'direct-vocative',mentioned};
 }
 const ending=TRAILING.exec(message);
 if(ending)return {target:actorOf(ending[1])||'UNSPECIFIED',basis:'trailing-vocative',mentioned};
 if(COLLECTIVE.test(message))
  return {target:'BOTH',basis:'collective',mentioned};
 return {target:'UNSPECIFIED',basis:'none',mentioned};
}
export function audienceReplyContract(address,kind='donation',reader=null){
 const target=address?.target||'UNSPECIFIED';
 const read=kind==='donation'&&['SHANNY','REV'].includes(reader)
  ?'The stage reader is '+reader+'; READING the viewer message does not mean the viewer addressed that character. ':'';
 if(target==='SHANNY')return read+
  'The viewer speaks TO SHANNY, not Rev. Viewer "you" means SHANNY. SHANNY must answer first. REV responds to SHANNY or defends himself against something Shanny actually says about him; REV must NOT speak as if the viewer directly accused or commanded him.';
 if(target==='REV')return read+
  'The viewer speaks TO REV, not Shanny. Viewer "you" means REV. REV must answer first. SHANNY responds to REV or challenges his reaction; SHANNY must NOT speak as if the viewer directly accused or commanded her.';
 if(target==='BOTH')return read+
  'The viewer speaks TO BOTH SHANNY and REV. Each may answer the viewer, but then react to what the other character actually said.';
 if(target==='BUFF')return read+
  'The viewer addresses BUFF the host, neither SHANNY nor REV. The characters may comment on Buff or argue with each other, but must NOT claim the viewer addressed them directly.';
 return read+
  'No single character is explicitly addressed. React to the actual viewer remark without inventing a personal summons to either character.';
}

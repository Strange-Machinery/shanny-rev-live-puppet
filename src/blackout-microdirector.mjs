/**
 * Blackout Microdirector: a tiny, deterministic contextual cue router.
 *
 * NOT a second LLM. Not a LoreGraph import. The producer's private character
 * notes remain the authority for unresolved or sensitive lore.
 * Trigger evidence is REQUIRED from the current audience input; an old memory
 * must never take over a new donation. Source/corpus phrases are NOT examples
 * to parrot verbatim.
 */
const HOOKS=Object.freeze([
 Object.freeze({
   id:'bucket',label:'the bucket',
   trigger:/\bbucket\b|\bshitbucket\b|\b(?:toilet|bathroom)\b.{0,40}\b(?:broken|walk|clean|empty|fix|years)\b|\b(?:walk|clean|empty)\b.{0,40}\b(?:toilet|bathroom)\b/i,
   grievance:'Rev resents repeatedly emptying the bucket after the hotel toilet broke; he sees avoidable labor, while Shanny disputes his blame about walking. These are their arguments, not verified adjudications.'
 }),
 Object.freeze({
   id:'ezzie',label:'Ezzie',
   trigger:/\bezzie\b|\bsext(?:ed|ing|s)?\b|\b(?:secret|hidden)\s+(?:text|message|flirt)/i,
   grievance:'Shanny is hurt by the allegation of Rev messaging Ezzie beside her and then minimizing it. Rev becomes guarded and defensive. Preserve Ezzie spelling and attribute disputed events as character claims.'
 }),
 Object.freeze({
   id:'baby-carrot',label:'baby carrot',
   trigger:/\bbaby[ -]?carrot\b|\bcarrot\b/i,
   grievance:'Baby Carrot is an embarrassing nickname aimed at Rev. He resents being publicly mocked; Shanny may bring it up as leverage. The nickname\'s exact origin is not established.'
 }),
 Object.freeze({
   id:'congealed',label:'congealed',
   trigger:/\bcongeal(?:ed|ing|s)?\b/i,
   grievance:'Congealed is a recognized callback phrase, but NO verified specific incident or grievance is available here. Do not invent the missing story; rely on supplied producer notes or the comment itself.'
 })
]);
export const CANON_HOOK_IDS=Object.freeze(HOOKS.map(row=>row.id));
export function selectGrievanceHooks(text,{limit=1}={}){
 if(typeof text!=='string'||!text.trim()||text.length>1000)return [];
 if(!Number.isInteger(limit)||limit<0||limit>2)throw new Error('Invalid contextual lore budget');
 return HOOKS.filter(row=>row.trigger.test(text)).slice(0,limit).map(row=>Object.freeze({
   id:row.id,label:row.label,grievance:row.grievance
 }));
}
export function echoFlags(notes='',examples=[],history=[]){
 // Only coarse flags leave the private producer process. No notes or raw
 // examples are written to logs or emitted to OBS.
 const samples=[String(notes),...examples.map(x=>JSON.stringify(x)),...history.map(x=>String(x.text||''))];
 return {
   old_notes_contain_no_means_no:samples.slice(0,1).some(v=>/\bno\s+means\s+no\b/i.test(v)),
   old_notes_contain_bread:samples.slice(0,1).some(v=>/\b(?:moldy\s+)?bread\b/i.test(v)),
   legacy_examples_contain_bread_or_refusal:samples.slice(1,-history.length||undefined).some(v=>/\b(?:moldy\s+)?bread\b|\bno\s+means\s+no\b/i.test(v)),
   recent_spoken_echo:history.slice(-4).some(v=>/\b(?:moldy\s+)?bread\b|\bno\s+means\s+no\b/i.test(String(v.text||''))
 };
}
export function makeMicroInput({text,kind,history=[],hinges=[]}){
 const hooks=selectGrievanceHooks(text);
 const recent=history.slice(-4).map(row=>({actor:row.actor,text:String(row.text||'').slice(0,160)}));
 const prior=Array.isArray(hinges)?hinges.slice(-2).filter(v=>typeof v==='string').map(v=>v.slice(0,160)):[];
 return {kind,input:text,contextual_grievance_hooks:hooks,
   recent_played_lines:recent,
   recent_causes:prior};
}

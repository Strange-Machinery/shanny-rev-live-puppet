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
   trigger:/\bbucket\b|\bshitbucket\b|\b(?:toilet|bathroom)\b.{0,48}\b(?:broken|walk\w*|clean\w*|empty|fix\w*|years)\b|\b(?:broken|walk\w*|clean\w*|empty|fix\w*)\b.{0,48}\b(?:toilet|bathroom)\b/i,
   grievance:'Rev resents repeatedly emptying the bucket after the hotel toilet broke; he sees avoidable labor, while Shanny disputes his blame about walking. These are their arguments, not verified adjudications.'
 }),
 Object.freeze({
   id:'ezzie',label:'Ezzie',
   trigger:/\b(?:ezzie|ezzy)\b/i,
   grievance:'Shanny is hurt by the allegation of Rev messaging Ezzie beside her and then minimizing it. Rev becomes guarded and defensive. Preserve Ezzie spelling and attribute disputed events as character claims.'
 }),
 Object.freeze({
   id:'baby-carrot',label:'baby carrot',
   trigger:/\bbaby[ -]?carrot\b|\bcarrot\b.{0,24}\b(?:nickname|name|tease|mock|size)\b/i,
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
const FOOD_THEME=/\b(?:bread|crust|sandwich(?:es)?|ingredients?|recipes?|flour|dough|toast|baking|bake|cookies?|pizza|burgers?|fries|ramen|kitchen|cooking|cheese|potatoes?|soup|lunch|dinner|breakfast|hungry|meal|food)\b/i;
const REFUSAL_SLOGAN=/\bno\s+means\s+no\b/i;

// Only the AUDIENCE'S subject authorizes a carryover. Old Qwen wording is
// never permitted to select its own next topic.
const UNINFORMATIVE_WORDS=new Set([
 'about','again','already','also','another','are','because','been','before',
 'being','both','buff','chat','compare','could','describe','did','discuss',
 'does','donation','donate','donated','each','either','even','every','explain',
 'explanation','from','have','here','how','into','just','keep','last','like',
 'make','made','mean','money','more','much','must','need','never',
 'only','opinion','other','over','people','please','question','really','rev',
 'said','say','says','shanny','should','show','some','someone','still','stank',
 'stream','tell',
 'than','that','them','then','there','these','they','thing','things','this',
 'those','time','today','very','want','what','when','where','which','while',
 'who','why','will','with','would','you','your','youre','yours'
]);
function subjectTerms(text) {
 if(typeof text!=='string')return new Set();
 return new Set((text.toLowerCase().match(/[a-z][a-z0-9'-]{3,}/g)||[])
   .map(x=>x.replace(/'/g,''))
   .filter(x=>!UNINFORMATIVE_WORDS.has(x)));
}
export function isSameLiveSubject(current,previous) {
 const now=subjectTerms(current),old=subjectTerms(previous);
 return [...now].some(x=>old.has(x));
}
const EXPLICIT_FOLLOW_UP=/\b(?:you\s+just\s+said|you\s+said\s+earlier|that\s+last\s+(?:comment|donation)|earlier\s+(?:comment|donation)|continue\s+(?:that|this)|go\s+on\s+about\s+that|back\s+to\s+what\s+you\s+said)\b/i;
const CONSENT_TOPIC=/\b(?:consent|permission|refus(?:e|al|ed)|boundar(?:y|ies)|touch|respect)\b/i;
function isGroundedOldLine(line,oldInput,newInput) {
 const spoken=String(line||'');
 if(FOOD_THEME.test(spoken)&&!FOOD_THEME.test(oldInput)&&!FOOD_THEME.test(newInput))
   return false;
 if(REFUSAL_SLOGAN.test(spoken)&&!CONSENT_TOPIC.test(oldInput)&&
    !CONSENT_TOPIC.test(newInput)&&!REFUSAL_SLOGAN.test(newInput))
   return false;
 return true;
}
export function echoFlags(notes='',examples=[],history=[]) {
 // Report only coarse category flags, never the actual private notes or
 // examples, credentials, saved prompt names or spoken text.
 const inputNotes=String(notes);
 const inputExamples=Array.isArray(examples)?examples.map(x=>JSON.stringify(x)).join('\n'):'';
 const recent=Array.isArray(history)?history.slice(-4).map(x=>String(x?.text||'')).join('\n'):'';
 return {
   old_notes_contain_no_means_no:REFUSAL_SLOGAN.test(inputNotes),
   old_notes_contain_bread:/\b(?:moldy\s+)?bread\b/i.test(inputNotes),
   legacy_examples_contain_bread_or_refusal:FOOD_THEME.test(inputExamples)||REFUSAL_SLOGAN.test(inputExamples),
   recent_spoken_echo:FOOD_THEME.test(recent)||REFUSAL_SLOGAN.test(recent),
   old_notes_contain_food_theme:FOOD_THEME.test(inputNotes),
   legacy_examples_contain_food_theme:FOOD_THEME.test(inputExamples),
   recent_spoken_food_echo:FOOD_THEME.test(recent)
 };
}
export function makeMicroInput({text,kind,history=[],hinges=[]}) {
 const hooks=selectGrievanceHooks(text);
 const played=Array.isArray(history)?history:[];
 const previous=played.at(-1);
 const previousInput=typeof previous?.input==='string'?previous.input:'';
 // A new donation is an independent interaction unless its speaker actually
 // returns to the last SUBJECT. Never infer topic from Qwen's prior output.
 const related=previousInput.length>0&&
   (isSameLiveSubject(text,previousInput)||EXPLICIT_FOLLOW_UP.test(text));
 const recent=related?played.filter(x=>x&&x.input===previousInput&&
    ['SHANNY','REV'].includes(x.actor)&&
    isGroundedOldLine(x.text,previousInput,text))
   .slice(-2).map(x=>({actor:x.actor,text:String(x.text).slice(0,320)})):[];
 const prior=related&&Array.isArray(hinges)?hinges
   .filter(x=>x&&typeof x==='object'&&x.input===previousInput&&
      typeof x.text==='string'&&isGroundedOldLine(x.text,previousInput,text))
   .slice(-1).map(x=>x.text.slice(0,160)):[];
 return {kind,input:text,contextual_grievance_hooks:hooks,
   recent_played_lines:recent,recent_causes:prior};
}

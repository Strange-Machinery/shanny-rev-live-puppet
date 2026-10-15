/**
 * Conservative fast-live subset of the approved episode voice category catalog.
 * The actor-specific reference IDs are NOT invented here: the installed episode
 * expanded/catalog.json must authorize the requested category at runtime.
 * An unavailable category is excluded before Qwen is shown any choices.
 * This module never manipulates fundamental pitch, speed or accent.
 */
export const EPISODE_VOICE_LABELS=Object.freeze({
 SHANNY:Object.freeze({
   S05:'angry crying; real grievance, not theatrical fake sobbing',
   S06:'full rage; immediate severe provocation only',
   S07:'low surly challenge; terse resentment, restrained volume',
   S08:'ordinary irritation; grumbling, not shouting',
   S09:'admonishing correction; deliberate precision and stress',
   S10:'smug cutting; mocking and dismissive',
   S11:'disgust contempt; quietly disdainful',
   S20:'low energy rage; controlled hostility under pressure'
 }),
 REV:Object.freeze({
   R01:'explaining matter of fact; only if genuinely clarifying',
   R09:'guarded anxious defensiveness; cautious resistance',
   R10:'ordinary irritation; exhausted pushback',
   R11:'mockery taunting; earned cutting insult',
   R12:'low controlled anger; deliberate disagreement',
   R13:'loud anger rage; severe earned loss of patience',
   R14:'firm correction boundaries; explicit refusal',
   R20:'disgust contempt; scorn, not constant shouting'
 })
});
export const requestedEpisodeCodes=Object.freeze(Object.fromEntries(
 Object.entries(EPISODE_VOICE_LABELS).map(([actor,labels])=>[actor,Object.keys(labels)])
));
export function verifyEpisodeCode(actor,code){
 return typeof code==='string'&&Object.hasOwn(EPISODE_VOICE_LABELS[actor]||{},code);
}
export function availableEpisodeCodes(codes){
 const result={};
 if(!codes||typeof codes!=='object'||Array.isArray(codes))return result;
 for(const actor of ['SHANNY','REV']){
   const candidates=codes[actor];
   if(!Array.isArray(candidates))continue;
   const kept=[...new Set(candidates.filter(code=>verifyEpisodeCode(actor,code)))];
   if(kept.length)result[actor]=kept;
 }
 return result;
}
export function guideForEpisodeCodes(codes){
 const available=availableEpisodeCodes(codes);
 return Object.entries(available).map(([actor,keys])=>
   actor+': '+keys.map(code=>code+' = '+EPISODE_VOICE_LABELS[actor][code]).join('; ')
 ).join('\n');
}

/**
 * Episode-qualified OmniVoice categories. All 20 Shanny and 23 Rev modes are
 * addressable; the resident worker advertises ONLY ones verified in the actual
 * local approved episode reference catalog. Never synthesize a pitch variant.
 */
export const EPISODE_VOICE_LABELS=Object.freeze({
 SHANNY:Object.freeze({
  S01:'almost crying; defensive hurt, barely contained',
  S02:'whiny moping; small grievances and self-pity',
  S03:'sobbing lament; audible grieving after a real loss',
  S04:'defensive crying; tears while still arguing back',
  S05:'angry crying; tears sharpen a genuine grievance',
  S06:'full rage; immediate nuclear reaction to extreme provocation',
  S07:'low surly challenge; controlled refusal and suspicion',
  S08:'ordinary irritation; muttering and everyday aggravation',
  S09:'admonishing correction; pointed, deliberate and precise',
  S10:'smug cutting; taunting through superiority',
  S11:'disgust contempt; distaste and cold scorn',
  S12:'disbelief surprise; a genuine shock',
  S13:'anxious pleading; fearful or urgent request',
  S14:'quiet sadness resignation; spent, low-energy sorrow',
  S15:'warmth affection; earned tenderness, rare in blackout',
  S16:'amusement playfulness; earned joke or delight',
  S17:'enthusiasm pride; real accomplishment',
  S18:'curiosity confusion; sincerely puzzled',
  S19:'apology backing down; reluctant acknowledgment, not automatic',
  S20:'low energy rage; bitter hostility without shouting'
 }),
 REV:Object.freeze({
  R01:'explaining matter of fact; concrete information',
  R02:'animated astounded; sudden sincere astonishment',
  R03:'reassuring comforting; responsive earned care',
  R04:'distressed pleading; frightened appeal',
  R05:'warmth affection; rare genuine softness',
  R06:'amusement playfulness; his own humor',
  R07:'enthusiasm pride; spontaneous excitement',
  R08:'curiosity confusion; puzzled questioning',
  R09:'guarded anxious defensiveness; careful counterargument',
  R10:'ordinary irritation; weary annoyance',
  R11:'mockery taunting; cutting ridicule',
  R12:'low controlled anger; quiet intentional anger',
  R13:'loud anger rage; explosive rage after serious injury',
  R14:'firm correction boundaries; clear pushback',
  R15:'whiny frustrated complaints; resentful grumbling',
  R16:'quiet sadness resignation; deflated retreat',
  R17:'tearful hurt crying; genuine injury',
  R18:'angry crying; injured resentment',
  R19:'apology softening; earned repair without surrender',
  R20:'disgust contempt; disapproval',
  R21:'smug self satisfied; knowing smugness',
  R22:'reluctant agreement; conceding a point unwillingly',
  R23:'surprise disbelief; incredulous reaction'
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
// A zero-model, sub-millisecond shortlist. All 43 reviewed categories remain
// reachable for motivated contexts while a two-sentence exchange exposes only
// a few codes to tiny Qwen. A category absent from the catalog stays absent.
const CORE=Object.freeze({
 SHANNY:['S07','S08','S10','S20'],
 REV:['R09','R10','R11','R12']
});
const CONDITIONS=Object.freeze([
 {test:/\b(?:cry\w*|tear\w*|sob\w*|hurt\w*|betray\w*|heartbreak\w*|grief|sad|mourn\w*)\b/i,
  SHANNY:['S01','S03','S04','S05','S14'],REV:['R04','R17','R18','R16']},
 {test:/\b(?:whin\w*|moan\w*|complain\w*|pout\w*|mop\w*)\b/i,
  SHANNY:['S02'],REV:['R15']},
 {test:/\b(?:please|beg\w*|plead\w*|help|scared|frightened)\b/i,
  SHANNY:['S13'],REV:['R04']},
 {test:/\b(?:furious|rage|enraged|humiliat\w*|betray\w*|cheat\w*|screaming|threatened)\b/i,
  SHANNY:['S06','S05'],REV:['R13','R12']},
 {test:/\b(?:what|why|really|serious\w*|believ\w*|impossible|surpris\w*|shocked|unexpected|confus\w*)\b/i,
  SHANNY:['S12','S18'],REV:['R02','R08','R23']},
 {test:/\b(?:love|miss|dear|care|thank\w*|appreciat\w*|support\w*|hug|forgiv\w*)\b/i,
  SHANNY:['S15','S19'],REV:['R03','R05','R19','R22']},
 {test:/\b(?:funny|laugh\w*|jok\w*|haha|roast\w*|prank\w*|proud|winning|congrat\w*)\b/i,
  SHANNY:['S16','S17'],REV:['R06','R07','R21']},
 {test:/\b(?:sorry|apolog\w*|forgiv\w*|wrong|back.down)\b/i,
  SHANNY:['S19'],REV:['R19','R22']},
 {test:/\b(?:disgust\w*|nasty|gross|filthy|mold\w*|congeal\w*|dirty)\b/i,
  SHANNY:['S11'],REV:['R20']},
 {test:/\b(?:smug|superior|better|prove|mock\w*|taunt\w*|show.off)\b/i,
  SHANNY:['S10'],REV:['R21','R11']},
 {test:/\b(?:stop|refus\w*|rule|permission|boundar\w*|respect|obey|must)\b/i,
  SHANNY:['S09'],REV:['R14']},
 {test:/\b(?:quiet|whisper\w*|sigh\w*|tired|exhaust\w*|resign\w*|softly)\b/i,
  SHANNY:['S14','S20'],REV:['R16','R12']},
 {test:/\b(?:explain\w*|fact\w*|reason\w*|evidence|details)\b/i,
  SHANNY:['S09','S18'],REV:['R01']}
]);
export function shortlistEpisodeCodes(codes,context='',{maxPerActor=10}={}){
 if(!Number.isInteger(maxPerActor)||maxPerActor<2||maxPerActor>24)throw Error('Invalid episode voice menu limit');
 const active=availableEpisodeCodes(codes);
 const text=String(context).slice(0,1500);
 const result={};
 for(const actor of ['SHANNY','REV']){
  const pool=new Set(active[actor]||[]);
  if(!pool.size)continue;
  const selected=[];
  const add=code=>{if(pool.has(code)&&!selected.includes(code)&&selected.length<maxPerActor)selected.push(code)};
  // Topic-matched categories outrank generic defaults, but never duplicate.
  for(const condition of CONDITIONS)if(condition.test.test(text))
   for(const code of condition[actor])add(code);
  for(const code of CORE[actor])add(code);
  // No keyword bag inflation: the Qwen menu is small even if every emotion
  // cue appears in a hostile untrusted donor message.
  if(selected.length<2)for(const code of active[actor])add(code);
  result[actor]=selected;
 }
 return result;
}
export function guideForEpisodeCodes(codes){
 const active=availableEpisodeCodes(codes);
 return Object.entries(active).map(([actor,keys])=>
  actor+': '+keys.map(code=>code+'='+EPISODE_VOICE_LABELS[actor][code]).join('; ')
 ).join('\n');
}

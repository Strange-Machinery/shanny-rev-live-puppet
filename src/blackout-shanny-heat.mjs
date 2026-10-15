/**
 * Zero-model, per-audience-message BLACKOUT_SHANNY performance steering.
 * Adapted from the episode writer's producer_performance.BLACKOUT treatment.
 *
 * 65% is an artistic TARGET for overtly hot lines on ordinary inputs, not an
 * absolute quota, anger measurement, medical concept or forced swear count.
 * Serious direct provocation can override the baseline; genuine relief or
 * affection can still motivate an exception in the one Qwen writing pass.
 *
 * No stale lore/food examples, model call, GPU, filesystem or wall-clock RNG.
 */
import {createHash} from 'node:crypto';

const HOT=/\b(?:fuck\s+(?:you|off)|liar|lies|lying|lie\s+to|hypocrit\w*|betray\w*|cheat\w*|scam\w*|manipulat\w*|humiliat\w*|mock\w*|disgusting|gross|filthy|shut\s+up|worthless|fraud|bully\w*|ruin\w*|blam\w*|owe\w*|deserv\w*|wrong|theft|stol\w*|stole|neglect\w*)\b/i;
const DIRECTIVE=/\b(?:you\s+(?:must|better|need\s+to|have\s+to)|go\s+(?:do|dump|clean)|shut\s+up|obey|explain\s+yourself|apologize\s+now|answer\s+me)\b/i;
const TENDER=/\b(?:i\s+love\s+you|we\s+love\s+you|you\s+did\s+great|hope\s+you\s+feel\s+better|sorry\s+you\s+are\s+hurting|thank\s+you\s+for\s+helping|we\s+support\s+you)\b/i;
const LANES=Object.freeze([
 Object.freeze({name:'direct_attack',share:0.39,voiceHint:'low surly anger challenge',intention:'Attack the actual imposition or insulting wording if present, defend dignity and press the concrete grievance. If no insult was made, object to being put on display instead of inventing one. A directed fuck you requires a real affront, never a quota.'}),
 Object.freeze({name:'disgust_contempt',share:0.22,voiceHint:'disgust contempt',intention:'Treat the current accusation or demand as revolting and beneath her. Use specific disgust and biting disdain aimed at what was actually said, not random filth or body imagery.'}),
 Object.freeze({name:'wounded_victim',share:0.21,voiceHint:'crying defensive hurt',intention:'Self-victimize from the present slight: turn the actual demand into proof she is used, unheard or blamed. Her tears are still an accusation; Rev can correct the logic without becoming a comfort machine.'}),
 Object.freeze({name:'insular_crying',share:0.18,voiceHint:'sobbing sadness crying',intention:'Withdraw inward into tearful self-pity about what the current remark implies for her own suffering; make the grievance legible. She can cry while blaming Rev or chat. No invented past trauma or compulsory forgiveness.'}),
]);
const LOW=Object.freeze({name:'contained_blackout',voiceHint:'quiet surly anger resignation',intention:'Stay recognizably Blackout: sulky, weary, acidly suspicious or bleakly wounded, rather than generic friendly customer service. A practical or affectionate remark can still receive a genuine change of mood.'});
const digestFraction=(hash,offset)=>hash.readUInt32BE(offset)/4294967296;
export function chooseBlackoutShanny({text,address={target:'UNSPECIFIED'},hooks=[],kind='donation'}={}){
 if(typeof text!=='string'||!text.trim()||text.length>1000||
   !['donation','microphone'].includes(kind))
   throw Error('Invalid Blackout Shanny stimulus');
 const target=address?.target||'UNSPECIFIED';
 const hookIds=Array.isArray(hooks)?hooks.map(x=>x?.id).filter(x=>typeof x==='string').slice(0,2):[];
 const hash=createHash('sha256').update('shanny-blackout-v1\0'+text.trim().toLowerCase()+'\0'+target+'\0'+kind).digest();
 const overtPressure=digestFraction(hash,0);
 const direct=target==='SHANNY',named=address?.mentioned?.includes('SHANNY');
 const intenseTrigger=HOT.test(text)&&(direct||named);
 const loadedHook=hookIds.length>0;
 const coercive=direct&&DIRECTIVE.test(text);
 const earnedPressure=intenseTrigger||coercive;
 // A wholly affectionate viewer remark can be accepted as affection; if she
 // still distrusts it, write a reason from that remark, not a new incident.
 const isTender=TENDER.test(text)&&!earnedPressure&&!loadedHook;
 const heated=earnedPressure||(!isTender&&overtPressure<0.65);
 const phase=digestFraction(hash,4);
 let lane=LOW;
 if(heated){
  let at=0;
  for(const option of LANES){at+=option.share;if(phase<at){lane=option;break;}}
 }
 const voiceHint=lane.name==='direct_attack'&&earnedPressure?'furious anger rage':lane.voiceHint;
 const source=direct?'the viewer addresses Shanny':target==='REV'?'the viewer addresses Rev':
  target==='BUFF'?'the viewer addresses Buff':target==='BOTH'?'the viewer addresses both':'the viewer makes a general remark';
 const reference=loadedHook?'the current matched lore hook, only if its grievance actually applies':'the current audience remark only';
 const why=earnedPressure?'there is a directed insult or coercive demand':
  heated?'the unwanted performance and audience scrutiny give her plausible friction':
  isTender?'the audience expresses care that may legitimately lower her guard':
  'the immediate subject supports restrained bitterness or melancholy';
 return {
  regime:heated?'HIGH_PRESSURE':'CONTAINED',
  emotional_lane:lane.name,
  voice_hint:voiceHint,
  acting_objective:lane.intention,
  moment_reason:why,
  addressed_context:source,
  evidence_scope:reference,
  // This is a steering decision for the next single writer call, NOT the
  // outcome. Qwen may soften/escalate if the actual exchange earns it.
  pressure_target:0.65,
  can_change_during_exchange:true
 };
}

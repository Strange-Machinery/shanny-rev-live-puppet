import {actorMoods,liveMood} from './live-moods.mjs';
import {verifyEpisodeCode} from './approved-delivery.mjs';
import {sampleLedShannyInput} from './dyad/sample-led-voice.mjs';

// GOLD already chooses these moods. Voice routing needs no additional writer,
// prompt, lore lookup or emotion classifier. The worker chooses the recording.
export const voiceDyadLiteCodes=Object.freeze({
  SHANNY:Object.freeze({anger:'S06',rage:'S06',crying:'S04',smug:'S10',surprised:'S12'}),
  REV:Object.freeze({pacifying:'R03',irritated:'R10',rage:'R13',skeptical:'R09',surprised:'R23'})
});

/** Provider input only: do not replace authored session/history/caption rows. */
export function voiceDyadLiteInput(input,available){
  if(!input||!Object.hasOwn(actorMoods,input.actor))throw Error('Unknown voice-dyad-lite actor');
  const {actor,mood,voiceCode}=input;
  if(typeof input.text!=='string'||!input.text.trim())throw Error('Voice-dyad-lite needs spoken text');
  if(mood!==undefined)liveMood(actor,mood);
  const qualified=code=>verifyEpisodeCode(actor,code)&&available?.[actor]?.includes(code)===true;
  if(voiceCode!==undefined&&!qualified(voiceCode))throw Error('Unqualified explicit voice-dyad-lite delivery');
  const result=sampleLedShannyInput(input,available);
  // Preserve explicit qualified direction except that rage must use full rage.
  if(actor==='REV'&&mood==='rage')result.voiceCode='R13';
  else if(result.voiceCode===undefined&&mood!==undefined)result.voiceCode=voiceDyadLiteCodes[actor][mood];
  if(result.voiceCode!==undefined&&!qualified(result.voiceCode))
    throw Error('Required voice-dyad-lite recording category unavailable: '+actor+'/'+result.voiceCode);
  // Untagged provider warmup keeps its configured saved reference. Normal
  // gateway requests already receive the gateway's existing default mood.
  return result;
}

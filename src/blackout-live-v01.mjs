/**
 * BLACKOUT_LIVE v0.1: a tiny, remote-only acting arc for the existing
 * Microdirector. It consumes its already chosen Shanny emotional lane and
 * actor order. No new classifier, memory, model pass, sampling or voice rules.
 *
 * Only the V620 completion receives these extra directions. The original
 * messages remain untouched for the warm MSI fallback and manual MSI mode.
 */
const PIVOTS = Object.freeze({
  direct_attack:'Let a specific counterargument reveal defensive pride or an earned sense of injustice; never automatic tears.',
  disgust_contempt:'Let a specific challenge crack contempt into justified defensiveness or sharper disdain.',
  wounded_victim:'If challenged, let self-pity sharpen into a concrete accusation or a brief inward retreat.',
  insular_crying:'Keep the inward grievance legible; respond to an actual rebuttal instead of resetting to loud rage.',
  contained_blackout:'Let restrained bitterness sharpen or soften only if the other character changes the stakes.'
});
const INSTRUCTION =
  'BLACKOUT_LIVE v0.1 (V620 acting direction only): follow the concise blackout_live_v01 beats as CAUSAL objectives, not dialogue to recite. The first line answers the actual viewer topic; each later line must react to something the previous speaker actually said. Preserve the named speaker slots, voice qualifications and topic rules above. Prefer two speaking turns; an optional third is earned, never compulsory. Do not mechanically force rage, crying, concessions or invented history.';

export function planBlackoutLiveV01(turn){
  const first=turn?.first_speaker, second=turn?.second_speaker;
  const lane=turn?.shanny_blackout?.emotional_lane;
  if(!['donation','microphone'].includes(turn?.kind) ||
     typeof turn?.input!=='string'||!turn.input.trim()||turn.input.length>1000||
     !['SHANNY','REV'].includes(first)||
     second!==(first==='SHANNY'?'REV':'SHANNY')||
     !Object.hasOwn(PIVOTS,lane)||
     !['HIGH_PRESSURE','CONTAINED'].includes(turn?.shanny_blackout?.regime))
    throw Error('Invalid BLACKOUT_LIVE director input');
  const shannyFirst=first==='SHANNY';
  return {
    version:'blackout_live_v01',
    beats:[
      {slot:'first_'+first,objective:shannyFirst?
        'Shanny addresses the viewer and makes one contestable point about this exact remark, in her already selected Blackout lane.':
        'Rev addresses the viewer himself with a specific defense, challenge or concession; he is not Shanny\'s narrator.'},
      {slot:'second_'+second,objective:shannyFirst?
        'Rev reacts to Shanny\'s actual claim with his own stake. He may dispute, needle, partially agree or support, but never just echo her mood.':
        'Shanny reacts to Rev\'s actual claim using her already selected Blackout lane; she was not necessarily addressed by the viewer.'},
      {slot:'third_'+first,optional:true,objective:shannyFirst?
        'Only if Rev changes the emotional stakes, Shanny answers his specific point. '+PIVOTS[lane]:
        'Only if Shanny changes the stakes, Rev answers her specific rebuttal with his own agency; no generic closing insult.'}
    ]
  };
}

/** Pure prompt decoration. Non-JSON startup warmup is passed through exactly. */
export function decorateBlackoutLiveV01(messages){
  if(!Array.isArray(messages)||messages.length!==2||
     messages[0]?.role!=='system'||messages[1]?.role!=='user'||
     typeof messages[0].content!=='string'||typeof messages[1].content!=='string')
    throw Error('Invalid BLACKOUT_LIVE request messages');
  let turn;
  try{turn=JSON.parse(messages[1].content);}
  catch{return messages;} // Existing silent {"ready":true} warmup prompt.
  if(turn?.kind!=='donation'&&turn?.kind!=='microphone')return messages;
  if(Object.hasOwn(turn,'blackout_live_v01'))
    throw Error('BLACKOUT_LIVE direction already present');
  const result=[
    {...messages[0],content:messages[0].content+'\n'+INSTRUCTION},
    {...messages[1],content:JSON.stringify({...turn,blackout_live_v01:planBlackoutLiveV01(turn)})}
  ];
  if(JSON.stringify(result).length>12000)throw Error('BLACKOUT_LIVE prompt budget exceeded');
  return result;
}

export function withBlackoutLiveV01(complete){
  if(typeof complete!=='function')throw Error('Invalid BLACKOUT_LIVE completion');
  return args=>{
    args?.signal?.throwIfAborted();
    return complete({...args,messages:decorateBlackoutLiveV01(args?.messages)});
  };
}

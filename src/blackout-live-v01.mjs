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
  'BLACKOUT_LIVE v0.1: Buff is the offstage HOST, never a speaking Shanny/Rev character. ' +
  'The viewer message has already been read; DO NOT parrot its names, individual words or wording as dialogue. ' +
  'If blackout_live_v01.relay exists, the viewer asked Buff to pass an onstage request to the named actor. ' +
  'Have the characters react to its actual meaning, not pretend they are Buff. ' +
  'Make one coherent claim, an answer to that claim, and only an earned optional return. ' +
  'Do not chant, repeat short phrases, invent events, or force rage/tears. Keep all original speaker, voice and topic rules.';

/** Only a clear viewer-to-host relay. No free-form semantic classifier. */
export function detectBlackoutLiveRelay(input, audienceTarget='UNSPECIFIED') {
  if(audienceTarget!=='BUFF' || typeof input!=='string')return null;
  const text=input.trim();
  const match=/^(?:hey[,!\s]+)?@?(?:1buffweeb|buffweeb|buff)\s*[,!:]?\s*(?:(?:please|could you|can you)\s+)?(?:tell|ask|remind)\s+@?(rev|jason|shanny|shan)\b/i.exec(text);
  if(!match)return null;
  const recipient=/^(?:rev|jason)$/i.test(match[1])?'REV':'SHANNY';
  const requested=text.slice(match[0].length);
  const turnTaking=/\b(?:let|allow)\s+(?:shanny|shan|rev|jason|her|him)\s+(?:finish|talk|speak)\b/i.test(requested)||
    /\b(?:finish|complete)\s+(?:(?:her|his|their|the)\s+)?(?:sentence|point|thought)\b/i.test(requested)||
    /\b(?:stop|quit)\s+(?:constantly\s+)?interrupt(?:ing)?\b/i.test(requested);
  const beneficiary=/\b(?:shanny|shan)\b/i.test(requested)&&recipient!=='SHANNY'?'SHANNY':
    /\b(?:rev|jason)\b/i.test(requested)&&recipient!=='REV'?'REV':null;
  return {kind:'host_relay',recipient,
    goal:turnTaking?'give_other_actor_room_to_speak':'address_viewer_request',
    ...(turnTaking&&beneficiary?{beneficiary}:{})};
}

export function planBlackoutLiveV01(turn){
  const first=turn?.first_speaker,second=turn?.second_speaker;
  const lane=turn?.shanny_blackout?.emotional_lane;
  if(!['donation','microphone'].includes(turn?.kind)||
     typeof turn?.input!=='string'||!turn.input.trim()||turn.input.length>1000||
     !['SHANNY','REV'].includes(first)||
     second!==(first==='SHANNY'?'REV':'SHANNY')||
     !Object.hasOwn(PIVOTS,lane)||
     !['HIGH_PRESSURE','CONTAINED'].includes(turn?.shanny_blackout?.regime))
    throw Error('Invalid BLACKOUT_LIVE director input');
  const relay=detectBlackoutLiveRelay(turn.input,turn?.audience_address?.target);
  const floor=relay?.goal==='give_other_actor_room_to_speak';
  let opening=first==='SHANNY'?
    'Shanny addresses the viewer and makes a contestable point about the actual remark, in her selected Blackout lane.':
    'Rev addresses the viewer himself with a specific defense, challenge or concession; he is not Shanny\'s narrator.';
  let reply=first==='SHANNY'?
    'Rev reacts to Shanny\'s actual claim with his own stake. He may dispute, needle, partially agree or support.':
    'Shanny reacts to Rev\'s actual claim in her selected Blackout lane; she was not necessarily addressed by the viewer.';
  let returnBeat=first==='SHANNY'?
    'Only if Rev changes the emotional stakes, Shanny answers his specific point. '+PIVOTS[lane]:
    'Only if Shanny changes the stakes, Rev answers her specific rebuttal with independent agency.';
  if(floor){
    opening=first===relay.beneficiary?
      first+' demonstrates being allowed to COMPLETE one actual thought, not endlessly discussing interruption.':
      first+' reacts to being asked to yield the conversational floor, and makes one actual point.';
    reply=second===relay.recipient?
      second+' responds to that actual point and either resists or grants speaking space with a real reason; no wordplay about the request.':
      second+' advances their own substantive thought after '+first+' speaks; avoid talking about words instead of issues.';
    returnBeat='Only if earned, '+first+' finishes an actual point in response to '+second+', not a complaint about how to speak.';
  }
  return {version:'blackout_live_v01',
    ...(relay?{relay}:{}),
    beats:[
      {slot:'first_'+first,objective:opening},
      {slot:'second_'+second,objective:reply},
      {slot:'third_'+first,optional:true,objective:returnBeat}
    ]};
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

const tokenWords=text=>String(text).toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)||[];
function repeatedSpeech(text){
  const words=tokenWords(text);
  // Natural "no no no" is allowed, but a long word stuck in a loop is not.
  for(let i=2;i<words.length;i++)
    if(words[i].length>=4&&words[i]===words[i-1]&&words[i]===words[i-2])return true;
  // Repeated 3+ word phrase twice, or a 2-word phrase three times.
  for(const [n,times] of [[2,3],[3,2],[4,2],[5,2]]){
    for(let i=0;i+n*times<=words.length;i++){
      let repeated=true;
      for(let j=n;j<n*times;j++){
        if(words[i+j]!==words[i+j%n]){repeated=false;break;}
      }
      if(repeated)return true;
    }
  }
  return false;
}
/** Rejection precedes all V620 voice prefetch. The MSI adapter never sees this. */
export function assertBlackoutLiveSpeech(raw,relay=null){
  if(typeof raw!=='string')return;
  let response;try{response=JSON.parse(raw);}catch{return;}
  const lines=Array.isArray(response?.lines)?response.lines:
    Object.entries(response||{}).filter(([key])=>/^(?:first|second|third)(?:_(?:SHANNY|REV))?$/.test(key))
      .map(([,value])=>value);
  const spoken=lines.map(line=>line?.text).filter(v=>typeof v==='string');
  if(spoken.some(repeatedSpeech))throw Error('BLACKOUT_LIVE repetitive speech blocked');
  const canonical=spoken.map(text=>tokenWords(text).join(' '));
  if(canonical.some((text,i)=>text&&text.split(' ').length>=6&&canonical.indexOf(text)<i))
    throw Error('BLACKOUT_LIVE repeated dialogue blocked');
  if(relay){
    const together=spoken.join(' ');
    const buffMentions=(together.match(/\b(?:buff|buffweeb|1buffweeb)\b/gi)||[]).length;
    if(buffMentions>=3||/\b(?:i am|i'm|you are|you're)\s+(?:a\s+)?buff\b/i.test(together))
      throw Error('BLACKOUT_LIVE host identity confusion blocked');
  }
}

export function withBlackoutLiveV01(complete){
  if(typeof complete!=='function')throw Error('Invalid BLACKOUT_LIVE completion');
  return args=>{
    args?.signal?.throwIfAborted();
    const messages=decorateBlackoutLiveV01(args?.messages);
    const active=messages!==args?.messages;
    const relay=active?JSON.parse(messages[1].content).blackout_live_v01.relay||null:null;
    return Promise.resolve(complete({...args,messages})).then(raw=>{
      args?.signal?.throwIfAborted();
      if(active)assertBlackoutLiveSpeech(raw,relay);
      return raw;
    });
  };
}

/** Voice-side parity with the approved episode system; never edits GOLD plans. */
export function sampleLedShannyInput(input,available){
  if(input.actor!=='SHANNY')return {...input};
  const result={...input,text:input.text.toLowerCase()};
  // Episode SPECIAL_SELECTIONS: S06/full for rage, S06/medium for
  // moderate anger. The existing worker filters actual source intensity.
  // Incensed rage cannot be downgraded by a low-energy delivery code.
  // Other explicit qualified deliveries (including crying) keep their identity.
  if(result.mood==='rage'||!result.voiceCode&&result.mood==='anger'){
    if(!available?.SHANNY?.includes('S06'))
      throw Error('Approved Shanny S06 recordings are unavailable; refusing a generic anger substitute.');
    result.voiceCode='S06';
  }
  return result;
}

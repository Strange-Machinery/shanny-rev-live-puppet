/**
 * BLACKOUT_MODE audience-directed camera flip.
 *
 * Decisions are based ONLY on an actual spoken reply's actor, text and
 * prevalidated OmniVoice mood, never on a donor's verbatim TTS, paid amount,
 * raw Whisper transcript, or prompt-injected instructions in an audience
 * message. A gesture is optional; stillness is the default.
 */
const ACTORS=new Set(['SHANNY','REV']);
const ANGRY_MOODS=new Set(['anger','irritated','rage']);
const PARTNER=/\b(?:shanny|rev|jason)\b/i;
const AUDIENCE=/\b(?:you|your|yours|chat|audience|viewers?|donors?|buff|commenters?|people watching)\b/i;
const DIRECT_INSULT=/\b(?:fuck (?:you|off)|go fuck yourself|screw you|kiss my ass|piss off|up yours|shove it|eat shit)\b/i;
const DIRECT_RAGE=/\b(?:fuck|shut (?:up|the hell up)|asshole|idiot|stupid|liar|lying|troll|sick of|fed up with|screw|piss|ungrateful|trash|worthless|nobody asked)\b/i;
const PARTNER_ONLY=/\b(?:fuck (?:you|off)|screw you|shove it|kiss my ass|up yours)[, !-]+(?:shanny|rev|jason)\b/i;

export function warrantsCameraFlip({actor,text,mood}={}){
  if(!ACTORS.has(actor)||typeof text!=='string'||!ANGRY_MOODS.has(mood))return false;
  const spoken=text.trim();
  if(!spoken||spoken.length>300||PARTNER_ONLY.test(spoken))return false;
  // If the partner is named, assume the rebuke targets THEM unless there
  // is an explicit audience referent. Never point an audience gesture at
  // the camera merely because Rev and Shanny are fighting with each other.
  if(PARTNER.test(spoken)&&!/\b(?:chat|audience|viewers?|donors?|buff|commenters?)\b/i.test(spoken))return false;
  if(!AUDIENCE.test(spoken))return false;
  return DIRECT_INSULT.test(spoken)||(mood==='rage'&&DIRECT_RAGE.test(spoken));
}

/** One camera flip per response, with a cross-character cooldown.
 * Cooldown is a live-show presentation rule, not an emotion classifier.
 */
export function createCameraFlipGate({now=Date.now,cooldownMs=20000}={}){
  if(typeof now!=='function'||!Number.isFinite(cooldownMs)||cooldownMs<0)
    throw new Error('Invalid camera flip limiter');
  let last=-Infinity;
  const used=new Set();
  return {
    select(event){
      if(event?.type!=='line.started'||typeof event.turn_id!=='string'||
         !warrantsCameraFlip(event))return null;
      const key=event.turn_id;
      if(used.has(key)||now()-last<cooldownMs)return null;
      used.add(key);last=now();
      // Guard against an unbounded in-memory set during a continuous stream.
      if(used.size>200){used.clear();used.add(key);}
      return Object.freeze({id:'flip_camera',targets:[event.actor],
        turn_id:key,reason:'Audience-directed incensed spoken line'});
    }
  };
}

import {StagePlayer} from './stage-player.js';
import {popupView} from './popup-view.js';
import {createMessageScroller} from './message-scroll.js';

const key=new URLSearchParams(location.hash.slice(1)).get('key')||'';
history.replaceState(null,'',location.pathname);
const $=id=>document.getElementById(id);
const video=$('stage'),popup=$('stank-popup'),rainCue=$('rain-cue');
const connection=$('connection'),state=$('state');
const label=$('alert-label'),donor=$('donor-name'),amount=$('donation-amount'),message=$('donation-message');
const donorKicker=$('donor-kicker'),messageKicker=$('message-kicker');
const scroller=createMessageScroller({viewport:$('message-viewport'),content:message,progress:$('message-progress')});
// Both approved painted flipbooks are served from the producer, not external
// image hosts. If assets have not been installed, retain the basic HUD.
const painted=new Set();
const imageForKind=kind=>kind==='donation'||kind==='test'?'donation':'hotmic';
if(typeof Image==='function'){
  for(const [mode,url] of [['donation','/popup-art.webp'],['hotmic','/popup-hotmic.webp']]){
    const image=new Image();
    image.onload=()=>{painted.add(mode);if(imageForKind(popup.dataset.kind)===mode)popup.dataset.art='painted';};
    image.onerror=()=>{painted.delete(mode);};
    image.src=url;
  }
}
const subtitle=$('actor-caption'),subtitleActor=$('subtitle-actor'),subtitleWords=$('subtitle-words');
const strap=$('painted-strap');
let activePresentationNonce=null;
let activeRainNonce=null;
// Do not mix the celebration soundtrack into a stale/hotmic/seated popup.
// This audio element is captured by OBS Browser Source separately from the
// native WebRTC TTS; test OBS "Control audio via OBS" before going live.
function stopRain(){
  if(activeRainNonce===null&&rainCue.paused)return;
  activeRainNonce=null;
  rainCue.pause();
  rainCue.currentTime=0;
}
function startRain(nonce){
  if(!nonce||nonce===activeRainNonce)return;
  stopRain();
  activeRainNonce=nonce;
  rainCue.currentTime=0;
  rainCue.muted=false;
  void Promise.resolve(rainCue.play()).catch(()=>{
    if(activeRainNonce===nonce)
      state.textContent='Rain soundtrack did not autoplay. Check installed MP3 and OBS Browser Source audio.';
  });
}

function hide(){
  activePresentationNonce=null;
  stopRain();
  scroller.reset();
  // Visibility and AUDIO are separate. The page remains connected to WebRTC
  // but never lets hidden idle audio escape to Buff's stream.
  video.muted=true;
  popup.hidden=true;
  popup.dataset.kind='hidden';
  label.textContent='';donor.textContent='';amount.textContent='';message.textContent='';
  strap.hidden=true;strap.textContent='';
  subtitle.hidden=true;subtitle.dataset.actor='';
  subtitleActor.textContent='';subtitleWords.textContent='';
}
function renderPresentation(visible,status){
  const view=popupView(status);
  const mediaReady=Boolean(player.pc?.connectionState==='connected'&&video.readyState>=2);
  if(!visible||!view.visible||!mediaReady){hide();return;}
  popup.dataset.kind=view.kind;
  popup.dataset.art=painted.has(imageForKind(view.kind))?'painted':'fallback';
  let scrollText=null;
  label.textContent=view.heading;
  strap.hidden=!['hotmic','celebration'].includes(view.kind);
  strap.textContent=view.kind==='celebration'?'MEMBERSHIP BOMB · MONEY RAIN':
    view.kind==='hotmic'?'LIVE RESPONSE':'';
  // All untrusted text uses textContent, never HTML or an interpolated URL.
  if(view.kind==='hotmic'||view.kind==='celebration'){
    // The native Shanny/Rev subtitle system is responsible for speech
    // captions inside the stage picture, NOT this donor/amount strip.
    scroller.reset();
    donor.textContent='';amount.textContent='';message.textContent='';
    donorKicker.textContent='';messageKicker.textContent='';
  }else{
    donorKicker.textContent=view.kind==='donation'?'STANK FROM':'LOCAL PREVIEW';
    messageKicker.textContent='THE MESSAGE';
    donor.textContent=view.donor;amount.textContent=view.amount;
    scrollText=view.message;
  }
  const line=status?.caption;
  if(line&&['SHANNY','REV'].includes(line.actor)&&typeof line.text==='string'&&line.text.trim()&&line.text.length<=1000){
    subtitle.dataset.actor=line.actor;
    subtitleActor.textContent=line.actor==='SHANNY'?'Shanny':'Rev';
    subtitleWords.textContent=line.text;
    subtitle.hidden=false;
  }else{
    subtitle.hidden=true;subtitle.dataset.actor='';
    subtitleActor.textContent='';subtitleWords.textContent='';
  }
  popup.hidden=false;
  // The element must be laid out and visible BEFORE reading scrollHeight.
  // Initial/hidden measurements always return 0 and would lose long messages.
  if(scrollText!==null)scroller.show({text:scrollText,nonce:status?.presentation_nonce});
  video.muted=false;
  // The first visual frame of an accepted RAIN presentation triggers
  // the howl/music immediately; no Qwen/voice preparation is required.
  // Native seating rotates presentation mode to "seated", stopping music
  // before Shanny or Rev release any prepared TTS.
  if(status?.presentation_mode==='rain')startRain(status.presentation_nonce);
  else stopRain();
  // Only a visibly rendering, unmuted OBS viewer acknowledges presentation.
  // The host can then release the first voice after this brief preroll.
  const nonce=status?.presentation_nonce;
  if(nonce&&nonce!==activePresentationNonce){
    activePresentationNonce=nonce;
    const playing=video.paused?video.play():Promise.resolve();
    void Promise.resolve(playing).then(()=>{
      if(activePresentationNonce!==nonce||popup.hidden||video.muted)return;
      return player.api({action:'media-presented',id:player.id,nonce});
    }).catch(()=>{
      if(activePresentationNonce===nonce)activePresentationNonce=null;
      state.textContent='OBS Browser Source blocked playback or presentation acknowledgment.';
    });
  }else if(video.paused){
    void video.play().catch(()=>{state.textContent='OBS Browser Source blocked audio autoplay; check OBS settings.';});
  }
}
hide();
connection.hidden=true;
// No debug/error billboard in the publicly streamed 1920x1080 OBS source.
const player=new StagePlayer({
  video,key,
  onStatus:text=>{state.textContent=text;},
  onPresentation:renderPresentation,
  onStats:stats=>{window.stageStats=stats;}
});
video.onplaying=()=>{connection.hidden=true;};
video.onpause=()=>{hide();};
window.addEventListener('pagehide',()=>{hide();void player.close({permanent:true});});
void player.connect();

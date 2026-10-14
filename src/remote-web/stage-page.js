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
function activeRain(nonce){
  return nonce&&activeRainNonce===nonce&&!popup.hidden&&popup.dataset.kind!=='hidden';
}
function reportRain(action,nonce){
  if(!activeRain(nonce))return Promise.resolve();
  return player.api({action,id:player.id,nonce}).catch(()=>{
    if(activeRain(nonce))
      state.textContent='OBS rain playback receipt failed. Check the producer stage and audio connection.';
  });
}
function startRain(nonce){
  if(!nonce||nonce===activeRainNonce)return;
  stopRain();
  activeRainNonce=nonce;
  rainCue.currentTime=0;
  rainCue.muted=false;
  // MUST follow the accepted OBS media-presented receipt. The host will
  // not count this as "playing" until HTMLMediaElement.play() resolves.
  void Promise.resolve().then(()=>{
    // STOP, "Shut up" and disconnect may hide the frame between
    // media-presented and this scheduled browser task. Do not start a
    // belated howl in an invisible OBS browser source.
    if(!activeRain(nonce))return false;
    return rainCue.play().then(()=>true);
  }).then(async played=>{
    if(!played)return;
    if(!activeRain(nonce)){
      // Never stop a newer rain nonce that happened to replace this one.
      if(activeRainNonce===null||activeRainNonce===nonce){
        rainCue.pause();rainCue.currentTime=0;
      }
      return;
    }
    await reportRain('media-rain-started',nonce);
  }).catch(()=>{
    if(!activeRain(nonce))return;
    state.textContent='Rain soundtrack did not autoplay. Check installed MP3 and OBS Browser Source audio.';
    void reportRain('media-rain-failed',nonce);
  });
}
rainCue.onended=()=>{
  const nonce=activeRainNonce;
  if(nonce)void reportRain('media-rain-ended',nonce);
};
rainCue.onerror=()=>{
  const nonce=activeRainNonce;
  if(nonce)void reportRain('media-rain-failed',nonce);
};

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
  if(scrollText!==null){
    if(status?.presentation_mode==='rain'){
      // During the 23.9-second paid dance the message stays at the TOP;
      // only scroll down when Shanny/Rev have seated for their actual TTS.
      // The audience must not miss the beginning before it is read aloud.
      scroller.reset();
      message.textContent=scrollText;
    }else scroller.show({text:scrollText,nonce:status?.presentation_nonce});
  }
  video.muted=false;
  // Sound never begins before the OBS viewer acknowledges a visible,
  // unmuted video frame. This allows the host to validate music receipts
  // as belonging to the same exact presentation nonce.
  if(status?.presentation_mode!=='rain')stopRain();
  // Only a visibly rendering, unmuted OBS viewer acknowledges presentation.
  // The host can then release the first voice after this brief preroll.
  const nonce=status?.presentation_nonce;
  if(nonce&&nonce!==activePresentationNonce){
    activePresentationNonce=nonce;
    const playing=video.paused?video.play():Promise.resolve();
    void Promise.resolve(playing).then(async()=>{
      if(activePresentationNonce!==nonce||popup.hidden||video.muted)return;
      await player.api({action:'media-presented',id:player.id,nonce});
      if(activePresentationNonce===nonce&&!popup.hidden&&!video.muted&&status?.presentation_mode==='rain')
        startRain(nonce);
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

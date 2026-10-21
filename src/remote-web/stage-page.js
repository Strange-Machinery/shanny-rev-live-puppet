import {StagePlayer} from './stage-player.js';
import {popupView} from './popup-view.js';
import {createMessageScroller} from './message-scroll.js';
import {HttpStagePlayer} from './http-stage-player.js';
import {LocalMediaPublisher} from './local-media-publisher.js';

const parameters=new URLSearchParams(location.hash.slice(1));
const key=parameters.get('key')||'';
const sourceMode=parameters.get('source')==='http';
const httpMode=!sourceMode&&parameters.get('transport')==='http';
const watchMode=location.pathname==='/watch';
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
let publisher=null,publisherWanted=true,publisherNeedsClick=false,publisherStopping=false;
let lastSourceNonce=null,lastSourceEpoch=null,lastSourceStatus=null,publisherSource=null,publisherTask=null;
async function startPublisher(){
  if(!publisher||publisherTask||publisher.starting||publisherNeedsClick||lastSourceStatus?.available!==true)return;
  const stream=video.srcObject;
  if(publisher.running&&publisherSource===stream)return;
  if(!publisherWanted&&!publisher.running)return;
  if(!stream?.getVideoTracks?.().length||!stream?.getAudioTracks?.().length)return;
  const task=(async()=>{
    if(publisher.running)await publisher.stop();
    publisherWanted=false;publisherSource=stream;
    try{
      await publisher.start();
      if(video.srcObject!==stream){await publisher.stop();publisherWanted=!publisherNeedsClick;}
    }catch(error){state.textContent=error.message;}
  })();
  publisherTask=task;
  try{await task;}finally{if(publisherTask===task)publisherTask=null;}
}
async function stopPublisher(){
  if(!publisher||publisherStopping)return;
  publisherStopping=true;publisherWanted=!publisherNeedsClick;
  const pending=publisherTask;
  const task=(async()=>{
    // Cancel an in-flight start immediately, then wait for its cleanup before
    // admitting another source. No reconnect may race the old publisher close.
    await publisher.stop();
    await pending?.catch(()=>{});
    publisherSource=null;
  })();
  publisherTask=task;
  try{await task;}finally{
    if(publisherTask===task)publisherTask=null;
    publisherStopping=false;
  }
  if(publisherWanted)void startPublisher();
}
// Do not mix the celebration soundtrack into a stale/hotmic/seated popup.
// Legacy WebRTC captures this element separately. The HTTP publisher mixes it
// once into the program track; the remote HTTP receiver never plays it again.
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
  if(sourceMode)publisher?.setRainPlayback({nonce,state:action==='media-rain-started'?'playing':
    action==='media-rain-ended'?'ended':'failed'});
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
  rainCue.muted=sourceMode;
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
  if(sourceMode){
    if(Number.isSafeInteger(status?.control_epoch)){
      if(lastSourceEpoch!==null&&lastSourceEpoch!==status.control_epoch){
        // STOP is observable independently of upload errors. A simultaneous
        // source loss must not swallow the 409 and silently restart the feed.
        publisherNeedsClick=true;publisherWanted=false;
        state.textContent='Feed stopped. Click Start Buff feed to resume.';
        void stopPublisher();
      }
      lastSourceEpoch=status.control_epoch;
    }
    lastSourceStatus=status;publisher?.setPresentation(status);
    if(status?.available!==true&&(publisher?.running||publisher?.starting))void stopPublisher();
    if(status?.presentation_nonce&&status.presentation_nonce!==lastSourceNonce){
      lastSourceNonce=status.presentation_nonce;publisherWanted=!publisherNeedsClick;void startPublisher();
    }
  }
  let view=popupView(status);
  const mediaReady=Boolean((httpMode?player.isReady:player.pc?.connectionState==='connected')&&video.readyState>=2);
  if(watchMode&&status?.available&&mediaReady&&!view.visible)
    view={visible:true,kind:'hotmic',heading:'LIVE SHOW',donor:'',amount:'',message:''};
  if((!visible&&!watchMode)||!view.visible||!mediaReady){hide();return;}
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
  video.muted=sourceMode;
  // The HTTP stream already contains the source soundtrack. Starting a second
  // HTML audio element here would double it and lose the shared media clock.
  if(httpMode){stopRain();if(video.paused)void video.play().catch(()=>{state.textContent='Click Enable sound to play the show.';});return;}
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
      if(activePresentationNonce!==nonce||popup.hidden||(!sourceMode&&video.muted))return;
      await player.api({action:'media-presented',id:player.id,nonce});
      if(activePresentationNonce===nonce&&!popup.hidden&&(sourceMode||!video.muted)&&status?.presentation_mode==='rain')
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
connection.hidden=!sourceMode&&!watchMode;
if(sourceMode||watchMode){connection.dataset.interactive='true';connection.setAttribute('aria-hidden','false');}
// No debug/error billboard in the publicly streamed 1920x1080 OBS source.
const Player=httpMode?HttpStagePlayer:StagePlayer;
const player=new Player({
  video,key,ingest:sourceMode,
  onStatus:text=>{state.textContent=text;},
  onPresentation:renderPresentation,
  onStats:stats=>{window.stageStats=stats;if(sourceMode)void startPublisher();}
});
video.onplaying=()=>{connection.hidden=!sourceMode&&!watchMode;};
video.onpause=()=>{hide();};
window.addEventListener('pagehide',()=>{hide();void publisher?.stop();void player.close({permanent:true});});
if(sourceMode){
  $('sound').textContent='Start Buff feed';$('sound').tabIndex=0;
  $('sound').onclick=()=>{publisherNeedsClick=false;publisherWanted=true;void publisher?.context?.resume();void startPublisher();};
  void (async()=>{
    const reply=await fetch('/api/http-stage/config',{headers:{Authorization:'Bearer '+key},cache:'no-store',redirect:'error'});
    const config=await reply.json();
    if(!reply.ok||!config.can_publish)throw new Error('Open the publisher from the local producer panel.');
    publisher=new LocalMediaPublisher({video,rainAudio:rainCue,key,
      onStatus:text=>{state.textContent=text;},onError:error=>{
        publisherNeedsClick=error.status===409;
        state.textContent=publisherNeedsClick?'Feed stopped. Click Start Buff feed to resume.':error.message;
        publisherWanted=!publisherNeedsClick;
        // Wait for a fresh native status before restarting after an epoch
        // change; stale local presentation state may never restore old audio.
        lastSourceStatus={available:false,presentation_visible:false};
        publisher.setPresentation(lastSourceStatus);
      }});
    if(lastSourceStatus)publisher.setPresentation(lastSourceStatus);
    await player.connect();
  })().catch(error=>{state.textContent=error.message;});
}else{
  if(watchMode){
    $('sound').tabIndex=0;$('sound').onclick=()=>{video.muted=false;void video.play().catch(()=>{});};
    $('reconnect').tabIndex=0;$('reconnect').onclick=()=>{void player.connect();};
  }
  void player.connect();
}

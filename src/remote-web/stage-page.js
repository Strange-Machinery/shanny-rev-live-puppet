import {StagePlayer} from './stage-player.js';
import {popupView} from './popup-view.js';

const key=new URLSearchParams(location.hash.slice(1)).get('key')||'';
history.replaceState(null,'',location.pathname);
const $=id=>document.getElementById(id);
const video=$('stage'),popup=$('stank-popup');
const connection=$('connection'),state=$('state');
const label=$('alert-label'),donor=$('donor-name'),amount=$('donation-amount'),message=$('donation-message');
const donorKicker=$('donor-kicker'),messageKicker=$('message-kicker');
const subtitle=$('actor-caption'),subtitleActor=$('subtitle-actor'),subtitleWords=$('subtitle-words');

function hide(){
  // Visibility and AUDIO are separate. The page remains connected to WebRTC
  // but never lets hidden idle audio escape to Buff's stream.
  video.muted=true;
  popup.hidden=true;
  popup.dataset.kind='hidden';
  label.textContent='';donor.textContent='';amount.textContent='';message.textContent='';
  subtitle.hidden=true;subtitle.dataset.actor='';
  subtitleActor.textContent='';subtitleWords.textContent='';
}
function renderPresentation(visible,status){
  const view=popupView(status);
  const mediaReady=Boolean(player.pc?.connectionState==='connected'&&video.readyState>=2);
  if(!visible||!view.visible||!mediaReady){hide();return;}
  popup.dataset.kind=view.kind;
  label.textContent=view.heading;
  // All untrusted text uses textContent, never HTML or an interpolated URL.
  if(view.kind==='hotmic'){
    // The native Shanny/Rev subtitle system is responsible for speech
    // captions inside the stage picture, NOT this donor/amount strip.
    donor.textContent='';amount.textContent='';message.textContent='';
    donorKicker.textContent='';messageKicker.textContent='';
  }else{
    donorKicker.textContent=view.kind==='donation'?'STANK FROM':'LOCAL PREVIEW';
    messageKicker.textContent='THE MESSAGE';
    donor.textContent=view.donor;amount.textContent=view.amount;message.textContent=view.message;
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
  video.muted=false;
  if(video.paused)void video.play().catch(()=>{state.textContent='OBS Browser Source blocked audio autoplay; check OBS source settings.';});
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

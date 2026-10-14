import {createMessageScroller} from './message-scroll.js';

/** Visual-only art review, never connects to Unity, accounts, OBS or TTS. */
const params=new URLSearchParams(location.search);
const hotmic=location.pathname==='/hotmic';
const celebration=location.pathname==='/celebration';
const long=params.get('long')==='1';
const kind=celebration?'celebration':hotmic?'hotmic':'donation';
const root=document.getElementById('stank-popup');
root.hidden=false;root.dataset.kind=kind;root.dataset.art='fallback';
if(params.get('backdrop')==='1')document.body.classList.add('preview-backdrop');
const $=id=>document.getElementById(id);
$('stage').style.display='none';
const stage=document.querySelector('.stage-well');
const scene=document.createElement('div');scene.className='demo-scene';
scene.textContent='LIVE STANK TANK · UNITY CAMERA AREA';
stage.insertBefore(scene,stage.firstChild);
const heading=kind==='celebration'?'MEMBERSHIP BOMB · MAKE IT RAIN':
 kind==='hotmic'?'LIVE RESPONSE':'DONATION ALERT';
$('alert-label').textContent=heading;
const strap=$('painted-strap');
if(kind!=='donation'){strap.hidden=false;strap.textContent=heading;}
const text=long?(
  'I have watched this whole project come together and wanted to send something meaningful. '+
  'The show is hilarious, and the technology behind it is genuinely incredible. '+
  'Please tell Shanny and Rev that the audience has their backs, even when those two cannot agree about anything. '+
  'I cannot believe how far the animation, voices and performances have come. '+
  'Keep the Stank Tank running, keep making the ridiculous episodes, and never stop experimenting! '+
  'This is the kind of independent creativity I want to support. '+
  'One more thing: please do not let Rev swipe every last bill from the donation pile. '+
  'There should be a little left for Shanny! '
).repeat(2).slice(0,1000):'You two always make my day! Keep up the amazing work!';
$('donor-name').textContent=kind==='donation'?'STANK SUPPORTER':'';
$('donation-amount').textContent=kind==='donation'?'$100.00 USD':'';
$('donation-message').textContent=kind==='donation'?text:'';
if(hotmic){
  const caption=$('actor-caption');
  caption.dataset.actor='SHANNY';caption.hidden=false;
  $('subtitle-actor').textContent='Shanny';
  $('subtitle-words').textContent='I have something to say about THAT!';
}
const scroller=createMessageScroller({
  viewport:$('message-viewport'),content:$('donation-message'),progress:$('message-progress')
});
const status=document.createElement('aside');status.className='preview-art-status';
status.textContent='Checking approved painted artwork…';
document.body.append(status);
const frame=new Image();
frame.onload=()=>{
  root.dataset.art='painted';
  status.textContent='PAINTED 12-FRAME SPRITE · '+(long?'LONG-MESSAGE AUTO-SCROLL':'NATURAL FLIPBOOK MOTION');
  if(kind==='donation')requestAnimationFrame(()=>scroller.show({text,nonce:'local-preview'}));
};
frame.onerror=()=>{
  root.dataset.art='fallback';
  status.textContent='PAINTED ART NOT INSTALLED · Run scripts/Install-StankPopupArt.ps1';
  if(kind==='donation')requestAnimationFrame(()=>scroller.show({text,nonce:'local-preview-fallback'}));
};
frame.src=kind==='donation'?'/popup-art.webp':'/popup-hotmic.webp';

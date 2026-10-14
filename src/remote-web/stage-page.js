import {StagePlayer} from './stage-player.js';
const key=new URLSearchParams(location.hash.slice(1)).get('key')||'';history.replaceState(null,'',location.pathname);
const video=document.getElementById('stage'),panel=document.getElementById('connection'),state=document.getElementById('state');
video.style.visibility='hidden';panel.hidden=true;
const player=new StagePlayer({video,key,onStatus:text=>{state.textContent=text;},onPresentation:visible=>{video.style.visibility=visible?'visible':'hidden';},onStats:stats=>{window.stageStats=stats;}});
video.onplaying=()=>{panel.hidden=true;};
document.getElementById('sound').onclick=()=>{video.muted=false;void video.play();};
document.getElementById('reconnect').onclick=()=>void player.connect();
window.addEventListener('pagehide',()=>void player.close());void player.connect();

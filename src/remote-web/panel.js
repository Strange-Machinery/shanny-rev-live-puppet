import {StagePlayer} from './stage-player.js';
const $=id=>document.getElementById(id);
const key=new URLSearchParams(location.hash.slice(1)).get('key')||'';
history.replaceState(null,'',location.pathname);
const stage=new StagePlayer({video:$('stage-preview'),key,onStatus:text=>$('stage-status').textContent=text,onStats:s=>{
  $('stage-quality').textContent=[s.width&&s.height?s.width+' × '+s.height:'',s.fps?Math.round(s.fps)+' fps':'',s.codec||'',Number.isFinite(s.rtt_ms)?'Network round trip '+Math.round(s.rtt_ms)+' ms':''].filter(Boolean).join(' · ');
}});
$('connect-stage').onclick=()=>void stage.connect();
$('stage-sound').onclick=async()=>{const video=$('stage-preview');video.muted=!video.muted;try{await video.play();$('stage-sound').textContent=video.muted?'Enable preview sound':'Mute preview sound';}catch{$('stage-status').textContent='Connect the preview first.';}};
$('copy-obs').onclick=async()=>{try{const result=await api('obs-link');try{await navigator.clipboard.writeText(result.url);$('stage-status').textContent='OBS link copied. Paste into a 1920 × 1080 Browser source.';}catch{$('obs-link').hidden=false;$('obs-link').value=result.url;$('obs-link').select();$('stage-status').textContent='Copy this link into your OBS Browser source.';}}catch(error){$('stage-status').textContent=error.message;}};
window.addEventListener('pagehide',()=>void stage.close());
let revision=0,request=null,stream=null,context=null,recording=false,starting=false,chunks=[],frames=0,timer=null,online=false,donationsEnabled=false,stageBusy=false,stageAvailable=false;
async function api(path,body,signal){const response=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal,redirect:'error',cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.error||'Connection failed');return result;}
function stopCapture(){recording=false;starting=false;clearTimeout(timer);stream?.getTracks().forEach(track=>track.stop());stream=null;void context?.close();context=null;$('mic').textContent='Test microphone';}
function stop(){revision++;request?.abort();stopCapture();chunks=[];frames=0;donationsEnabled=false;
 $('result').textContent='Stopped. Microphone off.';void api('action',{action:'stop'}).catch(()=>{});
}
async function donationAction(action){
 try {
  const result=await api('action',{action,make_it_rain:$('make-it-rain').checked});
  donationsEnabled=Boolean(result.enabled);showDonations(result);
 } catch(error){$('donation-status').textContent=error.message;}
}
function showDonations(d){
 if(!d)return;
 donationsEnabled=Boolean(d.enabled);
 const labels={youtube:'YouTube',streamlabs:'Streamlabs',streamelements:'StreamElements'};
 const states=Object.entries(d.providers||{}).map(([p,v])=>(labels[p]||p)+': '+(v==='not_configured'?'needs connection':v)).join(' · ');
 const intake=d.intake_diagnostics;
 const counters=Object.values(intake?.counts||{});
 const observed=counters.reduce((n,c)=>n+(c.observed||0),0);
 const accepted=counters.reduce((n,c)=>n+(c.accepted||0),0);
 const ignored=counters.reduce((n,c)=>n+(c.ignored||0),0);
 // A Streamlabs/SE dashboard "test alert" may only reach their widget and
 // never deliver an authenticated paid-event packet to OUR socket. Make
 // that visible without exposing donor names, amounts or private tokens.
 const diagnostics=observed?' · Provider packets '+observed+
  ' · accepted '+accepted+' · ignored '+ignored:
  ' · No paid-source packets observed yet';
 $('donation-status').textContent=(d.enabled?'Automatic reactions ENABLED':'Automatic reactions OFF')+
  (d.pending?' · '+d.pending+' waiting':'')+(states?' · '+states:'')+
  diagnostics+(d.error?' · '+d.error:'');
 $('donation-enable').disabled=!online||d.enabled||d.requires_setup;
 $('donation-stop').disabled=!online||!d.enabled;
}
async function run(action,extra={}){const captured=revision;request=new AbortController();$('result').textContent='Preparing voices and reactions…';try{const result=await api('action',{action,make_it_rain:$('make-it-rain').checked,...extra},request.signal);if(captured===revision)$('result').textContent=(result.transcript?'You said: '+result.transcript+'\n\n':'')+result.message;}catch(error){if(captured===revision)$('result').textContent=error.message;}}
function encodeAudio(){const buffer=new ArrayBuffer(44+frames*2),view=new DataView(buffer);const ascii=(offset,text)=>[...text].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));ascii(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,48000,true);view.setUint32(28,96000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,frames*2,true);let n=44;for(const chunk of chunks)for(const sample of chunk){view.setInt16(n,Math.max(-32768,Math.min(32767,Math.round(sample*32767))),true);n+=2;}const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
function finish(){if(!recording)return;stopCapture();const audio=encodeAudio();chunks=[];frames=0;void run('microphone',{audio});}
async function microphone(){if(recording){finish();return;}if(starting||!online)return;starting=true;const captured=revision;try{const input=await navigator.mediaDevices.getUserMedia({audio:{deviceId:$('device').value?{exact:$('device').value}:undefined,channelCount:1,echoCancellation:true},video:false});if(captured!==revision){input.getTracks().forEach(track=>track.stop());return;}stream=input;context=new AudioContext({sampleRate:48000});await context.audioWorklet.addModule('/mic-worklet.js');if(captured!==revision)return;await context.resume();if(captured!==revision)return;const source=context.createMediaStreamSource(stream),node=new AudioWorkletNode(context,'microphone-collector');chunks=[];frames=0;recording=true;starting=false;node.port.onmessage=event=>{if(!recording||captured!==revision)return;const chunk=event.data.slice(0,Math.max(0,1440000-frames));chunks.push(chunk);frames+=chunk.length;if(frames>=1440000)finish();};source.connect(node);const mute=context.createGain();mute.gain.value=0;node.connect(mute);mute.connect(context.destination);$('mic').textContent='Finish recording';$('result').textContent='Speak now, then click Finish recording.';timer=setTimeout(finish,30000);const devices=await navigator.mediaDevices.enumerateDevices();if(captured===revision){const selected=$('device').value;$('device').replaceChildren(new Option('Default microphone',''));for(const device of devices.filter(d=>d.kind==='audioinput'&&!/stereo mix|what u hear|loopback|obs/i.test(d.label)))$('device').append(new Option(device.label||'Microphone',device.deviceId));$('device').value=selected;}}catch(error){stopCapture();$('result').textContent='Microphone unavailable. Check browser permission and the selected input. '+error.message;}}
$('donate').onclick=()=>void run('donate',{text:$('text').value});$('replay').onclick=()=>void run('transcript',{text:$('text').value});$('mic').onclick=()=>void microphone();$('stop').onclick=stop;
$('donation-enable').onclick=()=>void donationAction('donation-enable');
$('donation-stop').onclick=()=>void donationAction('donation-stop');
$('rain-now').onclick=async()=>{
 $('rain-now').disabled=true;
 $('rain-now-status').textContent='Starting the paired money-rain choreography…';
 try {
   const result=await api('action',{action:'rain-now'});
   $('rain-now-status').textContent=result.status==='accepted'
     ?'MAKE IT RAIN! Shanny and Rev are performing the full native paired choreography.'
     :'Manual celebration was not accepted.';
 }catch(error){$('rain-now-status').textContent=error.message;}
};
$('shut-up').onclick=()=>{
 revision++;request?.abort();stopCapture();
 $('result').textContent='Interrupting the current characters…';
 void api('action',{action:'silence'}).then(result=>{
  $('result').textContent=result.waiting_for_tts?'Silent. Waiting for the next TTS.':'Silenced. Automatic reactions are off.';
  if(result.providers)showDonations(result);
 }).catch(error=>$('result').textContent=error.message);
};
$('make-it-rain').onchange=()=>{
 if(donationsEnabled)void donationAction('donation-mode');
};
window.addEventListener('offline',()=>{stageAvailable=false;$('rain-now').disabled=true;if(!donationsEnabled)stop();});
window.addEventListener('pagehide',()=>{stopCapture();
 // The OBS Browser source and opted-in feed outlive this control page.
 if(!donationsEnabled)void fetch('/api/action',{method:'POST',
   headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
   body:JSON.stringify({action:'stop'}),keepalive:true}).catch(()=>{});
});
let polling=false;async function status(){if(polling)return;polling=true;try{const s=await api('status');online=true;stageBusy=Boolean(s.busy);stageAvailable=Boolean(s.media?.available);showDonations(s.donations);$('status').textContent='Connected to producer · '+(s.real_characters?'Real characters · Blackout Shanny':'Testing fixtures')+' · '+(s.whisper?'Whisper ready':'Whisper unavailable');if(s.real_characters){$('service-note').textContent='Real Qwen, character voices and Unity run on the producer computer. No YouTube livestream is needed. Use Connect preview to watch and hear the stage.';$('dialogue').textContent=s.error||s.history.map(row=>row.actor+': '+row.text).join('\n\n');}}catch(error){if(online&&!donationsEnabled)stop();online=false;$('status').textContent='Producer unavailable. Ask them to start sharing, then reopen your launcher.';}finally{polling=false;for(const id of ['donate','replay','mic'])$(id).disabled=!online;$('rain-now').disabled=!online||stageBusy||!stageAvailable;}}
void status();setInterval(()=>void status(),3000);
let catalog={revision:'',items:[]};
function options(id,values){$(id).replaceChildren(...values.map(value=>new Option(value.label||value,value.value||value)));}
function actorRows(){return catalog.items.filter(row=>row.target===$('actor').value);}
function categories(){options('category',[...new Set(actorRows().map(row=>row.category))].sort());contexts();}
function contexts(){options('context',[...new Set(actorRows().filter(row=>row.category===$('category').value).flatMap(row=>row.contexts))].sort());gestures();}
function gestures(){options('gesture',actorRows().filter(row=>row.category===$('category').value&&row.contexts.includes($('context').value)).map(row=>({label:row.label+(row.playable?'':' — unavailable'),value:row.id})));selectedGesture();}
function selectedGesture(){const row=actorRows().find(row=>row.id===$('gesture').value);$('play-animation').disabled=!online||!row?.playable;$('animation-status').textContent=row?(row.playable?'Ready for '+$('actor').selectedOptions[0].text:row.reason):(catalog.message||'MotionLab has not supplied entries yet.');}
$('animations').ontoggle=async()=>{if(!$('animations').open)return;try{catalog=await api('animations');categories();}catch(error){$('animation-status').textContent=error.message;}};
$('actor').onchange=categories;$('category').onchange=contexts;$('context').onchange=gestures;$('gesture').onchange=selectedGesture;
$('play-animation').onclick=()=>void run('animate',{id:$('gesture').value,target:$('actor').value,context:$('context').value,catalogRevision:catalog.revision});

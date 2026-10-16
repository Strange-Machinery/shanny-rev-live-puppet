/** Read-only YouTube text chat intake; never uses donations or an AI API.
 * The bridge is operator-enabled, backpressure-limited and unable to arm
 * or restart an operator-stopped ConversationSession.
 */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

const MAX_QUEUE=24, MAX_SEEN=1024, CHAT_TTL_MS=45000;
const DEFAULT_SCRIPT=fileURLToPath(new URL('../python/youtube_chat_collector.py',import.meta.url));

function plain(value,max){
  if(typeof value!=='string')return '';
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
function normalized(packet,now){
  if(!packet||typeof packet!=='object'||Array.isArray(packet)||packet.source!=='youtube'||
     packet.type!=='textMessage')return null; // Paid events belong ONLY to authenticated donation intake.
  const id=plain(packet.id,160),text=plain(packet.text,450),name=plain(packet.author,60)||'YouTube viewer';
  const posted=Number(packet.published_ms);
  if(!id||!text||!Number.isFinite(posted)||posted>now+10000||now-posted>CHAT_TTL_MS)return null;
  if(/^\s*[!/](?:stop|shutdown|system|command)\b/i.test(text))return null;
  return {id,text,author:name,posted,priority:packet.is_moderator===true?2:packet.is_member===true?1:0};
}
export function createYouTubeChatBridge({session,paidBusy=()=>false,videoId='',fixture='',python='python',
  script=DEFAULT_SCRIPT,mode='react',minGapMs=12000,now=Date.now,spawnProcess=spawn}={}){
  if(!session||typeof session.submit!=='function'||typeof paidBusy!=='function')throw Error('Chat bridge needs a live session');
  if(!['react','read'].includes(mode)||!Number.isInteger(minGapMs)||minGapMs<5000||minGapMs>120000)
    throw Error('Invalid chat performance policy');
  if((videoId&&!/^[a-zA-Z0-9_-]{11}$/.test(videoId))||
     (typeof fixture!=='string')||(typeof python!=='string')||(typeof script!=='string'))
    throw Error('Invalid chat collector configuration');
  let enabled=false,child=null,ticker=null,restart=null,lastAt=-Infinity,startedAt=0,queue=[],busy=false;
  const seen=new Map();
  const counts={received:0,eligible:0,duplicates:0,stale:0,ignored:0,accepted:0,submit_failures:0,reconnects:0};
  function status(){return {configured:Boolean(videoId||fixture),enabled,collector_running:Boolean(child),
    mode,min_gap_ms:minGapMs,queue_depth:queue.length,counts:{...counts}};}
  function ingest(packet){
    if(!enabled)return false;
    counts.received++;
    const event=normalized(packet,now());
    if(!event){counts.ignored++;return false;}
    if(event.posted<startedAt-10000){counts.stale++;return false;}
    if(seen.has(event.id)){counts.duplicates++;return false;}
    seen.set(event.id,now());
    while(seen.size>MAX_SEEN)seen.delete(seen.keys().next().value);
    counts.eligible++;
    queue.push(event);
    // If saturated, evict the least-valuable OLDEST queued comment.
    if(queue.length>MAX_QUEUE){
      let drop=0;
      for(let i=1;i<queue.length;i++)if(queue[i].priority<queue[drop].priority)drop=i;
      queue.splice(drop,1);
    }
    return true;
  }
  async function tick(){
    if(!enabled||busy)return;
    const timestamp=now();
    queue=queue.filter(x=>timestamp-x.posted<=CHAT_TTL_MS);
    if(!queue.length||timestamp-lastAt<minGapMs||session.mode!=='live'||session.turn||paidBusy())return;
    busy=true;
    let event;
    try{
      // Priority within bounded queued eligible comments, no paid-event override.
      queue.sort((a,b)=>b.priority-a.priority||a.posted-b.posted);
      event=queue.shift();
      if(!enabled||session.mode!=='live'||session.turn||paidBusy())return;
      const scope=session.scope;
      if(!scope?.session_id)return;
      // New 'chat' kind uses the SAME director/gateway/playback gates.
      await session.submit({kind:'chat',text:event.text,chatAuthor:event.author,
        readChat:mode==='read',session_id:scope.session_id,mode_epoch:session.epoch});
      lastAt=now();counts.accepted++;
    }catch{counts.submit_failures++;}finally{busy=false;}
  }
  function launch(){
    if(!enabled||child)return;
    const args=['-u',script,...(fixture?['--fixture',fixture]:['--video-id',videoId])];
    try{child=spawnProcess(python,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});}
    catch{counts.submit_failures++;return;}
    const current=child;
    const lines=createInterface({input:current.stdout,crlfDelay:Infinity});
    lines.on('line',line=>{
      if(!enabled||child!==current)return;
      if(line.length>4096){counts.ignored++;return;}
      try{ingest(JSON.parse(line));}catch{counts.ignored++;}
    });
    // Collector stderr never goes to public OBS, nor is raw chat logged here.
    current.stderr?.resume();
    // Windows spawn failure may emit 'error' WITHOUT an 'exit' event;
    // handle either once and retry without looping on a dead child.
    let ended=false;
    const onEnd=()=>{
      if(ended)return;ended=true;
      if(child===current)child=null;
      lines.close();
      if(enabled){counts.reconnects++;restart=setTimeout(()=>{restart=null;launch();},5000);restart.unref?.();}
    };
    current.on('error',onEnd);
    current.on('exit',onEnd);
  }
  async function enable(){
    if(enabled)return status();
    if(!videoId&&!fixture)throw Error('Configure a YouTube video ID before enabling chat');
    if(session.mode!=='live')throw Error('Arm the characters before enabling chat');
    queue=[];seen.clear();lastAt=-Infinity;startedAt=now();enabled=true;
    launch();ticker=setInterval(()=>void tick(),400);ticker.unref?.();
    return status();
  }
  async function disable(){
    enabled=false;queue=[];seen.clear();
    if(ticker){clearInterval(ticker);ticker=null;}
    if(restart){clearTimeout(restart);restart=null;}
    if(child){const proc=child;child=null;proc.kill();}
    return status();
  }
  return {enable,disable,ingest,tick,status};
}

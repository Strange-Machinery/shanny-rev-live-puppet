/**
 * Producer-owned paid-event feed transports. No UI or donation speech control.
 *
 * Authentication is supplied by an opt-in private producer configuration.
 * The onEvent callback MUST be the authoritative, durable admission bridge.
 *
 * Official protocols:
 *  YouTube liveChatMessages.list (documented polling fallback to streamList)
 *  Streamlabs Socket API (Socket.IO; socket.token OAuth scope)
 *  StreamElements Astro topic channel.tips (tips:read)
 */
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const sleep=(ms,signal)=>delay(ms,undefined,{signal});
function nonblank(s){return typeof s==='string'&&s.length>0&&s.length<=4096;}
function bearer(token){if(!nonblank(token))throw new Error('Provider access token unavailable');return token;}
function safeJson(body){if(typeof body!=='string'||body.length>256000)throw new Error('Provider message too large');return JSON.parse(body);}
function persistCursor(path,chatId,token){
  if(!path)return;
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const temp=path+'.tmp-'+process.pid+'-'+randomUUID();
  try{
    writeFileSync(temp,JSON.stringify({version:1,liveChatId:chatId,pageToken:token})+'\n',{mode:0o600,flag:'wx'});
    renameSync(temp,path);
  }catch(error){throw new Error('Could not persist YouTube cursor: '+error.message);}
}
function loadCursor(path,chatId){
  if(!path)return null;
  let saved;try{saved=readFileSync(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}
  const row=JSON.parse(saved);
  if(row.version!==1||row.liveChatId!==chatId||typeof row.pageToken!=='string'||row.pageToken.length>2000)
    throw new Error('YouTube chat cursor invalid or belongs to another broadcast');
  return row.pageToken||null;
}
function status(fn,state){try{fn?.(state);}catch{}}

/** YouTube's documented REST list fallback; obey provider pollingIntervalMillis.
 * Initial connection bookmarks recent messages rather than performing an
 * unexpected replay. Reconnects reuse a durable page token after admission.
 */
export class YouTubePaidSource {
 constructor({liveChatId,getAccessToken,onEvent,onStatus=()=>{},cursorFile,fetcher=fetch,
   minPollMs=5000,now=Date.now}={}){
  if(!nonblank(liveChatId)||typeof getAccessToken!=='function'||typeof onEvent!=='function'||
    typeof fetcher!=='function'||!Number.isSafeInteger(minPollMs)||minPollMs<1000||
    typeof now!=='function')throw new Error('Invalid YouTube source configuration');
  Object.assign(this,{liveChatId,getAccessToken,onEvent,onStatus,cursorFile,fetcher,minPollMs,now});
  this.pageToken=loadCursor(cursorFile,liveChatId);this.ready=Boolean(this.pageToken);
  this.running=false;this.controller=null;this.task=null;this.state='disconnected';
 }
 report(value){this.state=value;status(this.onStatus,value);}
 async pollOnce({signal}={}){
  const params=new URLSearchParams({liveChatId:this.liveChatId,part:'id,snippet,authorDetails'});
  if(this.pageToken)params.set('pageToken',this.pageToken);
  const response=await this.fetcher('https://www.googleapis.com/youtube/v3/liveChat/messages?'+params,
   {headers:{Authorization:'Bearer '+bearer(await this.getAccessToken())},signal,redirect:'error'});
  if(!response.ok){
    const error=new Error('YouTube live chat HTTP '+response.status);
    error.permanent=[400,401,403,404].includes(response.status);
    throw error;
  }
  const page=await response.json();
  if(!Array.isArray(page?.items)||typeof page.nextPageToken!=='string'||
     page.nextPageToken.length>2000)throw new Error('Invalid YouTube live chat page');
  if(!this.ready){
    // Start at the current live position. Do not play historic Super Chats.
    this.ready=true;
  }else{
    for(const item of page.items){
      if(signal?.aborted)throw signal.reason||new Error('Source stopped');
      await this.onEvent(item);
    }
  }
  // Persist AFTER every normalized event has been durably admitted.
  persistCursor(this.cursorFile,this.liveChatId,page.nextPageToken);
  this.pageToken=page.nextPageToken;
  return Math.max(this.minPollMs,Math.min(120000,
    Number.isSafeInteger(page.pollingIntervalMillis)?page.pollingIntervalMillis:this.minPollMs));
 }
 async start(){
  if(this.running)return;
  this.running=true;this.controller=new AbortController();this.report('connecting');
  const signal=this.controller.signal;
  this.task=(async()=>{
   let errors=0;
   while(this.running&&!signal.aborted){
    let sleepMs=this.minPollMs;
    try{
      sleepMs=await this.pollOnce({signal});errors=0;this.report('connected');
    }catch(error){
      if(!this.running||signal.aborted)break;
      this.report(error.permanent?'error':'retrying');
      if(error.permanent)break;errors++;
      sleepMs=Math.min(60000,1000*2**Math.min(errors,6));
    }
    try{await sleep(sleepMs,signal);}catch{break;}
   }
   this.running=false;
   if(this.state!=='error')this.report('disconnected');
  })();
 }
 /** STOP ends the feed and discards unattended history on next opt-in. */
 async stop({freshOnNextStart=true}={}){
  this.running=false;this.controller?.abort();await this.task?.catch(()=>{});
  this.task=null;
  if(freshOnNextStart){
    this.pageToken=null;this.ready=false;
    persistCursor(this.cursorFile,this.liveChatId,'');
  }
  this.report('disconnected');
 }
}

export class StreamlabsPaidSource {
 constructor({socketToken,onEvent,onStatus=()=>{},connect}={}){
  if(!nonblank(socketToken)||typeof onEvent!=='function')throw new Error('Invalid Streamlabs socket configuration');
  Object.assign(this,{socketToken,onEvent,onStatus,connect});this.socket=null;this.running=false;this.state='disconnected';
 }
 report(v){this.state=v;status(this.onStatus,v);}
 async start(){
  if(this.running)return;
  this.running=true;this.report('connecting');
  let connect=this.connect;
  if(!connect){
   // Socket.IO v2 matches the Streamlabs published socket-client example.
   const module=await import('socket.io-client');
   connect=module.default||module;
  }
  try{
   this.socket=connect('https://sockets.streamlabs.com',{
     transports:['websocket'],query:{token:this.socketToken},
     reconnection:true,reconnectionDelay:2000,reconnectionDelayMax:30000,
     timeout:10000,autoConnect:true
   });
   this.socket.on('connect',()=>this.running&&this.report('connected'));
   this.socket.on('disconnect',()=>this.running&&this.report('retrying'));
   this.socket.on('reconnect_attempt',()=>this.running&&this.report('retrying'));
   this.socket.on('connect_error',()=>this.running&&this.report('error'));
   this.socket.on('event',payload=>{
     if(!this.running||this.state!=='connected')return;
     // Socket callback is authenticated by the provider-specific socket token.
     void Promise.resolve(this.onEvent(payload)).catch(()=>this.report('error'));
   });
  }catch(error){this.running=false;this.report('error');throw error;}
 }
 async stop(){
  this.running=false;this.socket?.removeAllListeners?.();
  this.socket?.disconnect?.();this.socket=null;this.report('disconnected');
 }
}

export class StreamElementsPaidSource {
 constructor({room,token,tokenType='jwt',onEvent,onStatus=()=>{},
   websocketFactory=url=>new WebSocket(url),backoffMs=1500}={}){
  if(!nonblank(room)||!nonblank(token)||!['jwt','apikey','oauth2'].includes(tokenType)||
     typeof onEvent!=='function'||typeof websocketFactory!=='function'||
     !Number.isSafeInteger(backoffMs)||backoffMs<100)
    throw new Error('Invalid StreamElements Astro configuration');
  Object.assign(this,{room,token,tokenType,onEvent,onStatus,websocketFactory,backoffMs});
  this.running=false;this.socket=null;this.state='disconnected';
  this.timer=null;this.retry=0;this.authorized=false;this.canonicalRoom=null;this.reconnectToken=null;
  this.reconnectAuth=false;
 }
 report(v){this.state=v;status(this.onStatus,v);}
 connect(){
  if(!this.running)return;
  this.report(this.retry?'retrying':'connecting');
  const restored=Boolean(this.reconnectToken),url='wss://astro.streamelements.com/'+
   (restored?'?reconnect_token='+encodeURIComponent(this.reconnectToken):'');
  const socket=this.websocketFactory(url);this.socket=socket;
  const nonce=randomUUID();this.authorized=false;
  socket.addEventListener('open',()=>{
    if(!this.running||socket!==this.socket)return;
    if(restored){
      // Astro restores only a valid authenticated subscription.
      // Wait for welcome before accepting provider messages.
      return;
    }
    socket.send(JSON.stringify({type:'subscribe',nonce,
      data:{topic:'channel.tips',room:this.room,token:this.token,token_type:this.tokenType}}));
  });
  socket.addEventListener('message',event=>{
    if(!this.running||socket!==this.socket)return;
    let packet;try{packet=safeJson(String(event.data));}catch{this.report('error');return;}
    if(restored&&packet.type==='welcome'){
      this.authorized=true;this.reconnectAuth=true;this.retry=0;
      this.reconnectToken=null;this.report('connected');return;
    }
    if(packet.type==='response'&&packet.nonce===nonce){
      if(packet.error){this.report('error');return;}
      if(packet.data?.topic!=='channel.tips'||!nonblank(packet.data?.room)){
        this.report('error');return;
      }
      this.canonicalRoom=packet.data.room;this.authorized=true;this.retry=0;
      this.reconnectToken=null;this.report('connected');return;
    }
    if(packet.type==='reconnect'&&typeof packet.data?.reconnect_token==='string'&&
       packet.data.reconnect_token.length<8192&&this.authorized){
      this.reconnectToken=packet.data.reconnect_token;
      socket.close();return;
    }
    if(packet.type==='message'&&packet.topic==='channel.tips'&&
       this.authorized&&packet.room===(this.canonicalRoom||this.room)){
      void Promise.resolve(this.onEvent(packet)).catch(()=>this.report('error'));
    }
  });
  socket.addEventListener('error',()=>this.running&&socket===this.socket&&this.report('retrying'));
  socket.addEventListener('close',()=>{
    if(!this.running||socket!==this.socket)return;
    this.authorized=false;
    this.report('retrying');
    const wait=Math.min(30000,this.backoffMs*2**Math.min(this.retry++,5));
    this.timer=setTimeout(()=>this.connect(),wait);
    this.timer.unref?.();
  });
 }
 async start(){
  if(this.running)return;
  this.running=true;this.retry=0;this.reconnectToken=null;this.connect();
 }
 async stop(){
  this.running=false;clearTimeout(this.timer);this.timer=null;
  this.socket?.close?.();this.socket=null;this.reconnectToken=null;
  this.authorized=false;this.report('disconnected');
 }
}

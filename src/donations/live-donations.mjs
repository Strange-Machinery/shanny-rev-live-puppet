/** Single trusted coordinator. Provider events are authenticated upstream,
 * normalized once, then durably handed to ConversationSession through host().
 * Nothing connects until the operator explicitly presses Enable.
 */
import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {DonationLedger} from './ledger.mjs';
import {DurableDonationQueue} from './durable-queue.mjs';
import {DEFAULT_DONATION_AUTHORITY,normalizeProviderEvent} from './provider-events.mjs';
import {YouTubePaidSource,StreamlabsPaidSource,StreamElementsPaidSource} from './provider-sources.mjs';

const PROVIDERS=['youtube','streamlabs','streamelements'];
const AUTHORITY_FIELDS=['superchat','streamlabs_tip','streamelements_tip'];
function cred(name,value){if(value!==undefined&&value!==null&&
 (typeof value!=='string'||!value.trim()||value.length>4096))
  throw new Error('Invalid private '+name+' credential');return value;}
function readPrivateConfig(config){
 if(!config)return {};
 if(typeof config.credentialsFile==='string'){
  // Never serve, log or commit this producer-local file.
  return JSON.parse(readFileSync(config.credentialsFile,'utf8'));
 }
 return config;
}
export class LiveDonations {
 constructor({directory,host,config={},fetcher=fetch,factories={}}={}){
  if(typeof directory!=='string'||!directory||typeof host!=='function')
    throw new Error('Invalid producer donations bridge configuration');
  mkdirSync(directory,{recursive:true,mode:0o700});
  this.config=readPrivateConfig(config);
  this.host=host;this.fetcher=fetcher;this.directory=directory;
  this.authority={...DEFAULT_DONATION_AUTHORITY,...(this.config.authority||{})};
  if(Object.keys(this.authority).some(k=>!AUTHORITY_FIELDS.includes(k))||
    !['youtube','streamlabs'].includes(this.authority.superchat)||
    this.authority.streamlabs_tip!=='streamlabs'||
    this.authority.streamelements_tip!=='streamelements')
    throw new Error('Invalid paid-event authority configuration');
  this.ledger=new DonationLedger(join(directory,'donations-ledger.local'));
  try{
   this.queue=new DurableDonationQueue({directory,ledger:this.ledger,host,onStatus:()=>{}});
  }catch(error){this.ledger.close();throw error;}
  this.sources=new Map();this.factories=factories;
  this.make_it_rain=false;this.closed=false;this.lastError='';
  // Non-PII diagnostics: operator can distinguish a dashboard mock alert
  // that NEVER hit the paid-event source from a real adapter event.
  this.providerCounters=Object.fromEntries(PROVIDERS.map(provider=>[provider,
    {observed:0,ignored:0,accepted:0,duplicate:0,disabled:0,busy:0}]));
  this.lastProviderEvent=null;
 }
 status(){
  const base=this.queue.status();
  const configured=Object.fromEntries(PROVIDERS.map(p=>{
   const credentials=p==='youtube'?Boolean(this.config.youtube?.liveChatId&&this.config.youtube?.accessToken):
    p==='streamlabs'?Boolean(this.config.streamlabs?.socketToken||this.config.streamlabs?.accessToken):
    Boolean(this.config.streamelements?.room&&this.config.streamelements?.token);
   return [p,Boolean(this.sources.get(p))||credentials];
  }));
  const providers={...base.providers};
  for(const p of PROVIDERS)if(!configured[p])providers[p]='not_configured';
  return {...base,providers,configured,make_it_rain:this.make_it_rain,
   // No donor, transaction ID, text, JWT or raw socket response is exposed.
   intake_diagnostics:{
     counts:Object.fromEntries(PROVIDERS.map(p=>[p,{...this.providerCounters[p]}])),
     last:this.lastProviderEvent?{...this.lastProviderEvent}:null
   },
   error:this.lastError||base.error,requires_setup:!Object.values(configured).some(Boolean)};
 }
 setMode(rain){
  if(typeof rain!=='boolean')throw new Error('Make it rain must be a boolean');
  this.make_it_rain=rain;return this.status();
 }
 ingest(source,payload){
  if(this.closed)throw new Error('Donation coordinator closed');
  const packets=normalizeProviderEvent(source,payload,{authority:this.authority});
  const counter=this.providerCounters[source];
  if(!counter)throw new Error('Unknown authenticated paid source');
  counter.observed++;
  const mark=outcome=>{
    if(Object.hasOwn(counter,outcome))counter[outcome]++;
    this.lastProviderEvent={source,outcome,observed_unix_ms:Date.now()};
  };
  if(!packets.length)mark('ignored');
  const result=[];
  for(const item of packets){
   // An authenticated USD $100+ contribution always earns money rain.
   // Never compare bare amounts across currencies (e.g. 100 JPY).
   // Freeze the result when admitting the queue item, not at dispatch.
   const highValueRain=item.currency==='USD'&&item.amount>=100;
   const admitted=this.queue.ingest(item,{make_it_rain:this.make_it_rain||highValueRain});
   mark(admitted.status==='queued'?'accepted':admitted.status);
   if(admitted.status==='busy')throw new Error('Donation queue full; provider replay required');
   result.push(admitted);
  }
  return result;
 }
 async _configuredSources(){
  if(this.sources.size)return;
  const input=this.config;
  const handle=p=>raw=>this.ingest(p,raw);
  const state=p=>v=>this.queue.setProviderStatus(p,v);
  const make=(provider,Cls,args)=>{
   const factory=this.factories[provider];
   this.sources.set(provider,factory?factory(args):new Cls(args));
  };
  if(input.youtube?.liveChatId&&input.youtube?.accessToken){
   make('youtube',YouTubePaidSource,{liveChatId:input.youtube.liveChatId,
     getAccessToken:async()=>cred('YouTube',input.youtube.accessToken),
     cursorFile:join(this.directory,'youtube-page-cursor.local.json'),
     fetcher:this.fetcher,onEvent:handle('youtube'),onStatus:state('youtube')});
  }
  const streamlabs=input.streamlabs;
  if(streamlabs?.socketToken||streamlabs?.accessToken){
   let socketToken=streamlabs.socketToken;
   if(!socketToken){
    const response=await this.fetcher('https://streamlabs.com/api/v2.0/socket/token',{
     headers:{Authorization:'Bearer '+cred('Streamlabs',streamlabs.accessToken)},redirect:'error'});
    if(!response.ok)throw new Error('Streamlabs socket authorization failed (HTTP '+response.status+')');
    const tokens=await response.json();socketToken=tokens.socket_token||tokens.token;
   }
   make('streamlabs',StreamlabsPaidSource,{socketToken:cred('Streamlabs socket',socketToken),
     onEvent:handle('streamlabs'),onStatus:state('streamlabs')});
  }
  const se=input.streamelements;
  if(se?.room&&se?.token){
   make('streamelements',StreamElementsPaidSource,{room:se.room,
     token:cred('StreamElements',se.token),tokenType:se.tokenType||'jwt',
     onEvent:handle('streamelements'),onStatus:state('streamelements')});
  }
 }
 async enable({make_it_rain=false}={}){
  if(this.closed)throw new Error('Donation coordinator closed');
  this.setMode(make_it_rain);
  await this._configuredSources();
  if(!this.sources.size)throw new Error('No donation provider is connected. Configure the producer account first.');
  await this.queue.enable();
  // A provider failure cannot silently rearm or authorize another feed.
  for(const [provider,source] of this.sources){
   try{await source.start();}
   catch(error){this.queue.setProviderStatus(provider,'error');this.lastError=provider+' connection failed: '+error.message;}
  }
  return this.status();
 }
 async stop(){
  // Disconnect feeds before muting so in-flight events cannot rearm playback.
  for(const source of this.sources.values())await source.stop().catch(()=>{});
  await this.queue.stop();return this.status();
 }
 async silence(){
  if(!this.queue.enabled)return {silenced:true,waiting_for_tts:false,...this.status()};
  await this.queue.interruptCurrent();
  return {silenced:true,waiting_for_tts:true,...this.status()};
 }
 async close(){
  if(this.closed)return;
  this.closed=true;await this.stop().catch(()=>{});
  await this.queue.close();this.ledger.close();
 }
}

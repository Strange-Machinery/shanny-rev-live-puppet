/**
 * Producer-local, durable, bounded donation dispatch.
 *
 * Important delivery guarantee:
 *   - Reserve the platform ID in DonationLedger before persistence.
 *   - Persist "started" BEFORE calling the host. An uncertain/crashed call
 *     is never reissued; at-most-once is intentionally NOT exactly-once.
 *   - At startup, discard previously started items. Queued ones survive.
 *   - Playback is never armed after restart or STOP without operator enable().
 *
 * This class does not itself connect to a provider or authenticate a wire feed.
 * Accept only normalized events from an authenticated adapter.
 */
import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,openSync,closeSync,fsyncSync,
  renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

const SOURCES=new Set(['youtube','streamlabs','streamelements']);
const STATES=new Set(['queued','started']);
const MAX_ITEMS_ON_DISK=128;
function validPayment(details){
  return details&&typeof details==='object'&&!Array.isArray(details)&&
    ['youtube','streamlabs','streamelements'].includes(details.provider)&&
    typeof details.donor==='string'&&details.donor.length<=80&&
    Number.isFinite(details.amount)&&details.amount>0&&details.amount<=1e12&&
    typeof details.currency==='string'&&/^[A-Z]{3}$/.test(details.currency);
}
function validateRecord(record) {
  if(!record||typeof record!=='object'||Array.isArray(record)||
     typeof record.donation_id!=='string'||!record.donation_id||
     record.donation_id.length>128||!SOURCES.has(record.source)||
     typeof record.text!=='string'||!record.text.trim()||record.text.length>1000||
     typeof record.make_it_rain!=='boolean'||!STATES.has(record.state)||
     !Number.isSafeInteger(record.received_unix_ms)||record.received_unix_ms<0||
     (record.donation!==undefined&&record.donation!==null&&!validPayment(record.donation)))
    throw new Error('Invalid durable donation queue item');
}
function saveAtomic(file,state) {
  const temporary=file+'.'+process.pid+'.'+randomBytes(8).toString('hex')+'.tmp';
  let fd;
  try {
    fd=openSync(temporary,'wx',0o600);
    writeFileSync(fd,JSON.stringify({version:1,items:state})+'\n','utf8');
    fsyncSync(fd);closeSync(fd);fd=undefined;
    renameSync(temporary,file);
    // Directory fsync is unavailable on some Windows filesystems.
    try {const dir=openSync(join(file,'..'),'r');try{fsyncSync(dir);}finally{closeSync(dir);}}catch{}
  } finally {
    if(fd!==undefined)closeSync(fd);
    try{unlinkSync(temporary);}catch{}
  }
}
function readState(file) {
  let raw;
  try{raw=readFileSync(file,'utf8');}
  catch(error){if(error.code==='ENOENT')return [];throw error;}
  const parsed=JSON.parse(raw);
  if(!parsed||parsed.version!==1||!Array.isArray(parsed.items)||
     parsed.items.length>MAX_ITEMS_ON_DISK)
    throw new Error('Invalid durable queue snapshot');
  const ids=new Set();
  for(const row of parsed.items) {
    validateRecord(row);
    if(ids.has(row.donation_id))throw new Error('Duplicate durable queue item');
    ids.add(row.donation_id);
  }
  return parsed.items;
}
function validateProviderEvent(item) {
  if(!item||typeof item!=='object'||!SOURCES.has(item.source)||
     typeof item.donation_id!=='string'||item.donation_id.length>128||
     !/^(youtube:superchat:|streamlabs:donation:|streamelements:tip:)/.test(item.donation_id)||
     typeof item.text!=='string'||!item.text.trim()||item.text.length>1000)
    throw new Error('Unauthenticated or invalid normalized donation');
}
function validateScope(scope) {
  if(typeof scope?.session_id!=='string'||!scope.session_id||
     !Number.isSafeInteger(scope.mode_epoch)||scope.mode_epoch<0)
    throw new Error('Host did not return an armed conversation scope');
}
export class DurableDonationQueue {
  constructor({directory,ledger,host,maxPending=32,pollMs=150,timeoutMs=180000,now=Date.now,
    onStatus=()=>{}}={}) {
    if(typeof directory!=='string'||!directory||!ledger||
       typeof ledger.reserve!=='function'||typeof ledger.has!=='function'||
       typeof host!=='function'||typeof now!=='function'||typeof onStatus!=='function'||
       !Number.isSafeInteger(maxPending)||maxPending<1||maxPending>128||
       !Number.isSafeInteger(pollMs)||pollMs<1||pollMs>10000||
       !Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>600000)
      throw new TypeError('Invalid durable queue options');
    Object.assign(this,{ledger,host,maxPending,pollMs,timeoutMs,now,onStatus});
    mkdirSync(directory,{recursive:true,mode:0o700});
    this.path=join(directory,'donations-queue.local.json');
    const stored=readState(this.path);
    if(stored.some(row=>!ledger.has(row.donation_id)))
      throw new Error('Queue and durable donation ledger disagree; manual reconciliation required');
    this.recoveredStarted=stored.filter(row=>row.state==='started').length;
    this.items=stored.filter(row=>row.state==='queued');
    if(this.items.length>maxPending)
      throw new Error('Queue capacity reduced below persisted pending count');
    this.providers=new Map([['youtube','disconnected'],['streamlabs','disconnected'],
      ['streamelements','disconnected']]);
    this.enabled=false;this.closed=false;this.scope=null;
    this.revision=0;this.task=null;this.lastError='';
    this.interruptEpoch=0;this.silencing=false;this.interruption=null;
    if(this.recoveredStarted)saveAtomic(this.path,this.items);
  }
  status() {
    return {enabled:this.enabled,pending:this.items.filter(row=>row.state==='queued').length,
      inflight:this.items.filter(row=>row.state==='started').length,
      capacity:this.maxPending,providers:Object.fromEntries(this.providers),
      recovered_abandoned:this.recoveredStarted,error:this.lastError};
  }
  _signal(){try{this.onStatus(this.status());}catch{}}
  setProviderStatus(provider,status) {
    if(!SOURCES.has(provider)||!['disconnected','connecting','connected','retrying','error'].includes(status))
      throw new Error('Unknown provider connection status');
    this.providers.set(provider,status);this._signal();
  }
  async enable() {
    if(this.closed)throw new Error('Queue is closed');
    if(this.enabled)return this.status();
    const revision=++this.revision;
    // ONLY a direct operator request may invoke host arm().
    const scope=await this.host({action:'arm'});
    validateScope(scope);
    if(revision!==this.revision||this.closed) {
      await this.host({action:'stop'});
      throw new Error('Donation enable was cancelled by STOP');
    }
    this.scope=Object.freeze({session_id:scope.session_id,mode_epoch:scope.mode_epoch});
    this.enabled=true;this.lastError='';this._signal();this._kick();
    return this.status();
  }
  /**
   * STOP is sticky. Already started work is never retried. Pending work is
   * preserved but cannot resume until the operator explicitly calls enable().
   */
  async stop() {
    this.enabled=false;this.scope=null;this.revision++;this.silencing=false;
    this._signal();
    await this.host({action:'stop'});
    return this.status();
  }
  /**
   * "Shut up": kill only the active popup. The queue stays armed and pending
   * purchases keep their frozen mode. A returned NEW mode_epoch invalidates
   * any pre-interrupt host call. Duplicate interrupts share one transition.
   */
  async interruptCurrent(){
    if(!this.enabled)return this.status();
    if(this.interruption)return this.interruption;
    const revision=this.revision;
    this.interruptEpoch++;this.silencing=true;this._signal();
    this.interruption=(async()=>{
      try {
        const scope=await this.host({action:'silence'});
        if(!this.enabled||revision!==this.revision)return this.status();
        if(!scope?.waiting_for_tts)throw new Error('Host did not resume after silence');
        validateScope(scope);
        this.scope=Object.freeze({session_id:scope.session_id,mode_epoch:scope.mode_epoch});
        this.lastError='';return this.status();
      }catch(error){
        if(revision===this.revision){
          this.lastError='Silence failed: '+error.message;
          await this.stop().catch(()=>{});
        }
        throw error;
      }finally{this.silencing=false;this.interruption=null;this._signal();}
    })();
    return this.interruption;
  }
  /** Ingest after authentication. The selected animation mode is snapshotted
   * per accepted payment and cannot drift with the launcher checkbox.
   */
  ingest(item,{make_it_rain=false}={}) {
    if(this.closed)throw new Error('Queue is closed');
    validateProviderEvent(item);
    if(typeof make_it_rain!=='boolean')throw new Error('Invalid rain mode');
    if(this.ledger.has(item.donation_id))return {status:'duplicate',donation_id:item.donation_id};
    if(!this.enabled) {
      // Events observed while STOP is active are suppressed durably, so a
      // later connection replay cannot play old donations after an enable.
      this.ledger.reserve(item.donation_id);
      return {status:'disabled',donation_id:item.donation_id};
    }
    if(this.items.length>=this.maxPending)
      return {status:'busy',donation_id:item.donation_id};
    if(!this.ledger.reserve(item.donation_id))
      return {status:'duplicate',donation_id:item.donation_id};
    // Preserve only the public donor/amount fields for the future popup;
    // retain the canonical payment ID solely in the private durable ledger.
    const donor=typeof item.donor==='string'?item.donor:'';
    const donation=validPayment({provider:item.source,donor,amount:item.amount,currency:item.currency})?
      {provider:item.source,donor,amount:item.amount,currency:item.currency}:null;
    const record={donation_id:item.donation_id,source:item.source,text:item.text,
      donation,make_it_rain,received_unix_ms:this.now(),state:'queued'};
    // If the process crashes after reservation but before this snapshot,
    // this donation can be lost, never replayed. Deliberate at-most-once.
    this.items.push(record);
    try{saveAtomic(this.path,this.items);}
    catch(error){this.items.pop();this.enabled=false;this.lastError='Queue persistence failed: '+error.message;
      this._signal();throw error;}
    this._signal();this._kick();
    return {status:'queued',donation_id:item.donation_id};
  }
  _current(revision){return this.enabled&&!this.closed&&revision===this.revision;}
  _kick() {
    if(this.task||!this.enabled||!this.items.some(row=>row.state==='queued'))return;
    this.task=this._drain().catch(async error=>{
      this.enabled=false;this.scope=null;this.revision++;
      this.lastError=error.message;this._signal();
      await this.host({action:'stop'}).catch(()=>{});
    }).finally(()=>{
      this.task=null;
      if(this.enabled&&this.items.some(row=>row.state==='queued'))this._kick();
    });
  }
  _remove(row) {
    const index=this.items.indexOf(row);
    if(index>=0){this.items.splice(index,1);saveAtomic(this.path,this.items);this._signal();}
  }
  async _waitReady(revision) {
    const deadline=this.now()+this.timeoutMs;
    while(this._current(revision)) {
      const status=await this.host({action:'status'});
      if(!this._current(revision))return false;
      if(this.silencing){await sleep(this.pollMs);continue;}
      if(status.mode!=='live'||status.error)throw new Error('Host is stopped or failed');
      // Real paid events must never disappear into an OBS stage with no
      // authenticated Browser Source viewer. A producer-only fake host
      // without a media property remains valid for offline fixtures.
      const missingObs=Boolean(status.media&&
        (status.media.available===false||
          Number.isInteger(status.media.obs_viewers)&&status.media.obs_viewers<1));
      if(!missingObs&&!status.turn_busy&&!status.conversation_busy&&!status.presentation_visible)return true;
      if(this.now()>=deadline)throw new Error(missingObs?
        'No connected OBS viewer to deliver paid donation':
        'Host was busy past the donation deadline');
      await sleep(this.pollMs);
    }
    return false;
  }
  async _drain() {
    const revision=this.revision;
    while(this._current(revision)) {
      const row=this.items.find(value=>value.state==='queued');
      if(!row)return;
      if(!await this._waitReady(revision))return;
      row.state='started';
      // Crash safe: persist before an uncertain network/action attempt.
      saveAtomic(this.path,this.items);this._signal();
      const dispatchEpoch=this.interruptEpoch;
      try {
        while(this._current(revision)&&this.silencing)await sleep(this.pollMs);
        if(!this._current(revision))return;
        const result=await this.host({action:'donate',text:row.text,
          make_it_rain:row.make_it_rain,...(row.donation?{donation:row.donation}:{}),...this.scope});
        if(!this._current(revision))return;
        if(result?.status!=='accepted')throw new Error('Host did not accept donation');
        if(!await this._waitReady(revision))return;
      } catch(error) {
        // A known user interrupt may race an in-flight host request.
        // Its failed/stale result must not disarm the donation pipeline.
        if(this.interruptEpoch===dispatchEpoch)throw error;
      } finally {
        // Even after a timeout or cancellation, started work may not replay.
        this._remove(row);
      }
    }
  }
  async close() {
    if(this.closed)return;
    this.closed=true;this.enabled=false;this.scope=null;this.revision++;
    await this.host({action:'stop'}).catch(()=>{});
    if(this.task)await this.task;
  }
}

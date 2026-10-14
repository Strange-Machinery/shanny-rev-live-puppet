import {readFile,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';

const TARGETS={SHANNY:['SHANNY'],REV:['REV'],BOTH:['SHANNY','REV']};
const idPattern=/^[a-zA-Z0-9_-]{1,100}$/;
const label=id=>id.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());

/** Existing MotionLab repertoire reader. Availability must come from an accepted player. */
export class AnimationMenu {
  constructor({catalogPath,adapter,getScope=()=>({enabled:false}),now=Date.now}={}) {
    Object.assign(this,{catalogPath,adapter,getScope,now});this.revision=0;this.abort=null;
  }
  async read() {
    if(!this.catalogPath)return {revision:'unconfigured',items:[],message:'MotionLab catalog is not connected yet.'};
    if((await stat(this.catalogPath)).size>1_000_000)throw new Error('Animation catalog exceeds budget');
    const bytes=await readFile(this.catalogPath);if(bytes.length>1_000_000)throw new Error('Animation catalog exceeds budget');
    const catalog=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
    if(!Array.isArray(catalog.items)||catalog.items.length>1000)throw new Error('Invalid MotionLab repertoire');
    const revision=createHash('sha256').update(bytes).digest('hex'),seen=new Set(),items=[];
    for(const row of catalog.items) {
      if(!idPattern.test(row.id)||seen.has(row.id))throw new Error('Invalid or duplicate animation ID');
      seen.add(row.id);
      const actors=Array.isArray(row.actors)?row.actors.filter(a=>['SHANNY','REV'].includes(a)):[];
      const contexts=Array.isArray(row.contexts)&&row.contexts.length?row.contexts.filter(c=>idPattern.test(c)):['unspecified'];
      const kind=idPattern.test(row.kind)?row.kind:'animation';
      for(const [target,targets] of Object.entries(TARGETS)) {
        if(row.roles===2&&target!=='BOTH')continue;
        const bindings=Object.fromEntries(targets.map(actor=>[actor,row.bindings?.[actor]||row.binding||null]));
        let reason='Player animation adapter is not connected.';
        if(row.status!=='runtime_candidate')reason='MotionLab status: '+String(row.status||'unreviewed').slice(0,60);
        else if(targets.some(actor=>!actors.includes(actor)))reason='Actor compatibility is not yet declared by MotionLab.';
        else if(Object.values(bindings).some(value=>!idPattern.test(value||'')))reason='MotionLab binding is not available.';
        else if(this.adapter?.accepted===true&&await this.adapter.canPlay({id:row.id,targets,bindings,catalogRevision:revision})===true)reason='';
        items.push({id:row.id,label:label(row.id),target,category:label(kind),contexts:contexts.map(label),
          playable:!reason,reason,format:String(row.format||'pending').slice(0,60),bindings});
      }
    }
    return {revision,items,message:items.some(row=>row.playable)?'Available animations come from the accepted player.':'Catalog loaded. Playback waits for MotionLab/player acceptance.'};
  }
  async menu() {const catalog=await this.read();return {...catalog,items:catalog.items.map(({bindings,...row})=>row)};}
  async play({id,target,context,catalogRevision}) {
    const generation=this.revision,scope=this.getScope();
    if(!scope.enabled||!TARGETS[target])throw new Error('Animation controls are stopped or unavailable');
    const catalog=await this.read();
    const selected=catalog.items.find(row=>row.id===id&&row.target===target);
    if(catalogRevision!==catalog.revision||!selected?.playable||!selected.contexts.includes(context)||generation!==this.revision)throw new Error('Refresh the catalog; this animation is not available');
    const current=this.getScope();
    if(!current.enabled||current.session_id!==scope.session_id||current.epoch!==scope.epoch)throw new Error('Stale animation request');
    if(this.abort)throw new Error('An animation command is pending');
    const abort=new AbortController();this.abort=abort;
    try {
      // BOTH is one adapter operation with one start time, never two independent play calls.
      const result=await this.adapter.playBatch({request_id:randomUUID(),id,context,targets:TARGETS[target],bindings:selected.bindings,
        catalogRevision:catalog.revision,session_id:scope.session_id,epoch:scope.epoch,start_at_ms:this.now()+100,signal:abort.signal});
      if(generation!==this.revision||abort.signal.aborted)throw new Error('Animation was stopped');
      return result;
    } finally {if(this.abort===abort)this.abort=null;}
  }
  stop() {this.revision++;this.abort?.abort();this.adapter?.stopNow?.();}
}

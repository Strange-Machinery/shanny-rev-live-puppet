import {readJson} from '../http-json.mjs';

/**
 * Opt-in private V620 writer. Only checks LM Studio's read-only model
 * inventory. Never calls the model load/unload endpoint or a public service.
 * A model merely downloaded, but not loaded, is NOT considered available.
 */
export function createV620ModelProbe({
  host, model, port=1234, request=fetch, timeoutMs=1500
}={}){
  if(typeof host!=='string'||
     !/^100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(host)||
     !Number.isInteger(port)||port!==1234||
     typeof model!=='string'||!model.trim()||model.length>200||
     typeof request!=='function'||
     !Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>5000)
    throw new Error('Invalid private V620 model probe configuration');
  const url='http://'+host+':'+port+'/api/v1/models';
  return async(signal)=>{
    signal?.throwIfAborted();
    const combined=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
    const reply=await request(url,{method:'GET',signal:combined,redirect:'error',
      cache:'no-store',headers:{Accept:'application/json'}});
    if(!reply.ok){await reply.body?.cancel();return false;}
    const inventory=await readJson(reply,32000);
    combined.throwIfAborted();
    return Array.isArray(inventory.models)&&inventory.models.some(entry=>
      entry&&entry.key===model&&
      Array.isArray(entry.loaded_instances)&&entry.loaded_instances.length>0);
  };
}

/**
 * A single approved generation per turn. Prefer the loaded V620 27B.
 * If it is unavailable or returns a rejected/incomplete plan, one local 2B
 * backup generation is allowed. The V620's partial text is NEVER forwarded
 * to speculative OmniVoice preparation. STOP/cancellation never retries.
 *
 * Local llama.cpp remains warm as a genuine immediately usable backup.
 */
export function createQwenFailover({
  primary, fallback, probe, now=Date.now, cooldownMs=10000
}={}){
  if(typeof primary!=='function'||typeof fallback!=='function'||
     typeof probe!=='function'||typeof now!=='function'||
     !Number.isInteger(cooldownMs)||cooldownMs<0||cooldownMs>120000)
    throw new Error('Invalid private Qwen failover configuration');
  let until=0;
  const state={
    preferred:'v620', last_route:'none', last_reason:'none',
    remote_state:'unverified', fallback_count:0, primary_count:0,
    last_model_ms:null, last_primary_ms:null, last_fallback_ms:null
  };
  const status=()=>({...state,cooldown_remaining_ms:Math.max(0,until-now())});
  const local=async(args,reason)=>{
    args.signal?.throwIfAborted();
    const started=now();
    // Metadata contains an enum rather than remote exception text or donor
    // prompt. No remote error is sent to the private producer browser.
    state.last_reason=reason;state.last_route='msi';state.fallback_count++;
    try{
      const result=await fallback(args);
      state.last_fallback_ms=now()-started;
      state.last_model_ms=state.last_fallback_ms;
      return result;
    }catch(e){
      state.last_route='failed';state.last_fallback_ms=now()-started;
      state.last_model_ms=state.last_fallback_ms;
      throw e;
    }
  };
  const complete=async(args={})=>{
    args.signal?.throwIfAborted();
    if(now()<until)return local(args,'cooldown');
    const checked=now();let ready=false;
    try{ready=(await probe(args.signal))===true;}
    catch(error){if(args.signal?.aborted)throw error;}
    if(!ready){
      state.remote_state='unavailable';
      state.last_primary_ms=now()-checked;
      until=now()+cooldownMs;
      return local(args,'model-unavailable');
    }
    state.remote_state='loaded';
    const started=now();let candidate;
    try{
      // Deliberately suppress remote onText, even when the caller streams the
      // MSI backup. A failed remote cannot queue a partial TTS clip.
      candidate=await primary({...args,onText:undefined});
      args.signal?.throwIfAborted();
      if(typeof candidate!=='string'||candidate.length>5000)throw Error('Invalid private remote model response');
      JSON.parse(candidate);
      if(typeof args.validateResponse==='function')args.validateResponse(candidate);
    }catch(error){
      if(args.signal?.aborted)throw error;
      state.remote_state='failed';state.last_primary_ms=now()-started;
      until=now()+cooldownMs;
      return local(args,'remote-generation-failed');
    }
    state.last_primary_ms=now()-started;
    state.last_model_ms=state.last_primary_ms;
    state.last_route='v620';state.last_reason='none';state.primary_count++;
    // A full, validated V620 answer is safe to prepare for OmniVoice.
    // No remote text has been published while failover was still possible.
    args.onText?.(candidate);
    return candidate;
  };
  complete.status=status;
  return complete;
}

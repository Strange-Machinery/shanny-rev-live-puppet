/**
 * Preserve the original funny MSI BLACKOUT ConversationDirector unchanged.
 * This bridge only ensures a COMPLETE V620 answer satisfies that original
 * director's own validator BEFORE the existing failover/prefetch releases it.
 *
 * No new acting prompts, lore, emotion selection, sampling or model calls.
 * MSI fallback receives the same original messages and original validation.
 */
import {validateExchange} from './conversation-director.mjs';

export function guardOriginalMsiBlackoutRemote(remote) {
  if(typeof remote!=='function')throw Error('MSI BLACKOUT GOLD needs a remote completion');
  return async function verifiedOriginalBlackout(args={}) {
    args.signal?.throwIfAborted();
    // Even if the supplied backend later supports streaming, nothing from an
    // unvalidated V620 reply may enter the speculative OmniVoice callback.
    const raw=await remote({...args,onText:undefined});
    args.signal?.throwIfAborted();
    try {
      if(typeof raw!=='string'||raw.length>5000)throw Error('Invalid response');
      const ready=args.responseSchema?.properties?.ready?.const===true;
      if(ready) {
        const p=JSON.parse(raw);
        if(!p||typeof p!=='object'||Array.isArray(p)||
           Object.keys(p).sort().join(',')!=='ready'||p.ready!==true)
          throw Error('Invalid warmup');
      }else{
        const last=args.messages?.at(-1);
        const user=last?.role==='user'?JSON.parse(last.content):null;
        if(!['donation','microphone'].includes(user?.kind))
          throw Error('Unknown original director input');
        // Reuse the OLD 2B validator, including one-sentence/mood/actor limits.
        // Do not install the experimental v0.1 repetition or emotion layer.
        validateExchange(raw,user.kind);
      }
    }catch{
      // Do not expose private character notes or generated speech in errors.
      throw Error('V620 did not satisfy original MSI BLACKOUT output contract');
    }
    return raw;
  };
}

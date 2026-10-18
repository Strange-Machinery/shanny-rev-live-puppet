import {compactDyadPrompt} from './prompt.mjs';
import {schemaForRecord,validateDyad} from './contract.mjs';
import {prepareDyadInput,argumentCallbacks} from './input.mjs';

export function createDyadDirector({complete,notes='',prompt=compactDyadPrompt,random=Math.random} = {}) {
  if (typeof complete !== 'function') throw Error('Dyad requires a completion');
  const system = prompt(notes);
  let revision = 0, active, lastCard;
  const state = {state:'idle',calls:0,line_count:0,rage_bonus:false};
  function cancel() {
    revision++;
    active?.abort();
    active = undefined;
    Object.assign(state,{state:'cancelled',line_count:0,rage_bonus:false});
  }
  return {cancel,status:() => ({...state}),async generate(args={}) {
    args.signal?.throwIfAborted();
    if (active) throw Error('Dyad writer is busy');
    let cardId = args.cardId;
    if (args.kind === 'argument' && cardId === undefined) {
      cardId = Math.min(argumentCallbacks.length, Math.max(1, 1+Math.floor(random()*argumentCallbacks.length)));
      if (cardId === lastCard) cardId = cardId % argumentCallbacks.length + 1;
    }
    const {record} = prepareDyadInput({...args,cardId});
    const current = ++revision;
    const controller = active = new AbortController();
    const signal = AbortSignal.any([controller.signal,...(args.signal?[args.signal]:[])]);
    Object.assign(state,{state:'generating',calls:state.calls+1,line_count:0,rage_bonus:false});
    try {
      const raw = await complete({messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(record)}],signal,responseSchema:schemaForRecord(record)});
      signal.throwIfAborted();
      if (current !== revision) throw new DOMException('Stale dyad generation','AbortError');
      const plan = validateDyad(raw,record);
      lastCard = cardId;
      Object.assign(state,{state:'ready',line_count:plan.lines.length,rage_bonus:plan.rage_bonus});
      return plan;
    } catch (error) {
      if (current === revision) Object.assign(state,{state:signal.aborted?'cancelled':'failed',line_count:0,rage_bonus:false});
      throw error;
    } finally {
      if (active === controller) active = undefined;
    }
  }};
}

// Explicit opt-in; future host wiring must supply its existing GOLD/ARGUE routes.
// No warmup or speculative callbacks can launch an extra dyad request.
export function routeDyad({gold,argument,dyad,enabled}) {
  return {director:{warmup:() => gold.warmup(),generate:args => (enabled()?dyad:gold).generate(args)},
    argumentDirector:{status:() => enabled()?dyad.status():argument.status(),generate:args => (enabled()?dyad:argument).generate({...args,kind:'argument'})}};
}

import {dyadSchema} from './contract.mjs';
export const sampling = Object.freeze({max_tokens:1024,temperature:1,top_p:1,stream:false,chat_template_kwargs:Object.freeze({enable_thinking:false})});

export function createDyadCompletion({endpoint,model='qwen3.8-27b',request=fetch,timeoutMs=90000}={}) {
  const url = new URL(endpoint);
  const octets = url.hostname.split('.').map(Number);
  if (model !== 'qwen3.8-27b' || url.protocol !== 'http:' || url.username || url.password || url.search || url.hash ||
      url.port !== '1234' || !['/','/v1/chat/completions'].includes(url.pathname) ||
      octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n<0 || n>255) ||
      octets[0] !== 100 || octets[1]<64 || octets[1]>127) throw Error('Dyad requires the approved V620 endpoint and model');
  if (!Number.isInteger(timeoutMs) || timeoutMs<1 || timeoutMs>90000) throw Error('Invalid writer timeout');
  url.pathname = '/v1/chat/completions';
  let busy = false;
  return async ({messages,signal,responseSchema=dyadSchema,onResult}) => {
    signal?.throwIfAborted();
    if (busy) throw Error('Dyad writer is busy');
    if (!Array.isArray(messages) || JSON.stringify(messages).length>85000) throw Error('Dyad context exceeds its bounded budget');
    const combined = AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
    busy = true;
    try {
      const response = await request(url.href,{method:'POST',redirect:'error',signal:combined,headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model,messages,...sampling,response_format:{type:'json_schema',json_schema:{name:'stank_dyad',schema:responseSchema}}})});
      if (!response.ok) { await response.body?.cancel(); throw Error('Dyad V620 HTTP '+response.status); }
      const value = await response.json();
      combined.throwIfAborted();
      const choice = value.choices?.[0];
      // Complete response audit only, never a speculative playback callback.
      onResult?.({raw:typeof choice?.message?.content==='string'?choice.message.content.slice(0,8000):null,usage:value.usage,finish_reason:choice?.finish_reason});
      if (value.choices?.length !== 1 || choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string' ||
          choice.message.content.length>8000 || choice.message.tool_calls?.length || choice.message.reasoning_content || /<\/?think>/i.test(choice.message.content)) throw Error('Dyad answer incomplete');
      combined.throwIfAborted();
      return choice.message.content;
    } finally { busy=false; }
  };
}

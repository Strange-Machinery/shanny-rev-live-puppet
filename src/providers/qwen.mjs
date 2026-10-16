import { performance } from 'node:perf_hooks';
import { readJson } from '../http-json.mjs';
import { readQwenStream } from './qwen-stream.mjs';

/** Calls an already provisioned endpoint. Never loads/downloads a model. */
export function createQwenCompletion({ endpoint, model, apiKey = '', timeoutMs = 6000,
  maxTokens = 192, temperature = 1, topP = 1,
  placement, resourceHeadroomVerified = false, request = fetch,
  responseFormat = 'llamacpp', trustedTailnetHost = null,
  onTiming = () => {} } = {}) {
  const url = new URL(endpoint);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  // A deliberate, exact private Tailscale HTTP peer is permitted only when
  // configured as an off-device LM Studio writer. No generic plaintext LAN,
  // public host, URL credentials or redirect are accepted.
  const tailnet = responseFormat === 'lmstudio' && placement === 'off-device' &&
    typeof trustedTailnetHost === 'string' &&
    /^100\.(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(trustedTailnetHost) &&
    url.hostname === trustedTailnetHost && url.port === '1234';
  if (url.username || url.password || url.search || url.hash ||
      url.pathname !== '/v1/chat/completions' ||
      !(url.protocol === 'https:' || (loopback && url.protocol === 'http:') ||
        (tailnet && url.protocol === 'http:'))) {
    throw new Error('Qwen requires HTTPS, loopback HTTP or explicitly trusted Tailscale LM Studio HTTP /v1/chat/completions');
  }
  if (!['off-device', 'cpu', 'local-gpu'].includes(placement) ||
      (!loopback && placement !== 'off-device') ||
      (placement === 'local-gpu' && resourceHeadroomVerified !== true)) {
    throw new Error('Declare Qwen placement; local GPU requires verified resource headroom');
  }
  if (!['llamacpp','lmstudio'].includes(responseFormat) ||
      (responseFormat === 'lmstudio' && placement !== 'off-device') ||
      (responseFormat === 'llamacpp' && tailnet) ||
      typeof model !== 'string' || !model.trim() || model.length > 200 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000 ||
      !Number.isInteger(maxTokens) || maxTokens < 32 || maxTokens > 512 ||
      typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2 ||
      typeof topP !== 'number' || !Number.isFinite(topP) || topP <= 0 || topP > 1) {
    throw new Error('Invalid Qwen model or budgets');
  }
  let busy = false;
  return async ({ messages, signal, responseSchema, onText }) => {
    if (busy) throw new Error('Qwen concurrency limit reached');
    if (!Array.isArray(messages) || JSON.stringify(messages).length > 12_000) throw new Error('Qwen prompt budget exceeded');
    signal?.throwIfAborted();
    busy = true;
    const start = performance.now();
    const combined = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    try {
      const streaming = responseFormat === 'llamacpp' && typeof onText === 'function';
      const reply = await request(url.href, {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}) },
        body: JSON.stringify({ model, messages, stream: streaming, max_tokens: maxTokens,
          temperature, top_p: topP,
          response_format: responseFormat === 'lmstudio' && responseSchema
            ? {type:'json_schema',json_schema:{name:'buff_character_exchange',schema:responseSchema}}
            : { type:'json_object', ...(responseSchema?{schema:responseSchema}:{}) },
          chat_template_kwargs: { enable_thinking: false } })
      });
      // Header arrival is not TTFT for a non-streaming endpoint.
      // It is recorded separately to distinguish request/server work
      // from response-body transfer without exposing any prompt or text.
      const responseHeadersMs=performance.now()-start;
      // Do not echo remote errors: they may contain private prompt text.
      if (!reply.ok) { await reply.body?.cancel(); throw new Error('Qwen HTTP ' + reply.status); }
      if(streaming){
        let firstContentMs=null;
        const content=await readQwenStream(reply,combined,raw=>{
          if(firstContentMs===null&&raw.length>0)firstContentMs=performance.now()-start;
          onText(raw);
        });
        onTiming({model,completion_ms:performance.now()-start,
          response_headers_ms:responseHeadersMs,first_content_ms:firstContentMs,status:'ok'});
        return content;
      }
      const value = await readJson(reply, 16_000);
      combined.throwIfAborted();
      const choice = value.choices?.[0];
      if (value.choices?.length !== 1 || choice?.finish_reason !== 'stop' ||
          typeof choice.message?.content !== 'string' || choice.message.content.length > 4000 ||
          choice.message.tool_calls?.length || choice.message.reasoning_content ||
          /<\/?think>/i.test(choice.message.content)) {
        throw new Error('Qwen output truncated, thinking, or malformed');
      }
      // Token counts are provided by the serving backend only when known.
      // This is a total request duration, not decode-only tokens/second.
      const usage=value.usage||{};
      onTiming({model,completion_ms:performance.now()-start,
        response_headers_ms:responseHeadersMs,
        ...(Number.isSafeInteger(usage.prompt_tokens)&&usage.prompt_tokens>=0?{prompt_tokens:usage.prompt_tokens}:{}),
        ...(Number.isSafeInteger(usage.completion_tokens)&&usage.completion_tokens>=0?{completion_tokens:usage.completion_tokens}:{}),
        status:'ok'});
      // Remote LM Studio is non-streaming; never expose unvalidated partial
      // remote text to TTS's speculative voice-preparation callback.
      if (typeof onText === 'function') onText(choice.message.content);
      return choice.message.content;
    } catch(error) {
      const localTimeout=combined.aborted&&!signal?.aborted &&
        combined.reason?.name==='TimeoutError';
      if(localTimeout){
        onTiming({model,completion_ms:performance.now()-start,status:'timeout'});
        throw new Error('Qwen '+(placement==='off-device'?'remote':'CPU')+' timeout after '+timeoutMs+' ms');
      }
      onTiming({model,completion_ms:performance.now()-start,
        status:signal?.aborted?'cancelled':'error'});
      throw error;
    } finally { busy = false; }
  };
}

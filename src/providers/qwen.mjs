import { performance } from 'node:perf_hooks';
import { readJson } from '../http-json.mjs';
import { readQwenStream } from './qwen-stream.mjs';

/** Calls an already provisioned endpoint. Never loads/downloads a model. */
export function createQwenCompletion({ endpoint, model, apiKey = '', timeoutMs = 6000,
  maxTokens = 192, temperature = 1, topP = 1,
  placement, resourceHeadroomVerified = false, request = fetch,
  onTiming = () => {} } = {}) {
  const url = new URL(endpoint);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      url.pathname !== '/v1/chat/completions' ||
      !(url.protocol === 'https:' || (loopback && url.protocol === 'http:'))) {
    throw new Error('Qwen requires HTTPS or loopback HTTP /v1/chat/completions');
  }
  if (!['off-device', 'cpu', 'local-gpu'].includes(placement) ||
      (!loopback && placement !== 'off-device') ||
      (placement === 'local-gpu' && resourceHeadroomVerified !== true)) {
    throw new Error('Declare Qwen placement; local GPU requires verified resource headroom');
  }
  if (typeof model !== 'string' || !model.trim() || model.length > 200 ||
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
      const reply = await request(url.href, {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}) },
        body: JSON.stringify({ model, messages, stream: typeof onText==='function', max_tokens: maxTokens,
          temperature, top_p: topP, response_format: { type: 'json_object', ...(responseSchema?{schema:responseSchema}:{}) },
          chat_template_kwargs: { enable_thinking: false } })
      });
      // Do not echo remote errors: they may contain private prompt text.
      if (!reply.ok) { await reply.body?.cancel(); throw new Error('Qwen HTTP ' + reply.status); }
      if(typeof onText==='function'){
        const content=await readQwenStream(reply,combined,onText);
        onTiming({model,completion_ms:performance.now()-start});return content;
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
      onTiming({ model, completion_ms: performance.now() - start });
      return choice.message.content;
    } finally { busy = false; }
  };
}

/** Bounded OpenAI-compatible SSE reader. Partial text may prepare audio only. */
export async function readQwenStream(reply,signal,onText) {
  if(!reply.body)throw new Error('Missing Qwen stream');
  const reader=reply.body.getReader(),decoder=new TextDecoder();
  let pending='',content='',bytes=0,finished=false,doneMarker=false;
  const abort=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});
  try {
    while(true){
      signal.throwIfAborted();
      const chunk=await reader.read();signal.throwIfAborted();
      if(chunk.done)break;
      bytes+=chunk.value.byteLength;
      if(bytes>128000)throw new Error('Oversized Qwen stream');
      pending+=decoder.decode(chunk.value,{stream:true});
      let end;
      while((end=pending.indexOf('\n'))!==-1){
        const row=pending.slice(0,end).trim();pending=pending.slice(end+1);
        if(!row||row.startsWith(':'))continue;
        if(!row.startsWith('data:'))throw new Error('Malformed Qwen stream');
        const data=row.slice(5).trim();
        if(data==='[DONE]'){doneMarker=true;continue;}
        if(doneMarker)throw new Error('Data after Qwen stream end');
        let value;try{value=JSON.parse(data);}catch{throw new Error('Malformed Qwen stream');}
        if(value.choices?.length===0&&value.usage)continue;
        const choice=value.choices?.[0],delta=choice?.delta;
        if(value.choices?.length!==1||choice.index!==0||!delta||delta.tool_calls?.length||
          delta.reasoning_content||delta.reasoning||
          (delta.content!=null&&typeof delta.content!=='string')||finished){
          throw new Error('Qwen output truncated, thinking, or malformed');
        }
        content+=delta.content||'';
        if(content.length>4000||/<\/?think>/i.test(content))throw new Error('Qwen output truncated, thinking, or malformed');
        if(choice.finish_reason!=null){
          if(choice.finish_reason!=='stop')throw new Error('Qwen output truncated, thinking, or malformed');
          finished=true;
        }
        onText(content);
      }
      if(pending.length>16000)throw new Error('Oversized Qwen stream frame');
    }
    if(!finished||!doneMarker||pending.trim())throw new Error('Incomplete Qwen stream');
    return content;
  } finally {
    signal.removeEventListener('abort',abort);
    await reader.cancel().catch(()=>{});reader.releaseLock();
  }
}

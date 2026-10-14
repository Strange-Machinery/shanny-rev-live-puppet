import test from 'node:test';
import assert from 'node:assert/strict';
import {createQwenCompletion} from '../src/providers/qwen.mjs';
import {firstStreamedLine,createConversationDirector} from '../src/conversation-director.mjs';
const settings={endpoint:'http://127.0.0.1:1234/v1/chat/completions',model:'test',placement:'cpu'};
const frame=(content,finish_reason=null,extra={})=>'data: '+JSON.stringify({choices:[{index:0,delta:{content,...extra},finish_reason}]})+'\r\n\r\n';
function response(data){return new Response(new ReadableStream({start(c){
 const bytes=new TextEncoder().encode(data);for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();
}}));}
test('stream handles split frames and Unicode, exposing partial text before completion',async()=>{
 const parts=[];let sent;
 const complete=createQwenCompletion({...settings,request:async(u,o)=>{sent=JSON.parse(o.body);return response(frame('Hello, ')+frame('Buff’s show.')+frame('', 'stop')+'data: [DONE]\n\n');}});
 assert.equal(await complete({messages:[],onText:x=>parts.push(x)}),'Hello, Buff’s show.');
 assert.equal(sent.stream,true);assert.equal(parts[0],'Hello, ');
});
for(const [name,data] of [
 ['truncated',frame('partial','length')+'data: [DONE]\n\n'],
 ['unfinished',frame('partial')],
 ['missing done',frame('partial','stop')],
 ['thinking',frame('',null,{reasoning_content:'hidden'})],
 ['oversized',frame('x'.repeat(4001))],
 ['post-stop text',frame('ok','stop')+frame('more')+'data: [DONE]\n\n']
])test('stream rejects '+name,async()=>{
 const complete=createQwenCompletion({...settings,request:async()=>response(data)});
 await assert.rejects(complete({messages:[],onText:()=>{}}));
});
test('stream abort cancels a blocked reader and permits another request',async()=>{
 let cancelled=false;const controller=new AbortController();
 const complete=createQwenCompletion({...settings,request:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))});
 const result=complete({messages:[],signal:controller.signal,onText:()=>{}});
 await new Promise(r=>setTimeout(r,10));controller.abort();
 await assert.rejects(result,/abort/i);assert.equal(cancelled,true);
});
test('first-line extraction waits for a complete bounded JSON row',()=>{
 const row={actor:'SHANNY',text:'That is my soda.'};
 assert.deepEqual(firstStreamedLine('{"lines":['+JSON.stringify(row)+','),row);
 assert.equal(firstStreamedLine('{"lines":['+JSON.stringify(row).slice(0,-2)),null);
 assert.equal(firstStreamedLine('{"lines":[{"actor":"SHANNY","text":"One. Two."},'),null);
 assert.equal(firstStreamedLine('{"lines":[{"actor":"SHANNY","text":"Wait.","extra":1},'),null);
});
test('director prepares once but rejects an invalid remainder',async()=>{
 const rows=[];
 const director=createConversationDirector({notes:'Private',complete:async({onText})=>{
   const raw='{"lines":[{"actor":"SHANNY","text":"That is mine."},';
   onText(raw);onText(raw);return '{"lines":[],"rev_reason":""}';
 }});
 await assert.rejects(director.generate({kind:'microphone',text:'Who owns it?',onFirstLine:r=>rows.push(r)}),/budget/);
 assert.equal(rows.length,1);
});

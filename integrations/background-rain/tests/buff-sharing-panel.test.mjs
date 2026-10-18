import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../src/remote-web/panel.js',import.meta.url),'utf8');
async function panel(remote=false){
 const elements=new Map(),requests=[];let copied='',opened='';
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,select(){}});return elements.get(id);};
 const origin=remote?'https://trial.trycloudflare.com':'http://127.0.0.1:17861';
 const context={document:{getElementById:element},location:{hostname:remote?'trial.trycloudflare.com':'127.0.0.1',origin,pathname:'/',hash:'#key=fixture'},
  URL,URLSearchParams,Date,history:{replaceState(){}},sessionStorage:{getItem(){return '';},setItem(){}},setInterval(){},
  navigator:{clipboard:{writeText:async value=>{copied=value;}}},window:{open:value=>{opened=value;}},
  fetch:async(path,options)=>{requests.push({path,options});const data=path==='/api/buff-link'?{state:'ready',origin:'https://fresh.trycloudflare.com',message:'Ready'}:
   path==='/api/obs-link'?{url:'https://fresh.trycloudflare.com/stage#key=viewer'}:{mode:'muted',dyad:{enabled:true,available:true}};
   return {ok:true,json:async()=>data};}};
 vm.runInNewContext(source,context);
 for(let n=0;n<5;n++)await new Promise(setImmediate);
 return {element,requests,get copied(){return copied;},get opened(){return opened;}};
}
test('producer buttons request renewal and copy the newly verified private HTTPS link',async()=>{
 const p=await panel();assert.equal(p.element('buff-sharing').hidden,false);
 await p.element('new-buff-link').onclick();
 const request=p.requests.find(x=>x.path==='/api/buff-link'&&x.options.method==='POST');assert.equal(request.options.body,'{}');
 await p.element('copy-buff-link').onclick();assert.equal(p.copied,'https://fresh.trycloudflare.com/#key=fixture');
 await p.element('open-live').onclick();assert.equal(p.opened,'http://127.0.0.1:17861/live#key=viewer');
});
test('Buff remote panel hides producer renewal controls and does not query their endpoint',async()=>{
 const p=await panel(true);assert.equal(p.element('buff-sharing').hidden,true);
 assert.equal(p.requests.some(x=>x.path==='/api/buff-link'),false);
});

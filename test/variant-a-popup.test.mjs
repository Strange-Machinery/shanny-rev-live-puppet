import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStageMedia} from '../src/stage-media.mjs';
import {preparePopupDetails} from '../src/popup-details.mjs';
import {popupView} from '../src/remote-web/popup-view.js';

const token='local-popup-test-secret'.repeat(3);
const details={provider:'youtube',donor:'BUFF FAN',amount:17.50,currency:'USD'};
async function source(t){
  const stage=await createStageMedia({token});
  t.after(()=>stage.close());
  const post=async(route,body)=>{
    const res=await fetch(stage.url+route,{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    assert.equal(res.status,200);
    return res.json();
  };
  await post('/poll',{state:'ready'});
  return {stage,post};
}
async function commandReceipt(stage,post,expected){
  const pending=stage.animate({id:expected,targets:['SHANNY','REV']});
  const poll=await post('/poll',{state:'ready'});
  assert.equal(poll.commands.length,1);
  assert.equal(poll.commands[0].alias,expected);
  await post('/command-receipt',{id:poll.commands[0].id,accepted:true});
  await pending;
}
test('donation popup accepts only verified public name, amount and message',()=>{
  const payload=preparePopupDetails({kind:'donation',donation:details,text:'Thanks, <script>alert(1)</script>!'});
  assert.deepEqual(payload,{type:'donation',donor:'BUFF FAN',amount:17.5,currency:'USD',
    message:'Thanks, <script>alert(1)</script>!'});
  assert.equal('donation_id' in payload,false);
  assert.equal('token' in payload,false);
  const view=popupView({available:true,presentation_visible:true,popup:payload});
  assert.equal(view.visible,true);assert.equal(view.kind,'donation');
  assert.equal(view.amount,'$17.50 USD');
  assert.equal(view.donor,'BUFF FAN');
  assert.equal(view.message,'Thanks, <script>alert(1)</script>!');
  for(const invalid of [{...details,provider:'unknown'},{...details,amount:-10},
      {...details,currency:'usd'},{...details,donor:2}]){
    assert.throws(()=>preparePopupDetails({kind:'donation',donation:invalid,text:'Hello'}));
  }
});
test('hotmic has no Buff transcription or fake donation in public UI',()=>{
  const prepared=preparePopupDetails({kind:'microphone',text:'private Whisper transcript',donation:details});
  assert.deepEqual(prepared,{type:'hotmic'});
  const view=popupView({available:true,presentation_visible:true,popup:prepared});
  assert.equal(view.heading,'LIVE RESPONSE');
  assert.equal(view.donor,'');assert.equal(view.amount,'');assert.equal(view.message,'');
});
test('missing, expired or malformed metadata cannot display stale donor information',()=>{
  const payload={type:'donation',donor:'DONOR',amount:5,currency:'USD',message:'hi'};
  for(const info of [
    {available:false,presentation_visible:true,popup:payload},
    {available:true,presentation_visible:false,popup:payload},
    {available:true,presentation_visible:true,popup:null},
    {available:true,presentation_visible:true,popup:{...payload,amount:'five'}}
  ])assert.equal(popupView(info).visible,false);
});
test('public metadata is invisible until the native player acknowledges reveal; caption follows receipt',async t=>{
  const {stage,post}=await source(t);
  stage.setPopup({type:'donation',donor:'STREAMER',amount:7.25,currency:'USD',
    message:'That is hilarious.'});
  assert.equal(stage.info().popup,null);
  assert.equal(stage.info().presentation_visible,false);
  await commandReceipt(stage,post,'seated_response');
  const ready=stage.info();
  assert.equal(ready.presentation_visible,true);
  assert.deepEqual(ready.popup,{type:'donation',donor:'STREAMER',amount:7.25,currency:'USD',
    message:'That is hilarious.'});
  stage.setCaption({actor:'SHANNY',text:'I have some things to say!'});
  assert.deepEqual(stage.info().caption,{actor:'SHANNY',text:'I have some things to say!'});
  stage.setCaption(null);assert.equal(stage.info().caption,null);
  stage.setCaption({actor:'REV',text:'That is not what happened.'});
  assert.equal(stage.info().caption.actor,'REV');
  await commandReceipt(stage,post,'presentation_end');
  assert.equal(stage.info().presentation_visible,false);
  assert.equal(stage.info().popup,null);
  assert.equal(stage.info().caption,null);
});
test('manual membership celebration exposes no payment fields and hides on native end receipt',async t=>{
  const {stage,post}=await source(t);
  stage.setPopup({type:'celebration',donor:'SHOULD_NOT_APPEAR',amount:999});
  await commandReceipt(stage,post,'make_it_rain');
  const state=stage.info();
  assert.deepEqual(state.popup,{type:'celebration'});
  assert.equal(popupView(state).heading,'MEMBERSHIP BOMB · MAKE IT RAIN');
  assert.equal(popupView(state).amount,'');
  await commandReceipt(stage,post,'presentation_end');
  assert.equal(stage.info().popup,null);
  assert.equal(stage.info().presentation_visible,false);
});
test('Shut up and STOP clear public fields immediately and reject spoofed subtitle actor',async t=>{
  const {stage,post}=await source(t);
  stage.setPopup({type:'hotmic'});
  await commandReceipt(stage,post,'seated_response');
  assert.throws(()=>stage.setCaption({actor:'BUFF',text:'Whisper says please'}));
  stage.setCaption({actor:'SHANNY',text:'This is my answer.'});
  stage.stopAnimations();
  assert.equal(stage.info().presentation_visible,false);
  assert.equal(stage.info().popup,null);assert.equal(stage.info().caption,null);
  assert.equal(popupView(stage.info()).visible,false);
});
test('Variant A is contained in top-left of a transparent OBS page, with no external font requests',()=>{
  const html=readFileSync(new URL('../src/remote-web/stage.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../src/remote-web/stage.css',import.meta.url),'utf8');
  const script=readFileSync(new URL('../src/remote-web/stage-page.js',import.meta.url),'utf8');
  assert.match(html,/id="stank-popup"/);assert.match(html,/id="actor-caption"/);
  assert.match(html,/id="donor-name"/);assert.match(html,/id="donation-amount"/);
  assert.match(css,/background:transparent!important/);
  assert.match(css,/top:27px;left:29px/);
  assert.match(css,/\.stank-popup\[data-kind="hotmic"\] \.donation-plaque\{display:none\}/);
  assert.doesNotMatch(css,/@import|fonts\.googleapis|url\(["']?https?:/i);
  assert.match(script,/video\.muted=true/);
  assert.match(script,/donor\.textContent=view\.donor/);
  assert.match(script,/subtitleWords\.textContent=line\.text/);
  assert.doesNotMatch(script,/innerHTML/);
});

test('OBS presentation acknowledgment requires view-only role and current visible nonce',async t=>{
  const {stage,post}=await source(t);
  const obs=stage.viewer({action:'media-open',viewer_role:'obs'});
  const preview=stage.viewer({action:'media-open',viewer_role:'preview'});
  stage.setPopup({type:'hotmic'});
  await commandReceipt(stage,post,'seated_response');
  const nonce=stage.info().presentation_nonce;
  assert.match(nonce,/^[a-f0-9-]{36}$/);
  assert.throws(()=>stage.viewer({action:'media-presented',id:preview.id,nonce}),/unauthorized/);
  const waiting=stage.waitForViewer({timeoutMs:800});
  assert.deepEqual(stage.viewer({action:'media-presented',id:obs.id,nonce}),{accepted:true});
  assert.equal(await waiting,true);
  await commandReceipt(stage,post,'presentation_end');
  assert.throws(()=>stage.viewer({action:'media-presented',id:obs.id,nonce}),/Stale/);
  assert.equal(stage.info().presentation_nonce,null);
});
test('producer without an OBS viewer receives a bounded preroll without blocking synthesis',async t=>{
  const {stage,post}=await source(t);
  stage.setPopup({type:'test',message:'Local only'});
  await commandReceipt(stage,post,'seated_response');
  const start=Date.now();
  const ready=await stage.waitForViewer({timeoutMs:800});
  const ms=Date.now()-start;
  assert.equal(ready,false);
  assert.ok(ms>=380&&ms<1500,'preroll should be roughly 420ms, observed '+ms);
});

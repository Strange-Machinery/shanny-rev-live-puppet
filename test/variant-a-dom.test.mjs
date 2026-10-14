import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {StagePlayer} from '../src/remote-web/stage-player.js';

test('actual OBS DOM hides/clears audio and text, shows donor only for paid alerts, and captions only character speech',async()=>{
  const original={connect:StagePlayer.prototype.connect,api:StagePlayer.prototype.api,
    document:globalThis.document,window:globalThis.window,
    history:globalThis.history,location:globalThis.location};
  let player;const sent=[];
  const elements={};
  class Element {
    constructor(){this.hidden=false;this.style={};this.dataset={};
      this.textContent='';this.muted=true;this.paused=false;this.readyState=3;this.srcObject=null;}
    set innerHTML(_) {throw new Error('Untrusted popup content must never use innerHTML');}
    play(){this.paused=false;return Promise.resolve();}
  }
  const $=id=>elements[id]??(elements[id]=new Element());
  try {
    globalThis.document={getElementById:$};
    globalThis.window={addEventListener:()=>{},stageStats:null};
    globalThis.history={replaceState:()=>{}};
    globalThis.location={hash:'#key=PRIVATE_TEST_KEY',pathname:'/stage'};
    StagePlayer.prototype.connect=function(){player=this;this.pc={connectionState:'connected'};return Promise.resolve();};
    StagePlayer.prototype.api=async function(value){sent.push(value);return {accepted:true};};
    await import('../src/remote-web/stage-page.js?test=variantA-DOM');
    assert.ok(player);
    assert.equal($('stank-popup').hidden,true);
    assert.equal($('stage').muted,true);
    const donation={available:true,presentation_visible:true,presentation_nonce:'nonce-01',
      popup:{type:'donation',donor:'<img src=x onerror=1>',amount:10,currency:'USD',
        message:'Dude <script>evil</script> is a donor comment!'},
      caption:{actor:'SHANNY',text:'I read your donation!'}};
    player.onPresentation(true,donation);
    await delay(0);
    assert.equal($('stank-popup').hidden,false);
    assert.equal($('stank-popup').dataset.kind,'donation');
    assert.equal($('donor-name').textContent,'<img src=x onerror=1>');
    assert.equal($('donation-message').textContent,'Dude <script>evil</script> is a donor comment!');
    assert.equal($('donation-amount').textContent,'$10.00 USD');
    assert.equal($('subtitle-actor').textContent,'Shanny');
    assert.equal($('subtitle-words').textContent,'I read your donation!');
    assert.equal($('stage').muted,false);
    assert.equal(sent.at(-1).action,'media-presented');
    player.onPresentation(false,{available:true,presentation_visible:false,popup:null});
    assert.equal($('stank-popup').hidden,true);
    assert.equal($('stage').muted,true);
    assert.equal($('donation-message').textContent,'');
    assert.equal($('subtitle-words').textContent,'');
    // A hotmic response must never disclose what Whisper transcribed.
    const hotmic={available:true,presentation_visible:true,presentation_nonce:'nonce-02',
      popup:{type:'hotmic'},caption:{actor:'REV',text:'Oh come on.'}};
    player.onPresentation(true,hotmic);
    await delay(0);
    assert.equal($('stank-popup').dataset.kind,'hotmic');
    assert.equal($('alert-label').textContent,'LIVE RESPONSE');
    assert.equal($('donor-name').textContent,'');
    assert.equal($('donation-amount').textContent,'');
    assert.equal($('donation-message').textContent,'');
    assert.equal($('subtitle-words').textContent,'Oh come on.');
    assert.equal($('subtitle-actor').textContent,'Rev');
    player.onPresentation(false,{available:false,presentation_visible:false});
    assert.equal($('stage').muted,true);
    assert.equal($('subtitle-words').textContent,'');
  } finally {
    StagePlayer.prototype.connect=original.connect;StagePlayer.prototype.api=original.api;
    for(const key of ['document','window','history','location'])
      if(original[key]===undefined)delete globalThis[key];
      else globalThis[key]=original[key];
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMessageScroller} from '../src/remote-web/message-scroll.js';
import {popupView} from '../src/remote-web/popup-view.js';

const text=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=text('src/remote-web/stage.html');
const css=text('src/remote-web/stage.css');
const stageScript=text('src/remote-web/stage-page.js');
const panel=text('src/remote-web/index.html');
const launcherScript=text('src/remote-web/panel.js');

test('approved painted border replaces primitive SVG and preserves all public stage text elements',()=>{
  assert.match(html,/class="painted-frame"/);
  assert.doesNotMatch(html,/<svg\b|class="goo |mucus-strand/);
  assert.match(html,/STANK TANK AI|Stank Tank AI/);
  for(const id of ['stage','actor-caption','subtitle-actor','subtitle-words',
    'donor-name','donation-amount','donation-message','message-viewport',
    'message-progress','painted-strap'])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(css,/border-image-source:url\("\/popup-art\.webp"\)/);
  assert.match(css,/border-image-slice:220 102 309 102 fill/);
  assert.match(css,/border-image-repeat:stretch/);
  assert.match(css,/left:66px;top:125px/);
  assert.match(css,/width:648px;height:364\.5px/);
  assert.match(css,/border-image-source:url\("\/popup-hotmic\.webp"\)/);
  assert.match(css,/border-image-source:url\("\/popup-art-still\.webp"\)/);
  assert.match(css,/border-image-source:url\("\/popup-hotmic-still\.webp"\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(stageScript,/new Image\(\)/);
  assert.doesNotMatch(stageScript,/innerHTML|eval\(/);
  assert.match(css,/background:transparent!important/);
  assert.match(css,/\.stank-popup\[data-kind="hidden"\]\{display:none!important\}/);
  assert.doesNotMatch(css,/@import|fonts\.googleapis|url\(["']?https?:/i);
});

test('hotmic and manual money rain show no fake donor or amount',()=>{
  for(const kind of ['hotmic','celebration']){
    const p=popupView({available:true,presentation_visible:true,popup:{type:kind}});
    assert.equal(p.visible,true);assert.equal(p.kind,kind);
    assert.equal(p.amount,'');assert.equal(p.donor,'');assert.equal(p.message,'');
    assert.match(p.heading,/LIVE RESPONSE|MEMBERSHIP BOMB/);
  }
  assert.equal(popupView({available:true,presentation_visible:false,
    popup:{type:'celebration'}}).visible,false);
  assert.match(css,/\[data-kind="celebration"\].*\.donation-plaque\{display:none\}/);
});

test('Buff has distinct manual command and $100 USD override without impersonating donations',()=>{
  assert.match(panel,/id="rain-now"/);
  assert.match(panel,/MAKE IT RAIN NOW!/);
  assert.match(panel,/USD \$100\+/);
  assert.match(launcherScript,/action:'rain-now'/);
  const host=text('src/real-host.mjs');
  assert.match(host,/data\.action==='rain-now'/);
  assert.match(host,/session\.startRainNow\(\)/);
  assert.match(host,/queue\?\.enabled&&\(paid\?\.pending>0\|\|paid\?\.inflight>0\|\|queue\.task\)/);
  assert.match(host,/Paid donations are waiting; manual rain is available when the queue is idle/);
  assert.match(launcherScript,/lastQueueDepth=Math\.max\(0,Number\(d\.pending\)/);
  assert.match(launcherScript,/donationsEnabled&&lastQueueDepth>0/);
  const session=text('src/conversation-session.mjs');
  assert.match(session,/startRainNow\(\)/);
  assert.match(session,/popup:\{type:'celebration'\}/);
  assert.doesNotMatch(session.slice(session.indexOf('startRainNow()'),session.indexOf('async run(turn)')),/kind:'donation'|gateway\.speak|director\.generate/);
  const donations=text('src/donations/live-donations.mjs');
  assert.match(donations,/item\.currency==='USD'&&item\.amount>=100/);
  assert.match(donations,/make_it_rain:this\.make_it_rain\|\|highValueRain/);
});

test('long message progresses downward once and is cancelled instantly on hide',()=>{
  let now=0,next=1;
  const callbacks=new Map();
  const requestFrame=fn=>{const id=next++;callbacks.set(id,fn);return id;};
  const cancelFrame=id=>callbacks.delete(id);
  const tick=ms=>{now+=ms;const current=[...callbacks.entries()];
    callbacks.clear();for(const [,fn] of current)fn(now);};
  const viewport={scrollTop:0,clientHeight:42};
  const content={textContent:'',scrollHeight:652};
  const progress={textContent:'',hidden:true};
  const scroller=createMessageScroller({viewport,content,progress,
    now:()=>now,requestFrame,cancelFrame});
  const message='This is a lengthy paid donation. '.repeat(28);
  scroller.show({text:message,nonce:'payment-1'});
  assert.equal(content.textContent,message);
  assert.equal(progress.hidden,false);
  assert.equal(viewport.scrollTop,0);
  assert.match(progress.textContent,/↓ 1 \/ /);
  tick(1800);tick(13000);
  const partial=viewport.scrollTop;
  assert.ok(partial>20&&partial<610,'message should move through the viewport');
  scroller.show({text:message,nonce:'payment-1'}); // periodic media poll
  assert.equal(viewport.scrollTop,partial,'same public nonce must not rewind');
  tick(79000);
  assert.equal(Math.round(viewport.scrollTop),610);
  scroller.reset();assert.equal(viewport.scrollTop,0);
  assert.equal(progress.hidden,true);assert.equal(callbacks.size,0);
  scroller.show({text:'New donation',nonce:'payment-2'});
  assert.equal(content.textContent,'New donation');
  scroller.reset();
});

test('reduced-motion viewers get discrete page positions instead of continuous scrolling',()=>{
  let now=0,callback;
  const viewport={scrollTop:0,clientHeight:50},content={textContent:'',scrollHeight:300};
  const progress={textContent:'',hidden:true};
  const scroller=createMessageScroller({viewport,content,progress,
    now:()=>now,requestFrame:fn=>(callback=fn,1),cancelFrame:()=>{callback=null},
    reducedMotion:()=>true});
  scroller.show({text:'A'.repeat(400),nonce:'reduced'});
  now=2000;callback(now);assert.equal(viewport.scrollTop,0);
  now=12500;callback(now);
  assert.equal(viewport.scrollTop%50,0);
  assert.ok(viewport.scrollTop>0);
  scroller.reset();assert.equal(callback,null);
});

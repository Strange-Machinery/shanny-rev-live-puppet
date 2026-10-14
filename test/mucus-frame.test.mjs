import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../src/remote-web/stage.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/remote-web/stage.css',import.meta.url),'utf8');
const shellBefore=html.split('<div class="popup-rim">')[0];

test('STANK TANK AI branding retains the production billing and live camera bug',()=>{
  assert.match(html,/<title>Stank Tank AI — Buff OBS alert<\/title>/);
  assert.match(html,/STRANGE MACHINERY PRESENTS/);
  assert.match(html,/<strong class="brand-wordmark" aria-label="Stank Tank AI">/);
  assert.match(html,/<span class="brand-ai">AI<\/span>/);
  assert.match(html,/THE STANK TANK<\/span>/);
  assert.match(css,/\.brand-wordmark \.brand-ai/);
});

test('one self-contained art layer per TOP, LOWER LEFT, LOWER RIGHT, BOTTOM: no public media or controls moved',()=>{
  const layers=[...shellBefore.matchAll(/<svg class="mucus-layer (mucus-layer--[\w-]+)" data-mucus-zone="([\w-]+)" viewBox="0 0 (\d+) (\d+)"[^>]*>/g)];
  assert.deepEqual(layers.map(x=>x[2]),['top','lower-left','lower-right','bottom']);
  assert.deepEqual(layers.map(x=>[Number(x[3]),Number(x[4])]),[[820,42],[70,230],[70,230],[820,116]]);
  assert.equal((html.match(/<svg\b/g)||[]).length,4);
  assert.equal((html.match(/<\/svg>/g)||[]).length,4);
  assert.equal((html.match(/aria-hidden="true" focusable="false"/g)||[]).length,4);
  assert.equal((html.match(/<defs>/g)||[]).length,4);
  assert.equal((html.match(/<\/defs>/g)||[]).length,4);
  assert.match(html,/<section class="stage-well"/);
  assert.match(html,/<video id="stage" autoplay playsinline><\/video>/);
  assert.match(html,/id="actor-caption"/);
  assert.match(html,/id="donation-message"/);
  assert.match(css,/aspect-ratio:16\/9/);
  assert.match(css,/background:transparent!important/);
  assert.match(css,/\[hidden\],\.stank-popup\[hidden\]/);
  assert.ok(html.indexOf('data-mucus-zone="bottom"')<html.indexOf('<div class="popup-rim">'));
});

test('lower-side and bottom reservoir geometry stays OUTSIDE the video and donor content',()=>{
  assert.match(css,/\.mucus-layer--top\{\s*left:-20px;top:-12px;/);
  assert.match(css,/\.mucus-layer--left\{\s*left:-22px;bottom:-3px;/);
  assert.match(css,/\.mucus-layer--right\{\s*right:-22px;bottom:-3px;/);
  assert.match(css,/\.mucus-layer--bottom\{\s*left:-18px;bottom:-67px;/);
  assert.match(css,/width:calc\(100% \+ 36px\);height:116px/);
  assert.match(css,/\.mucus-layer\{[^}]*pointer-events:none;/s);
  assert.match(css,/\.popup-rim\{\s*position:relative;overflow:hidden/);
  assert.doesNotMatch(html,/class="goo goo-/);
  assert.doesNotMatch(css,/\.goo-[123]/);
  assert.match(html,/mucus-reservoir/);
  assert.match(html,/mucus-cast-shadow/);
  assert.match(html,/mucus-bottom-glint/);
  assert.match(html,/mucus-top-sheen/);
});

test('at most five independently timed motion strands and two infrequent microbeads',()=>{
  assert.equal((html.match(/mucus-strand--hero/g)||[]).length,5);
  assert.equal((html.match(/class="mucus-droplet /g)||[]).length,2);
  const timings=[
    ['a','11.3s'],['b','8.9s'],['c','14.7s'],['d','17.4s'],['side','12.5s']
  ];
  for(const [name,seconds] of timings){
    const pattern=new RegExp('\\.mucus-strand--'+name+'\\{animation:mucus-strain-[abc] '+seconds.replace('.','\\.')+' ');
    assert.match(css,pattern);
  }
  for(const name of ['a','b']){
    assert.match(css,new RegExp('\\.mucus-droplet--'+name+'\\{animation:mucus-release-'+name));
  }
  assert.match(css,/transform-box:fill-box/);
  assert.match(css,/@keyframes mucus-tip-tension/);
  assert.match(css,/@keyframes mucus-light-shift/);
  assert.match(css,/opacity:0/);
  assert.doesNotMatch(shellBefore,/<image|<filter|<feTurbulence|<feDisplacementMap|onload=|<script/i);
  assert.doesNotMatch(css,/@import|fonts\.googleapis|filter:\s*blur|backdrop-filter|url\(["']?https?:/i);
});

test('reduced-motion turns off all mucus transforms, gloss and flying beads',()=>{
  const reduced=css.match(/@media\(prefers-reduced-motion:reduce\)\{([\s\S]*?)\n\}/);
  assert.ok(reduced,'expected explicit reduced-motion section');
  const styles=reduced[1];
  assert.match(styles,/\.mucus-strand--hero/);
  assert.match(styles,/\.mucus-tip/);
  assert.match(styles,/\.mucus-droplet/);
  assert.match(styles,/mucus-bottom-glint/);
  assert.match(styles,/animation:none!important/);
  assert.match(styles,/\.mucus-droplet\{opacity:0!important\}/);
});

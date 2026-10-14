import test from 'node:test';
import assert from 'node:assert/strict';
import {startPreview} from '../scripts/preview-stank-popup.mjs';

test('isolated loopback preview supports both painted modes and auto-scrolling long paid text',async t=>{
  const preview=await startPreview();
  t.after(()=>preview.close());
  for(const route of ['/donation','/donation?backdrop=1&long=1','/hotmic','/celebration']){
    const response=await fetch(preview.url+route);
    assert.equal(response.status,200,route);
    const html=await response.text();
    assert.match(html,/class="painted-frame"/);
    assert.match(html,/src="\/preview-page\.js"/);
    assert.doesNotMatch(html,/src="\/stage-page\.js"/);
  }
  const art=await (await fetch(preview.url+'/preview-page.js')).text();
  assert.match(art,/long=params\.get\('long'\)==='1'/);
  assert.match(art,/new Image\(\)/);
  assert.match(art,/scroller\.show/);
  assert.match(art,/MEMBERSHIP BOMB/);
  const css=await (await fetch(preview.url+'/stage.css')).text();
  assert.match(css,/border-image-slice:220 102 309 102 fill/);
  const code=await (await fetch(preview.url+'/message-scroll.js')).text();
  assert.match(code,/requestFrame\(scroll\)/);
  assert.equal((await fetch(preview.url+'/api/action')).status,404);
  // No approved binary is injected into GitHub CI: the preview correctly
  // reports an explicit fallback until the signed art bundle is installed.
  const image=await fetch(preview.url+'/popup-art.webp');
  assert.ok(image.status===404||image.status===200);
  if(image.status===200)assert.match(image.headers.get('content-type'),/image\/webp/);
});

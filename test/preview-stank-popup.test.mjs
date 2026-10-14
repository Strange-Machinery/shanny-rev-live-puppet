import test from 'node:test';
import assert from 'node:assert/strict';
import {startPreview} from '../scripts/preview-stank-popup.mjs';

test('loopback Variant A preview serves real CSS and both popup examples without providers',async t=>{
  const preview=await startPreview();
  t.after(()=>preview.close());
  const donation=await fetch(preview.url+'/donation');
  const body=await donation.text();
  assert.equal(donation.status,200);
  assert.match(body,/id="stank-popup"/);
  assert.match(body,/STANK SUPPORTER/);
  assert.doesNotMatch(body,/src="\/stage-page\.js"/);
  const hotmic=await (await fetch(preview.url+'/hotmic')).text();
  assert.match(hotmic,/I have something to say about THAT/);
  const css=await (await fetch(preview.url+'/stage.css')).text();
  assert.match(css,/\.goo-1/);
  assert.equal((await fetch(preview.url+'/api/action')).status,404);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RAIN_CUE_PATH,RAIN_CUE_DURATION_MS,RAIN_DANCE_MIN_MS,
  RAIN_SEAT_SETTLE_MS} from '../src/rain-cue.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('final producer-edited 23.862-second theme, not provisional audition, drives the rain-to-desk gate',()=>{
  assert.equal(RAIN_CUE_PATH,'/rain-intro.mp3');
  assert.equal(RAIN_CUE_DURATION_MS,23903); // ffprobe 23.902041 sec with MP3 padding
  assert.equal(RAIN_DANCE_MIN_MS,20000);
  assert.equal(RAIN_SEAT_SETTLE_MS,250);
  const source=read('src/rain-cue.mjs');
  assert.match(source,/Make_it_rain_theme\.wav/);
  assert.match(source,/23\.862426/);
  assert.doesNotMatch(source,/3\.95s–24\.86s/);
});

test('soundtrack is SHA-pinned and served only from private producer asset, not YouTube',()=>{
  const installer=read('scripts/Install-StankPopupArt.ps1');
  const checksum='edf7c81f86f6ce446066a1d06274a72d7b3e00746c0578d8ad3ed4b143f57cec';
  assert.ok(installer.includes("'rain-intro.mp3' = '"+checksum+"'"));
  assert.doesNotMatch(installer,/c39f65dbdcd3a0fb348722c93dade445e0e892d6f5cd72378e214747d2f63e3c/);
  assert.match(read('src/remote-web/stage.html'),/id="rain-cue" preload="auto" src="\/rain-intro\.mp3"/);
  const page=read('src/remote-web/stage-page.js');
  assert.match(page,/status\?\.presentation_mode==='rain'/);
  assert.match(page,/if\(status\?\.presentation_mode!=='rain'\)stopRain\(\)/);
  assert.match(page,/rainCue\.onended=/);
  assert.match(page,/reportRain\('media-rain-started'/);
  assert.match(page,/reportRain\('media-rain-ended'/);
  assert.match(page,/await player\.api\(\{action:'media-presented'/);
  assert.match(page,/rainCue\.pause\(\)/);
  assert.doesNotMatch(page,/youtube\.com|soundcloud\.com/i);
  const host=read('src/remote-panel.mjs');
  assert.match(host,/assets\.set\('\/rain-intro\.mp3'/);
  assert.match(host,/type:'audio\/mpeg'/);
});

test('rain prelude prepares Qwen and voices concurrently but native desk receipt gates actual speech',()=>{
  const session=read('src/conversation-session.mjs');
  assert.match(session,/this\.presentation\.begin\(\{\s*rain:true/);
  assert.match(session,/const preparing=this\.preparePresentationRows\(turn\)\.then/);
  assert.match(session,/Math\.max\(choreography,RAIN_CUE_DURATION_MS\)\+RAIN_SEAT_SETTLE_MS/);
  assert.match(session,/await this\.presentation\.waitRainEnd\?\.\(/);
  assert.match(session,/await this\.presentation\.seat\(\{signal:turn\.abort\.signal\}\)/);
  assert.match(session,/await this\.playPreparedPresentationRows\(turn,rows\)/);
  const host=read('src/real-host.mjs');
  assert.match(host,/seat:\(\{signal\}\)=>media\.animate\(\{id:'seated_response'/);
  assert.match(host,/waitRainEnd:\(\{signal\}\)=>media\.waitForRainEnd\(\{signal\}\)/);
});

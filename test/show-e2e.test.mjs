import test from 'node:test';
import assert from 'node:assert/strict';
import { showFixture, flush, wav } from './helpers/show-fixture.mjs';

for (const [text,actor] of [['Hello Buff','SHANNY'],['(rev) Hello Buff','REV'],['(shanny) Hello Buff','SHANNY']]) {
  test('HTTP Qwen / held WAV / playback / resume show: '+actor+' '+text,async()=>{
    const f=await showFixture();
    try {
      await f.controller.live();
      const admitted=await f.runner.donate(f.donation('payment-1',text));
      assert.equal(admitted.reader,actor);
      const read=await f.until('speech.ready',admitted.read_id);
      assert.equal(f.calls.length,0);
      assert.equal((await f.ack(read,'started')).status,200);
      const prepared=await f.until('speech.prepared');
      assert.equal(f.calls.length,1); assert.equal(prepared.duration_ms,10000);
      assert.equal(f.generated.length,2);
      assert.equal(f.calls[0].chat_template_kwargs.enable_thinking,false);
      const held=await fetch(f.origin+'/v1/audio/'+prepared.id,{headers:{Authorization:'Bearer '+f.token}});
      assert.equal(held.status,409); await held.body.cancel();
      assert.equal((await f.gateway.events()).events.filter(e=>e.prepared_release).length,0);
      assert.equal((await f.runner.donate(f.donation('overlap'))).status,'busy');
      await f.ack(read,'finished');
      const reaction=await f.until('speech.ready',prepared.id);
      assert.equal(reaction.prepared_release,true); assert.equal(f.generated.length,2);
      await f.ack(reaction,'started'); await f.ack(reaction,'finished'); await f.runner.tick(); await flush();
      const metrics=f.coordinator.metrics(); assert.equal(metrics.outcomes.released,1); assert.equal(metrics.prepared_before_end_percent,100);
      await f.controller.stopAndResume(); await f.controller.stopAndResume();
      assert.equal(f.installed.trace.filter(x=>x==='episode.resume').length,1);
      assert.equal(f.controller.snapshot().retained_playhead_ms,null);
      assert.equal(f.controller.mode,'show'); assert.equal((await f.gateway.status()).muted,true);
      await f.controller.live();
      assert.equal((await f.runner.donate(f.donation('payment-1'))).status,'duplicate');
    } finally { await f.close(); }
  });
}
test('panic during synthesis invalidates completed old WAV and repeated resume requests',async()=>{
  let resolveVoice;
  const f=await showFixture({provider:{generate:()=>new Promise(resolve=>{resolveVoice=resolve;})}});
  try {
    await f.controller.live(); const read=await f.runner.donate(f.donation('panic'));
    assert.equal(read.status,'accepted');
    const a=f.controller.stopAndResume(),b=f.controller.stopAndResume(); assert.equal(a,b); await a;
    resolveVoice(wav()); await flush(); await f.runner.tick();
    assert.equal((await f.gateway.events()).events.some(e=>e.type==='speech.ready'),false);
    assert.equal(f.installed.trace.filter(x=>x==='episode.resume').length,1);
  } finally {await f.close();}
});
test('late Qwen, expiry and external cross-character interrupt cannot release reactions',async()=>{
  let finishQwen; let time=100000;
  const f=await showFixture({now:()=>time,qwenReply:(_req,res,body)=>{finishQwen=()=>res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({actor:'REV',text:'Fixture reaction text',emotion:'neutral',intensity:.5})}}]}));}});
  try {
    await f.controller.live(); const a=await f.runner.donate(f.donation('late','(rev) Hi'));
    const read=await f.until('speech.ready',a.read_id); await f.ack(read,'started'); await f.runner.tick();
    for(let i=0;i<20&&!finishQwen;i++)await flush();
    await f.ack(read,'finished'); await f.runner.tick(); time+=1501; f.coordinator.sweep(); finishQwen(); await flush();
    assert.equal(f.coordinator.pending,0); assert.equal(f.coordinator.metrics().outcomes.expired,1);
    await f.gateway.speak({actor:'SHANNY',text:'Interrupt Rev',delivery:'interrupt'}); await f.runner.tick();
    assert.equal(f.coordinator.active,false); assert.equal((await f.gateway.events()).events.some(e=>e.prepared_release),false);
  } finally {await f.close();}
});
test('ingress authenticates separate donation/operator tokens and rejects stale mode',async()=>{
  const f=await showFixture();
  try {
    const {port}=await f.runner.listen({port:0,token:'operator-test-secret',donationToken:'donation-test-secret'});
    const url='http://127.0.0.1:'+port;
    assert.equal((await fetch(url+'/status')).status,401);
    const rejected=await fetch(url+'/donations',{method:'POST',headers:{Authorization:'Bearer operator-test-secret','Content-Type':'application/json'},body:'{}'});
    assert.equal(rejected.status,401);
    const stale=await fetch(url+'/donations',{method:'POST',headers:{Authorization:'Bearer donation-test-secret','Content-Type':'application/json'},body:JSON.stringify(f.donation('stale'))});
    assert.equal((await stale.json()).status,'stale');
    const status=await fetch(url+'/status',{headers:{Authorization:'Bearer operator-test-secret'}});
    assert.equal((await status.json()).microphone_enabled,false);
  } finally {await f.close();}
});
test('lost release acknowledgement panics instead of admitting overlapping new speech',async()=>{
  const f=await showFixture();
  try {
    f.coordinator.gateway={...f.gateway,release:async data=>{await f.gateway.release(data);throw new Error('Lost release response');}};
    await f.controller.live();const a=await f.runner.donate(f.donation('lost-release'));
    const read=await f.until('speech.ready',a.read_id);await f.ack(read,'started');await f.until('speech.prepared');
    await f.ack(read,'finished');await f.runner.tick();
    for(let i=0;i<50&&!(await f.gateway.status()).muted;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal((await f.gateway.status()).muted,true);assert.equal(f.controller.mode,'stop_pending');
    assert.equal((await f.runner.donate(f.donation('next'))).status,'stale');
  } finally {await f.close();}
});

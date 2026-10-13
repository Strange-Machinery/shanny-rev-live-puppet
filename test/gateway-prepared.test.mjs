import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveServer } from '../src/live-server.mjs';
import { MockVoiceProvider } from '../src/providers/mock.mjs';
import { createLocalPuppetGateway } from '../src/donations/gateway-client.mjs';

const token = 'integration-local-gateway-key';
const delay = t => new Promise(resolve => setTimeout(resolve, t));

async function start() {
  const server = createLiveServer({provider:new MockVoiceProvider(),token,port:0});
  const {port} = await server.start();
  const gateway = createLocalPuppetGateway({url:'http://127.0.0.1:'+port,token});
  async function until(type) {
    for (let i=0;i<100;i++) {
      const page = await gateway.events();
      const event = page.events.find(e=>e.type===type);
      if (event) return event;
      await delay(10);
    }
    throw new Error('Timeout on '+type);
  }
  server.testPort=port;
  return {server,gateway,until};
}

test('prepared audio is held and not played before an authenticated release',async()=>{
  const {server,gateway,until}=await start();
  try {
    const status = await gateway.status();
    const result = await gateway.speak({actor:'SHANNY',text:'Wait for Buff to finish!',
      prepare_only:true,delivery:'queue'});
    const ready = await until('speech.prepared');
    assert.equal(ready.id,result.request_id);
    assert.equal(ready.audio_path,null);
    const before = await gateway.events();
    assert.equal(before.events.some(e=>e.type==='speech.ready'),false);
    const shape = {id:result.request_id,session_id:status.session_id,epoch:status.epoch};
    assert.equal((await gateway.release(shape)).status,'released');
    const now = await until('speech.ready');
    assert.equal(now.prepared_release,true);
    assert.equal(now.audio_path,'/v1/audio/'+result.request_id);
    assert.equal((await gateway.release(shape)).status,'already_released');
    const after = await gateway.events();
    assert.equal(after.events.filter(e=>e.type==='speech.ready').length,1);
  } finally { await server.close(); }
});

test('releasing wrong epoch, interrupt pregen, or after panic fails closed',async()=>{
  const {server,gateway,until}=await start();
  try {
    const status = await gateway.status();
    const result=await gateway.speak({actor:'REV',text:'Holding!',prepare_only:true});
    await until('speech.prepared');
    await assert.rejects(()=>gateway.release({
      id:result.request_id,session_id:status.session_id,epoch:status.epoch+1
    }),/409/);
    await assert.rejects(()=>gateway.speak({
      actor:'REV',text:'no',prepare_only:true,delivery:'interrupt'
    }),/400/);
    await gateway.panic();
    await assert.rejects(()=>gateway.release({
      id:result.request_id,session_id:status.session_id,epoch:status.epoch
    }),/409/);
    await gateway.resume();
    const events = await gateway.events();
    assert.equal(events.events.some(e=>e.type==='speech.ready'),false);
  } finally {await server.close();}
});

test('discard removes prepared audio before release',async()=>{
  const {server,gateway,until}=await start();
  try {
    const status=await gateway.status();
    const result=await gateway.speak({actor:'REV',text:'Do not play',prepare_only:true});
    await until('speech.prepared');
    const shape={id:result.request_id,session_id:status.session_id,epoch:status.epoch};
    assert.equal((await gateway.discard(shape)).status,'discarded');
    await assert.rejects(()=>gateway.release(shape),/409/);
    const events=await gateway.events();
    assert.equal(events.events.some(e=>e.type==='speech.discarded'),true);
  } finally {await server.close();}
});

test('Unity-style playback receipts create deduplicated start/finish events',async()=>{
  const {server,gateway,until}=await start();
  try {
    const status=await gateway.status();
    const result=await gateway.speak({actor:'SHANNY',text:'Read donation'});
    await until('speech.ready');
    const endpoint='http://127.0.0.1:'+ (await serverAddress(server));
    // The local gateway is the same trusted origin as the playback endpoint.
    async function ack(state) {
      const reply=await fetch(endpoint+'/v1/playback',{
        method:'POST',
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({id:result.request_id,actor:'SHANNY',
          session_id:status.session_id,epoch:status.epoch,state})
      });
      return {status:reply.status,body:await reply.json()};
    }
    assert.equal((await ack('finished')).status,409);
    assert.equal((await ack('started')).status,200);
    assert.equal((await ack('started')).body.status,'duplicate');
    assert.equal((await ack('finished')).status,200);
    assert.equal((await ack('finished')).body.status,'duplicate');
    const page=await gateway.events();
    assert.equal(page.events.filter(e=>e.type==='playback.started').length,1);
    assert.equal(page.events.filter(e=>e.type==='playback.finished').length,1);
  } finally { await server.close(); }
});

async function serverAddress(server) {
  // API intentionally doesn't expose raw HTTP server; status request helper
  // tests supply the origin by recording the address separately instead.
  return server.testPort;
}

test('gateway rejects external network origins even with credentials',()=>{
  assert.throws(()=>createLocalPuppetGateway({
    url:'http://public.example.com:8770',token
  }),/loopback/);
  assert.throws(()=>createLocalPuppetGateway({
    url:'https://127.0.0.1:8770',token
  }),/loopback/);
});

import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveServer } from '../live-server.mjs';
import { createLocalPuppetGateway } from '../donations/gateway-client.mjs';
import { createQwenCompletion } from '../providers/qwen.mjs';
import { createReactionDirector } from '../donations/reaction.mjs';
import { DonationReactionCoordinator } from '../donations/coordinator.mjs';
import { DonationLedger } from '../donations/ledger.mjs';
import { ShowController } from '../show-controller.mjs';
import { ShowRunner } from '../show-runner.mjs';
import { mockSpeechWav } from '../wav.mjs';

export const flush = () => new Promise(resolve => setImmediate(resolve));
export function wav(ms = 10_000) {
  const template = mockSpeechWav('fixture');
  const dataSize = Math.round(ms * 48) * 2;
  const result = Buffer.alloc(44 + dataSize); template.copy(result,0,0,44);
  result.writeUInt32LE(result.length-8,4); result.writeUInt32LE(dataSize,40);
  return result;
}
export function adapters() {
  const trace = []; const resumes = new Map();
  let paused = false, playing = false;
  return {
    trace,
    player: { accepted:true, pause:async () => { paused=true; trace.push('episode.pause'); return {playback_id:'fixture-episode',position_ms:123456}; },
      resume:async token => { if (!resumes.has(token.transition_id)) { resumes.set(token.transition_id,token); trace.push('episode.resume'); paused=false; }
        return { ...token, resumed:true }; } },
    stage: { accepted:true, stopNow() { playing=false; trace.push('local.stop.both'); },
      resume:async () => { playing=true; trace.push('stage.resume'); }, confirmStopped:async () => !playing },
    get paused() { return paused; }
  };
}
export async function showFixture({ provider, qwenReply, now = Date.now, maxLateMs = 1500 } = {}) {
  const token = 'fixture-gateway-secret';
  const temp = mkdtempSync(join(tmpdir(),'show-fixture-'));
  const calls = [];
  const qwen = createServer((req,res) => {
    let raw=''; req.on('data', c => {raw+=c;}); req.on('end', () => {
      const body=JSON.parse(raw); calls.push(body);
      if (qwenReply) { qwenReply(req,res,body); return; }
      const actor=JSON.parse(body.messages[1].content).intended_actor;
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({ choices:[{ finish_reason:'stop',message:{ content:JSON.stringify({actor,text:'Fixture reaction text',emotion:'amused',intensity:.5}) } }] }));
    });
  });
  await new Promise(resolve=>qwen.listen(0,'127.0.0.1',resolve));
  const generated=[];
  const server=createLiveServer({token,port:0,now,provider:provider || {name:'fixture-PCM',async generate(job) { generated.push(job); return wav(job.text==='Fixture reaction text'?10000:1000); }}});
  const {port}=await server.start(); const origin='http://127.0.0.1:'+port;
  const gateway=createLocalPuppetGateway({url:origin,token});
  const complete=createQwenCompletion({endpoint:'http://127.0.0.1:'+qwen.address().port+'/v1/chat/completions',model:'fixture-Qwen',placement:'cpu'});
  const installed=adapters(); let runner;
  const errors=[];
  const coordinator=new DonationReactionCoordinator({gateway,director:createReactionDirector({complete,personaNotes:{SHANNY:'Fixture only',REV:'Fixture only'}}),now,maxLateMs,
    onError:e=>errors.push(e),onOutcome:row=>runner?.outcome(row)});
  const controller=new ShowController({gateway,coordinator,...installed});
  const ledger=new DonationLedger(join(temp,'donations.ledger'));
  runner=new ShowRunner({gateway,coordinator,controller,ledger,now});
  await runner.initialize();
  async function post(route,body) {
    const reply=await fetch(origin+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
    return {status:reply.status,body:await reply.json()};
  }
  async function until(type,id) {
    for(let i=0;i<100;i++) {
      await runner.tick(); const page=await gateway.events();
      const event=page.events.find(e=>e.type===type&&(!id||e.id===id));
      if(event)return event;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    throw new Error('Fixture timed out: '+type);
  }
  async function ack(event,state) { const scope=await gateway.status(); return post('/v1/playback',{...scope,id:event.id,actor:event.actor,state}); }
  function donation(id,text='Hi Buff') { return {donation_id:id,text,received_unix_ms:now(),session_id:coordinator.sessionId,mode_epoch:controller.modeEpoch}; }
  async function close() { await runner.close(); await server.close(); qwen.closeAllConnections(); await new Promise(resolve=>qwen.close(resolve)); rmSync(temp,{recursive:true,force:true}); }
  return {server,gateway,origin,token,runner,coordinator,controller,ledger,installed,errors,calls,generated,post,until,ack,donation,close};
}

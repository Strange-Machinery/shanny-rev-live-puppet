import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {warrantsCameraFlip,createCameraFlipGate} from '../src/audience-reactions.mjs';
import {createConversationDirector} from '../src/conversation-director.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('both adult characters may earn a CAMERA middle finger when enraged at chat',()=>{
  assert.equal(warrantsCameraFlip({actor:'SHANNY',mood:'anger',text:'Fuck you, chat!'}),true);
  assert.equal(warrantsCameraFlip({actor:'REV',mood:'rage',text:'You stupid commenters need to shut up!'}),true);
  assert.equal(warrantsCameraFlip({actor:'SHANNY',mood:'rage',text:'You lying trolls make me sick!'}),true);
  assert.equal(warrantsCameraFlip({actor:'REV',mood:'irritated',text:'Screw you, audience!'}),true);
});
test('donor words, ordinary profanity, talking to partner, and calm sarcasm NEVER earn camera flip',()=>{
  for(const line of [
    {actor:'SHANNY',text:'Fuck you, chat!'}, // donor TTS / no real line mood
    {actor:'REV',mood:'skeptical',text:'Fuck you, chat!'},
    {actor:'SHANNY',mood:'rage',text:'Fuck you, Rev!'},
    {actor:'REV',mood:'rage',text:'Shanny, fuck you!'},
    {actor:'SHANNY',mood:'anger',text:'I cannot believe this fucking situation.'},
    {actor:'SHANNY',mood:'rage',text:'Rev is being stupid.'},
    {actor:'REV',mood:'rage',text:'I am furious about the weather.'},
    {actor:'BUFF',mood:'rage',text:'Fuck you, chat!'},
    {actor:'SHANNY',mood:'smug',text:'Fuck you, chat!'}
  ])assert.equal(warrantsCameraFlip(line),false,JSON.stringify(line));
});
test('same turn and cross-character cooldown prevent relentless repetitive obscenity',()=>{
 let clock=100000;
 const gate=createCameraFlipGate({now:()=>clock,cooldownMs:20000});
 const line={type:'line.started',turn_id:'turn-1',actor:'SHANNY',mood:'rage',text:'Fuck you, audience!'};
 assert.deepEqual(gate.select(line),{
  id:'flip_camera',targets:['SHANNY'],turn_id:'turn-1',
  reason:'Audience-directed incensed spoken line'
 });
 assert.equal(gate.select({...line,text:'Fuck off, chat!'}),null);
 clock+=19000;
 assert.equal(gate.select({...line,turn_id:'turn-2',actor:'REV'}),null);
 clock+=1000;
 const action=gate.select({...line,turn_id:'turn-3',actor:'REV',text:'Chat, shut the hell up!'});
 assert.deepEqual(action.targets,['REV']);
 assert.equal(gate.select({...line,type:'line.finished',turn_id:'turn-4'}),null);
});
test('Qwen prompt keeps BLACKOUT_MODE rude audience confrontation but does not force gesture keys',async()=>{
 let request;
 const director=createConversationDirector({
  notes:'Blackout Shanny argues with Rev and the chat.',
  complete:async data=>{
   request=data;
   return {lines:[
    {actor:'SHANNY',text:'I am sick of you entitled chat trolls!',mood:'rage'},
    {actor:'REV',text:'You idiots act like we owe you a damn thing!',mood:'rage'}
   ],rev_reason:'Rev shares audience grievance'};
  }
 });
 const plan=await director.generate({kind:'donation',text:'You two are ungrateful.'});
 assert.equal(plan.lines.length,2);
 assert.equal(plan.lines[0].mood,'rage');
 const system=request.messages[0].content;
 assert.match(system,/BLACKOUT_MODE audience antagonism/);
 assert.match(system,/RUDE, UNGRATEFUL/);
 assert.match(system,/argu(?:ment|mentative|ing|e) with their AUDIENCE/i);
 assert.match(system,/do not insert obligatory swearing/);
 const user=JSON.parse(request.messages.at(-1).content);
 assert.match(user.direction,/AT THE AUDIENCE\/DONOR/);
 assert.equal(user.input,'You two are ungrateful.');
 assert.ok(!('gesture' in plan.lines[0]));
});
test('existing Unity finger pose is reused only inside the Buff M16 body owner, not recreated in JS',()=>{
 const body=read('unity/Assets/ShannyRevLivePuppet/Runtime/EpisodeBodyBuffLive.cs');
 const stage=read('unity/Assets/ShannyRevLivePuppet/Runtime/LiveM16Stage.cs');
 const signaling=read('src/stage-media.mjs');
 const host=read('src/real-host.mjs');
 const session=read('src/conversation-session.mjs');
 assert.match(body,/new TheatricalCue\{/);
 assert.match(body,/action="middle_finger"/);
 assert.match(body,/SampleHands\(buffCameraFlip,sample,1\)/);
 assert.match(body,/AimLimb\(armR,foreR/);
 assert.match(body,/camera\.transform\.position/);
 assert.match(body,/StopBuffCameraFlip\(\)/);
 assert.match(body,/ResetHands\(\)/);
 assert.match(stage,/if\(alias=="flip_camera"\)/);
 assert.match(stage,/if\(rain\|\|targets\.Length!=1\)return false/);
 assert.match(stage,/b\.StopBuffCameraFlip\(\)/);
 assert.match(signaling,/caption\?\.actor!==targets\[0\]/);
 assert.match(host,/cameraFlipGate\.select\(event\)/);
 assert.match(session,/await this\.onChange\(\{type:'line\.started'/);
 assert.doesNotMatch(host,/gesture=|flip camera if donor/i);
});

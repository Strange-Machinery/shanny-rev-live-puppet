/** Build preparation only. Usage: node scripts/prepare-buff-presentation.mjs private-config.json */
import {readFile,writeFile,cp,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {importM16} from '../src/m16-package.mjs';
const config=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
const project=resolve(config.project);
await access(join(project,'BUFF_ISOLATED_PRESENTATION'));
if(!config.productionUnity||!config.rainTrack)throw new Error('Installed rain source and oriented paired track required');
// Read the installed production implementation, including its current M16
// integration, rather than transplanting the older PR base into this player.
for(const file of ['Assets/ShannyRevDemo/Runtime/EpisodeBodyActionPlayer.cs','Assets/FullPerformanceCandidate/Runtime/EpisodeBodyTheatrical.cs','Assets/FullPerformanceCandidate/Runtime/EpisodeBodyFurniture.cs','Assets/FullPerformanceCandidate/Runtime/EpisodeBodyMovement.cs','Assets/FullPerformanceCandidate/Runtime/EpisodeBodyMakeItRain.cs'])
 await cp(join(config.productionUnity,file),join(project,file));
await cp(join(config.productionUnity,'Assets/FullPerformanceCandidate/Resources/MakeItRain'),join(project,'Assets/FullPerformanceCandidate/Resources/MakeItRain'),{recursive:true});
const rain=JSON.parse(await readFile(config.rainTrack,'utf8'));
const dance=rain.repertoire_actions?.find(a=>a.name==='twerk'),cash=rain.money_rain_actions?.[0];
if(rain.money_rain_actions?.length!==1||cash.start_sample!==0||cash.end_sample!==960000||!dance||dance.yaw_degrees!==180||dance.native_end_sample-dance.native_start_sample!==960000||rain.furniture_routines.length!==2)throw new Error('Continuous twenty-second paired function with seated recovery required');
// Keep the finished continuous low section and native sit-down recovery. Remove
// unrelated later episode gestures, rather than looping the six-second take.
rain.repertoire_actions=[dance];rain.repertoire_motions=rain.repertoire_motions.filter(m=>m.id===dance.motion_id);
for(const key of ['cues','postures','attention','rev_gaze','idle_profiles','body_language_states','show_events','food_actions','wart_actions','cigarette_actions'])rain[key]=[];
rain.revision='buff-paired-rain-20-seconds-v1';
await writeFile(join(project,'Assets/BuffPresentation/Resources/BuffRainTrack.json'),JSON.stringify(rain));
const destination=join(project,'Assets/BuffPresentation/Resources/M16');
const manifest=await importM16({contractPath:config.contractPath,destination});
const track=JSON.parse(await readFile(config.templateTrack,'utf8'));
if(track.schema_version!=='p5-full-performance-v1'||track.furniture_routines?.length!==2||track.furniture_routines.some(r=>!r.initial_seated))throw new Error('M16 seated scene template required');
for(const key of ['repertoire_actions','repertoire_motions','money_rain_actions','cues','postures','attention','rev_gaze','idle_profiles','movement','body_language_states','show_events','food_actions','wart_actions','cigarette_actions'])track[key]=[];
Object.assign(track,{revision:'buff-m16-live-preload-v1',mocap_first:true,m16_editor_preview:false});
const clocks={SHANNY:48000,REV:48000};
for(const b of manifest.bindings){
 const motion=JSON.parse(await readFile(join(destination,b.file),'utf8'));
 // Upstream's explicit producer selection is independent of rights/contact flags.
 motion.local_use_authorization='M16_PRODUCER_SELECTED_20261014';track.repertoire_motions.push(motion);
 const seat=track.furniture_routines.find(r=>r.actor_id===b.actor),start=clocks[b.actor],duration=Math.round(b.duration_seconds*48000);
 track.repertoire_actions.push({id:b.actor+'-'+b.alias,name:b.alias,actors:[b.actor],motion_id:b.motion_id,format:'retargeted_body',
  start_sample:start,native_start_sample:start+24000,native_end_sample:start+24000+duration,end_sample:start+48000+duration,
  intensity:1,hand_action:'waiting',arm_mask:'both',seated_mocap:true,left_sole_adjust_y:b.left_sole_adjust_y,right_sole_adjust_y:b.right_sole_adjust_y,
  anchor:{x:seat.seat.x,y:seat.seat.y-.505,z:seat.seat.z},yaw_degrees:seat.end_yaw_degrees});
 clocks[b.actor]=start+duration+96000;
}
await writeFile(join(project,'Assets/BuffPresentation/Resources/BuffTrack.json'),JSON.stringify(track));
const expressions={schema_version:'p5-expression-plan-v1',cues:[
 {actor_id:'SHANNY',emotion:'live:angry',start_sample:0,end_sample:2147483647,blend_samples:0,weights:[
  ['Brow_Drop_L',12],['Brow_Drop_R',12],['Brow_Compress_L',8],['Brow_Compress_R',8],
  ['Eye_Squint_L',8],['Eye_Squint_R',8],['Mouth_Frown_L',6],['Mouth_Frown_R',6],['Eye_Blink_L',0],['Eye_Blink_R',0]
 ].map(([shape,value])=>({shape,value}))},
 {actor_id:'REV',emotion:'live:skeptical',start_sample:0,end_sample:2147483647,blend_samples:0,weights:[
  ['browDownLeft',8],['browDownRight',8],['eyeSquintLeft',6],['eyeSquintRight',6],
  ['mouthFrownLeft',4],['mouthFrownRight',4],['eyeBlinkLeft',0],['eyeBlinkRight',0]
 ].map(([shape,value])=>({shape,value}))}
]};
// Bind the union once at build time; runtime profiles contain only fixed allowed shapes.
const shapes={SHANNY:['Brow_Drop','Brow_Compress','Brow_Raise_Inner','Brow_Raise_Outer','Eye_Squint','Eye_Wide','Mouth_Frown','Mouth_Smile','Cheek_Squint','Eye_Blink'].flatMap(s=>[s+'_L',s+'_R']),
 REV:['browDownLeft','browDownRight','browInnerUp','browOuterUpLeft','browOuterUpRight','eyeSquintLeft','eyeSquintRight','eyeWideLeft','eyeWideRight','mouthFrownLeft','mouthFrownRight','mouthSmileLeft','mouthSmileRight','cheekSquintLeft','cheekSquintRight','eyeBlinkLeft','eyeBlinkRight']};
for(const cue of expressions.cues)cue.weights=shapes[cue.actor_id].map(shape=>({shape,value:0}));
await writeFile(join(project,'Assets/BuffPresentation/Resources/BuffExpressions.json'),JSON.stringify(expressions));
await cp(fileURLToPath(new URL('../unity/Assets/ShannyRevLivePuppet',import.meta.url)),join(project,'Assets/ShannyRevLivePuppet'),{recursive:true});
const packagesPath=join(project,'Packages/manifest.json'),packages=JSON.parse(await readFile(packagesPath,'utf8'));
Object.assign(packages.dependencies,{'com.unity.webrtc':'3.0.0','com.unity.modules.unitywebrequest':'1.0.0','com.unity.modules.unitywebrequestaudio':'1.0.0','com.unity.modules.imageconversion':'1.0.0'});
await writeFile(packagesPath,JSON.stringify(packages,null,2)+'\n');
await import('./prepare-shared-conversation.mjs');
console.log(JSON.stringify({prepared:true,bindings:manifest.bindings.length,contract_sha256:manifest.contract_sha256}));

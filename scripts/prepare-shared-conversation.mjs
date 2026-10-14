import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const config=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
const shared='Assets/FullPerformanceCandidate/Runtime/EpisodeBodySharedConversation.cs';
const repertoire='Assets/FullPerformanceCandidate/Runtime/EpisodeBodyRepertoire.cs';
const playback='Assets/ShannyRevDemo/Runtime/EpisodePlaybackController.cs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const changes=[];
for(const file of [repertoire,playback]){
 const before=await readFile(join(config.productionUnity,file));let text=before.toString('utf8');const newline=text.includes('\r\n')?'\r\n':'\n';text=text.replaceAll('\r\n','\n');
 if(file===repertoire){
  const anchor='var role=RepertoireMotionFor(action).roles.Single(r=>r.actor_id==actorId);float weight=RepertoireWeight(action,sample);';
  if(!text.includes(anchor))throw new Error('Current selected repertoire integration changed');
  if(!text.includes('PrepareSelectedConversation(action,RepertoireMotionFor(action),role);'))text=text.replace(anchor,anchor+'\n   PrepareSelectedConversation(action,RepertoireMotionFor(action),role);');
 }else{
  const anchor='                gazeBodies[0].CompleteConversationHead(sample,eyeCenters[1]);';
  if(!text.includes(anchor)&&!text.includes('CompleteSharedConversationHead('))throw new Error('Current shared gaze integration changed');
  const block=`                // Deterministic speaking/held listener contact over selected seated mocap.
                var recent=plan.lines.Where(line=>line.start_sample<=sample).OrderBy(line=>line.start_sample).LastOrDefault();
                float contact=0,indirect=0;
                if(recent!=null){
                    int end=recent.start_sample+recent.sample_count;
                    contact=Mathf.SmoothStep(0,1,(sample-recent.start_sample)/16800f)*(1-Mathf.SmoothStep(0,1,(sample-end-144000)/24000f));
                    indirect=recent.actor_id=="SHANNY"?Mathf.SmoothStep(0,1,(sample-recent.start_sample-72000)/24000f):0;
                }
                for(int i=0;i<2;i++)if(gazeBodies[i].SharedConversationGazeAt(sample))gazeBodies[i].CompleteSharedConversationHead(eyeCenters[1-i],gazeBodies[i].ActorId=="REV"?indirect:0,contact);
                eyeCenters=gazeBodies.Select(b=>b.ConversationEyeCenter).ToArray();
                for(int i=0;i<2;i++)if(gazeBodies[i].SharedConversationGazeAt(sample))gazeBodies[i].CompleteSharedConversationEyes(eyeCenters[1-i],gazeBodies[i].ActorId=="REV"?indirect:0,contact);
`;
  if(!text.includes('CompleteSharedConversationHead('))text=text.replace(anchor,block+anchor);
  for(const i of [0,1])for(const method of ['CompleteConversationHead','CompleteConversationGaze']){
   const call=`gazeBodies[${i}].${method}(sample,eyeCenters[${1-i}]);`;
   if(!text.includes(`if(!gazeBodies[${i}].SharedConversationGazeAt(sample))${call}`))text=text.replace(call,`if(!gazeBodies[${i}].SharedConversationGazeAt(sample))${call}`);
  }
 }
 changes.push({file,before,after:Buffer.from(text.replaceAll('\n',newline))});
}
const guarded=await readFile('unity/Assets/ShannyRevLivePuppet/Runtime/EpisodeBodySharedConversation.cs','utf8');
const source=Buffer.from(guarded.replace(/^#if BUFF_M16\r?\n/,'').replace(/#endif\s*$/,''));
if(!process.argv.includes('--install-only'))for(const change of changes)await writeFile(join(config.project,change.file),change.after);
if(process.argv.includes('--install')){
 const backup=resolve(config.backup||'work/shared-conversation-backup');await mkdir(backup,{recursive:false});
 const receipt=[];
 for(const change of changes){
  if(hash(await readFile(join(config.productionUnity,change.file)))!==hash(change.before))throw new Error('Production changed during preparation');
  await mkdir(join(backup,change.file,'..'),{recursive:true});await writeFile(join(backup,change.file),change.before);
  receipt.push({file:change.file,before_sha256:hash(change.before),after_sha256:hash(change.after)});
 }
 try{await readFile(join(config.productionUnity,shared));throw new Error('Shared module already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const change of changes)await writeFile(join(config.productionUnity,change.file),change.after);
 await writeFile(join(config.productionUnity,shared),source);
 receipt.push({file:shared,before_sha256:null,after_sha256:hash(source)});
 await writeFile(join(backup,'receipt.json'),JSON.stringify({production:config.productionUnity,files:receipt},null,2));
 console.log('Installed shared Shanny/Rev fixes with verified originals in '+backup);
}else console.log('Prepared current shared sources in isolated Buff project');

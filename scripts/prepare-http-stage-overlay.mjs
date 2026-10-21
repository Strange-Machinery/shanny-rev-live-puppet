/** Read-only installed-runtime inventory. Produces a reviewable overlay in a
 * fresh sibling directory; it never installs files or edits runtime config. */
import {createHash} from 'node:crypto';
import {lstat,mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const blobSha=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const inside=(parent,child)=>{const path=relative(parent,child);return path===''||(!isAbsolute(path)&&path!=='..'&&!path.startsWith('..'+sep));};
async function regularFile(root,path){
  let current=root;
  const parts=path.split('/');
  for(let i=0;i<parts.length;i++){
    current=resolve(current,parts[i]);
    let state;
    try{state=await lstat(current);}catch(error){if(error.code==='ENOENT')return null;throw error;}
    if(state.isSymbolicLink()||(i<parts.length-1?!state.isDirectory():!state.isFile()))
      throw new Error('Refusing a symlink or unexpected file type: '+path);
    if(i===parts.length-1&&state.size>2*1024*1024)throw new Error('Unexpected source file size: '+path);
  }
  return readFile(current);
}
async function put(root,path,bytes){
  const target=resolve(root,path);await mkdir(dirname(target),{recursive:true});
  await writeFile(target,bytes,{flag:'wx'});
}

export async function prepareHttpStageOverlay({installed,output,candidateRoot=ROOT}){
  if(!installed||!output)throw new Error('Both --installed and --output are required');
  const installedRoot=await realpath(resolve(installed));
  const candidate=await realpath(resolve(candidateRoot));
  // Resolve the existing parent so a symlink cannot direct output into the
  // installed runtime even when its spelling looks like a separate folder.
  const requested=resolve(output);
  const outputRoot=resolve(await realpath(dirname(requested)),relative(dirname(requested),requested));
  if(inside(installedRoot,outputRoot)||inside(candidate,outputRoot))
    throw new Error('Output must be a fresh directory outside the installed and candidate trees');
  const manifest=JSON.parse(await readFile(resolve(candidate,'deployment/http-stage-overlay.json'),'utf8'));
  if(manifest.version!==1||!/^[a-f0-9]{40}$/.test(manifest.base_commit)||
      !Array.isArray(manifest.files)||!manifest.files.length||manifest.files.length>40)
    throw new Error('Invalid HTTP stage overlay manifest');
  const seen=new Set(),files=[];
  for(const entry of manifest.files){
    const path=entry.path;
    if(typeof path!=='string'||!/^src\/(?:remote-web\/)?[a-z0-9.-]+$/.test(path)||
        seen.has(path)||(entry.base_blob_sha!==null&&!/^[a-f0-9]{40}$/.test(entry.base_blob_sha)))
      throw new Error('Invalid HTTP stage overlay path or base hash');
    seen.add(path);
    const proposed=await regularFile(candidate,path);
    if(proposed===null)throw new Error('Candidate file is missing: '+path);
    const current=await regularFile(installedRoot,path);
    const currentSha=current===null?null:blobSha(current),candidateSha=blobSha(proposed);
    const status=currentSha===candidateSha?'already-current':
      currentSha===null&&entry.base_blob_sha===null?'safe-new-file':
      currentSha!==null&&currentSha===entry.base_blob_sha?'safe-base-match':
      currentSha===null?'missing-installed-integration':'needs-merge';
    files.push({path,status,base_blob_sha:entry.base_blob_sha,
      installed_blob_sha:currentSha,candidate_blob_sha:candidateSha,proposed});
  }
  const patch=await readFile(resolve(candidate,'deployment/http-stage-integration.patch'));
  // Inventory succeeds before writing anything. An existing output is refused
  // rather than reused or cleaned up, so prior work cannot be overwritten.
  await mkdir(outputRoot);
  for(const file of files){
    const folder=file.status.startsWith('safe-')?'overlay':'review';
    if(file.status!=='already-current')await put(outputRoot,folder+'/'+file.path,file.proposed);
  }
  await put(outputRoot,'integration.patch',patch);
  const report={version:1,base_commit:manifest.base_commit,installed_root:installedRoot,
    candidate_root:candidate,output_root:outputRoot,installed_files_modified:0,
    ready_to_apply:files.every(file=>file.status.startsWith('safe-')||file.status==='already-current'),
    counts:files.reduce((counts,file)=>{counts[file.status]=(counts[file.status]||0)+1;return counts;},{}),
    files:files.map(({proposed,...file})=>file)};
  await put(outputRoot,'report.json',JSON.stringify(report,null,2)+'\n');
  await put(outputRoot,'README.txt',[
    'This directory is a preparation result, not an installed deployment.',
    'The installed runtime was only read. No configuration or assets were replaced.',
    'overlay/ contains new files and exact upstream-base matches only.',
    'review/ contains candidate versions of changed or missing integration files.',
    'Never bulk-copy review/ over the newer MSI runtime.',
    'Do not apply a partial overlay: review every conflict and validate the combined staging tree first.',
    'integration.patch records the source changes against the pinned GitHub base.',
    'Follow docs/BUFF_HTTP_MEDIA_DEPLOYMENT.md in the candidate checkout for staging, acceptance and rollback.',
    ''
  ].join('\n'));
  return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),options={};
    for(let i=0;i<args.length;i+=2){
      if(!['--installed','--output'].includes(args[i])||!args[i+1]||options[args[i].slice(2)])
        throw new Error('Usage: node scripts/prepare-http-stage-overlay.mjs --installed <runtime> --output <fresh-directory>');
      options[args[i].slice(2)]=args[i+1];
    }
    const result=await prepareHttpStageOverlay(options);
    process.stdout.write(JSON.stringify({output:result.output_root,ready_to_apply:result.ready_to_apply,
      counts:result.counts,installed_files_modified:0},null,2)+'\n');
    if(!result.ready_to_apply)process.exitCode=2;
  }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}

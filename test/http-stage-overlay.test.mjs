import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareHttpStageOverlay} from '../scripts/prepare-http-stage-overlay.mjs';

const sha=text=>{const data=Buffer.from(text);return createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');};
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'http-stage-overlay-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const candidateRoot=join(root,'candidate'),installed=join(root,'installed'),output=join(root,'prepared');
  for(const dir of [join(candidateRoot,'src'),join(candidateRoot,'deployment'),join(installed,'src')])await mkdir(dir,{recursive:true});
  const files=[{path:'src/host.mjs',base_blob_sha:sha('base host\n')},{path:'src/http.mjs',base_blob_sha:null}];
  await writeFile(join(candidateRoot,'src/host.mjs'),'candidate host\n');
  await writeFile(join(candidateRoot,'src/http.mjs'),'new http module\n');
  await writeFile(join(installed,'src/host.mjs'),'base host\n');
  await writeFile(join(candidateRoot,'deployment/http-stage-integration.patch'),'reviewable patch\n');
  const manifestPath=join(candidateRoot,'deployment/http-stage-overlay.json');
  const manifest={version:1,base_commit:'6b532677055d73c7120bae17fd848f8805559c09',files};
  await writeFile(manifestPath,JSON.stringify(manifest));
  return {candidateRoot,installed,output,manifest,manifestPath};
}

test('overlay preparation copies only absent modules and exact base matches without editing installed files',async t=>{
  const f=await fixture(t),report=await prepareHttpStageOverlay(f);
  assert.equal(report.installed_files_modified,0);assert.equal(report.ready_to_apply,true);
  assert.deepEqual(report.counts,{'safe-base-match':1,'safe-new-file':1});
  assert.equal(await readFile(join(f.installed,'src/host.mjs'),'utf8'),'base host\n');
  assert.deepEqual(await readdir(join(f.installed,'src')),['host.mjs']);
  assert.equal(await readFile(join(f.output,'overlay/src/host.mjs'),'utf8'),'candidate host\n');
  assert.equal(await readFile(join(f.output,'overlay/src/http.mjs'),'utf8'),'new http module\n');
  const saved=JSON.parse(await readFile(join(f.output,'report.json'),'utf8'));
  assert.equal(saved.files[0].installed_blob_sha,sha('base host\n'));
});

test('newer installed source is retained and routed to explicit merge review',async t=>{
  const f=await fixture(t);
  await writeFile(join(f.installed,'src/host.mjs'),'newer MSI host\n');
  await writeFile(join(f.installed,'src/http.mjs'),'pre-existing unrelated module\n');
  const report=await prepareHttpStageOverlay(f);
  assert.equal(report.ready_to_apply,false);assert.deepEqual(report.counts,{'needs-merge':2});
  assert.equal(await readFile(join(f.installed,'src/host.mjs'),'utf8'),'newer MSI host\n');
  assert.equal(await readFile(join(f.installed,'src/http.mjs'),'utf8'),'pre-existing unrelated module\n');
  assert.equal(await readFile(join(f.output,'review/src/host.mjs'),'utf8'),'candidate host\n');
  assert.ok(!(await readdir(f.output)).includes('overlay'));
});

test('missing legacy integration and already-current files are distinguished',async t=>{
  const f=await fixture(t);await rm(join(f.installed,'src/host.mjs'));
  await writeFile(join(f.installed,'src/http.mjs'),'new http module\n');
  const report=await prepareHttpStageOverlay(f);
  assert.deepEqual(report.counts,{'missing-installed-integration':1,'already-current':1});
  assert.equal(report.ready_to_apply,false);
  assert.ok(!(await readdir(f.output)).includes('overlay'));
});

test('overlay preparation refuses an existing output and any output inside the runtime',async t=>{
  const f=await fixture(t);await mkdir(f.output);await writeFile(join(f.output,'keep.txt'),'keep');
  await assert.rejects(prepareHttpStageOverlay(f),/EEXIST/);
  assert.equal(await readFile(join(f.output,'keep.txt'),'utf8'),'keep');
  await assert.rejects(prepareHttpStageOverlay({...f,output:join(f.installed,'overlay')}),/outside/);
  await assert.rejects(prepareHttpStageOverlay({...f,output:join(f.candidateRoot,'overlay')}),/outside/);
});

test('overlay preparation rejects symlinked source and manifest traversal before writing output',async t=>{
  const f=await fixture(t);await rm(join(f.installed,'src/host.mjs'));
  await symlink(join(f.candidateRoot,'src/host.mjs'),join(f.installed,'src/host.mjs'));
  await assert.rejects(prepareHttpStageOverlay(f),/symlink/);
  f.manifest.files[0].path='src/../private';
  await writeFile(f.manifestPath,JSON.stringify(f.manifest));
  await assert.rejects(prepareHttpStageOverlay(f),/path or base hash/);
  await assert.rejects(readFile(join(f.output,'report.json')),/ENOENT/);
});

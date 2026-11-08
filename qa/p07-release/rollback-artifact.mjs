import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {stagePages,isAllowedPagesFile} from '../../scripts/stage_pages_deploy.mjs';
export async function buildRollback(sha,root){
 assert.match(sha,/^[a-f0-9]{40}$/);root=path.resolve(root);assert.ok(root.startsWith(path.resolve('.wrangler')+path.sep),'Generated assets remain under ignored build output');
 const git=(...a)=>execFileSync('git',a,{maxBuffer:30000000,windowsHide:true}),files=git('ls-tree','-r','--name-only',sha).toString().trim().split(/\r?\n/).filter(isAllowedPagesFile).sort();
 const sourceRelease=git('show',sha+':js/core/config.js').toString().match(/ASSET_RELEASE = "([^"]+)"/)[1];
 const rollbackRelease='20261109-aeris-p07-safe-rollback-r3';await mkdir(root,{recursive:true});const manifest=[];
 for(const file of files){const original=git('show',sha+':'+file);let bytes=original;
  if(!file.startsWith('assets/')&&!file.startsWith('vendor/')&&!file.startsWith('functions/')&&/\.(?:js|mjs|css|html|webmanifest)$/.test(file)){
   let text=original.toString().replaceAll(sourceRelease,rollbackRelease);
   if(file==='index.html'){assert.ok(!text.includes('name="aeris-p07-presentation"'));text=text.replace('<head>','<head>\n<meta name="aeris-p07-presentation" content="legacy">');assert.ok(text.includes('name="aeris-p07-presentation"'));}
   bytes=Buffer.from(text);
  }
  const dest=path.join(root,file);await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,bytes);manifest.push({path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),same_as_candidate:bytes.equals(original)});
 }
 const result=await stagePages({root});for(const row of manifest)assert.equal(createHash('sha256').update(await readFile(path.join(result.output,row.path))).digest('hex'),row.sha256);
 const proof={source_sha:sha,source_release:sourceRelease,rollback_release:rollbackRelease,presentation:'existing base/legacy UI capability; no business entitlement override',preserves_candidate_identity_sync_and_safe_sw:true,production_configuration_included:false,output:result.output,file_count:manifest.length,manifest_sha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),files:manifest};
 await writeFile(path.join(root,'rollback-manifest.json'),JSON.stringify({...proof,output:path.relative(process.cwd(),result.output).replaceAll('\\','/')},null,2)+'\n');return proof;
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){const sha=process.argv[2];const r=await buildRollback(sha,path.resolve('.wrangler/p07-safe-rollback',sha));console.log(JSON.stringify({source_sha:r.source_sha,rollback_release:r.rollback_release,file_count:r.file_count,manifest_sha256:r.manifest_sha256,output:path.relative(process.cwd(),r.output)}));}

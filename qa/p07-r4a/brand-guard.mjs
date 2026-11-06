import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..'),baseline='f7949f8253f51ea2621c397743208971c0cec467';
const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,maxBuffer:20*1024*1024});assert.equal(r.status,0);return r.stdout;};
const protectedRoots=['assets/brand','assets/logo.png','assets/splash-screen.png','favicon.ico','icon-192.png','icon-512.png','android/app/src/main/res'];
const files=git('ls-tree','-r','--name-only',baseline,'--',...protectedRoots).toString().trim().split(/\r?\n/).filter(Boolean);
assert.equal(git('diff','--name-only',baseline,'--',...protectedRoots).toString().trim(),'','official brand resources changed');
const assets=[];
for(const file of files){const original=git('show',baseline+':'+file),actual=await fs.readFile(path.join(root,file));
  if(/\.(?:png|ico|webp|jpg|svg)$/.test(file))assert.equal(createHash('sha256').update(actual).digest('hex'),createHash('sha256').update(original).digest('hex'),file+' bytes changed');
  assets.push({file,git_blob:git('rev-parse',baseline+':'+file).toString().trim(),sha256:createHash('sha256').update(original).digest('hex')});}
const references=[];
for(const file of ['index.html','manifest.webmanifest','sw.js','app.js']){
  const urls=text=>[...text.matchAll(/\/(?:assets\/(?:brand\/)?[A-Za-z0-9_-]+\.(?:png|svg|ico)|icon-\d+\.png|favicon\.ico)/g)].map(x=>x[0]).sort();
  const before=urls(git('show',baseline+':'+file).toString()),after=urls(await fs.readFile(path.join(root,file),'utf8'));
  assert.deepEqual(after,before,file+' official logo paths/references changed');references.push({file,paths:after});
}
const output=path.join(root,'docs/p07/evidence/r4a/brand-preservation.json');await fs.mkdir(path.dirname(output),{recursive:true});
await fs.writeFile(output,JSON.stringify({baseline,officialAssetBytesUnchanged:true,semanticReferencesUnchanged:true,versionQueriesMayChange:true,assets,references},null,2));
console.log(JSON.stringify({protectedFiles:files.length,officialAssetBytesUnchanged:true,semanticReferencesUnchanged:true}));

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../../..'), out=path.join(root,'docs/migration-evidence/finance-p04/experience-channel-current');
const target=path.join(out,'runtime-proof-r1.json');await fs.access(target).then(()=>{throw Error('Preserve previous proof');},()=>{});
const stage=path.join(root,'.wrangler/finance-p04-owner-preview-r2'),origin='https://owner-p04-preview.thewyj-finance-p04-preview.pages.dev';
const sha=b=>createHash('sha256').update(b).digest('hex');const rows=[];
for(const file of ['__preview/build.json','index.html','js/finance/app.js','js/finance/money.js','sw.js']){
  const response=await fetch(origin+(file==='index.html'?'/':'/'+file),{redirect:'error',signal:AbortSignal.timeout(20000)});assert.equal(response.status,200,file);
  const actual=Buffer.from(await response.arrayBuffer()),expected=await fs.readFile(path.join(stage,file));assert.equal(sha(actual),sha(expected),file);
  rows.push({file,bytes:actual.length,sha256:sha(actual),status:'PASS'});
}
const meta=JSON.parse(await fs.readFile(path.join(stage,'__preview/build.json'),'utf8'));
const result={checked_utc:new Date().toISOString(),origin,source_commit:meta.source_commit,artifact_tree_sha256:meta.artifact_tree_sha256,rows,
  runtime_assets_byte_identical:true,production_requests:0,scope:'Actual hosted public bytes; no browser cache or real account data'};
await fs.writeFile(target,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));

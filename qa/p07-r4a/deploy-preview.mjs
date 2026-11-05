// Reuse the existing allowlisted, binding-checked Preview publisher. Only this
// task's branch/evidence/owned browser port differ; Production is never used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const at=process.argv.indexOf('--commit'),sha=process.argv[at+1];
assert.ok(at>=0);assert.match(sha||'',/^[0-9a-f]{40}$/);
const ancestor=spawnSync('git',['merge-base','--is-ancestor','f7949f8253f51ea2621c397743208971c0cec467',sha],{cwd:root});
assert.equal(ancestor.status,0,'Preview must descend from the fixed product baseline');
await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen({host:'127.0.0.1',port:19357,exclusive:true},()=>s.close(resolve));});
let source=await fs.readFile(path.join(root,'qa/p07-d/deploy-and-verify-preview.mjs'),'utf8');
function replace(before,after){assert.equal(source.split(before).length,2,'Preview adapter anchor: '+before);source=source.replace(before,after);}
replace('const BRANCH_NAME = "v62-p07-d-workspaces";', 'const BRANCH_NAME = "codex-p07-r4a-runtime";');
source=source.replaceAll('docs/p07/evidence/p07-d/preview','docs/p07/evidence/r4a/preview');
replace('const cdpPort = 19328;', 'const cdpPort = 19357;');
source=source.replaceAll('p07-d-workspaces-${COMMIT.slice(0, 10)}','p07-r4a-runtime-${COMMIT.slice(0, 10)}');
source=source.replaceAll('Aeris V6.2 P07-D Business Workspaces isolated Preview','Aeris V6.2 P07-R4A runtime isolated Preview');
source=source.replaceAll('P07_D_PREVIEW_DEPLOYED_AND_VERIFIED','P07_R4A_PREVIEW_DEPLOYED_AND_VERIFIED');
const dir=path.join(root,'.wrangler/r4a-preview-driver');await fs.mkdir(dir,{recursive:true});
const file=path.join(dir,'run.mjs');await fs.writeFile(file,source);
const run=spawnSync(process.execPath,[file,'--commit',sha],{cwd:root,env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:'inherit',windowsHide:true});
process.exitCode=run.status??1;

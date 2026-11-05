// Apply reviewed candidates ONLY to the ignored runtime used for compatibility
// checks. The Flash checkout and its tracked CSS remain byte-for-byte unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function installCandidateOverlays(runtime,evidence){
 const root=path.resolve(import.meta.dirname,'../..');
 assert.ok(path.resolve(runtime).startsWith(path.join(root,'.wrangler')+path.sep));
 const changes=[];
 for(const relative of ['functions/_lib/task11-service.mjs','functions/_lib/task12-api.mjs']){
  const destination=path.join(runtime,relative),before=await fs.readFile(destination);
  const base=spawnSync('git',['show',`337bb32f1ce349f9c5d58bd6120932fa5e61a745:${relative}`],{cwd:root,encoding:'utf8'});
  assert.equal(base.status,0);assert.equal(before.toString().replaceAll('\r\n','\n'),base.stdout.replaceAll('\r\n','\n'),
    'Reject overlay on a concurrently changed API contract');
  const after=await fs.readFile(path.join(root,relative));await fs.writeFile(destination,after);
  changes.push({file:relative,before_sha256:sha(before),after_sha256:sha(after),candidate:'c62e833ff0098cacd46e58a919d4668933f81cb6'});
 }
 const relative='public/spatial-experience.css',file=path.join(runtime,relative),before=await fs.readFile(file);
 const own=await fs.readFile(path.join(root,'spatial-experience.css'),'utf8');
 const marker='/* Leave the focused content clear when native zoom leaves a short viewport. */';
 assert.equal(own.split(marker).length,2);assert.ok(!before.toString().includes(marker));
 const flashCss=before.toString().replaceAll('\r\n','\n');
 const contrastAnchor='html[data-p07-ui="enabled"] #workspace .tabs button:disabled {\n  opacity: 0.45;';
 assert.equal(flashCss.split(contrastAnchor).length,2,'Disabled-tab candidate must match pinned Flash CSS once');
 const after=Buffer.from(flashCss.replace(contrastAnchor,contrastAnchor.replace('0.45','1'))+'\n'+marker+own.split(marker)[1]);
 await fs.writeFile(file,after);
 changes.push({file:relative,before_sha256:sha(before),after_sha256:sha(after),candidate:'91a06fcaa6210dc04834d36678508eae8ad55a75 plus qa/p07-d/candidates/flash-readable-tabs.patch',placement:'short-viewport rules after Flash business rules; disabled-tab opacity restored'});
 await fs.writeFile(path.join(evidence,'candidate-overlays.json'),JSON.stringify({
  tier:'FLASH_HEAD_PLUS_QA_RUNTIME_CANDIDATES',tracked_source_modified:false,changes},null,2));
}

// Curate browser facts, not credentials, profiles or raw HTTP request headers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..'),qa=path.resolve(process.env.P07_R4A_QA_ROOT||path.join(process.env.USERPROFILE,'.codex/worktrees/p07-round3-independent-qa/thewyj.uk'));
const output=path.join(root,'docs/p07/evidence/r4a'),raw=path.join(root,'docs/migration-evidence/p07-r4a');
const prefix=process.argv[2]||'r4a-accepted';assert.match(prefix,/^[a-z0-9-]+$/);
const onLabel=process.argv[3]||prefix+'-on';assert.match(onLabel,/^[a-z0-9-]+$/);
const input=relative=>path.join(raw,relative.startsWith('r4a-accepted-on/')?relative.replace('r4a-accepted-on',onLabel):relative.replace(/^r4a-accepted/,prefix));
const json=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(output,{recursive:true});
const baseline=await json(path.join(qa,'docs/p07/evidence/round3-latest/round3-browser-results.json'));
const candidate=await json(input('r4a-accepted-on/round3-browser-results.json'));
const provenance=await json(input('r4a-accepted-on/r4a-driver-provenance.json'));
assert.equal(provenance.frozen_browser_sha256,'227c4f69d473186fdbe307fa3a6da4a9a6d5a0c41d485ff51d19beed608fa61d');
assert.equal(baseline.target_sha,'f7949f8253f51ea2621c397743208971c0cec467');
assert.equal(candidate.checks.length,25);assert.ok(candidate.checks.every(c=>c.status==='PASS'));
const matrix=baseline.checks.map(before=>{const after=candidate.checks.find(c=>c.id===before.id);assert.ok(after);return{id:before.id,baseline:before.status,candidate:after.status};});
await fs.writeFile(path.join(output,'browser-comparison.json'),JSON.stringify({baseline:baseline.target_sha,candidate:candidate.target_sha,qa:provenance.qa_sha,frozen_browser_sha256:provenance.frozen_browser_sha256,matrix},null,2));
const safeChecks=candidate.checks.map(({id,status,duration_ms,detail,error})=>({id,status,duration_ms,detail,error}));
await fs.writeFile(path.join(output,'browser-facts.json'),JSON.stringify({target_sha:candidate.target_sha,checks:safeChecks,real_ai_calls:0,real_payments:0,physical_device:false},null,2));
const files=[['r4a-accepted-on/primary-workspaces.json','primary-workspaces.json'],['r4a-accepted-on/r4a-runtime-results.json','runtime-results.json'],
  ['r4a-accepted-on/p4-workspace-behavior.json','p4-workspace-behavior.json'],['r4a-accepted-on/source-manifest.json','tested-source-manifest.json'],
  ['r4a-accepted-on/r4a-driver-provenance.json','driver-provenance.json'],['r4a-accepted-upgrade/cache-upgrade.json','cache-upgrade.json'],
  ['r4a-accepted-upgrade/upgrade-safety.json','upgrade-safety.json'],['r4a-accepted-off/round3-browser-results.json','flag-off.json'],
  ['r4a-accepted-kill/round3-browser-results.json','kill-switch.json'],['r4a-accepted-upgrade-red/cache-upgrade.json','cache-upgrade-red.json']];
for(const [from,to] of files){const value=await json(input(from));
  if(/flag-off|kill-switch/.test(to)){delete value.http_trace;delete value.network_trace;delete value.timelines;delete value.screenshots;}
  await fs.writeFile(path.join(output,to),JSON.stringify(value,null,2));}
for(const [from,to] of [['r4a-accepted-on/finance-upgrade-membership.png','finance-membership-exclusive.png'],['r4a-accepted-on/direct-account.png','account-main-workspace.png'],['r4a-accepted-upgrade/offline-upgraded-shell.png','offline-upgraded-shell.png']])
  await fs.copyFile(input(from),path.join(output,to));
const history=[
  {run:'r4a-candidate-on',result:'Frozen 25/25 and primary 3/3 passed; extra 4/6. Tests incorrectly clicked a hidden legacy close button and omitted native bridge opt-in.'},
  {run:'r4a-runtime-rerun',result:'Infrastructure failure: HTTP became ready before the seed verification completed, 3 !== 1. Added READY-log handshake; seed guard unchanged.'},
  {run:'r4a-runtime-verified',result:'5/6; native opt-in boot query had been removed by SPA navigation before ordinary refresh. Re-entered the documented opt-in before the separate native case.'},
  {run:'r4a-upgrade-safety',result:'Original byte assertion passed; added image inspection threw on an unrelated empty src. Resolved URLs against the document origin; Logo loading assertion retained.'},
  {run:'integrated-preview-5b29f97',result:'Static verification failed on one HTTP 404 for unchanged source-original.png. Later read-only GET returned 200; exact final deployment is independently hash-verified.'},
  {run:'preview-intermediate',result:'Initial publisher screenshot readiness used entryScreen only and captured pending policy. Final publisher waits for explicit non-pending policy and visible home; intermediate proof is not visual acceptance.'},
  {run:'Core CI 42013739936',result:'Actual application regression: a successful supported legacy status without Task25 left authenticated presentation permanently pending. Product now explicitly settles unavailable capability; original responsive home assertions retained, with an additional real-browser status-contract regression.'},
];
await fs.writeFile(path.join(output,'verification-history.json'),JSON.stringify({assertions_deleted_or_relaxed:false,frozen_assertions_changed:false,history},null,2));
const inventory=[];
for(const name of (await fs.readdir(output)).sort()){const file=path.join(output,name);if((await fs.stat(file)).isFile())inventory.push({path:name,sha256:hash(await fs.readFile(file))});}
await fs.writeFile(path.join(output,'evidence-manifest.json'),JSON.stringify({candidate:candidate.target_sha,files:inventory},null,2));
console.log(JSON.stringify({candidate:candidate.target_sha,frozen:25,passed:25,curatedFiles:inventory.length,productionOperations:0}));

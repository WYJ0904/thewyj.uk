import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..'),raw=path.join(root,'docs/migration-evidence/p07-r4c'),out=path.join(root,'docs/p07/evidence/r4c/independent');
const read=async name=>JSON.parse(await fs.readFile(path.join(raw,name),'utf8'));
const write=async(name,value)=>fs.writeFile(path.join(out,name),JSON.stringify(value,null,2));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(out,{recursive:true});
const browser=await read('r4c-rc2-on/round3-browser-results.json'),provenance=await read('r4c-rc2-on/r4a-driver-provenance.json');
assert.equal(provenance.frozen_browser_sha256,'227c4f69d473186fdbe307fa3a6da4a9a6d5a0c41d485ff51d19beed608fa61d');
assert.equal(browser.checks.length,25);
const counts={passed:browser.checks.filter(c=>c.status==='PASS').length,failed:browser.checks.filter(c=>c.status!=='PASS').length};
await write('frozen-browser.json',{source:browser.target_sha,frozenSha256:provenance.frozen_browser_sha256,...counts,checks:browser.checks.map(({id,status,detail,error})=>({id,status,detail,error})),realAiCalls:0,productionOperations:0});
const copies=[['r4c-rc2-on/primary-workspaces.json','primary-workspaces.json'],['r4c-rc2-on/r4a-runtime-results.json','runtime-results.json'],
  ['r4c-rc2-on/p4-workspace-behavior.json','p4-results.json'],['r4c-rc2-on/source-manifest.json','tested-source-manifest.json'],
  ['r4c-rc2-on/r4a-driver-provenance.json','driver-provenance.json'],['r4c-fixed-baseline-red/runtime-probe.json','baseline-red.json'],
  ['r4c-rc2-runtime/runtime-probe.json','runtime-green.json'],['r4c-rc2-upgrade/cache-upgrade.json','warm-upgrade.json'],
  ['r4c-rc2-upgrade/upgrade-safety.json','upgrade-safety.json'],['r4c-rc2-pwa/p5-pwa.json','pwa-contract.json'],['r4c-rc2-e/e-workspaces.json','e-workspaces.json']];
for(const [from,to] of copies)await write(to,await read(from));
for(const mode of ['off','kill']){const v=await read(`r4c-rc2-${mode}/round3-browser-results.json`);await write(mode+'-policy.json',{source:v.target_sha,checks:v.checks.map(({id,status,detail,error})=>({id,status,detail,error}))});}
await fs.copyFile(path.join(root,'docs/p07/evidence/r4a/brand-preservation.json'),path.join(out,'brand-preservation.json'));
const images=[['r4c-fixed-baseline-red/G01-background-bootstrap.png','G01-before.png'],['r4c-rc2-runtime/G01-background-bootstrap.png','G01-after.png'],
  ['r4c-fixed-baseline-red/G02-undecided-policy.png','G02-policy-pending.png'],['r4c-rc2-runtime/G02-settled-workflow.png','G02-policy-settled.png'],
  ['r4c-rc2-on/finance-upgrade-membership.png','membership-exclusive.png'],['r4c-rc2-on/direct-account.png','account-main.png'],
  ['r4c-rc2-upgrade/offline-upgraded-shell.png','offline-upgraded-shell.png'],['r4c-rc2-e/E-workflowWorkspace-390-dark.png','E-workflow-390-dark.png'],
  ['r4c-rc2-e/E-transferPage-375-light.png','E-transfer-375-light.png'],['r4c-rc2-e/E-adminPanel-1440-dark.png','E-admin-1440-dark.png'],['r4c-rc2-e/E-financePage-390-dark.png','E-candidates-390-dark.png']];
for(const [from,to] of images)await fs.copyFile(path.join(raw,from),path.join(out,to));
await fs.copyFile(path.join(raw,'r4c-final-upgrade/cache-upgrade.log'),path.join(out,'warm-upgrade-original-failure.log'));
let preflight=null;
try{preflight=await read('r4c-f-unified-final/p07-f-preflight-report.json');await write('f-unified-preflight.json',preflight);}catch(error){if(error.code!=='ENOENT')throw error;}
await write('acceptance-boundaries.json',{runtimeFrozen:counts.failed?'FAIL':'PASS',fTooling:preflight?{executed:true,source:preflight.baselineSha,toolArtifactStatus:preflight.status,quality:preflight.unifiedAcceptance,findings:preflight.findings.length}:{executed:false,status:'NOT_EXECUTED'},
  automaticPreview:{url:'https://eb0120ec.thewyj-uk.pages.dev',source:'owner observation',publicPolicy:{enabled:false,revision:0,reason:'missing'},classification:'environment configuration; expected fail-closed'},
  finalFlashHostedPreview:'OLDER_C8_SNAPSHOT_INDEPENDENTLY_VERIFIED; FINAL_HEAD_REDEPLOY_REQUIRED',hostedAccountPolicy:'V3_ON_ON_VERIFIED_C8_SNAPSHOT',manualOwnerReview:'HELD',productionOperations:0});
const hosted=await read('r4c-flash-joint-413-verified/hosted-joint.json');await write('hosted-joint-c8.json',hosted);
for(const image of ['joint-guest-home.png','joint-account.png','joint-recharge.png'])await fs.copyFile(path.join(raw,'r4c-flash-joint-413-verified',image),path.join(out,image));
await write('module-identity-regression.json',await read('r4c-module-identity-green/parked-rows.json'));
if(preflight)await write('f-quality-boundaries.json',{executedSource:preflight.baselineSha,artifactStatus:preflight.status,quality:preflight.unifiedAcceptance,
  labMetrics:preflight.labCoreWebVitals,lcpCandidateIsSplash:preflight.labCoreWebVitals?.lcpElement?.id==='splashImage',fieldINP:'NOT_MEASURED',mainCanvasPerformanceAcceptance:'NOT_ESTABLISHED_BY_SPLASH_LCP',findings:preflight.findings});
const manifest=await read('r4c-rc2-on/source-manifest.json');
const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,maxBuffer:30*1024*1024});assert.equal(r.status,0);return r.stdout;};
const head=git('rev-parse','HEAD').toString().trim();
for(const sha of new Set([head,browser.target_sha,'74d166a48f5101932d8b72cdbb2b54781ee5812e',hosted.deployedSha,...(preflight?[preflight.baselineSha]:[])]))for(const [file,expected] of Object.entries(manifest.files))assert.equal(hash(git('show',sha+':'+file)),expected,sha+':'+file);
await write('release-equivalence.json',{testedSha:browser.target_sha,warmUpgradeSha:'74d166a48f5101932d8b72cdbb2b54781ee5812e',hostedSnapshotSha:hosted.deployedSha,fExecutedSha:preflight?.baselineSha,checkedDeliveryParent:head,publishedFiles:Object.keys(manifest.files).length,allGitBytesIdentical:true,exactHostedHeadMatch:hosted.deployedSha===head});
await write('verification-history.json',{frozenAssertionsChanged:false,history:[
  {case:'r4c-runtime-red',result:'Initial G02 probe lacked a selected workflow template and reported a hidden run button. Fixture corrected to the same selected template as original CI; no product credit was taken from that failure.'},
  {case:'r4c-fixed-baseline-red',source:'0c87169aa4b75db4d00fe76a66bd32a62ead9e4a',result:'Real hidden account document: timers delivered, RAF zero, splash retained. The same background completion assertion failed.'},
  {case:'r4c-final-upgrade',result:'Actual R4-A to first integration candidate normal refresh failed before boot. Old worker source rejects unknown v modules; original failure log retained. RC2 canonical query bridge passed unchanged app-byte and storage assertions.'},
  {case:'static query contract',result:'Three original static checks hardcoded v. Canonical query changed to release to support deployed workers; exact version and full module/cache coverage retained. 31/31 passed after contract update.'},
  {case:'new worker unit fixtures',result:'Early new test syntax/network fixture wiring errors retained in ignored logs; fixed without changing the expected old-cache/future-navigation/no-API assertions. 13/13 runtime tests passed.'},
  {case:'Core CI cef7db9 application',result:'Cache presence checks still requested v URLs. Updated seven checks to exact canonical release keys; every original boolean and navigation assertion retained.'},
  {case:'Core CI c8ff0aa parked rows',result:'Tests imported v modules while product imports used release. Distinct ES module instances split the parked-row WeakMap. Updated current-resource test URLs, preserving every original identity, draft, removal, empty and reduced-motion assertion; targeted real Chrome contract passed.'},
  {case:'P07-F shared-runtime adapter',result:'Initial external-mode probe variables were scoped inside standalone startup. Corrected loading scope without modifying audit assertions; full audit then executed, returned nonzero for 8 findings.'},
  {case:'Hosted browser startup',result:'Manual PowerShell browser startup was rejected by automatic approval review with no specific reason. Switched to the existing owned QA launcher; no authorization or environment guard was bypassed.'},
  {case:'Hosted metadata pagination',result:'First metadata list request failed before credential use. Reused the existing validated Pages pagination size, retaining exact SHA and isolated-binding assertions; verified snapshot c8 passed 16 cases.'}
]});
const inventory=[];
async function walk(dir,relative=''){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const name=path.posix.join(relative,entry.name);if(name==='evidence-manifest.json')continue;assert.equal(entry.isSymbolicLink(),false);if(entry.isDirectory())await walk(path.join(dir,entry.name),name);else if(entry.isFile())inventory.push({path:name,sha256:hash(await fs.readFile(path.join(dir,entry.name)))});}}
await walk(out);inventory.sort((a,b)=>a.path.localeCompare(b.path));await write('evidence-manifest.json',{testedSha:browser.target_sha,files:inventory});
console.log(JSON.stringify({...counts,primary:(await read('r4c-rc2-on/primary-workspaces.json')).cases.map(c=>c.status),eChecks:(await read('r4c-rc2-e/e-workspaces.json')).results.length,fExecuted:Boolean(preflight),publishedFiles:Object.keys(manifest.files).length,evidenceFiles:inventory.length}));
if(counts.failed)process.exitCode=1;

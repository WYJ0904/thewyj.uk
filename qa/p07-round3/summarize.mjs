import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..');
const raw=path.join(root,'docs/migration-evidence/p07-d');
const output=path.join(root,'docs/p07/evidence/round3');
await fs.mkdir(output,{recursive:true});
const hash=x=>createHash('sha256').update(x).digest('hex');
const read=async(label,file)=>JSON.parse(await fs.readFile(path.join(raw,label,file),'utf8'));
function clean(value){
  if(Array.isArray(value))return value.map(clean);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['stack','diagnostic'].includes(k)).map(([k,v])=>[k,clean(v)]));
  return typeof value==='string'?value.replaceAll('C:\\Users\\78252','%USERPROFILE%').replaceAll('C:/Users/78252','%USERPROFILE%'):value;
}
async function retain(relative,data){
  const destination=path.join(output,relative);await fs.mkdir(path.dirname(destination),{recursive:true});
  const bytes=Buffer.isBuffer(data)?data:Buffer.from(JSON.stringify(clean(data),null,2)+'\n');
  try{const prior=await fs.readFile(destination);assert.equal(hash(prior),hash(bytes),'Refuse to replace retained evidence '+relative);}
  catch(e){if(e.code==='ENOENT')await fs.writeFile(destination,bytes,{flag:'wx'});else throw e;}
}
const inputs=[['red','round3-red-final-v2'],['candidate','round3-flash-final-v2']];
const reports={},drivers={};
for(const [name,label] of inputs){
  const report=await read(label,'round3-browser-results.json');reports[name]=report;
  await retain(name+'/results.json',{...report,network_trace:undefined});
  await retain(name+'/card-hit-matrix.json',await read(label,'round3-card-hit-matrix.json'));
  drivers[name]=await read(label,'driver-manifest.json');await retain(name+'/driver-manifest.json',drivers[name]);
  await retain(name+'/source-manifest.json',await read(label,'source-manifest.json'));
  await retain(name+'/runtime-tier.json',await read(label,'runtime-tier.json'));
  await retain(name+'/legacy-account-escape.json',await read(label,'legacy-account-escape-observation.json'));
  const names=await fs.readdir(path.join(raw,label,'round3-screenshots'));
  const keep=names.filter(n=>!n.startsWith('FAIL-')&&!n.includes('-first.png')&&!n.includes('home-feature-card-expanded'));
  for(const file of keep)await retain(name+'/screenshots/'+file,await fs.readFile(path.join(raw,label,'round3-screenshots',file)));
  for(const mode of ['off','kill']){
    const flagLabel=`round3-${name==='red'?'red':'flash'}-${mode}-v2`;
    const data=await read(flagLabel,'round3-browser-results.json');
    await retain(name+`/flag-${mode}.json`,{...data,network_trace:undefined});
    for(const file of (await fs.readdir(path.join(raw,flagLabel,'round3-screenshots'))).filter(n=>n.endsWith('.png')&&!n.includes('-first.png')))
      await retain(name+`/flag-${mode}-screenshots/`+file,await fs.readFile(path.join(raw,flagLabel,'round3-screenshots',file)));
  }
  const supplementLabel=`round3-${name==='red'?'red':'flash'}-layout`;
  const supplement=await read(supplementLabel,'layout-supplement.json');
  await retain(name+'/layout-supplement.json',supplement);
  for(const file of supplement.screenshots)await retain(name+'/screenshots/'+file,await fs.readFile(path.join(raw,supplementLabel,file)));
}
assert.deepEqual(drivers.red.files,drivers.candidate.files,'RED and candidate main suites must use identical drivers');
const hosted=await read('round3-flash-final-v2','hosted-readonly-results.json');
await retain('hosted-readonly.json',hosted);
for(const row of hosted.results)for(const file of row.screenshots)
  await retain('hosted-screenshots/'+file,await fs.readFile(path.join(raw,'round3-flash-final-v2','hosted-readonly-screenshots',file)));
await retain('candidate/p4-workspace-behavior.json',await read('round3-flash-final-v2','p4-workspace-behavior.json'));
const cacheUpgrade=await read('round3-cache-upgrade','cache-upgrade.json');
await retain('cache-upgrade.json',cacheUpgrade);
const comparison=reports.red.checks.map(before=>{const after=reports.candidate.checks.find(x=>x.id===before.id);assert.ok(after,'missing candidate test '+before.id);return{id:before.id,red:before.status,candidate:after.status};});
const counts=r=>({pass:r.checks.filter(x=>x.status==='PASS').length,fail:r.checks.filter(x=>x.status==='FAIL').length,not_tested:0});
await retain('comparison.json',{status:'P07_ROUND3_QA_PARTIAL',date:'2026-11-05',timezone:'Asia/Hong_Kong',
  red_sha:reports.red.target_sha,candidate_sha:reports.candidate.target_sha,counts:{red:counts(reports.red),candidate:counts(reports.candidate)},
  identical_driver_hashes:true,browser_driver_sha256:drivers.red.files['qa/p07-round3/browser.mjs'],comparison,
  real_ai_quality:'NOT_TESTED',hosted_authenticated_workspaces:'NOT_TESTED',hosted_administrator:'NOT_TESTED',
  production_acceptance:'NOT_TESTED',physical_touch:'NOT_TESTED',owner_existing_browser_profile_sw_upgrade:'NOT_TESTED',
  controlled_same_origin_sw_upgrade:cacheUpgrade.phases.filter(x=>x.generation==='candidate').every(x=>x.matchesCandidate)?'PASS':'FAIL'});
const history=[
  {labels:['round3-red-on','round3-red-on-2'],issues:['CDP maxTouchPoints=0 driver error','closed home disclosure and off-viewport coordinates','route readiness did not prove a new document','finance row hydration was incomplete']},
  {labels:['round3-red-on-3','round3-red-on-4','round3-flash-on-1'],issues:['balance parser rejected the valid -¥ prefix','removed splash element was dereferenced by the driver','closed finance disclosure made innerText unsuitable for row lookup','same-document readiness could match before navigation completed']},
  {labels:['round3-red-final-v1','round3-flash-final-v1'],issues:['homeProductDetails was not expanded before coordinate measurement','candidate confirm-payment click occurred before QR image hydration settled; no mutation was replayed']},
];
for(const item of history)for(const label of item.labels){
  const r=await read(label,'round3-browser-results.json');
  item.runs??=[];item.runs.push({label,source_sha:r.target_sha,pass:r.checks.filter(x=>x.status==='PASS').length,
    fail:r.checks.filter(x=>x.status==='FAIL').length,failures:r.checks.filter(x=>x.status==='FAIL').map(x=>({id:x.id,error:x.error}))});
}
await retain('driver-development-history.json',{scope:'Preserved original failed runs; aggregate counts are superseded by the fixed v2 driver, not relabeled PASS',history,
  corrections:['new-document identity and actual boot completion','real native expansion of the home disclosure','wait for actual QR decode, then fresh pointer geometry and elementFromPoint','numeric parsing tolerates currency-symbol placement while formatting is asserted separately'],
  round3_business_expectations_weakened:false,failed_cases_skipped_in_full_v2:0,
  original_CI_account_modal_assumption_replaced_with_page_navigation:true,product_code_changed:false});
const entries=[];
async function walk(dir,prefix=''){for(const e of await fs.readdir(dir,{withFileTypes:true})){const rel=prefix+e.name;if(e.isDirectory())await walk(path.join(dir,e.name),rel+'/');else if(rel!=='evidence-manifest.json'){const data=await fs.readFile(path.join(dir,e.name));entries.push({file:rel,bytes:data.length,sha256:hash(data)});}}}
await walk(output);entries.sort((a,b)=>a.file.localeCompare(b.file));
await retain('evidence-manifest.json',{files:entries,total_bytes:entries.reduce((n,x)=>n+x.bytes,0),synthetic_only:true});
console.log(JSON.stringify({files:entries.length,bytes:entries.reduce((n,x)=>n+x.bytes,0),counts:{red:counts(reports.red),candidate:counts(reports.candidate)}},null,2));

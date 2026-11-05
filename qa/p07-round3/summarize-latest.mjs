import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'../..'),raw=path.join(root,'docs/migration-evidence/p07-d'),out=path.join(root,'docs/p07/evidence/round3-latest');
const hash=x=>createHash('sha256').update(x).digest('hex');
const read=async(label,file)=>JSON.parse(await fs.readFile(path.join(raw,label,file),'utf8'));
function clean(v){if(Array.isArray(v))return v.map(clean);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>!['stack','diagnostic','network_trace'].includes(k)).map(([k,x])=>[k,clean(x)]));return typeof v==='string'?v.replaceAll('C:\\Users\\78252','%USERPROFILE%').replaceAll('C:/Users/78252','%USERPROFILE%'):v;}
async function retain(file,data){const target=path.join(out,file),bytes=Buffer.isBuffer(data)?data:Buffer.from(JSON.stringify(clean(data),null,2)+'\n');await fs.mkdir(path.dirname(target),{recursive:true});
  try{assert.equal(hash(await fs.readFile(target)),hash(bytes),'retained evidence conflict '+file);}catch(e){if(e.code==='ENOENT')await fs.writeFile(target,bytes,{flag:'wx'});else throw e;}}
const latest=await read('round3-latest-final','round3-browser-results.json'),driver=await read('round3-latest-final','driver-manifest.json');
const red=await read('round3-red-final-v2','round3-browser-results.json'),fb=await read('round3-flash-final-v2','round3-browser-results.json');
const originalDriver=await read('round3-red-final-v2','driver-manifest.json');
assert.equal(driver.files['qa/p07-round3/browser.mjs'],originalDriver.files['qa/p07-round3/browser.mjs'],'latest must replay the frozen 25-case browser driver');
for(const file of ['round3-browser-results.json','round3-card-hit-matrix.json','driver-manifest.json','source-manifest.json','runtime-tier.json','p4-workspace-behavior.json','legacy-account-escape-observation.json','primary-workspaces.json','hosted-readonly-results.json'])
  await retain(file,await read('round3-latest-final',file));
for(const file of (await fs.readdir(path.join(raw,'round3-latest-final','round3-screenshots'))).filter(x=>!x.startsWith('FAIL-')&&!x.includes('-first.png')&&!x.includes('home-feature-card-expanded')&&!x.includes('-normal-stable')))
  await retain('screenshots/'+file,await fs.readFile(path.join(raw,'round3-latest-final','round3-screenshots',file)));
for(const mode of ['off','kill']){
  const label='round3-latest-'+mode;await retain('flag-'+mode+'.json',await read(label,'round3-browser-results.json'));
  for(const file of (await fs.readdir(path.join(raw,label,'round3-screenshots'))).filter(x=>x.endsWith('.png')&&!x.includes('-first.png')))
    await retain('flag-'+mode+'-screenshots/'+file,await fs.readFile(path.join(raw,label,'round3-screenshots',file)));
}
const primaryInputs=[['red','round3-red-primary'],['fb936d1','round3-flash-primary'],['f7949f8','round3-latest-final']];
const primary=[];
for(const [name,label] of primaryInputs){const r=await read(label,'primary-workspaces.json');primary.push(r);await retain('primary-'+name+'.json',r);
  for(const c of r.cases)await retain('primary-'+name+'/'+c.screenshot,await fs.readFile(path.join(raw,label,c.screenshot)));}
const hosted=await read('round3-latest-final','hosted-readonly-results.json');
for(const row of hosted.results)for(const file of row.screenshots)await retain('hosted-screenshots/'+file,await fs.readFile(path.join(raw,'round3-latest-final','hosted-readonly-screenshots',file)));
const cache=await read('round3-cache-upgrade-latest','cache-upgrade.json');await retain('cache-upgrade.json',cache);
const counts=r=>({pass:r.checks.filter(x=>x.status==='PASS').length,fail:r.checks.filter(x=>x.status==='FAIL').length});
const comparison=red.checks.map(c=>({id:c.id,red:c.status,fb936d1:fb.checks.find(x=>x.id===c.id).status,f7949f8:latest.checks.find(x=>x.id===c.id).status}));
await retain('comparison.json',{status:'P07_ROUND3_QA_PARTIAL',date:'2026-11-05',timezone:'Asia/Hong_Kong',
  revisions:{red:red.target_sha,owner_supplied:fb.target_sha,additional_final_ci_candidate:latest.target_sha},counts:{red:counts(red),fb936d1:counts(fb),f7949f8:counts(latest)},
  identical_25_case_browser_driver:true,browser_driver_sha256:driver.files['qa/p07-round3/browser.mjs'],comparison,
  primary_surface_cases:primary.map(r=>({sha:r.target_sha,pass:r.cases.filter(c=>c.status==='PASS').length,fail:r.cases.filter(c=>c.status==='FAIL').length})),
  cache_upgrade:cache.phases.filter(p=>p.generation==='candidate').every(p=>p.matchesCandidate)?'PASS':'FAIL',
  real_ai_quality:'NOT_TESTED',hosted_authenticated_workspaces:'NOT_TESTED',hosted_administrator:'NOT_TESTED',owner_existing_browser_profile:'NOT_TESTED',production:'NOT_TESTED'});
const entries=[];async function walk(dir,prefix=''){for(const e of await fs.readdir(dir,{withFileTypes:true})){const file=prefix+e.name;if(e.isDirectory())await walk(path.join(dir,e.name),file+'/');else if(file!=='evidence-manifest.json'){const b=await fs.readFile(path.join(dir,e.name));entries.push({file,bytes:b.length,sha256:hash(b)});}}}
await walk(out);entries.sort((a,b)=>a.file.localeCompare(b.file));await retain('evidence-manifest.json',{files:entries,total_bytes:entries.reduce((n,x)=>n+x.bytes,0),synthetic_only:true});
console.log(JSON.stringify({latest:counts(latest),files:entries.length,bytes:entries.reduce((n,x)=>n+x.bytes,0)},null,2));

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {openPage} from '../../local-backend/browser_harness.mjs';
import {featureWriteWithBudget} from './feature-write-budget.mjs';

// Run after wrong-review-browser.mjs has created its Japanese legacy fixture.
const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8894';
assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const secret=process.env.WYJ_TEST_ADMIN_SECRET;assert.ok(secret);
const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9225',baseUrl,width:390,height:1000,mobile:true});
const originalFlags=[];let loggedIn=false;
const checks=[];
async function call(route,body,token=null){
  return page.evaluate(`(async()=>{const response=await fetch(${JSON.stringify(route)},{method:${JSON.stringify(body===undefined?'GET':'POST')},headers:{'X-Session-Token':${token===null?"localStorage.getItem('wyjAccountSession')||''":JSON.stringify(token)},'Content-Type':'application/json'},${body===undefined?'':`body:JSON.stringify(${JSON.stringify(body)}),`}cache:'no-store'});return {status:response.status,retry_after:response.headers.get('Retry-After'),body:await response.json()};})()`);
}
async function login(){
  await page.navigate('/login');await page.setFields({'#usernameInput':'wyj','#secretInput':secret});await page.click('#loginSubmitBtn');
  await page.waitFor("location.pathname==='/'&&state.account?.id",30000);loggedIn=true;
}
async function writeFlag(flag,patch){
  const current=(await call('/api/admin/feature-flags')).body.flags.find(row=>row.flag_key===flag.flag_key);
  const result=await featureWriteWithBudget(()=>call('/api/admin/feature-flags',{flag_key:current.flag_key,expected_revision:current.revision,...patch}));
  assert.equal(result.status,200);
}
const canonical=body=>body.points.map(point=>{
  assert.ok(Number.isFinite(point.score));
  return Object.fromEntries(['id','knowledge_id','score','attempt_count','correct_count','incorrect_count','effective_attempt_count','last_event_seq']
    .filter(key=>point[key]!==undefined).map(key=>[key,point[key]]));
});
try{
  await login();const account=await page.evaluate('state.account.id');
  const listed=await call('/api/admin/feature-flags');assert.equal(listed.status,200);
  for(const key of ['adaptive_learning','mastery_score','adaptive_review']){
    const flag=listed.body.flags.find(row=>row.flag_key===key);assert.ok(flag);originalFlags.push(flag);
    await writeFlag(flag,{enabled:true,kill_switch:false,channels:['stable','beta','experimental'],rollout_percentage:100});
  }
  const before=await call('/api/learning/mastery/summary?language=japanese');assert.equal(before.status,200);
  assert.equal(before.body.account_id,account);assert.ok(before.body.points.length>0,'Expected the previous real legacy-recovery browser fixture');
  const saved=canonical(before.body);assert.ok(saved.some(point=>point.attempt_count>0));
  checks.push('real_login_reads_existing_account_owned_mastery');
  const oldToken=await page.evaluate("localStorage.getItem('wyjAccountSession')");
  await page.evaluate("document.getElementById('logoutBtn').click()");await page.waitFor('!state.account');loggedIn=false;
  assert.equal(await page.evaluate("localStorage.getItem('wyjAccountSession')"),null);
  assert.equal((await call('/api/learning/mastery/summary?language=japanese')).status,401);
  assert.equal((await call('/api/learning/mastery/summary?language=japanese',undefined,oldToken)).status,401);
  checks.push('real_logout_clears_client_identity_and_revokes_the_old_session');
  await login();assert.equal(await page.evaluate('state.account.id'),account);
  assert.notEqual(await page.evaluate("localStorage.getItem('wyjAccountSession')"),oldToken);
  const after=await call('/api/learning/mastery/summary?language=japanese');assert.equal(after.status,200);
  assert.equal(after.body.account_id,account);assert.deepEqual(canonical(after.body),saved);
  checks.push('real_relogin_restores_identical_canonical_learning_evidence');
  assert.deepEqual(page.runtimeErrors,[]);
  const directory=path.resolve(process.env.WYJ_TEST_ARTIFACT_DIR||'artifacts','task26');fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'independent-session.json'),JSON.stringify({passed:true,physical_device:false,checks},null,2));
  console.log(`PASS session lifecycle: ${checks.join(', ')} (3 groups)`);
}finally{
  if(loggedIn)for(const flag of originalFlags)await writeFlag(flag,{enabled:flag.enabled,kill_switch:flag.kill_switch,channels:flag.channels,rollout_percentage:flag.rollout_percentage});
  await page.close();
}

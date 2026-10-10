import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openPage } from '../../local-backend/browser_harness.mjs';
import { catalog } from '../../functions/_lib/task26-catalog.mjs';

const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8894',secret=process.env.WYJ_TEST_ADMIN_SECRET;
assert.equal(new URL(baseUrl).hostname,'127.0.0.1','This destructive synthetic fixture is restricted to isolated local D1');
assert.ok(secret,'Synthetic fixture password is required');
const artifactRoot=path.resolve(process.env.WYJ_TEST_ARTIFACT_DIR||'artifacts','task26');fs.mkdirSync(artifactRoot,{recursive:true});
const results=[];const flagKeys=['adaptive_learning','mastery_score','adaptive_review','ai_error_explanation','similar_word_explanation'];
const widths=process.env.WYJ_TASK26_WIDTHS?process.env.WYJ_TASK26_WIDTHS.split(',').map(Number):[320,390,768,1366,1920];
assert.ok(widths.length&&widths.every(w=>[320,390,768,1366,1920].includes(w)),'Invalid browser width selection');
for(const width of widths){
 const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9225',baseUrl,width,height:1000,mobile:width<768});
 const checks=[];let accountId;
 const call=async(route,body)=>page.evaluate(`(async()=>{const r=await fetch(${JSON.stringify(route)},{method:${JSON.stringify(body===undefined?'GET':'POST')},headers:{'X-Session-Token':localStorage.getItem('wyjAccountSession'),${body===undefined?'':"'Content-Type':'application/json'"}},${body===undefined?'':`body:JSON.stringify(${JSON.stringify(body)}),`}cache:'no-store'});return {status:r.status,body:await r.json()};})()`);
 async function editFlag(key,patch){
  const {body}=await call('/api/admin/feature-flags');const f=body.flags.find(f=>f.flag_key===key);assert.ok(f,`missing ${key}`);
  const response=await call('/api/admin/feature-flags',{flag_key:key,expected_revision:f.revision,enabled:true,kill_switch:false,channels:['experimental'],rollout_percentage:100,...patch});
  assert.equal(response.status,200,JSON.stringify(response.body));
 }
 const pendingCount=()=>page.evaluate(`(JSON.parse(localStorage.getItem('aerisMastery:v1:'+${JSON.stringify(accountId)}))?.outbox||[]).length`);
 const settle=()=>page.evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
 async function currentQuestion(){return page.evaluate(`JSON.parse(localStorage.getItem('aerisMastery:v1:'+${JSON.stringify(accountId)})).questions[location.pathname.endsWith('japanese')?'japanese':'english'].question`);}
 async function answerQuestion(correct){
  const q=await currentQuestion();const found=catalog(q.language).flatMap(p=>p.questions).find(candidate=>candidate.kind===q.kind&&candidate.prompt===q.prompt);
  assert.ok(found,'Public question must correspond to reviewed server course');await page.setFields({'#masteryAnswerInput':correct?found.answers[0]:'wrong-response'});await page.click('#masterySubmitBtn');
  await page.waitFor(`!document.getElementById('masteryResult').classList.contains('hidden') && document.getElementById('masteryResultTitle').textContent === ${JSON.stringify(correct?'回答正确':'还需要练习')}`,30000);
  await page.waitFor("!document.getElementById('masteryNextBtn').disabled",30000);return q;
 }
 try{
  await page.navigate('/language/english');assert.equal(await page.evaluate("document.getElementById('masterySection').classList.contains('hidden')"),true);checks.push('guest_boundary');
  await page.navigate('/login');await page.setFields({'#usernameInput':process.env.WYJ_TEST_ADMIN_USER||'wyj','#secretInput':secret});await page.click('#loginSubmitBtn');await page.waitFor("location.pathname==='/'",30000);
  accountId=await page.evaluate("JSON.parse(localStorage.getItem('wyjAccountCache')).id");await page.evaluate("document.getElementById('dismissVersionNoticeBtn')?.click()");
  for(const key of flagKeys)await editFlag(key,{});
  const preference=await call('/api/release-channel');const setPreference=await call('/api/release-channel',{channel:'experimental',expected_revision:preference.body.revision});assert.equal(setPreference.status,200);
  await page.navigate('/language/english');await page.evaluate("document.getElementById('dismissVersionNoticeBtn')?.click()");
  await page.waitFor("!document.getElementById('masterySection').classList.contains('hidden') && !document.getElementById('masteryStartBtn').disabled",30000);
  await page.click('#masteryStartBtn');await page.waitFor("!document.getElementById('masteryQuiz').classList.contains('hidden') && !document.getElementById('masterySubmitBtn').disabled");
  const first=await answerQuestion(true);assert.equal(await pendingCount(),0);
  const server=await call('/api/learning/mastery/summary?language=english');assert.equal(server.status,200);assert.equal(server.body.account_id,accountId);assert.ok(server.body.points.some(p=>p.score>0));checks.push('correct_answer_mastery');
  await page.click('#masteryNextBtn');await page.waitFor(`document.getElementById('masteryAnswerInput').value==='' && !document.getElementById('masterySubmitBtn').disabled`);
  const second=await answerQuestion(false);assert.notEqual(second.ticket_id,first.ticket_id);await page.click('#masteryAiBtn');await page.waitFor("document.getElementById('masteryAiExplanation').textContent.includes('课程解析')",30000);checks.push('wrong_answer_course_ai_fallback');
  await page.click('#masteryWeakList button');assert.ok(await page.evaluate("document.getElementById('masteryDetail').textContent.includes('下次复习')"));checks.push('point_details');
  await page.navigate('/language/english');await page.waitFor("!document.getElementById('masterySection').classList.contains('hidden') && !document.getElementById('masteryResult').classList.contains('hidden')",30000);
  assert.ok(await page.evaluate("document.getElementById('masteryCounts').textContent.includes('学习中')"));checks.push('reload_persistence');
  for(const theme of ['light','dark']){
   for(let cycle=0;cycle<3&&await page.evaluate('document.documentElement.dataset.theme')!==theme;cycle++)await page.click('#themeToggleBtn');
   await page.waitFor(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`);await settle();
   assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`horizontal overflow at ${width}/${theme}`);
   assert.ok(await page.evaluate("Array.from(document.querySelectorAll('#masterySection button')).filter(b=>b.getClientRects().length).every(b=>b.scrollWidth<=b.clientWidth+1 && b.getBoundingClientRect().height>=43)"),`clipped/inaccessible controls at ${width}/${theme}`);
   await page.evaluate("document.getElementById('masterySection').scrollIntoView({block:'start'})");
   const screenshot=await page.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(artifactRoot,`mastery-${width}-${theme}.png`),Buffer.from(screenshot.data,'base64'));
  }
  // Inspector stylesheet simulates enlarged content without loosening CSP or
  // injecting an inline <style> that the product correctly blocks.
  await page.send('DOM.enable');await page.send('CSS.enable');
  const {frameTree}=await page.send('Page.getFrameTree');const {styleSheetId}=await page.send('CSS.createStyleSheet',{frameId:frameTree.frame.id});
  await page.send('CSS.setStyleSheetText',{styleSheetId,text:'#masterySection{font-size:150%} #masterySection input,#masterySection button,#masterySection .muted{font-size:inherit}'});await settle();
  assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),`large text overflow ${width}`);assert.ok(await page.evaluate("Array.from(document.querySelectorAll('#masterySection button')).filter(b=>b.getClientRects().length).every(b=>b.scrollWidth<=b.clientWidth+1)"));
  await page.send('CSS.setStyleSheetText',{styleSheetId,text:''});checks.push('five_width_light_dark_large_text');
  await page.navigate('/language/japanese');await page.waitFor("document.getElementById('masterySection').dataset.language==='japanese' && !document.getElementById('masterySection').classList.contains('hidden') && !document.getElementById('masteryStartBtn').disabled",30000);await page.click('#masteryStartBtn');await page.waitFor("document.getElementById('masterySection').dataset.language==='japanese' && !document.getElementById('masterySubmitBtn').disabled && !document.getElementById('masteryQuiz').classList.contains('hidden')");
  await answerQuestion(true);const japanese=await call('/api/learning/mastery/summary?language=japanese');assert.equal(japanese.status,200);assert.ok(japanese.body.points.every(p=>p.knowledge_id.startsWith('japanese:')));checks.push('japanese_language_isolation');
  if(width===390){
   await page.click('#masteryNextBtn');await page.waitFor("!document.getElementById('masterySubmitBtn').disabled && document.getElementById('masteryAnswerInput').value===''");
   await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await page.waitFor('navigator.onLine===false');
   await page.setFields({'#masteryAnswerInput':'offline-response'});await page.click('#masterySubmitBtn');assert.equal(await pendingCount(),1);
   assert.equal(await page.evaluate("document.getElementById('masteryResult').classList.contains('hidden')"),true);
   assert.ok(await page.evaluate("document.getElementById('masterySyncStatus').textContent.includes('待同步')"));
   const eventId=await page.evaluate(`JSON.parse(localStorage.getItem('aerisMastery:v1:'+${JSON.stringify(accountId)})).outbox[0].input.event_id`);
   await page.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
   await page.waitFor(`JSON.parse(localStorage.getItem('aerisMastery:v1:'+${JSON.stringify(accountId)})).outbox.length===0`,30000);
   const storedId=await page.evaluate(`JSON.parse(localStorage.getItem('aerisMastery:v1:'+${JSON.stringify(accountId)})).results.japanese.receipt.event_id`);assert.equal(storedId,eventId);checks.push('real_offline_pending_same_id_reconnect');
   await page.waitFor("!document.getElementById('masteryNextBtn').disabled",30000);
   await page.click('#masteryNextBtn');await page.waitFor("!document.getElementById('masterySubmitBtn').disabled && document.getElementById('masteryAnswerInput').value===''");
   const authResponse=await fetch(baseUrl+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.WYJ_TEST_ADMIN_USER||'wyj',secret})});const syntheticAuth=await authResponse.json();assert.ok(syntheticAuth.session);
   let lostId='',serverAccepted=false;
   const faults=await page.intercept([{match:'/api/learning/events',state:'lost',respond:async({postData,state})=>{
    if(state!=='lost')return {continue:true};const body=JSON.parse(postData);if(body.kind!=='answer_submitted')return {continue:true};
    lostId=body.event_id;const actual=await fetch(baseUrl+'/api/learning/events',{method:'POST',headers:{'Content-Type':'application/json','X-Session-Token':syntheticAuth.session},body:postData});serverAccepted=actual.status===200;await actual.arrayBuffer();
    return {status:503,body:{ok:false,code:'learning_unavailable',error:'Injected response loss after real server acceptance'}};
   }}]);
   await page.setFields({'#masteryAnswerInput':'response-lost'});await page.click('#masterySubmitBtn');await page.waitFor("document.getElementById('masteryStatus').textContent.includes('待同步')",30000);assert.equal(serverAccepted,true);assert.equal(await pendingCount(),1);
   faults.setState('normal');await page.click('#masteryRetryBtn');await page.waitFor(`JSON.parse(localStorage.getItem('aerisMastery:v1:'+${JSON.stringify(accountId)})).outbox.length===0`,30000);
   assert.equal(await page.evaluate(`JSON.parse(localStorage.getItem('aerisMastery:v1:'+${JSON.stringify(accountId)})).results.japanese.receipt.event_id`),lostId);checks.push('accepted_response_loss_retry');
   const malformed=await page.intercept([{match:'/api/learning/mastery/summary',state:'broken',respond:({state})=>state==='broken'?{status:200,body:{ok:true,account_id:'wrong-account',points:[]}}:{continue:true}}]);
   await page.click('#masteryRetryBtn');await page.waitFor("document.getElementById('masteryStatus').textContent.includes('响应无效')",30000);assert.ok(await page.evaluate("document.getElementById('masteryCounts').textContent.includes('学习中')"));malformed.setState('normal');checks.push('malformed_response_cache_preserved');
  }
  await editFlag('adaptive_learning',{kill_switch:true});await page.click('#accountBtn');await page.waitFor("!document.getElementById('releaseChannelSection').classList.contains('hidden')");await page.click('#refreshReleaseChannelBtn');
  await page.waitFor("window.AerisFeatures.enabled('adaptive_learning')===false && document.getElementById('masterySection').classList.contains('hidden')",30000);
  await page.click('[data-close-modal=accountModal]');checks.push('kill_switch_hides_optional_mode_base_quiz_retained');
  assert.ok(await page.evaluate("document.getElementById('wordInput')!==null"));await editFlag('adaptive_learning',{});
  await page.navigate('/admin');await page.click('#adminFeatureFlagsTab');await page.click('#refreshLearningMetricsBtn');await page.waitFor("document.getElementById('learningMetrics').textContent.includes('mastery-v1')",30000);
  assert.ok(await page.evaluate("!document.getElementById('learningMetrics').textContent.includes('task26-local-owner')"));checks.push('admin_aggregated_diagnostics');
  assert.deepEqual(page.runtimeErrors,[]);results.push({width,checks,passed:true,runtime_errors:[]});console.log(`PASS ${width}: ${checks.join(', ')}`);
 }catch(error){
  const screenshot=await page.send('Page.captureScreenshot',{format:'png'}).catch(()=>null);if(screenshot)fs.writeFileSync(path.join(artifactRoot,`failure-${width}.png`),Buffer.from(screenshot.data,'base64'));throw error;
 }finally{await page.close();}
}
// All changes belonged to the disposable local owner and isolated database.
const report={environment:'isolated_local_pages_d1',hosted_preview:false,production:false,physical_device:false,results};
fs.writeFileSync(path.join(artifactRoot,'browser-acceptance.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));

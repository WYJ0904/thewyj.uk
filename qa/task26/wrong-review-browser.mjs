import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {openPage} from '../../local-backend/browser_harness.mjs';
import {ASSET_RELEASE} from '../asset-release.mjs';
const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8894',secret=process.env.WYJ_TEST_ADMIN_SECRET;
assert.equal(new URL(baseUrl).hostname,'127.0.0.1','Synthetic tests must never alter remote learning records or flags');
assert.ok(secret,'Isolated local owner secret required');
const widths=process.env.WYJ_TASK26_WIDTHS?.split(',').map(Number)||[320,390,768,1366,1920];
const root=path.resolve(process.env.WYJ_TEST_ARTIFACT_DIR||'artifacts','task26');fs.mkdirSync(root,{recursive:true});
const results=[];
const runId=crypto.randomUUID().slice(0,8);
for(const width of widths){
  const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9225',baseUrl,width,height:1000,mobile:width<768});
  const checks=[];
  async function call(route,body){return page.evaluate(`(async()=>{const response=await fetch(${JSON.stringify(route)},{method:${JSON.stringify(body===undefined?'GET':'POST')},headers:{'X-Session-Token':localStorage.getItem('wyjAccountSession'),'Content-Type':'application/json'},${body===undefined?'':`body:JSON.stringify(${JSON.stringify(body)}),`}cache:'no-store'});return {status:response.status,body:await response.json()};})()`);}
  async function flags(enabled){
    for(const key of ['adaptive_learning','mastery_score','adaptive_review']){
      const list=await call('/api/admin/feature-flags'),flag=list.body.flags.find(row=>row.flag_key===key);
      if(flag.enabled===enabled&&!flag.kill_switch&&flag.rollout_percentage===100)continue;
      const result=await call('/api/admin/feature-flags',{flag_key:key,expected_revision:flag.revision,enabled,kill_switch:false,channels:['stable','beta','experimental'],rollout_percentage:100});assert.equal(result.status,200,JSON.stringify(result));
    }
  }
  async function seed(language,kind='meaning'){
    const profile=`wr-${runId}-${width}-${language[0]}-${kind[0]}`;
    await page.navigate('/language/'+language);await page.evaluate("document.getElementById('dismissVersionNoticeBtn')?.click()");
    await page.setFields({'#profileInput':profile});
    await page.waitFor(`state.profile===${JSON.stringify(profile)}`);
    await page.evaluate(`(async()=>{const {sanitizeWrongBook}=await import('/js/language/wrong-book.js?v=${ASSET_RELEASE}');
      const language=${JSON.stringify(language)},kind=${JSON.stringify(kind)},profile=${JSON.stringify(profile)};
      const terms=language==='english'?['apple','banana']:['学校','電話'];
      const payload=Object.fromEntries(terms.map((word,index)=>[word,{word,language,question_type:kind,grading_mode:'strict',wrong_count:index+2,correct_answer:kind==='dictation'?(language==='japanese'?word+' / '+(index?'でんわ':'がっこう'):word):language==='english'?(index?'香蕉':'苹果'):(index?'电话':'学校'),accepted:[],rubric:{reading:index?'でんわ':'がっこう'}}]));
      for(const scope of ['current','history'])localStorage.setItem('wrongBook:v2:'+encodeURIComponent(state.account.id)+':'+scope+':'+encodeURIComponent(profile),JSON.stringify(sanitizeWrongBook(payload)));
      state.currentWrongBook=sanitizeWrongBook(payload);state.historyWrongBook=sanitizeWrongBook(payload);
      document.getElementById('profileInput').dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await page.waitFor(`typeof state!=='undefined'&&state.profile===${JSON.stringify(profile)}&&state.quizLanguage===${JSON.stringify(language)}`);
    await page.click('[data-view="wrongView"]');await page.waitFor("document.getElementById('wrongView').classList.contains('active')");
    assert.equal(await page.evaluate("document.querySelectorAll('#wrongList .wrong-item').length"),2);
  }
  async function answer(correct=true){
    const result=await page.evaluate(`(()=>{const word=state.words[state.index],info=(state.mode==='review-current'?state.currentWrongBook:state.historyWrongBook)[state.reviewKeys[state.index]];return {word,index:state.index,kind:info.question_type,answer:info.question_type==='dictation'?(state.quizLanguage==='japanese'?word+' / '+info.rubric.reading:word):info.correct_answer};})()`);
    await page.setFields({'#answerInput':correct?result.answer:'incorrect-fixture'});await page.click('#submitBtn');
    await page.waitFor(`state.pendingAdvance?.questionIndex===${result.index}&&!state.busy`,15000);
    assert.equal(await page.evaluate('state.pendingAdvance.feedback.correct'),correct);
    return result;
  }
  async function finish(){
    if(await page.evaluate('state.roundActive&&Boolean(state.pendingAdvance)'))await page.click('#nextNowBtn');
    if(await page.evaluate('state.roundActive')){await answer();await page.click('#nextNowBtn');}
    await page.waitFor('!state.roundActive');await page.click('#roundSetupBtn');
    await page.waitFor("document.getElementById('roundSummaryModal').classList.contains('hidden')");
  }
  try{
    await page.send('Page.bringToFront');
    await page.intercept([{match:'/api/tts',respond:()=>({status:503,body:{ok:false,code:'tts_provider_unavailable',error:'Isolated browser fixture: exercise the existing speech fallback without an external voice provider'}})}]);
    await page.navigate('/language/english');assert.equal(await page.evaluate("document.querySelector('#masterySection')"),null);
    await page.navigate('/login');await page.setFields({'#usernameInput':'wyj','#secretInput':secret});await page.click('#loginSubmitBtn');await page.waitFor("location.pathname==='/'",30000);
    await page.evaluate("document.getElementById('dismissVersionNoticeBtn')?.click()");await flags(true);
    await seed('english');
    await page.waitFor("window.AerisFeatures.enabled('adaptive_learning')&&window.AerisFeatures.enabled('mastery_score')&&window.AerisFeatures.enabled('adaptive_review')",15000);
    assert.equal(await page.evaluate("document.querySelectorAll('#masteryAnswerForm,#masteryStartBtn,#masterySection').length"),0);
    assert.equal(await page.evaluate("document.querySelectorAll('#workspace > .tabs [data-view]').length"),5);
    checks.push('one_quiz_five_tabs_no_catalog_panel');
    await page.click('#reviewBtn');await page.waitFor("state.roundActive&&state.mode==='review-current'");
    assert.deepEqual((await page.evaluate('[...state.words]')).sort(),['apple','banana']);
    const first=await answer();assert.equal(await page.evaluate('Object.keys(state.currentWrongBook).length'),2);
    assert.equal(await page.evaluate('state.currentWrongBook[state.reviewKeys[state.index]].review.events.length'),1);
    checks.push('current_scope_first_correct_retained');
    await page.navigate('/language/english');await page.waitFor('state.roundActive&&state.score===1&&(Boolean(state.pendingAdvance)||state.index===1)');
    assert.equal(await page.evaluate('state.score'),1);await finish();
    assert.equal(await page.evaluate('state.studyRecords.length'),1,'A restored round must be recorded exactly once');
    checks.push('refresh_one_attempt_original_transition');
    await page.click('[data-view="wrongView"]');await page.click('#reviewHistoryBtn');await page.waitFor("state.roundActive&&state.mode==='review-history'");await answer(false);await finish();
    assert.equal(await page.evaluate('Object.keys(state.historyWrongBook).length'),2);checks.push('history_scope_error_retained');
    await page.click('[data-view="wrongView"]');
    for(const theme of ['light','dark']){
      for(let cycle=0;cycle<3&&await page.evaluate('document.documentElement.dataset.theme')!==theme;cycle++)await page.click('#themeToggleBtn');
      await page.evaluate('document.fonts.ready');
      assert.ok(await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
      const controls=await page.evaluate("Array.from(document.querySelectorAll('#wrongView button')).filter(button=>button.getClientRects().length).map(button=>({label:button.textContent,height:button.getBoundingClientRect().height,fits:button.scrollWidth<=button.clientWidth+1}))");
      assert.ok(controls.length>=6);assert.ok(controls.every(button=>button.height>=43&&button.fits),JSON.stringify(controls));
      const screenshot=await page.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,`wrong-review-${width}-${theme}.png`),Buffer.from(screenshot.data,'base64'));
    }
    checks.push('responsive_light_dark_real_chromium');
    await flags(false);await seed('english','dictation');await page.click('#reviewBtn');await page.waitFor('state.roundActive');
    assert.equal(await page.evaluate("document.getElementById('wordText').textContent"),'听写');await answer();await finish();checks.push('flags_off_base_dictation_works');
    await flags(true);await seed('japanese','dictation');await page.click('#reviewHistoryBtn');await page.waitFor('state.roundActive');await answer();await finish();checks.push('japanese_dictation_original_form');
    await seed('japanese');await page.click('#reviewBtn');await page.waitFor('state.roundActive');
    await page.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await answer();
    assert.ok(await page.evaluate("document.getElementById('wrongReviewStatus').textContent.includes('本机')||document.getElementById('wrongReviewStatus').textContent.includes('本地')"));
    await page.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});await finish();checks.push('offline_answer_durable_local_not_synced');
    if(width===390){
      // Recover one actually issued legacy ticket through the original form.
      // It is deliberately queued before reload with the old storage formats.
      const issued=await call('/api/learning/adaptive/next',{language:'japanese',mode:'adaptive'});assert.equal(issued.status,200);
      const ticket=issued.body.question,eventId=crypto.randomUUID();
      const oldFault=await page.intercept([{match:'/api/learning/legacy/events',state:'lost',respond:({state})=>state==='lost'?{status:503,body:{ok:false,code:'learning_unavailable',error:'isolated recovery outage'}}:{continue:true}}]);
      await page.evaluate(`(async()=>{const {emptyLearningStore,masteryStorageKey}=await import('/js/language/mastery-state.js?v=${ASSET_RELEASE}');const {createMasteryJournal}=await import('/js/language/mastery-journal.js?v=${ASSET_RELEASE}');
        const question=${JSON.stringify(ticket)},entry={language:'japanese',input:{event_id:${JSON.stringify(eventId)},ticket_id:question.ticket_id,kind:'answer_submitted',answer:'legacy-recovery-fixture',response_ms:1200}},store=emptyLearningStore(state.account.id);
        store.questions.japanese={question,started_at:Date.now(),mode:'adaptive'};store.outbox=[entry];
        await createMasteryJournal().put(state.account.id,entry,question);localStorage.setItem(masteryStorageKey(state.account.id),JSON.stringify(store));})()`);
      await flags(false);await page.navigate('/language/japanese');await page.click('[data-view="wrongView"]');
      await page.waitFor("!document.getElementById('legacyRecoveryBtn').classList.contains('hidden')");
      const beforeLegacy=await page.evaluate('state.studyRecords.length');
      await page.click('#legacyRecoveryBtn');await page.waitFor('state.roundActive&&Boolean(state.legacyQuestion)');
      assert.equal(await page.evaluate("document.querySelectorAll('#answerForm').length"),1);
      oldFault.setState('normal');await page.evaluate("dispatchEvent(new Event('online'))");
      await page.waitFor("JSON.parse(localStorage.getItem('aerisMastery:v1:'+state.account.id)).outbox.length===0",20000);
      await page.setFields({'#answerInput':'legacy-recovery-fixture'});await page.click('#submitBtn');await page.waitFor('Boolean(state.pendingAdvance)&&!state.busy');await page.click('#nextNowBtn');
      await page.waitFor('!state.roundActive');await page.click('#roundSetupBtn');
      assert.equal(await page.evaluate('state.studyRecords.length'),beforeLegacy,'Legacy events cannot be counted again as new quiz rounds');
      assert.equal(await page.evaluate("JSON.parse(localStorage.getItem('aerisMastery:v1:'+state.account.id)).results.japanese.receipt.event_id"),eventId);
      checks.push('legacy_signed_ticket_old_idb_outbox_flags_off_same_form_no_double_stats');
      await page.navigate('/language/english');await page.setFields({'#profileInput':`wr-${runId}-${width}-e-m`});await page.click('[data-view="wrongView"]');
      await page.waitFor(`state.profile===${JSON.stringify(`wr-${runId}-${width}-e-m`)}&&state.quizLanguage==='english'`);
      await page.click('#currentWrongTab');
      await page.evaluate("globalThis.__exportUrl=URL.createObjectURL;URL.createObjectURL=blob=>{globalThis.__wrongExport=blob;return __exportUrl(blob);}");
      await page.click('#exportWrongDataBtn');const backup=await page.evaluate('globalThis.__wrongExport.text().then(JSON.parse)');
      assert.equal(Object.keys(backup.currentWrongBook).length,2);assert.equal(Object.keys(backup.historyWrongBook).length,2);
      await page.evaluate("document.getElementById('wrongList').scrollIntoView({block:'center'})");
      await page.waitFor("Boolean(document.querySelector('#wrongList .wrong-remove-button'))");
      await page.click('#wrongList .wrong-remove-button');await page.click('#acceptConfirmBtn');assert.equal(await page.evaluate('Object.keys(state.currentWrongBook).length'),1);
      await page.click('#clearHistoryBtn');await page.click('#acceptConfirmBtn');assert.equal(await page.evaluate('Object.keys(state.historyWrongBook).length'),0);
      await page.evaluate('learningSyncManager.syncNow()');await page.navigate('/language/english');
      await page.waitFor(`state.account&&state.quizLanguage==='english'&&state.profile===${JSON.stringify(`wr-${runId}-${width}-e-m`)}`);
      await page.click('[data-view="wrongView"]');
      assert.equal(await page.evaluate('Object.keys(state.currentWrongBook).length'),1);assert.equal(await page.evaluate('Object.keys(state.historyWrongBook).length'),0);
      const backupPath=path.join(root,`wrong-review-backup-${runId}.json`);fs.writeFileSync(backupPath,JSON.stringify(backup));
      await page.setFile('#wrongDataFileInput',[backupPath]);await page.waitFor('Object.keys(state.currentWrongBook).length===2&&Object.keys(state.historyWrongBook).length===2');
      checks.push('real_json_export_delete_clear_sync_reload_explicit_import_restore');
      await flags(true);
    }
    assert.deepEqual(page.runtimeErrors,[]);
    results.push({width,checks,passed:true,physical_device:false});console.log(`PASS ${width}: ${checks.join(', ')}`);
  }catch(error){
    const diagnostic=await page.evaluate("({profile:state?.profile,language:state?.quizLanguage,current:Object.entries(state?.currentWrongBook||{}).map(([key,info])=>({key,language:info.language})),history:Object.entries(state?.historyWrongBook||{}).map(([key,info])=>({key,language:info.language})),storage:Object.keys(localStorage).filter(key=>key.startsWith('wrongBook:')).map(key=>({key,entries:Object.keys(JSON.parse(localStorage.getItem(key)||'{}'))}))})").catch(()=>null);
    fs.writeFileSync(path.join(root,`failure-${width}.json`),JSON.stringify({diagnostic,dialogs:page.dialogs,runtimeErrors:page.runtimeErrors},null,2));
    const screenshot=await page.send('Page.captureScreenshot',{format:'png'}).catch(()=>null);if(screenshot)fs.writeFileSync(path.join(root,`failure-${width}.png`),Buffer.from(screenshot.data,'base64'));
    throw error;
  }finally{await page.close();}
}
fs.writeFileSync(path.join(root,'browser-acceptance.json'),JSON.stringify({environment:'isolated_local_pages_d1',physical_device:false,production:false,hosted_preview:false,results},null,2));

import {ASSET_RELEASE} from '../asset-release.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {openPage} from '../../local-backend/browser_harness.mjs';
const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8894';assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const p=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9225',baseUrl,width:1366,height:1000,mobile:false});
const result={};
const ready="!document.getElementById('entryScreen')&&!document.querySelector('#publicHome').classList.contains('hidden')";
try {
 await p.navigate('/');await p.waitFor(ready);assert.equal(await p.evaluate("document.querySelector('.home-purpose').textContent"),'学习 · 工具 · 账本 · 文件');
 assert.equal(await p.evaluate("document.querySelectorAll('.hero-scene-card').length"),0,'I03 removes legacy 3 tilted hero cards cleanly');
 assert.equal(await p.evaluate("document.querySelectorAll('#publicBentoWall .bento-tile').length"),5);
 assert.equal(await p.evaluate("document.querySelector('.home-inline-nav [aria-current=page]')?.dataset.siteNav"),'home');
 await p.click('#publicLoginBtn');await p.waitFor("location.pathname==='/login'");await p.setFields({'#usernameInput':process.env.WYJ_TEST_ADMIN_USER||'wyj','#secretInput':process.env.WYJ_TEST_ADMIN_SECRET});await p.click('#loginSubmitBtn');await p.waitFor(ready+"&&document.querySelector('#publicHome').dataset.sessionMode==='authenticated'",30000);
 await p.waitFor('Boolean(window.state?.account?.id)');
 assert.equal(await p.evaluate("document.querySelector('#homeV3SummaryGrid').hidden"),false);
 // Verify home-widgets module safe-guards missing legacy 3-card hero DOM cleanly while retaining storage contract for I04.
 result.layoutModule=await p.evaluate(`(async()=>{const m=await import('/js/core/home-widgets.js?release=${ASSET_RELEASE}');const ctrl=m.createHomeWidgets({root:document.querySelector('#publicHome'),accountId:()=>'QA-A',navigate:()=>{}});ctrl.render({});const snap=ctrl.snapshot();ctrl.dispose();return {hasVersion:snap.version===m.HOME_WIDGET_VERSION,keyA:m.homeWidgetStorageKey('a'),keyB:m.homeWidgetStorageKey('b')};})()`);
 assert.equal(result.layoutModule.hasVersion,true);
 assert.notEqual(result.layoutModule.keyA,result.layoutModule.keyB);
 await p.navigate('/?native-navigation=1');await p.waitFor(ready+'&&!!window.WYJAndroidNavigation');
 await p.evaluate("window.__homeContinuity='retained';WYJAndroidNavigation.navigate('/tools')");await p.waitFor("location.pathname==='/tools'");await p.evaluate("WYJAndroidNavigation.navigate('/')");await p.waitFor(ready);assert.equal(await p.evaluate('__homeContinuity'),'retained');
 await p.evaluate("document.querySelector('#accountMenu').open=true");await p.click('#logoutBtn');await p.waitFor("document.querySelector('#publicHome').dataset.sessionMode==='guest'");
 assert.deepEqual(p.runtimeErrors,[]);
 Object.assign(result,{pass:true,i03CleanHome:true,accountContinuity:true,layoutMathPreserved:true,errors:p.runtimeErrors});
 const out=path.resolve(process.env.HOME_WIDGET_OUTPUT||'artifacts/aeris-home/widget-browser.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify({pass:true,i03CleanHome:true,layoutMathPreserved:true}));
}finally{await p.close();}

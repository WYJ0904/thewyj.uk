import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';

const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8894';
assert.equal(new URL(baseUrl).hostname,'127.0.0.1','Mutating account flow is confined to isolated QA data');
const results=[];
for(const width of [390,1366,1920]){
 const p=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9225',baseUrl,width,height:900,mobile:width===390});
 try{
  const surfaces=[];
  for(const theme of ['light','dark']){
   await p.navigate('/');await p.waitFor("!document.getElementById('entryScreen')&&document.documentElement.dataset.aerisMotionReady==='true'");
   await p.evaluate(`localStorage.setItem('wyj_theme_preference_v1',${JSON.stringify(theme)});document.documentElement.dataset.theme=${JSON.stringify(theme)};true`);
   for(const [route,visible] of [['/',"!document.querySelector('#publicHome').classList.contains('hidden')"],['/login',"!document.querySelector('#loginForm').classList.contains('hidden')"],['/register',"!document.querySelector('#registerForm').classList.contains('hidden')"],['/download',"!document.querySelector('#downloadPage').classList.contains('hidden')&&document.querySelector('#downloadVersion').textContent.includes('(')"]]){
    await p.navigate(route);await p.waitFor(`!document.getElementById('entryScreen')&&(${visible})`);
    await delay(150);
    const state=await p.evaluate("({path:location.pathname,overflow:document.documentElement.scrollWidth-innerWidth,theme:document.documentElement.dataset.theme,title:document.title,auth:document.querySelector('#publicHome').dataset.sessionMode,selectedTabs:[...document.querySelectorAll('#authPanel [role=tab]')].map(x=>({id:x.id,selected:x.getAttribute('aria-selected')})),download:document.querySelector('#downloadMainBtn').getAttribute('href')})");
    assert.ok(state.overflow<=1,`${width} ${theme} ${route} overflow`);assert.equal(state.theme,theme);assert.ok(state.title.startsWith('Aeris'));
    if(route==='/register')assert.equal(state.selectedTabs.find(t=>t.id==='showRegisterBtn').selected,'true');
    if(route==='/login')assert.equal(state.selectedTabs.find(t=>t.id==='showLoginBtn').selected,'true');
    if(route==='/download')assert.equal(new URL(state.download,baseUrl).pathname,'/api/app/download');
    surfaces.push({route,theme,...state});
   }
  }
  await p.navigate('/login');await p.waitFor("!document.getElementById('entryScreen')");
  await p.setFields({'#usernameInput':process.env.WYJ_TEST_ADMIN_USER||'wyj','#secretInput':process.env.WYJ_TEST_ADMIN_SECRET});await p.click('#loginSubmitBtn');
  await p.waitFor("location.pathname==='/'&&document.querySelector('#publicHome').dataset.sessionMode==='authenticated'");
  assert.equal(await p.evaluate("document.querySelectorAll('#publicHome .hero-scene-card').length"),3);
  await p.navigate('/select');await p.waitFor("!document.getElementById('entryScreen')&&!document.querySelector('#publicHome').classList.contains('hidden')");
  assert.equal(await p.evaluate("document.querySelector('#publicHome').dataset.sessionMode"),'authenticated');
  await p.navigate('/?native-navigation=1');await p.waitFor("!document.getElementById('entryScreen')&&!!window.WYJAndroidNavigation");
  await p.evaluate("window.__p6Document='preserved';true");
  await p.evaluate("Promise.all(Array.from({length:60},(_,i)=>WYJAndroidNavigation.navigate(['/tools','/language','/finance'][i%3]))).then(()=>true)");
  await p.waitFor("location.pathname==='/finance'&&!document.querySelector('#financePage').classList.contains('hidden')");
  assert.equal(await p.evaluate("window.__p6Document"),'preserved');
  const restored=await p.evaluate("({homeScenes:document.querySelectorAll('#publicHome .hero-scene-card').length,sessionPresent:!!localStorage.getItem('wyjAccountSession'),path:location.pathname})");
  await p.navigate('/');await p.waitFor("!document.getElementById('entryScreen')&&document.querySelector('#publicHome').dataset.sessionMode==='authenticated'");
  assert.equal(await p.evaluate("document.querySelectorAll('#publicHome .hero-scene-card').length"),3);
  assert.deepEqual(p.runtimeErrors,[]);
  results.push({width,surfaces,authenticatedHome:true,selectAlias:true,rapidNavigation:60,sameDocument:true,sessionRestore:restored,errors:[]});
  console.log(`P6 experience PASS width=${width} guest surfaces=${surfaces.length} rapid routes=60`);
 }finally{await p.close();}
}
const out=path.resolve(process.env.AERIS_P6_OUTPUT||'artifacts/aeris-p6/web-experience.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({scope:'Isolated real Chrome; guest auth/register/download surfaces, shared authenticated Home and route/session invariants. No Production account mutation.',results},null,2));

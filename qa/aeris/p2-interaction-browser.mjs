import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';
const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8894';assert.equal(new URL(baseUrl).hostname,'127.0.0.1');
const results=[];
for(const width of [390,1366,1920]){
 const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9225',baseUrl,width,height:900,mobile:width===390});
 try{
  await page.navigate('/login');await page.waitFor("document.documentElement.dataset.aerisMotionReady==='true' && (!document.getElementById('entryScreen') || document.getElementById('entryScreen').classList.contains('hidden'))");
  const point=async selector=>page.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});element.scrollIntoView({block:'center'});const r=element.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);if(!element.contains(hit))throw new Error('input target occluded by '+hit?.id);return{x,y};})()`);
  const press=async selector=>{const p=await point(selector);await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...p});return p;};
  const release=p=>page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...p});
  const p=await press('#showRegisterBtn');await page.waitFor("document.querySelector('#showRegisterBtn').dataset.aerisPressed==='true'",1000);
  await release(p);await page.waitFor("document.querySelector('#showRegisterBtn').getAttribute('aria-selected')==='true'");
  for(const selector of ['#showLoginBtn','#showRegisterBtn','#showLoginBtn'])await page.click(selector);
  await page.waitFor("document.querySelector('#showLoginBtn').getAttribute('aria-selected')==='true'");
  assert.equal(await page.evaluate("document.querySelectorAll('#authPanel .ds-tab-indicator').length"),1);
  await page.evaluate("document.querySelector('#showRegisterBtn').focus()");
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
  assert.equal(await page.evaluate("document.querySelector('#showRegisterBtn').dataset.aerisPressed"),'true');
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
  await page.waitFor("document.querySelector('#showRegisterBtn').getAttribute('aria-selected')==='true'");
  await page.click('#showLoginBtn');
  // System/browser reduced motion: actual Chrome media emulation on the CI runner.
  await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const reduced=await press('#showRegisterBtn');await delay(30);
  const style=await page.evaluate("(()=>{const s=getComputedStyle(document.querySelector('#showRegisterBtn'));return{scale:s.scale,opacity:s.opacity,duration:s.transitionDuration};})()");
  assert.ok(style.scale==='1'||style.scale==='none');assert.ok(style.duration.split(',').every(v=>parseFloat(v)<=.002));
  await release(reduced);await page.click('#showLoginBtn');
  await page.send('Emulation.setEmulatedMedia',{features:[]});
  const username=process.env.WYJ_TEST_ADMIN_USER||'wyj',secret=process.env.WYJ_TEST_ADMIN_SECRET;
  assert.ok(secret,'isolated CI admin fixture required');await page.setFields({'#usernameInput':username,'#secretInput':secret});await page.click('#loginSubmitBtn');await page.waitFor("location.pathname==='/select'",30000);
  await page.navigate('/finance');await page.waitFor("document.documentElement.dataset.aerisMotionReady==='true' && !document.getElementById('entryScreen')");
  const initialOpen=await page.evaluate("document.querySelector('#financeInsightDisclosure').open");
  const summary='#financeInsightDisclosure > summary';for(let i=0;i<4;i++)await page.click(summary);
  await page.waitFor(`document.querySelector('#financeInsightDisclosure').open===${initialOpen} && document.querySelector('#financeInsightDisclosure > summary').getAttribute('aria-expanded')===${JSON.stringify(String(initialOpen))}`);
  await page.click('#financeAddTransactionBtn');await page.waitFor("!document.querySelector('#financeTransactionModal').classList.contains('hidden')");
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await page.waitFor("document.querySelector('#financeTransactionModal').classList.contains('hidden')");
  await page.navigate('/select?native-navigation=1');await page.waitFor("Boolean(window.WYJAndroidNavigation)");
  const rapid=await page.evaluate("(async()=>{const before=history.length;await Promise.all(Array.from({length:30},(_,i)=>window.WYJAndroidNavigation.navigate(['/tools','/select','/finance'][i%3])));return{path:location.pathname,growth:history.length-before};})()");
  assert.equal(rapid.path,'/finance');assert.equal(rapid.growth,1);
  const repeated=await page.evaluate("(async()=>{const before=history.length;await Promise.all(Array.from({length:30},()=>window.WYJAndroidNavigation.navigate('/finance')));return{path:location.pathname,growth:history.length-before};})()");
  assert.equal(repeated.path,'/finance');assert.equal(repeated.growth,0);
  const overflow=await page.evaluate("document.documentElement.scrollWidth>innerWidth+1");assert.equal(overflow,false);
  await page.waitFor("document.querySelectorAll('[data-aeris-pressed]').length===0",2000);
  assert.deepEqual(page.runtimeErrors,[]);
  results.push({width,pressed:true,keyboard:true,rapidTab:true,indicatorCount:1,reducedMotion:style,disclosureReversal:true,escape:true,rapidNavigation:rapid,repeatedDestination:repeated,overflow:false,runtimeErrors:[]});
 }finally{await page.close();}
}
const output=path.resolve(process.env.AERIS_P2_OUTPUT||'artifacts/aeris-p2-interaction.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(results,null,2));console.log(JSON.stringify(results));

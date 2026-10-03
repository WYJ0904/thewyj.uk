import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {openPage} from '../../local-backend/browser_harness.mjs';
const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8894';assert.equal(new URL(baseUrl).hostname,'127.0.0.1');const cases=[];
const previewFile=path.resolve('.tool-e2e/p31-local-preview.txt');fs.mkdirSync(path.dirname(previewFile),{recursive:true});fs.writeFileSync(previewFile,'Owned P3.1 local-only preview fixture.');
for(const width of [320,390,1366,1920]){
 const page=await openPage({cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9225',baseUrl,width,height:900,mobile:width<=390});
 try {
  await page.navigate('/');await page.waitFor("document.documentElement.dataset.aerisMotionReady==='true' && !document.getElementById('entryScreen')");
  const catalog=await fetch(baseUrl+'/api/membership/plans').then(r=>r.json());assert.equal(catalog.ok,true);
  await page.waitFor("document.querySelectorAll('#publicModulePlans [data-plan-code]').length>0 && document.querySelectorAll('#publicPermanentPlans [data-plan-code]').length>0");
  const actual=await page.evaluate("[...document.querySelectorAll('.aeris-plan-catalog [data-plan-code]')].map(x=>({code:x.dataset.planCode,name:x.querySelector('span').textContent,price:x.querySelector('strong').textContent}))");
  for(const row of actual){const plan=catalog.plans.find(p=>p.code===row.code);assert.ok(plan?.purchasable);assert.equal(row.name,plan.name);assert.ok(row.price.includes(new Intl.NumberFormat('zh-CN',{style:'currency',currency:plan.currency}).format(plan.price_cents/100)));}
  const writes=[];page.client.listeners.add(event=>{if(event.method==='Network.requestWillBeSent'){const request=event.params.request;if(request.method!=='GET'&&/\/api\/(transfer\/uploads|finance|learning\/sync)/.test(request.url))writes.push({method:request.method,url:request.url});}});
  await page.click('#publicFilesTab');await page.setFile('#publicFilesInput',previewFile);await page.waitFor("document.querySelector('#publicFilesPreview').textContent.includes('p31-local-preview.txt')");assert.deepEqual(writes,[],'Product Window must never upload or write account data');
  for(const theme of ['light','dark']){
   await page.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
   for(const scene of ['learning','finance','tools']){await page.click(`[data-public-open="${scene}"]`);assert.equal(await page.evaluate("document.querySelector('[data-product-window]').dataset.selected"),scene);}
   await page.evaluate("document.querySelector('[data-public-open=learning]').focus()");await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await page.send('Input.dispatchKeyEvent',{type:'char',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});assert.equal(await page.evaluate("document.querySelector('#publicLearningTab').getAttribute('aria-selected')"),'true');
   assert.equal(await page.evaluate("document.documentElement.scrollWidth>innerWidth+1"),false);
   await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await page.evaluate("getComputedStyle(document.querySelector('.aeris-product-panel.active')).animationName"),'none');await page.send('Emulation.setEmulatedMedia',{features:[]});
   await page.send('Emulation.setDeviceMetricsOverride',{width:Math.floor(width/2),height:450,deviceScaleFactor:2,mobile:false});assert.equal(await page.evaluate("document.documentElement.scrollWidth>innerWidth+1"),false,'200% zoom must retain all restored content');await page.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<=390});
   assert.deepEqual(page.runtimeErrors,[]);cases.push({width,theme,sections:6,scenes:3,capabilities:5,pricesFromCatalog:true,keyboard:true,reducedMotion:true,zoom:true,overflow:false});
  }
  for(const [selector,expected] of [['[data-public-capability=learning]','/trial'],['[data-public-capability=tools]','/trial'],['[data-public-capability=finance]','/login'],['[data-public-capability=files]','/transfer'],['[data-public-capability=account]','/login'],['#publicTrialBtn','/trial'],['#publicPlansBtn','/login'],['[data-public-section=final] [data-public-trigger=publicLoginBtn]','/login'],['[data-public-section=final] [data-public-trigger=publicRegisterBtn]','/register'],['[data-public-section=final] [data-site-nav=download]','/download'],['#publicChangelogBtn','/changelog']]){
   if(await page.evaluate("location.pathname!=='/'")){await page.click('.site-brand[data-site-nav=home]');await page.waitFor("location.pathname==='/' && !document.querySelector('#publicHome').classList.contains('hidden')");}
   await page.click(selector);await page.waitFor(`location.pathname===${JSON.stringify(expected)}`,30000,'existing entry '+selector);
  }
  assert.deepEqual(page.runtimeErrors,[]);
 }finally{await page.close();}
}
const output=path.resolve(process.env.AERIS_P31_OUTPUT||'artifacts/aeris-p31-home.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({pass:true,cases},null,2));console.log(JSON.stringify({pass:true,cases}));

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {openPage,delay} from '../../local-backend/browser_harness.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const out=path.join(root,'docs/migration-evidence/aeris-p03-p07',`spatial-controls-${Date.now()}`);await fs.mkdir(out);
const page=await openPage({baseUrl:process.env.WYJ_TEST_BASE,cdpUrl:process.env.WYJ_CDP_URL,width:1440,height:960});
const measure=()=>page.evaluate("(()=>{const c=document.querySelector('[data-home-widget=learning]'),h=c.querySelector('[data-widget-drag]'),r=h.getBoundingClientRect(),v=c.querySelector('.home-widget-visual');return{root:getComputedStyle(c).transform,handle:{x:r.x,y:r.y,width:r.width,height:r.height},visual:getComputedStyle(v).transform};})()");
let result;
try{
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'delete globalThis.__WYJ_TEST_MODE__;'});
 await page.navigate('/');await page.waitFor("!document.getElementById('entryScreen') && !document.getElementById('appShell').classList.contains('app-shell-pending') && document.documentElement.dataset.p07Ui==='enabled'",30000);
 await page.click('#homeLayoutToggle');
 await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5});await delay(350);const before=await measure();
 const point=await page.evaluate("(()=>{const r=document.querySelector('[data-home-widget=learning]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()");
 await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await delay(300);const after=await measure();
 const delta={x:after.handle.x-before.handle.x,y:after.handle.y-before.handle.y};
 result={status:Math.abs(delta.x)<=.25&&Math.abs(delta.y)<=.25?'PASS':'FAIL',before,after,delta,scope:'Actual Chrome hover; fixed root pose; no account or ledger writes'};
 assert.equal(result.status,'PASS','Visual hover must not displace the drag control');
}catch(error){result={...result,status:'FAIL',error:error.stack};}
finally{await page.close();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({output:path.relative(root,out),...result}));if(result.status!=='PASS')process.exitCode=1;}

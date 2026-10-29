import fs from 'node:fs/promises';import path from 'node:path';
import {openPage} from '../../local-backend/browser_harness.mjs';
const label=process.argv[2]||'r1';if(!/^r[1-9][0-9]*$/.test(label))throw Error('invalid label');
const root=path.resolve(import.meta.dirname,'../..'),out=path.join(root,'docs/migration-evidence/aeris-p03-p07/modal-debug-'+label+'.json');
let page;const rows=[];
const observe=async label=>rows.push({label,...await page.evaluate(`({active:document.activeElement.id,activeText:document.activeElement.textContent?.trim().slice(0,50),initial:document.activeElement.hasAttribute('data-dialog-initial-focus'),layers:[...document.querySelectorAll('.modal-layer:not(.hidden)')].map(x=>({id:x.id,inert:x.inert})),deleteButton:{rects:document.getElementById('openDeleteAccountBtn').getClientRects().length,disabled:document.getElementById('openDeleteAccountBtn').disabled},policy:document.documentElement.dataset.p07Ui})`)});
try{
 page=await openPage({cdpUrl:process.env.WYJ_CDP_URL,baseUrl:process.env.WYJ_BASE_URL,width:1440,height:960});
 await page.send('Page.addScriptToEvaluateOnNewDocument',{source:'delete globalThis.__WYJ_TEST_MODE__'});await page.navigate('/login');await page.waitFor("document.getElementById('authPanel').getClientRects().length>0&&document.documentElement.dataset.p07Ui==='enabled'",20000,'guest policy');
 await page.evaluate("document.getElementById('showLoginBtn').focus();document.getElementById('accountBtn').click()");await observe('account-open');
 await page.evaluate("document.getElementById('openDeleteAccountBtn').focus()");await observe('delete-button-focused');
 await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await observe('after-real-enter');
 if(label!=='r1'){
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await observe('after-enter-character-event');
 }
}catch(e){rows.push({error:e.stack})}finally{if(page)await page.close();await fs.writeFile(out,JSON.stringify(rows,null,2));console.log(JSON.stringify(rows))}

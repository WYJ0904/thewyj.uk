import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {openPage,CdpClient,delay} from '../../../local-backend/browser_harness.mjs';
const out=path.resolve(process.env.FINANCE_E2E_OUTPUT),config=JSON.parse(await fs.readFile(path.join(out,'private/context.json'),'utf8'));
const {port}=JSON.parse(await fs.readFile(path.join(out,'port.json'),'utf8')),url='http://127.0.0.1:'+port;
const native=JSON.parse(await fs.readFile(path.join(out,'native/restore.json'),'utf8'));assert.equal(native.status,'SYNTHETIC_E2E_PASS');
const profile=path.join(out,'owned-chrome-profile');await fs.mkdir(profile);const rows=[];
const child=spawn(process.env.AERIS_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',
 ['--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'--no-first-run','--disable-background-networking','--disable-sync','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{stdio:'ignore',windowsHide:true});
let page,browser;
async function check(id,run){try{rows.push({id,status:'SYNTHETIC_E2E_PASS',actual:await run()});}catch(error){rows.push({id,status:'FAIL',error:error.stack});}}
try{
 let cdp;for(let i=0;i<100&&!cdp;i++){try{cdp=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{await delay(100)}}assert(cdp);
 const cdpUrl='http://127.0.0.1:'+cdp;browser=new CdpClient((await(await fetch(cdpUrl+'/json/version')).json()).webSocketDebuggerUrl);await browser.connect();
 page=await openPage({baseUrl:url,cdpUrl,width:1200,height:1100,mobile:false});await page.navigate('/');await page.waitFor('window.ready===true');
 await check('native-cloud-web-same-id-currency-amount-direction',async()=>{
  const current=await page.evaluate('store()');assert.equal(Object.keys(current.transactions).length,native.bookings.length);
  for(const booking of native.bookings){const row=current.transactions[booking.id];assert(row,booking.id);assert.equal(row.amount_minor,booking.amount_minor);assert.equal(row.currency,booking.currency);assert.equal(row.direction,booking.direction.toLowerCase());assert.equal(row.amount_exponent,booking.amount_exponent);}
  return native.bookings.map(b=>({id:b.id,currency:b.currency,amount_minor:b.amount_minor,direction:b.direction}));
 });
 await check('detail-edit-surface-preserves-original-iso-unit-without-writing',async()=>{
  const values=[];for(const booking of native.bookings){await page.evaluate(`document.querySelector('[data-finance-edit="${booking.id}"]').click()`);
   const value=await page.evaluate("({currency:document.getElementById('financeTransactionCurrency').value,amount:document.getElementById('financeTransactionAmount').value})");
   assert.equal(value.currency,booking.currency);const digits=booking.currency==='JPY'?0:2;assert.equal(value.amount,(booking.amount_minor/10**digits).toFixed(digits));values.push(value);
   await page.evaluate("document.getElementById('financeTransactionModal').classList.add('hidden')");}
  return values;
 });
 await check('refund-and-currency-groups-do-not-turn-control-events-into-expense',async()=>{
  const view=await page.evaluate("({list:document.getElementById('financeTransactionList').textContent,summary:controller.dashboardSummary(),status:document.getElementById('financeCurrencyStatus').textContent})");
  assert(native.bookings.some(b=>b.direction==='REFUND'));assert.match(view.list,/JPY|日元|JP¥/);assert.match(view.list,/HKD|HK\$/);
  assert.match(view.status,/待换算|待核实/);return view;
 });
 await check('browser-reload-does-not-duplicate-or-rescale-source-money',async()=>{
  await page.navigate('/');await page.waitFor('window.ready===true');const current=await page.evaluate('store()');
  for(const booking of native.bookings){assert.equal(current.transactions[booking.id].amount_minor,booking.amount_minor);assert.equal(current.transactions[booking.id].currency,booking.currency);}
  assert.equal(Object.keys(current.transactions).length,5);
 });
 await check('actual-api-session-rejects-unrelated-credential',async()=>{
  const response=await fetch(url+'/api/finance/transactions?money_version=2',{headers:{'X-Session-Token':'synthetic-invalid-session','X-Finance-Money-Version':'3'}});assert.equal(response.status,401);return {status:response.status};
 });
 await check('no-unhandled-browser-exceptions',async()=>assert.deepEqual(page.runtimeErrors,[]));
 const capture=await page.client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(path.join(out,'web-finance.png'),Buffer.from(capture.data,'base64'));
 await fs.writeFile(path.join(out,'web-dom.txt'),await page.evaluate('document.body.innerText'));
}finally{
 if(browser){await browser.send('Browser.close').catch(()=>{});browser.close();}page?.close();
 await fs.writeFile(path.join(out,'browser.json'),JSON.stringify({rows,scope:'Actual Chrome product finance HTML/modules + authenticated local API; not full site navigation or Production',synthetic_only:true},null,2));
}
console.log(JSON.stringify(rows));process.exitCode=rows.some(r=>r.status==='FAIL')?1:0;

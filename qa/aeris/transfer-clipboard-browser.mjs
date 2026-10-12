import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {delay,openPage,registerAndSignIn} from '../../local-backend/browser_harness.mjs';

const baseUrl=process.env.WYJ_TEST_BASE||'http://127.0.0.1:8894';
assert.equal(new URL(baseUrl).hostname,'127.0.0.1','Clipboard regression must never run against hosted user data');
const page=await openPage({baseUrl,cdpUrl:process.env.WYJ_CDP_URL||'http://127.0.0.1:9225',width:1366,height:900,mobile:false});
const writes=[],checks=[];
page.client.listeners.add(({method,params={}})=>{
 if(method==='Network.requestWillBeSent'&&/\/api\/transfer\//.test(params.request?.url||'')
   &&['POST','PUT','DELETE'].includes(params.request.method))writes.push({method:params.request.method,path:new URL(params.request.url).pathname});
});
const paste=async(selector,file=false)=>page.evaluate(`(() => {
 const target=document.querySelector(${JSON.stringify(selector)});if(!target)throw Error('Missing paste target');
 const data=new DataTransfer();${file?"data.items.add(new File(['clipboard-regression-file'], 'clipboard-guard-positive.txt', {type:'text/plain'}));":"data.setData('text/plain','clipboard-regression-marker');"}
 const event=new ClipboardEvent('paste',{bubbles:true,composed:true,cancelable:true,clipboardData:data});
 target.dispatchEvent(event);return event.defaultPrevented;
})()`);
const queueCount=()=>page.evaluate("document.querySelectorAll('#transferQueue .transfer-queue-item, #transferQueue [data-transfer-cancel]').length");
async function ignored(selector,label,file=false){
 const before=writes.length;assert.equal(await paste(selector,file),false,label+' must keep ordinary paste default');
 await delay(250);assert.equal(writes.length,before,label+' must issue no upload mutation');
 assert.equal(await queueCount(),0,label+' must leave the queue empty');checks.push(label);
}
try{
 await registerAndSignIn(page,{username:'cp'+Date.now().toString(36),secret:'Clipboard-Regression-Fixture-2026!'});
 await page.navigate('/transfer?native-navigation=1');
 await page.waitFor("Boolean(window.WYJAndroidNavigation)&&!document.querySelector('#transferQuotaText')?.textContent.includes('加载中')");
 await page.evaluate("window.__clipboardDocumentMarker='same-document';true");
 await ignored('#transferPassword','share-password text');
 await ignored('#transferPassword','file pasted into editable input',true);
 await ignored('#transferMaxDownloads','numeric input');
 await ignored('#transferExpiry','select input');
 await page.evaluate("(() => {const editor=document.createElement('div');editor.id='clipboardEditableProbe';editor.contentEditable='true';editor.innerHTML='<span id=clipboardEditableChild>editable probe</span>';document.querySelector('#transferDropZone').append(editor);return true;})()");
 await ignored('#clipboardEditableChild','nested contenteditable');
 await page.evaluate("window.WYJAndroidNavigation.navigate('/language/english')");
 await page.waitFor("location.pathname==='/language/english'&&document.querySelector('#profileInput').getClientRects().length>0");
 assert.equal(await page.evaluate('window.__clipboardDocumentMarker'),'same-document');
 await ignored('#profileInput','other-screen language input');
 await ignored('body','inactive transfer text');
 await ignored('body','inactive transfer file',true);
 await page.evaluate("window.WYJAndroidNavigation.navigate('/transfer')");
 await page.waitFor("location.pathname==='/transfer'&&document.querySelector('#transferPage').getClientRects().length>0");
 const beforeDeferred=writes.length;
 assert.equal(await page.evaluate(`(() => {
  // Native DataTransfer wrappers clone item methods when ClipboardEvent is
  // constructed. Control only this callback's timing with an explicit test
  // provider; the other paste cases use real browser DataTransfer objects.
  const data={items:[{kind:'string',getAsString(callback){window.__deferredClipboard=callback;}}]};
  const event=new Event('paste',{bubbles:true,composed:true,cancelable:true});
  Object.defineProperty(event,'clipboardData',{value:data});document.body.dispatchEvent(event);return event.defaultPrevented;
 })()`),true);
 assert.equal(await page.evaluate("typeof window.__deferredClipboard"),'function','deferred fault-injection provider must capture the actual handler callback');
 await page.evaluate("window.WYJAndroidNavigation.navigate('/language/english')");
 await page.waitFor("location.pathname==='/language/english'");
 await page.evaluate("window.__deferredClipboard('delayed-clipboard-marker');true");
 await delay(250);assert.equal(writes.length,beforeDeferred);assert.equal(await queueCount(),0);checks.push('deferred callback after navigation');
 await page.evaluate("window.WYJAndroidNavigation.navigate('/transfer')");
 await page.waitFor("location.pathname==='/transfer'&&document.querySelector('#transferPage').getClientRects().length>0");
 assert.equal(await paste('body'),true,'intentional transfer text paste must remain supported');
 await page.waitFor("document.querySelector('#transferCompleteBtn')?.disabled===false",30000);
 assert.ok(writes.some(x=>x.method==='POST'&&x.path==='/api/transfer/uploads'));checks.push('intentional text paste uploads');
 assert.equal(await paste('body',true),true,'intentional transfer file paste must remain supported');
 await page.waitFor("document.querySelector('#transferQueue')?.textContent.includes('clipboard-guard-positive.txt')&&document.querySelector('#transferCompleteBtn')?.disabled===false",30000);
 checks.push('intentional file paste uploads');assert.deepEqual(page.runtimeErrors,[]);
 const output=path.resolve(process.env.WYJ_TEST_ARTIFACT_DIR||'artifacts','transfer-clipboard-browser.json');fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify({status:'PASS',scope:'Isolated localhost browser/controller regression; no hosted user data or physical-device claim',checks,writes},null,2));console.log(JSON.stringify({status:'PASS',checks}));
}finally{await page.close();}

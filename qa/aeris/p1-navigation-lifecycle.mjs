import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openPage, registerAndSignIn } from "../../local-backend/browser_harness.mjs";
import { benchmarkFixture } from "./fixture.mjs";

const baseUrl = process.env.WYJ_TEST_BASE || "http://127.0.0.1:8902";
assert.equal(new URL(baseUrl).hostname, "127.0.0.1");
const page = await openPage({ cdpUrl: process.env.WYJ_CDP_URL || "http://127.0.0.1:9226", baseUrl, width: 1366, height: 900, mobile: false });
const results = {};
const partRequests = new Map();
page.client.listeners.add(message => {
  const params = message.params || {};
  if (message.method === "Network.requestWillBeSent") {
    const match = /\/parts\/(\d+)$/.exec(params.request?.url || "");
    if (match) partRequests.set(params.requestId, { part: Number(match[1]), started: Date.now() });
  }
  const entry = partRequests.get(params.requestId);
  if (!entry) return;
  if (message.method === "Network.responseReceived") { entry.status = params.response?.status; entry.responseAt = Date.now(); }
  if (message.method === "Network.loadingFinished") entry.finishedAt = Date.now();
  if (message.method === "Network.loadingFailed") { entry.failedAt = Date.now(); entry.error = params.errorText; }
});
try {
  await registerAndSignIn(page, { username: `nv${Date.now().toString(36)}`, secret: "Aeris-Navigation-2026!" });
  const session = await page.evaluate("localStorage.getItem('wyjAccountSession')");
  await page.navigate("/?native-navigation=1");
  await page.waitFor("Boolean(window.WYJAndroidNavigation)");
  await page.evaluate("window.__aerisDocumentMarker = 'retained'; true");
  const rapid = await page.evaluate(`(async () => {
    const before=history.length, started=performance.now();
    const routes=['/tools','/language','/finance'];
    await Promise.all(Array.from({length:120},(_,i)=>window.WYJAndroidNavigation.navigate(routes[i%3])));
    return { path:location.pathname, historyGrowth:history.length-before, handlerMs:performance.now()-started };
  })()`);
  assert.equal(rapid.path, "/finance"); assert.equal(rapid.historyGrowth, 1);
  results.rapid = rapid;
  const feedback = await page.evaluate(`new Promise(resolve => {
    const started=performance.now(); document.querySelector('[data-site-nav="transfer"]').click();
    const immediatePath=location.pathname;
    requestAnimationFrame(()=>resolve({immediatePath, firstRafMs:performance.now()-started,
      marker:window.__aerisDocumentMarker, path:location.pathname}));
  })`);
  assert.equal(feedback.immediatePath, "/transfer"); assert.equal(feedback.marker, "retained");
  results.transferNavigation = feedback;
  await page.waitFor("!document.querySelector('#transferQuotaText')?.textContent.includes('加载中')");
  const fixture = benchmarkFixture();
  await page.setFile("#transferFileInput", fixture);
  const queueItem = `(() => { const key=Object.keys(localStorage).find(k=>k.startsWith('wyjTransferQueue:')); return JSON.parse(localStorage.getItem(key)||'{}').queue?.[0]; })()`;
  await page.waitFor(`${queueItem}?.uploaded >= 16777216 && ${queueItem}?.status === 'uploading'`, 30000, "first part acknowledged");
  const held = await page.evaluate(`(() => {
    document.documentElement.dataset.androidWebActive='false';
    document.dispatchEvent(new CustomEvent('thewyj:webview-active',{detail:{active:false}}));
    return { displayed:document.querySelector('#transferQueue progress').value, uploaded:${queueItem}?.uploaded };
  })()`);
  results.activity = { held };
  // Progress paints on rAF while persistence is coalesced for 250 ms. The
  // stored bytes can lag the already painted percentage at suspension. Wait
  // for an acknowledgement beyond that displayed percentage, so resuming
  // must expose genuinely newer progress rather than the same painted value.
  await page.waitFor(`(() => { const item=${queueItem}; return item?.uploaded > ${held.uploaded}
    && Math.min(100, Math.round(item.uploaded / item.size * 100)) > ${held.displayed}; })()`,
  20000, "acknowledgement beyond suspended displayed progress");
  const hidden = await page.evaluate(`({displayed:document.querySelector('#transferQueue progress').value, uploaded:${queueItem}?.uploaded})`);
  results.activity.hidden = hidden;
  assert.equal(hidden.displayed, held.displayed, "hidden WebView must not repaint numeric progress");
  assert.ok(hidden.uploaded > held.uploaded, "durable upload acknowledgements continue while rendering is inactive");
  const resumed = await page.evaluate(`(() => {
    document.documentElement.dataset.androidWebActive='true';
    document.dispatchEvent(new CustomEvent('thewyj:webview-active',{detail:{active:true}}));
    return { displayed:document.querySelector('#transferQueue progress').value, marker:window.__aerisDocumentMarker };
  })()`);
  results.activity.resumed = resumed;
  assert.ok(resumed.displayed > held.displayed); assert.equal(resumed.marker, "retained");
  assert.equal(await page.evaluate("localStorage.getItem('wyjAccountSession')"), session);
  results.activity = { held, hidden, resumed, sessionPreserved: true };
  await page.waitFor("document.querySelector('#transferCompleteBtn')?.disabled === false", 120000);
  assert.deepEqual(page.runtimeErrors, []);
  results.scope = "Browser contract for native route/activity signals; not physical Android lifecycle evidence";
  const output = path.resolve(process.env.AERIS_NAV_OUTPUT || "artifacts/p1-navigation-lifecycle.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} catch (error) {
  // Preserve the actual failed owner state before closing the isolated context.
  // Never log authentication tokens or file bodies.
  results.failure=String(error);
  results.partRequests=[...partRequests.values()];
  results.runtimeErrors=page.runtimeErrors;
  try { results.diagnostic=await page.evaluate(`({
    path:location.pathname,active:document.documentElement.dataset.androidWebActive,
    completeDisabled:document.querySelector('#transferCompleteBtn')?.disabled,
    message:document.querySelector('#transferMessage')?.textContent,
    queueText:document.querySelector('#transferQueue')?.textContent,
    queues:Object.keys(localStorage).filter(k=>k.startsWith('wyjTransferQueue:')).map(k=>({
      items:(JSON.parse(localStorage.getItem(k)||'{}').queue||[]).map(x=>({
        name:x.name,status:x.status,error:x.error,lastError:x.lastError,
        size:x.size,uploaded:x.uploaded,partCount:x.partCount,uploadedParts:x.uploadedParts,
        partHashes:x.partHashes,performance:x.performance
      }))
    }))
  })`); } catch (diagnosticError) {results.diagnosticError=String(diagnosticError);}
  const output=path.resolve(process.env.AERIS_NAV_OUTPUT||'artifacts/p1-navigation-lifecycle.json');
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(results,null,2));
  console.error('[aeris-navigation-diagnostic] '+JSON.stringify(results));throw error;
} finally { await page.close(); }

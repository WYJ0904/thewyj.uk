import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openPage, registerAndSignIn, delay } from "../../local-backend/browser_harness.mjs";
import { benchmarkFixture } from "./fixture.mjs";

// Only run against isolated loopback services, never real account storage.
const urls = (process.env.AERIS_BENCH_URLS || "http://127.0.0.1:8900,http://127.0.0.1:8902").split(",");
assert.ok(urls.every((url) => new URL(url).hostname === "127.0.0.1"));
const cdpUrl = process.env.WYJ_CDP_URL || "http://127.0.0.1:9226";
const fixture = benchmarkFixture();
const bytes = fs.statSync(fixture).size;
const results = [];
const instrumentation = `(() => {
  let current = null;
  window.__aerisStart = () => current = { started: performance.now(), domWrites: [], storageWrites: [], longTasks: [], frameGaps: [], clicks: [] };
  window.__aerisRead = () => ({ ...current, elapsed: performance.now() - current.started });
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', { ...descriptor, set(value) {
    const at = performance.now(); descriptor.set.call(this, value);
    if (current && this.id === 'transferQueue') current.domWrites.push({ at: at-current.started, ms: performance.now()-at });
  }});
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    const at=performance.now(); original.call(this,key,value);
    if (current && String(key).startsWith('wyjTransferQueue:')) current.storageWrites.push({ at:at-current.started, ms:performance.now()-at });
  };
  new PerformanceObserver((list) => { if(current) for(const e of list.getEntries()) {
    if(e.startTime >= current.started) current.longTasks.push({at:e.startTime-current.started,ms:e.duration});
  }}).observe({type:'longtask',buffered:false});
  let previous = 0;
  function frame(at) {
    if(current && previous >= current.started) current.frameGaps.push(at-previous);
    previous=at; requestAnimationFrame(frame);
  } requestAnimationFrame(frame);
})();`;

for (let repeat = 0; repeat < 3; repeat++) {
  for (let version = 0; version < urls.length; version++) {
    const baseUrl = urls[version];
    const page = await openPage({ cdpUrl, baseUrl, width: 1366, height: 900, mobile: false });
    try {
      await page.send("Page.addScriptToEvaluateOnNewDocument", { source: instrumentation });
      await registerAndSignIn(page, { username: `p1${Date.now().toString(36)}${version}`, secret: "Aeris-Benchmark-2026!", label: "P1 isolated benchmark" });
      await page.navigate("/transfer");
      await page.waitFor("!document.querySelector('#transferQuotaText')?.textContent.includes('加载中')", 25000);
      await page.evaluate("window.__aerisStart(); true");
      await page.setFile("#transferFileInput", fixture);
      await page.waitFor("document.querySelector('#transferCompleteBtn')?.disabled === false", 240000, "200 MiB upload complete");
      const metric = await page.evaluate(`(() => {
        const key = Object.keys(localStorage).find(k=>k.startsWith('wyjTransferQueue:'));
        const item = JSON.parse(localStorage.getItem(key) || '{}').queue?.[0];
        return { ...window.__aerisRead(), upload: item?.performance, uploaded: item?.uploaded,
          partSize: item?.partSize, partCount: item?.partCount, acknowledged: item?.uploadedParts?.length,
          status: item?.status, navigationEntries: performance.getEntriesByType('navigation').length };
      })()`);
      assert.equal(metric.uploaded, bytes); assert.equal(metric.acknowledged, metric.partCount); assert.equal(metric.status, "done");
      assert.equal(metric.partSize, 16 * 1024 * 1024);
      const inPipeline = metric.upload?.totalMs || metric.elapsed;
      results.push({ version: version === 0 ? "main-0f45" : "p1", repeat, bytes, ...metric,
        throughputMiBs: bytes / 1024 / 1024 / (inPipeline / 1000), runtimeErrors: page.runtimeErrors });
      console.log(JSON.stringify({ version: results.at(-1).version, repeat, elapsedMs: Math.round(metric.elapsed),
        pipelineMs: metric.upload?.totalMs, domWrites: metric.domWrites.length, storageWrites: metric.storageWrites.length,
        longTasks: metric.longTasks.length, throughputMiBs: results.at(-1).throughputMiBs }));
      assert.equal(page.runtimeErrors.length, 0);
    } finally { await page.close(); }
    await delay(500);
  }
}
const target = path.resolve(process.env.AERIS_BENCH_OUTPUT || "artifacts/p1-browser-comparison.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify({ scope: "Windows headless Chrome / real disk File / loopback Pages D1 R2; not Android or WAN", results }, null, 2));
console.log(`benchmark evidence: ${target}`);

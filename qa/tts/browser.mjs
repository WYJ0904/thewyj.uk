import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Miniflare } from "miniflare";
import { CdpClient, delay, openPage } from "../../local-backend/browser_harness.mjs";
import { handleTtsRequest } from "../../functions/_lib/tts-api.mjs";
import { syntheticMp3 } from "./synthetic-audio.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const evidence = path.join(root, ".wrangler/tts-evidence");
await mkdir(evidence, { recursive: true });
const realIndex = process.argv.indexOf("--real-audio");
const realDir = realIndex < 0 ? null : path.resolve(root, process.argv[realIndex + 1]);
const realSamples = new Map();
let realSource;
if (realDir) {
  assert.ok(realDir.startsWith(path.join(root, ".wrangler") + path.sep));
  realSource = JSON.parse(await readFile(path.join(realDir, "result.json"), "utf8"));
  assert.equal(realSource.status, "AZURE_API_PASS");
  for (const sample of realSource.samples) {
    const bytes = await readFile(path.join(realDir, `${sample.language}.mp3`));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), sample.sha256);
    realSamples.set(sample.language, { ...sample, bytes });
  }
  assert.equal(realSamples.size, 3);
}
const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('fixture'); } }",
  d1Databases: { WYJ_DB: "tts-browser" }, r2Buckets: ["WYJ_STORAGE"] });
const env = { WYJ_DB: await mf.getD1Database("WYJ_DB"), WYJ_STORAGE: await mf.getR2Bucket("WYJ_STORAGE"),
  AZURE_SPEECH_KEY: "synthetic-browser-key", AZURE_SPEECH_REGION: "eastasia", TTS_MODE: "azure",
  TTS_AZURE_RATE_LIMIT: "1000", TTS_RETRY_BASE_MS: "0", WORKERS_AI_ENABLED: "false" };
await env.WYJ_DB.prepare("CREATE TABLE cloud_rate_limit_windows (bucket_key TEXT PRIMARY KEY, route TEXT NOT NULL, window_started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, request_count INTEGER NOT NULL)").run();
const originalFetch = globalThis.fetch;
let providerCalls = 0;
globalThis.fetch = async (url, options) => {
  if (String(url) !== "https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1") return originalFetch(url, options);
  providerCalls += 1;
  for (const status of [401, 429, 503, 504]) if (options.body.includes(`FAIL_${status}`)) {
    return new Response("synthetic upstream error", { status, headers: { "Retry-After": "30" } });
  }
  const sample = [...realSamples.values()].find((entry) => options.body.includes(`name="${entry.voice}"`));
  return new Response(realDir ? sample.bytes : syntheticMp3(), { headers: { "Content-Type": "audio/mpeg" } });
};
const csp = (await readFile(path.join(root, "_headers"), "utf8")).match(/Content-Security-Policy: (.+)/)[1].trim();
const requests = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html;charset=utf-8", "Content-Security-Policy": csp });
      res.end('<!doctype html><html><meta charset="utf-8"><title>Aeris isolated cloud audio fixture</title><div id="appShell"><p>Synthetic audio transport test</p></div><script type="module" src="/fixture.mjs"></script></html>');
    } else if (url.pathname === "/fixture.mjs") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(`import {speakText,stopSpeech} from '/js/language/speech.js';
        window.deviceCalls=0;window.speechSynthesis.speak=()=>{window.deviceCalls++};window.speechSynthesis.cancel=()=>{window.deviceCalls++};
        window.ttsSpeak=options=>speakText(window,options).pending;window.ttsStop=()=>stopSpeech(window);window.fixtureReady=true;`);
    } else if (url.pathname === "/js/language/speech.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(await readFile(path.join(root, "js/language/speech.js")));
    } else if (url.pathname === "/api/tts") {
      requests.push({ language: url.searchParams.get("language"), text: url.searchParams.get("text"), v: url.searchParams.get("v") });
      const response = await handleTtsRequest({ env, request: new Request(`http://127.0.0.1${req.url}`) });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } else { res.writeHead(404); res.end(); }
  } catch (_) { res.writeHead(500); res.end("fixture error"); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), "aeris-tts-browser-"));
const chrome = process.env.AERIS_TEST_CHROME || process.env.CHROME_BIN
  || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "google-chrome");
const child = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
  `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--disable-component-update", "--disable-default-apps", "--disable-sync",
  "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1", "about:blank"], { windowsHide: true, stdio: "ignore" });
let browser;
let page;
const results = { scope: "loopback-Chrome-synthetic-provider-real-D1-R2-and-audio-decoder", tests: [],
  actual_azure_requests: 0, real_voice_listening: "NOT_TESTED", android_webview_device: "NOT_TESTED", production: "NOT_SWITCHED" };
if (realDir) Object.assign(results, { scope: "loopback-Chrome-original-Azure-MP3-replay-local-D1-R2",
  real_voice_listening: "LISTENING_PENDING", source_azure_synthesis_requests: realSource.synthesis_requests,
  source_samples: realSource.samples.map(({ language, voice, locale, sha256 }) => ({ language, voice, locale, sha256 })) });
try {
  let port;
  for (let i = 0; i < 100 && !port; i += 1) {
    try { port = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); } catch (_) { await delay(100); }
  }
  assert.ok(port, "isolated Chrome started");
  const cdpUrl = `http://127.0.0.1:${port}`;
  const version = await originalFetch(`${cdpUrl}/json/version`).then((response) => response.json());
  results.browser = version.Browser;
  browser = new CdpClient(version.webSocketDebuggerUrl); await browser.connect();
  for (const mobile of [false, true]) {
    page = await openPage({ cdpUrl, baseUrl, width: mobile ? 412 : 1200, height: 900, mobile });
    await page.navigate("/"); await page.waitFor("window.fixtureReady===true");
    for (const [lang, language, voice] of [["en", "en", "en-US-JennyNeural"], ["ja", "jp", "ja-JP-NanamiNeural"], ["zh", "zh", "zh-CN-XiaoxiaoNeural"]]) {
      const text = realDir ? realSamples.get(language).text : `synthetic-${language}-${mobile}`;
      const before = providerCalls;
      const outcome = await page.evaluate(`ttsSpeak(${JSON.stringify({ text, lang, rate: 1.2, native: mobile })})`);
      assert.equal(outcome.ok, true, JSON.stringify(outcome));
      assert.equal(outcome.engine, "cloud"); assert.equal(outcome.fallback, false);
      await delay(150);
      const audio = await page.evaluate("({time:window.__wyjCloudAudio.currentTime,rate:window.__wyjCloudAudio.playbackRate,src:window.__wyjCloudAudio.src})");
      assert.ok(audio.time > 0, "real decoder advances playback"); assert.equal(audio.rate, 1.2); assert.match(audio.src, /^blob:/);
      const response = await originalFetch(`${baseUrl}/api/tts?${new URLSearchParams({ language, text })}`);
      assert.equal(response.headers.get("X-WYJ-TTS"), "hit");
      assert.equal(response.headers.get("X-WYJ-TTS-Voice"), voice);
      assert.equal(providerCalls, before + (realDir && mobile ? 0 : 1), "repeat and the real-sample warm mobile viewport are R2 only");
      assert.equal(requests.find((request) => request.text === text)?.v, "azure-neural-r1");
      let decoded;
      if (realDir) {
        decoded = await page.evaluate(`(async()=>{const r=await fetch(${JSON.stringify(`/api/tts?${new URLSearchParams({ language, text })}`)});
          const context=new AudioContext({sampleRate:24000});try{const buffer=await context.decodeAudioData(await r.arrayBuffer());
          let energy=0,peak=0;const values=buffer.getChannelData(0);for(const value of values){energy+=value*value;peak=Math.max(peak,Math.abs(value));}
          return {duration:buffer.duration,sample_rate:buffer.sampleRate,channels:buffer.numberOfChannels,rms:Math.sqrt(energy/values.length),peak};
          }finally{await context.close();}})()`);
        assert.ok(decoded.duration > 1 && decoded.rms > 0.0001 && decoded.peak > 0.01, "the original Azure sample decodes to non-silent PCM");
        await page.waitFor("window.__wyjCloudAudio.ended", 20_000, "entire Azure MP3 playback");
      }
      results.tests.push({ mode: mobile ? "Chrome-mobile-viewport" : "Chrome-desktop", language, playback: "PASS", cache: "PASS", csp: "PASS",
        ...(decoded ? { decoded, entire_playback: "PASS", source_sha256: realSamples.get(language).sha256 } : {}) });
    }
    for (const [status, code] of [[401, "tts_auth_failed"], [429, "tts_quota_exhausted"], [503, "tts_service_unavailable"], [504, "tts_timeout"]]) {
      const result = await page.evaluate(`ttsSpeak(${JSON.stringify({ text: `FAIL_${status}_${mobile}`, lang: "ja", native: mobile })})`);
      assert.equal(result.ok, false); assert.equal(result.code, code); assert.equal(result.fallback, false);
      assert.ok(result.message.length > 0); assert.equal(await page.evaluate("window.deviceCalls"), 0);
      results.tests.push({ mode: mobile ? "Chrome-mobile-viewport" : "Chrome-desktop", error: code, explicit_failure_without_device_tts: "PASS" });
    }
    await page.evaluate("ttsStop()");
    assert.equal(await page.evaluate("window.deviceCalls"), 0);
    assert.equal(await page.evaluate("location.pathname"), "/");
    await page.close(); page = null;
  }
  results.status = realDir ? "LOCAL_AUDIO_PASS" : "PASS_SYNTHETIC_TRANSPORT_ONLY";
} catch (error) {
  results.status = "FAIL"; results.error = error.message; process.exitCode = 1;
} finally {
  await page?.close().catch(() => undefined);
  if (browser) { await browser.send("Browser.close").catch(() => undefined); browser.close(); }
  child.kill();
  await new Promise((resolve) => server.close(resolve));
  globalThis.fetch = originalFetch;
  await mf.dispose();
  await writeFile(realDir ? path.join(realDir, "browser-result.json") : path.join(evidence, "browser-result.json"), JSON.stringify(results, null, 2) + "\n");
}
console.log(JSON.stringify(results, null, 2));

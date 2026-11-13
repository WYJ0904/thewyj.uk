import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Miniflare } from "miniflare";
import { syntheticMp3 } from "./synthetic-audio.mjs";

// Execute the actual Wrangler-built Pages worker, including middleware and
// routing, in workerd. Outbound traffic is entirely replaced by a fixture.
const root = path.resolve(import.meta.dirname, "../..");
const worker = path.join(root, ".wrangler/functions-build/index.js");
let upstream = 0;
const outbound = [];
const mf = new Miniflare({ modules: true, scriptPath: worker, compatibilityDate: "2026-08-06",
  d1Databases: { WYJ_DB: "tts-workerd" }, r2Buckets: ["WYJ_STORAGE"],
  bindings: { CLOUD_FOUNDATION_ENABLED: "true", WORKERS_AI_ENABLED: "false", TTS_MODE: "azure",
    AZURE_SPEECH_KEY: "synthetic-workerd-key", AZURE_SPEECH_REGION: "eastasia", TTS_RETRY_BASE_MS: "0", TTS_AZURE_RATE_LIMIT: "1000" },
  outboundService: async (request) => {
    outbound.push({ url: request.url, method: request.method,
      expected_test_header: request.headers.get("Ocp-Apim-Subscription-Key") === "synthetic-workerd-key" });
    assert.equal(request.url, "https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1");
    assert.equal(request.headers.get("Ocp-Apim-Subscription-Key"), "synthetic-workerd-key");
    upstream += 1;
    const body = await request.text();
    for (const status of [302, 401, 429, 503, 504]) if (body.includes(`FAIL_${status}`)) return new Response("fixture error", {
      status, headers: status === 302 ? { Location: "https://redirect.invalid/" } : {},
    });
    return new Response(syntheticMp3(), { headers: { "Content-Type": "audio/mpeg" } });
  },
});
const result = { scope: "compiled-Pages-worker-workerd-isolated-D1-R2-synthetic-Azure", tests: [], actual_azure_requests: 0, outbound };
try {
  const db = await mf.getD1Database("WYJ_DB");
  await db.prepare("CREATE TABLE cloud_rate_limit_windows (bucket_key TEXT PRIMARY KEY, route TEXT NOT NULL, window_started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, request_count INTEGER NOT NULL)").run();
  for (const [language, text, voice] of [["en", "Aeris English", "en-US-JennyNeural"],
    ["jp", "先生と学生", "ja-JP-NanamiNeural"], ["zh", "中文语音", "zh-CN-XiaoxiaoNeural"]]) {
    const url = `https://worker.invalid/api/tts?${new URLSearchParams({ language, text })}`;
    const response = await mf.dispatchFetch(url);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("X-WYJ-TTS-Voice"), voice);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(bytes, syntheticMp3());
    const before = upstream;
    const cached = await mf.dispatchFetch(url);
    assert.equal(cached.headers.get("X-WYJ-TTS"), "hit");
    assert.equal(cached.headers.get("Content-Length"), String(bytes.length));
    assert.equal(upstream, before);
    result.tests.push({ language, cache_and_audio: "PASS" });
  }
  const post = await mf.dispatchFetch("https://worker.invalid/api/tts", { method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://worker.invalid" },
    body: JSON.stringify({ lang: "ja-JP", text: "日本語の確認", voice: "default" }) });
  assert.equal(post.status, 200); result.tests.push({ post_protocol: "PASS" });
  for (const [status, expected, code] of [[302, 503, "tts_provider_rejected"], [401, 503, "tts_auth_failed"], [429, 429, "tts_quota_exhausted"],
    [503, 503, "tts_service_unavailable"], [504, 504, "tts_timeout"]]) {
    const response = await mf.dispatchFetch(`https://worker.invalid/api/tts?language=en&text=FAIL_${status}`);
    assert.equal(response.status, expected);
    assert.equal((await response.json()).code, code);
    result.tests.push({ code, explicit_error: "PASS" });
  }
  result.worker_sha256 = createHash("sha256").update(await readFile(worker)).digest("hex");
  result.status = "PASS_SYNTHETIC_RUNTIME_ONLY";
} catch (error) { result.status = "FAIL"; result.error = error.message; process.exitCode = 1; }
finally {
  await mf.dispose();
  await mkdir(path.join(root, ".wrangler/tts-evidence"), { recursive: true });
  await writeFile(path.join(root, ".wrangler/tts-evidence/workerd-result.json"), JSON.stringify(result, null, 2) + "\n");
}
console.log(JSON.stringify(result, null, 2));

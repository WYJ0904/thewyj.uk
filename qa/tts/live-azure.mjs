import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Miniflare } from "miniflare";
import { azureSpeechConfig, handleTtsRequest, audioContentType } from "../../functions/_lib/tts-api.mjs";

// Explicit service smoke test: only three public synthetic phrases are sent to
// Azure. D1/R2 are ephemeral Miniflare fixtures, never Hosted/Production data.
const output = path.resolve(import.meta.dirname, "../../.wrangler/tts-evidence/live-azure");
await mkdir(output, { recursive: true });
const result = { recorded_at: new Date().toISOString(), scope: "isolated-real-Azure-with-local-D1-R2",
  status: "BLOCKED_AZURE_CREDENTIALS", actual_azure_requests: 0, samples: [],
  human_listening: "NOT_TESTED", web_playback: "NOT_TESTED", android_device: "NOT_TESTED",
  hosted_preview: "NOT_TESTED", production: "NOT_SWITCHED" };
const env = { AZURE_SPEECH_KEY: process.env.AZURE_SPEECH_KEY,
  AZURE_SPEECH_REGION: process.env.AZURE_SPEECH_REGION, TTS_MODE: "azure", WORKERS_AI_ENABLED: "false" };
let mf;
const originalFetch = globalThis.fetch;
try {
  azureSpeechConfig(env);
  mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('fixture'); } }",
    d1Databases: { WYJ_DB: "tts-live-isolated" }, r2Buckets: ["WYJ_STORAGE"] });
  env.WYJ_DB = await mf.getD1Database("WYJ_DB");
  env.WYJ_STORAGE = await mf.getR2Bucket("WYJ_STORAGE");
  await env.WYJ_DB.prepare("CREATE TABLE cloud_rate_limit_windows (bucket_key TEXT PRIMARY KEY, route TEXT NOT NULL, window_started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, request_count INTEGER NOT NULL)").run();
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith(".tts.speech.microsoft.com/cognitiveservices/v1")) result.actual_azure_requests += 1;
    return originalFetch(url, options);
  };
  for (const [language, text] of [["en", "Welcome to Aeris. This is an English speech test."],
    ["jp", "先生と学生が日本語を勉強しています。"], ["zh", "欢迎使用 Aeris。这是一段中文语音测试。"]]) {
    const request = () => new Request(`https://isolated.invalid/api/tts?${new URLSearchParams({ language, text, voice: "default" })}`);
    const response = await handleTtsRequest({ env, request: request() });
    if (!response.ok) {
      const error = await response.json();
      throw Object.assign(new Error("Real Azure service probe failed"), { code: error.code, status: response.status });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(audioContentType(bytes), "audio/mpeg");
    assert.equal(response.headers.get("X-WYJ-TTS"), "miss");
    const cached = await handleTtsRequest({ env, request: request() });
    assert.equal(cached.headers.get("X-WYJ-TTS"), "hit");
    assert.deepEqual(new Uint8Array(await cached.arrayBuffer()), bytes);
    await writeFile(path.join(output, `${language}.mp3`), bytes);
    result.samples.push({ language, text, voice: response.headers.get("X-WYJ-TTS-Voice"), bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), local_cache_round_trip: "PASS", human_listening: "NOT_TESTED" });
  }
  result.status = "LIVE_API_PASS_LISTENING_AND_DEVICE_GATES_PENDING";
  result.region = env.AZURE_SPEECH_REGION;
} catch (error) {
  result.status = error.code === "tts_not_configured" ? "BLOCKED_AZURE_CREDENTIALS" : "LIVE_API_FAIL";
  result.error_code = /^tts_[a-z_]+$/.test(error.code || "") ? error.code : "probe_failed";
  if (error.status) result.http_status = error.status;
  process.exitCode = result.status === "BLOCKED_AZURE_CREDENTIALS" ? 2 : 1;
} finally {
  globalThis.fetch = originalFetch;
  await mf?.dispose();
  await writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
}
console.log(JSON.stringify(result, null, 2));

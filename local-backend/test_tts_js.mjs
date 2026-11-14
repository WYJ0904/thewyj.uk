import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import { syntheticMp3 } from "../qa/tts/synthetic-audio.mjs";
import {
  TTS_DEFAULT_MODEL, TTS_MAX_AUDIO_BYTES, TTS_OUTPUT_FORMAT, audioContentType,
  azureSpeechConfig, azureTtsCacheModel, handleTtsRequest, normalizeTtsLanguage,
  normalizeTtsText, synthesizeAzureSpeech, ttsCacheKey, ttsSsml,
} from "../functions/_lib/tts-api.mjs";

const AUDIO = syntheticMp3();
const ENV = { AZURE_SPEECH_REGION: "eastasia", AZURE_SPEECH_KEY: "synthetic-test-key",
  TTS_RETRY_BASE_MS: "0", TTS_AZURE_RATE_LIMIT: "1000", WORKERS_AI_ENABLED: "false" };
const audioResponse = () => new Response(AUDIO, { headers: { "Content-Type": "audio/mpeg" } });
async function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = original; }
}
async function errorIs(response, status, code, retryable) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.code, code);
  if (retryable !== undefined) assert.equal(body.retryable, retryable);
  assert.ok(!JSON.stringify(body).includes(ENV.AZURE_SPEECH_KEY));
  return body;
}

await test("Azure cloud TTS with isolated D1/R2 and synthetic provider responses", async (t) => {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('fixture'); } }",
    d1Databases: { WYJ_DB: "tts-test" }, r2Buckets: ["WYJ_STORAGE"] });
  try {
    const db = await mf.getD1Database("WYJ_DB");
    const bucket = await mf.getR2Bucket("WYJ_STORAGE");
    await db.prepare("CREATE TABLE cloud_rate_limit_windows (bucket_key TEXT PRIMARY KEY, route TEXT NOT NULL, window_started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, request_count INTEGER NOT NULL)").run();
    let sequence = 0;
    const call = ({ language = "en", text = `fixture-${++sequence}`, method = "GET", body, env = {}, ip, query } = {}) =>
      handleTtsRequest({ env: { ...ENV, WYJ_DB: db, WYJ_STORAGE: bucket,
        AI: { run() { throw new Error("Workers AI must never be called"); } }, ...env },
      request: new Request(`https://tts.invalid/api/tts?${query ?? new URLSearchParams({ language, text, voice: "default" })}`, {
        method, headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip || `fixture-${++sequence}` },
        ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
      }) });

    await t.test("language aliases, unchanged kanji, XML escaping and legacy cache identity", async () => {
      for (const alias of ["ja", "jp", "jpn", "japanese", "ja-JP"]) assert.equal(normalizeTtsLanguage(alias), "jp");
      assert.equal(normalizeTtsLanguage("EN-us"), "en");
      assert.equal(normalizeTtsLanguage("中文"), "zh");
      assert.equal(normalizeTtsLanguage("fr"), "");
      assert.equal(normalizeTtsText("  漢字の\u0001読み  "), "漢字の 読み");
      assert.match(ttsSsml("<voice> & \" ' 漢字", "jp"), /&lt;voice&gt; &amp; &quot; &apos; 漢字/);
      assert.match(ttsSsml("先生", "jp"), /xml:lang="ja-JP".*name="ja-JP-NanamiNeural">先生</);
      const input = { language: "en", voice: "default", model: "@cf/myshell-ai/melotts", text: "legacy" };
      const digest = createHash("sha256").update("en\0default\0@cf/myshell-ai/melotts\0v2\0legacy").digest("hex");
      assert.equal(await ttsCacheKey(input), `tts/v2/en/${digest}`);
      assert.notEqual(await ttsCacheKey(input), await ttsCacheKey({ ...input, model: azureTtsCacheModel("en") }));
    });

    for (const [language, voice] of [["en", "en-US-JennyNeural"], ["jp", "ja-JP-NanamiNeural"], ["zh", "zh-CN-XiaoxiaoNeural"]]) {
      await t.test(`${language}: Azure request and real R2 streamed cache round trip`, async () => {
        const text = `${language} 語音 fixture`;
        let calls = 0;
        await withFetch(async (url, options) => {
          calls += 1;
          assert.equal(url, "https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1");
          assert.equal(options.headers["Ocp-Apim-Subscription-Key"], ENV.AZURE_SPEECH_KEY);
          assert.equal(options.headers["X-Microsoft-OutputFormat"], TTS_OUTPUT_FORMAT);
          assert.equal(options.redirect, "manual");
          assert.ok(options.signal instanceof AbortSignal);
          assert.ok(options.body.includes(`name="${voice}"`));
          return audioResponse();
        }, async () => {
          const first = await call({ language, text });
          assert.equal(first.status, 200);
          assert.equal(first.headers.get("X-WYJ-TTS"), "miss");
          assert.equal(first.headers.get("X-WYJ-TTS-Model"), TTS_DEFAULT_MODEL);
          assert.equal(first.headers.get("X-WYJ-TTS-Voice"), voice);
          assert.equal(first.headers.get("X-WYJ-TTS-Attempts"), "1");
          assert.deepEqual(new Uint8Array(await first.arrayBuffer()), AUDIO);
          const second = await call({ language, text, env: { AZURE_SPEECH_KEY: "", TTS_MODE: "cache-only" } });
          assert.equal(second.status, 200);
          assert.equal(second.headers.get("X-WYJ-TTS"), "hit");
          assert.equal(second.headers.get("Content-Length"), String(AUDIO.length));
          assert.equal(second.headers.get("ETag"), first.headers.get("ETag"));
          assert.deepEqual(new Uint8Array(await second.arrayBuffer()), AUDIO);
          assert.equal(calls, 1);
        });
      });
    }

    await t.test("GET lang alias and POST protocol remain compatible", async () => {
      await withFetch(async () => audioResponse(), async () => {
        assert.equal((await call({ query: "lang=ja-JP&text=学校" })).status, 200);
        assert.equal((await call({ method: "POST", body: { lang: "zh", text: "中文 & English", voice: "default" } })).status, 200);
      });
    });

    await t.test("valid legacy EN/ZH audio is reused without secrets or synthesis", async () => {
      for (const language of ["en", "zh"]) for (const model of ["@cf/myshell-ai/melotts", "google/gemini-3.1-flash-tts"]) {
        const text = `legacy-${language}-${model}`;
        const key = await ttsCacheKey({ language, text, model, voice: "default" });
        await bucket.put(key, AUDIO, { httpMetadata: { contentType: "audio/mpeg" } });
        const response = await call({ language, text, env: { AZURE_SPEECH_KEY: "" } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("X-WYJ-TTS-Model"), model);
        assert.equal(response.headers.get("X-WYJ-TTS-Attempts"), "0");
      }
    });

    await t.test("unverified legacy Japanese is preserved and replaced with a Japanese Azure voice", async () => {
      const text = "先生と学生";
      const key = await ttsCacheKey({ language: "jp", text, voice: "default", model: "@cf/myshell-ai/melotts" });
      await bucket.put(key, AUDIO);
      await withFetch(async (_, options) => { assert.match(options.body, /ja-JP-NanamiNeural/); return audioResponse(); }, async () => {
        const response = await call({ language: "jp", text });
        assert.equal(response.headers.get("X-WYJ-TTS"), "miss");
        assert.equal(response.headers.get("X-WYJ-TTS-Voice"), "ja-JP-NanamiNeural");
        assert.ok(await bucket.head(key), "legacy object is never deleted");
      });
    });

    await t.test("reviewed legacy Japanese can still be reused", async () => {
      const text = "確認済み音声";
      const key = await ttsCacheKey({ language: "jp", text, voice: "default", model: "@cf/myshell-ai/melotts" });
      await bucket.put(key, AUDIO, { customMetadata: { ttsLocale: "ja-JP", ttsVerified: "true" } });
      const response = await call({ language: "jp", text, env: { AZURE_SPEECH_KEY: "" } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("X-WYJ-TTS"), "hit");
    });

    await t.test("corrupt legacy JSON is neither played nor deleted", async () => {
      const text = "invalid-old-object";
      const key = await ttsCacheKey({ language: "en", text, voice: "default", model: "@cf/myshell-ai/melotts" });
      await bucket.put(key, '{"error":"old provider failure"}', { httpMetadata: { contentType: "audio/mpeg" } });
      await withFetch(async () => audioResponse(), async () => {
        assert.equal((await call({ text })).headers.get("X-WYJ-TTS"), "miss");
        assert.ok(await bucket.head(key));
      });
    });

    await t.test("invalid inputs fail before any provider call", async () => {
      await errorIs(await call({ language: "fr" }), 400, "tts_language_unsupported", false);
      await errorIs(await call({ text: "" }), 400, "tts_text_required", false);
      await errorIs(await call({ text: "a".repeat(241) }), 413, "tts_text_too_long", false);
      await errorIs(await call({ query: "language=en&text=hello&voice=other" }), 400, "tts_voice_unsupported", false);
      await errorIs(await call({ method: "DELETE" }), 405, "method_not_allowed", false);
      await errorIs(await call({ method: "POST", body: "{" }), 400, "invalid_payload", false);
      await errorIs(await call({ method: "POST", body: [] }), 400, "invalid_payload", false);
    });

    await t.test("missing credentials, unsafe region and cache-only rollback are explicit", async () => {
      await errorIs(await call({ env: { AZURE_SPEECH_KEY: "" } }), 503, "tts_not_configured", false);
      await errorIs(await call({ env: { AZURE_SPEECH_REGION: "eastasia.evil.invalid/" } }), 503, "tts_not_configured", false);
      await errorIs(await call({ env: { TTS_MODE: "cache-only" } }), 503, "tts_unavailable", true);
      await errorIs(await call({ env: { TTS_MODE: "melotts" } }), 503, "tts_not_configured", false);
      assert.throws(() => azureSpeechConfig({ ...ENV, AZURE_SPEECH_REGION: "https://evil.invalid" }));
    });

    for (const [status, code, resultStatus, retryable] of [
      [302, "tts_provider_rejected", 503, false],
      [401, "tts_auth_failed", 503, false], [403, "tts_auth_failed", 503, false],
      [429, "tts_quota_exhausted", 429, true], [400, "tts_provider_rejected", 503, false],
      [415, "tts_provider_rejected", 503, false], [504, "tts_timeout", 504, true],
    ]) await t.test(`Azure HTTP ${status}: one attempt, safe JSON, no cache poisoning`, async () => {
      let calls = 0;
      const text = `upstream-${status}`;
      await withFetch(async () => { calls += 1; return new Response(ENV.AZURE_SPEECH_KEY,
        { status, headers: { "Retry-After": "37" } }); }, async () => {
        const response = await call({ text });
        if (status === 429) assert.equal(response.headers.get("Retry-After"), "37");
        await errorIs(response, resultStatus, code, retryable);
        assert.equal(calls, 1);
        assert.equal(await bucket.head(await ttsCacheKey({ language: "en", text, voice: "default", model: azureTtsCacheModel("en") })), null);
      });
    });

    await t.test("temporary 503 recovers once; persistent service/network failures stop after two attempts", async () => {
      let calls = 0;
      await withFetch(async () => ++calls === 1 ? new Response("down", { status: 503 }) : audioResponse(), async () => {
        assert.equal((await call()).headers.get("X-WYJ-TTS-Attempts"), "2"); assert.equal(calls, 2);
      });
      for (const impl of [() => new Response("down", { status: 502 }), () => { throw new Error(ENV.AZURE_SPEECH_KEY); }]) {
        calls = 0;
        await withFetch(async () => { calls += 1; return impl(); }, async () => {
          await errorIs(await call(), 503, "tts_service_unavailable", true); assert.equal(calls, 2);
        });
      }
    });

    await t.test("empty audio, disguised JSON, wrong format and excessive audio are rejected", async () => {
      for (const [response, code] of [
        [new Response(null, { headers: { "Content-Type": "audio/mpeg" } }), "tts_empty_audio"],
        [new Response('{"error":"no audio"}', { headers: { "Content-Type": "audio/mpeg" } }), "tts_invalid_audio"],
        [new Response(AUDIO, { headers: { "Content-Type": "application/json" } }), "tts_invalid_audio"],
        [new Response(AUDIO, { headers: { "Content-Type": "audio/mpeg", "Content-Length": String(TTS_MAX_AUDIO_BYTES + 1) } }), "tts_invalid_audio"],
        [new Response(new Uint8Array(TTS_MAX_AUDIO_BYTES + 1), { headers: { "Content-Type": "audio/mpeg" } }), "tts_invalid_audio"],
      ]) await withFetch(async () => response, async () => errorIs(await call(), 503, code));
      assert.equal(audioContentType(new TextEncoder().encode("{bad provider}")), "");
    });

    await t.test("deadline aborts a hung fetch and a stalled body without retry", async () => {
      for (const streaming of [false, true]) {
        let calls = 0;
        let signal;
        await withFetch(async (_, options) => {
          calls += 1; signal = options.signal;
          return streaming ? new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "audio/mpeg" } })
            : new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
        }, async () => {
          const started = Date.now();
          await errorIs(await call({ env: { TTS_TIMEOUT_MS: "1000" } }), 504, "tts_timeout", true);
          assert.ok(Date.now() - started < 3_000); assert.equal(signal.aborted, true); assert.equal(calls, 1);
        });
      }
    });

    await t.test("cache read/write failures leave synthesis usable and do not expose internals", async () => {
      await withFetch(async () => audioResponse(), async () => assert.equal((await call({ env: { WYJ_STORAGE: {
        async get() { throw new Error("cache down"); }, async put() { throw new Error("cache down"); },
      } } })).status, 200));
    });

    await t.test("per-client limiter is retained and cached requests cannot bypass it", async () => {
      const text = "cached rate test";
      await withFetch(async () => audioResponse(), async () => {
        assert.equal((await call({ text, ip: "limit-client", env: { TTS_RATE_LIMIT: "1" } })).status, 200);
        await errorIs(await call({ text, ip: "limit-client", env: { TTS_RATE_LIMIT: "1" } }), 429, "rate_limited", true);
      });
    });

    await t.test("resource-wide F0 limiter spans client IPs and fails closed when D1 is unavailable", async () => {
      await db.prepare("DELETE FROM cloud_rate_limit_windows WHERE route = '/api/tts:tts-azure'").run();
      let calls = 0;
      await withFetch(async () => { calls += 1; return audioResponse(); }, async () => {
        const env = { TTS_AZURE_RATE_LIMIT: "1" };
        assert.equal((await call({ env, text: "global-budget-first" })).status, 200);
        await errorIs(await call({ env }), 429, "tts_quota_exhausted", true);
        assert.equal((await call({ env, text: "global-budget-first" })).status, 200, "a cache hit spends no synthesis quota");
        await errorIs(await call({ env: { WYJ_DB: undefined } }), 503, "tts_unavailable", true);
        assert.equal(calls, 1);
      });
    });

    await t.test("Android WebView keeps the shared cloud player and requires no native voice or permission changes", async () => {
      const source = await readFile(new URL("../android/app/src/main/java/uk/thewyj/app/core/web/ThewyjWebView.kt", import.meta.url), "utf8");
      assert.ok(source.includes("mediaPlaybackRequiresUserGesture = false"));
      const player = await readFile(new URL("../js/language/speech.js", import.meta.url), "utf8");
      assert.doesNotMatch(player, /speechSynthesis|SpeechSynthesisUtterance|thewyj:\/\/speech/);
    });
  } finally { await mf.dispose(); }
});

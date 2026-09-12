import assert from "node:assert/strict";
import path from "node:path";

import { Miniflare } from "miniflare";

import {
  TTS_CACHE_VERSION,
  handleTtsRequest,
  normalizeTtsLanguage,
  normalizeTtsText,
  ttsBytesFromResult,
  ttsCacheKey,
} from "../functions/_lib/tts-api.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Minimal in-memory R2 replacement: only the operations the handler uses. */
function fakeBucket() {
  const objects = new Map();
  return {
    objects,
    async get(key) {
      const entry = objects.get(key);
      if (!entry) return null;
      return {
        body: entry.bytes,
        httpMetadata: entry.httpMetadata,
      };
    },
    async put(key, value, options = {}) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      objects.set(key, { bytes, httpMetadata: options.httpMetadata || {} });
    },
  };
}

function base64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function fakeAi({ audio = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 1, 2, 3, 4]), fail = null, capture = [] } = {}) {
  return {
    capture,
    async run(model, input) {
      capture.push({ model, input });
      if (fail) throw fail;
      return { audio: base64(audio) };
    },
  };
}

async function withDatabase(run) {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { WYJ_DB: "tts-test" },
  });
  try {
    const db = await mf.getD1Database("WYJ_DB");
    await db.prepare(
      "CREATE TABLE IF NOT EXISTS cloud_rate_limit_windows (" +
        "bucket_key TEXT PRIMARY KEY, route TEXT NOT NULL, window_started_at INTEGER NOT NULL, " +
        "expires_at INTEGER NOT NULL, request_count INTEGER NOT NULL)",
    ).run();
    await run(db);
  } finally {
    await mf.dispose();
  }
}

function call(db, { query = "", method = "GET", body = null, env = {} } = {}) {
  const url = `https://preview.thewyj.uk/api/tts${query}`;
  return handleTtsRequest({
    env: {
      WYJ_ENVIRONMENT: "preview",
      WORKERS_AI_ENABLED: "true",
      D1_RATE_LIMIT_ENABLED: "true",
      WYJ_DB: db,
      ...env,
    },
    data: { requestId: crypto.randomUUID() },
    request: new Request(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
  });
}

async function expectError(response, status, code) {
  assert.equal(response.status, status, `expected HTTP ${status}, got ${response.status}`);
  const payload = await response.json();
  assert.equal(payload.code, code, `expected code ${code}, got ${payload.code}`);
}

await withDatabase(async (db) => {
  // 1. Normalisation: kanji is never rewritten, language aliases collapse.
  assert.equal(normalizeTtsLanguage("ja-JP"), "jp");
  assert.equal(normalizeTtsLanguage("EN-us"), "en");
  assert.equal(normalizeTtsLanguage("klingon"), "");
  assert.equal(normalizeTtsText("  お茶を  飲む  "), "お茶を 飲む");
  assert.equal(normalizeTtsText("Kanji: \u6f22\u5b57"), "Kanji: \u6f22\u5b57");

  // 2. Stable cache identity covers language + text + voice + model version.
  const keyA = await ttsCacheKey({ language: "jp", text: "\u304a\u8336", voice: "default", model: "m" });
  const keyB = await ttsCacheKey({ language: "jp", text: "\u304a\u8336", voice: "default", model: "m" });
  const keyC = await ttsCacheKey({ language: "jp", text: "\u304a\u6c34", voice: "default", model: "m" });
  const keyD = await ttsCacheKey({ language: "en", text: "\u304a\u8336", voice: "default", model: "m" });
  assert.equal(keyA, keyB, "identical input must share one cache key");
  assert.notEqual(keyA, keyC);
  assert.notEqual(keyA, keyD);
  assert.ok(keyA.includes(`/${TTS_CACHE_VERSION}/`));

  // 3. First request synthesises once, second request is a cache hit.
  const bucket = fakeBucket();
  const ai = fakeAi();
  const first = await call(db, {
    query: "?language=ja&text=" + encodeURIComponent("\u6f22\u5b57\u306e\u8aad\u307f"),
    env: { WYJ_STORAGE: bucket, AI: ai },
  });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Content-Type"), "audio/mpeg");
  assert.equal(first.headers.get("X-WYJ-TTS"), "miss");
  assert.equal(ai.capture.length, 1);
  assert.equal(ai.capture[0].input.lang, "jp");
  assert.equal(
    ai.capture[0].input.prompt,
    "\u6f22\u5b57\u306e\u8aad\u307f",
    "the server must receive the original kanji text",
  );
  const audio = new Uint8Array(await first.arrayBuffer());
  assert.ok(audio.length > 0);

  const second = await call(db, {
    query: "?language=jp&text=" + encodeURIComponent("\u6f22\u5b57\u306e\u8aad\u307f"),
    env: { WYJ_STORAGE: bucket, AI: fakeAi({ fail: new Error("must not be called") }) },
  });
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("X-WYJ-TTS"), "hit", "repeat playback must hit the cache");
  assert.equal(second.headers.get("ETag"), first.headers.get("ETag"));

  // 4. English and Japanese share one protocol and one cache namespace.
  const english = await call(db, {
    query: "?language=en&text=" + encodeURIComponent("dictation practice"),
    env: { WYJ_STORAGE: bucket, AI: ai },
  });
  assert.equal(english.status, 200);
  assert.equal(ai.capture.at(-1).input.lang, "en");

  // 5. POST body form works for the Android/Web clients.
  const posted = await call(db, {
    method: "POST",
    body: { language: "en", text: "posted body", voice: "default" },
    env: { WYJ_STORAGE: fakeBucket(), AI: ai },
  });
  assert.equal(posted.status, 200);

  // 6. Validation errors are explicit.
  await expectError(await call(db, { query: "?language=fr&text=bonjour", env: { WYJ_STORAGE: bucket, AI: ai } }), 400, "tts_language_unsupported");
  await expectError(await call(db, { query: "?language=en&text=", env: { WYJ_STORAGE: bucket, AI: ai } }), 400, "tts_text_required");
  await expectError(await call(db, { query: "?language=en&text=hi&voice=male", env: { WYJ_STORAGE: bucket, AI: ai } }), 400, "tts_voice_unsupported");
  await expectError(
    await call(db, { query: "?language=en&text=" + "a".repeat(400), env: { WYJ_STORAGE: bucket, AI: ai } }),
    413,
    "tts_text_too_long",
  );

  // 7. Server failure is explicit - never a silent device fallback.
  await expectError(
    await call(db, { query: "?language=en&text=offline", env: { WYJ_STORAGE: fakeBucket(), AI: fakeAi({ fail: new Error("ai down") }) } }),
    503,
    "tts_generation_failed",
  );
  await expectError(
    await call(db, { query: "?language=en&text=disabled", env: { WYJ_STORAGE: fakeBucket(), WORKERS_AI_ENABLED: "false" } }),
    503,
    "tts_unavailable",
  );
  await expectError(
    await call(db, { query: "?language=en&text=quota", env: { WYJ_STORAGE: fakeBucket(), AI: fakeAi({ fail: Object.assign(new Error("rate"), { status: 429 }) }) } }),
    429,
    "tts_quota_exhausted",
  );

  // 8. Rate limiting still protects the synthesis path.
  const limitedDb = db;
  let limited = 0;
  for (let index = 0; index < 5; index += 1) {
    const response = await call(limitedDb, {
      query: `?language=en&text=limit-${index}`,
      env: { WYJ_STORAGE: fakeBucket(), AI: ai, TTS_RATE_LIMIT: "1" },
    });
    if (response.status === 429) limited += 1;
  }
  assert.ok(limited >= 1, "rate limiting must be able to reject a burst");

  // 9. Audio shape normalisation covers every documented provider answer.
  const bytes = new Uint8Array([1, 2, 3, 4]);
  assert.deepEqual(await ttsBytesFromResult({ audio: base64(bytes) }), bytes);
  assert.deepEqual(await ttsBytesFromResult(bytes), bytes);
  assert.deepEqual(await ttsBytesFromResult({ audio: base64(bytes) }), bytes);
  assert.equal(await ttsBytesFromResult({ nope: true }), null);
});

// 10. The web and Android clients must not treat device voices as the normal path.
const webSpeech = await import("node:fs/promises").then((fs) =>
  fs.readFile(path.join(ROOT, "js", "language", "speech.js"), "utf8"),
);
assert.ok(webSpeech.includes("/api/tts"), "web speech must call the cloud TTS API");
assert.ok(
  webSpeech.indexOf("/api/tts") < webSpeech.indexOf("speechSynthesis"),
  "the cloud path must be evaluated before any device fallback",
);
// Android plays the exact same asset: the WebView loads the shared module, and
// the native bridge is only reachable from the offline fallback branch.
const androidBridge = await import("node:fs/promises").then((fs) =>
  fs.readFile(path.join(ROOT, "android", "app", "src", "main", "java", "uk", "thewyj", "app", "core", "speech", "AndroidSpeechBridge.kt"), "utf8"),
);
assert.ok(
  /offline|离线/.test(androidBridge),
  "the Android system TTS bridge must be documented as the offline fallback",
);
const webView = await import("node:fs/promises").then((fs) =>
  fs.readFile(path.join(ROOT, "android", "app", "src", "main", "java", "uk", "thewyj", "app", "core", "web", "ThewyjWebView.kt"), "utf8"),
);
assert.ok(
  webView.includes("mediaPlaybackRequiresUserGesture = false"),
  "the WebView must allow the cloud dictation asset to play",
);

console.log("Cloud TTS checks passed (cache identity, EN/JP synthesis, explicit failures, no device dependency).");

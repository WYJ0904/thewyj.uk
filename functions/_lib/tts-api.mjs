import { apiError, enforceD1RateLimit, featureFlags, requestIdFor, sha256Hex } from "./cloudflare-foundation.mjs";

/**
 * Cloud TTS (Task 24.2 prerequisite: cross-device compatibility).
 *
 * Web and Android both play the exact same server-side audio instead of
 * depending on a device voice package (`speechSynthesis` / Android
 * `TextToSpeech`). Synthesis runs on Workers AI (multilingual MeloTTS, which
 * covers English and Japanese) and every result is cached in R2 under a stable
 * `{language, text, voice, model version}` key, so repeated playback never
 * re-synthesises and never depends on the caller's device.
 *
 * Failure policy: a generation failure is returned to the client as an explicit
 * error. The server never silently degrades to a device voice - if the client
 * wants an offline fallback it must say so itself.
 */

export const TTS_DEFAULT_MODEL = "@cf/myshell-ai/melotts";
export const TTS_CACHE_VERSION = "v1";
export const TTS_MAX_TEXT_CHARS = 240;
export const TTS_RATE_LIMIT = 120;
export const TTS_RATE_WINDOW_SECONDS = 60;
export const TTS_DEFAULT_VOICE = "default";

/**
 * Declared in the same `"METHOD /api/path"` shape the legacy-route gate scans
 * for, so the frontend `/api/tts` call is proven to have a Cloudflare handler.
 */
export const TTS_ROUTES = Object.freeze(["GET /api/tts", "POST /api/tts"]);

const LANGUAGE_ALIASES = new Map([
  ["en", "en"],
  ["eng", "en"],
  ["english", "en"],
  ["en-us", "en"],
  ["en-gb", "en"],
  ["ja", "jp"],
  ["jp", "jp"],
  ["jpn", "jp"],
  ["japanese", "jp"],
  ["ja-jp", "jp"],
  ["zh", "zh"],
  ["zh-cn", "zh"],
  ["chinese", "zh"],
  ["中文", "zh"],
]);

const ALLOWED_MODELS = new Set([
  "@cf/myshell-ai/melotts",
]);

export function normalizeTtsLanguage(value) {
  const key = String(value ?? "").trim().toLowerCase();
  return LANGUAGE_ALIASES.get(key) || "";
}

export function normalizeTtsText(value) {
  return String(value ?? "")
    .normalize("NFC")
    // Control characters would corrupt both the cache key and the prompt.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTtsVoice(value) {
  const voice = String(value ?? "").trim().toLowerCase();
  return voice || TTS_DEFAULT_VOICE;
}

export function ttsModelFor(env = {}) {
  const configured = String(env.TTS_MODEL || "").trim();
  return ALLOWED_MODELS.has(configured) ? configured : TTS_DEFAULT_MODEL;
}

/** Stable cache identity: language + text + voice + model/version. */
export async function ttsCacheKey({ language, text, voice, model }) {
  const digest = await sha256Hex(`${language}\u0000${voice}\u0000${model}\u0000${TTS_CACHE_VERSION}\u0000${text}`);
  return `tts/${TTS_CACHE_VERSION}/${language}/${digest}`;
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesFromAudioValue(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (typeof value === "string") {
    // MeloTTS answers with base64 audio; tolerate a data URL wrapper too.
    const base64 = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
    try {
      return base64ToBytes(base64);
    } catch (_) {
      return null;
    }
  }
  if (typeof value?.arrayBuffer === "function") return null;
  return null;
}

/** Normalises every documented Workers AI TTS answer shape into raw bytes. */
export async function ttsBytesFromResult(result) {
  if (!result) return null;
  if (result instanceof Response) return new Uint8Array(await result.arrayBuffer());
  const direct = bytesFromAudioValue(result);
  if (direct) return direct;
  if (typeof result.arrayBuffer === "function") return new Uint8Array(await result.arrayBuffer());
  if (typeof result.getReader === "function") {
    const reader = result.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value instanceof Uint8Array ? value : new Uint8Array(value));
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }
  const nested = bytesFromAudioValue(result.audio ?? result.audio_base64 ?? result.data);
  if (nested) return nested;
  return null;
}

export function audioContentType(bytes) {
  if (!bytes || bytes.length < 4) return "audio/mpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "audio/wav";
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return "audio/ogg";
  return "audio/mpeg";
}

function parseRequest(context) {
  const url = new URL(context.request.url);
  return { url, method: context.request.method.toUpperCase() };
}

async function readPayload(context, url, method) {
  if (method === "POST") {
    const body = await context.request.json().catch(() => null);
    if (!body || typeof body !== "object") return null;
    return {
      text: body.text,
      language: body.language ?? body.lang,
      voice: body.voice,
    };
  }
  return {
    text: url.searchParams.get("text"),
    language: url.searchParams.get("language") || url.searchParams.get("lang"),
    voice: url.searchParams.get("voice"),
  };
}

function audioResponse(bytes, { cacheHit, model, requestId, contentType, etag }) {
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "ETag": `"${etag}"`,
      "X-WYJ-TTS": cacheHit ? "hit" : "miss",
      "X-WYJ-TTS-Model": model,
      "X-WYJ-TTS-Version": TTS_CACHE_VERSION,
      "X-Request-Id": requestId,
    },
  });
}

export async function handleTtsRequest(context) {
  const { url, method } = parseRequest(context);
  if (url.pathname !== "/api/tts") return null;
  const requestId = requestIdFor(context.request);
  if (!["GET", "POST"].includes(method)) {
    return apiError("method_not_allowed", "只支持 GET 与 POST", 405, requestId);
  }

  const payload = await readPayload(context, url, method);
  if (!payload) return apiError("invalid_payload", "请求内容无法解析", 400, requestId);

  const language = normalizeTtsLanguage(payload.language);
  if (!language) {
    return apiError(
      "tts_language_unsupported",
      "当前云端语音只支持英语与日语",
      400,
      requestId,
      { retryable: false },
    );
  }
  const voice = normalizeTtsVoice(payload.voice);
  if (voice !== TTS_DEFAULT_VOICE) {
    return apiError(
      "tts_voice_unsupported",
      "当前云端语音只有默认音色，请使用 voice=default",
      400,
      requestId,
      { retryable: false },
    );
  }
  const text = normalizeTtsText(payload.text);
  if (!text) return apiError("tts_text_required", "缺少要朗读的文本", 400, requestId, { retryable: false });
  if ([...text].length > TTS_MAX_TEXT_CHARS) {
    return apiError(
      "tts_text_too_long",
      `单次朗读最长 ${TTS_MAX_TEXT_CHARS} 个字符`,
      413,
      requestId,
      { retryable: false },
    );
  }

  // The limit is overridable so tests (and temporary incidents) can tighten it
  // without touching the synthesis path.
  const configuredLimit = Number.parseInt(String(context.env?.TTS_RATE_LIMIT ?? ""), 10);
  const limit = await enforceD1RateLimit(context, {
    limit: Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : TTS_RATE_LIMIT,
    windowSeconds: TTS_RATE_WINDOW_SECONDS,
    scope: "tts",
  });
  if (!limit.allowed) {
    return apiError("rate_limited", "语音请求过于频繁，请稍后再试", 429, requestId, { retryable: true });
  }

  const model = ttsModelFor(context.env);
  const cacheKey = await ttsCacheKey({ language, text, voice, model });
  const bucket = context.env?.WYJ_STORAGE;
  const flags = featureFlags(context.env);
  if (bucket?.get) {
    const cached = await bucket.get(cacheKey).catch(() => null);
    if (cached?.body) {
      const contentType = cached.httpMetadata?.contentType || "audio/mpeg";
      return audioResponse(cached.body, {
        cacheHit: true,
        model,
        requestId,
        contentType,
        etag: cacheKey,
      });
    }
  }

  if (!flags.workersAi || !context.env?.AI?.run) {
    return apiError(
      "tts_unavailable",
      "云端语音服务暂时不可用，请稍后重试",
      503,
      requestId,
      { retryable: true },
    );
  }

  let bytes = null;
  try {
    const result = await context.env.AI.run(model, { prompt: text, lang: language });
    bytes = await ttsBytesFromResult(result);
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || 0);
    const code = status === 429 ? "tts_quota_exhausted" : "tts_generation_failed";
    return apiError(
      code,
      status === 429 ? "云端语音额度已用完，请稍后再试" : "云端语音生成失败，请稍后重试",
      status === 429 ? 429 : 503,
      requestId,
      { retryable: true },
    );
  }
  if (!bytes || bytes.length === 0) {
    return apiError("tts_empty_audio", "云端语音没有返回音频，请稍后重试", 503, requestId, { retryable: true });
  }

  const contentType = audioContentType(bytes);
  if (bucket?.put) {
    await bucket
      .put(cacheKey, bytes, {
        httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
      })
      .catch(() => undefined);
  }
  return audioResponse(bytes, { cacheHit: false, model, requestId, contentType, etag: cacheKey });
}

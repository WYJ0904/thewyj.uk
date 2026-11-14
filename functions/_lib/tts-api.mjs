import { apiError, enforceD1RateLimit, requestIdFor, sha256Hex } from "./cloudflare-foundation.mjs";

// Azure Speech is independent of Workers AI and the Llama text AI. Keep v2
// cache identities readable; no R2 objects are deleted or bulk rewritten.
export const TTS_DEFAULT_MODEL = "azure/speech-neural";
export const TTS_CACHE_VERSION = "v2";
export const TTS_MAX_TEXT_CHARS = 240;
export const TTS_MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const TTS_RATE_LIMIT = 120;
export const TTS_RATE_WINDOW_SECONDS = 60;
export const TTS_DEFAULT_VOICE = "default";
export const TTS_GENERATION_ATTEMPTS = 2;
export const TTS_RETRY_BASE_MS = 120;
export const TTS_TIMEOUT_MS = 8_000;
export const TTS_AZURE_RATE_LIMIT = 20;
export const TTS_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
export const TTS_ROUTES = Object.freeze(["GET /api/tts", "POST /api/tts"]);

const LEGACY_MODELS = ["@cf/myshell-ai/melotts", "google/gemini-3.1-flash-tts"];
const PROFILES = Object.freeze({
  en: Object.freeze({ locale: "en-US", voice: "en-US-JennyNeural" }),
  jp: Object.freeze({ locale: "ja-JP", voice: "ja-JP-NanamiNeural" }),
  zh: Object.freeze({ locale: "zh-CN", voice: "zh-CN-XiaoxiaoNeural" }),
});
const LANGUAGE_ALIASES = new Map([
  ...["en", "eng", "english", "en-us", "en-gb"].map((alias) => [alias, "en"]),
  ...["ja", "jp", "jpn", "japanese", "ja-jp"].map((alias) => [alias, "jp"]),
  ...["zh", "zh-cn", "chinese", "中文"].map((alias) => [alias, "zh"]),
]);

export function normalizeTtsLanguage(value) {
  return LANGUAGE_ALIASES.get(String(value ?? "").trim().toLowerCase()) || "";
}

export function normalizeTtsText(value) {
  return String(value ?? "").normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/g, " ")
    .toWellFormed().replace(/\s+/g, " ").trim();
}

export function normalizeTtsVoice(value) {
  return String(value ?? "").trim().toLowerCase() || TTS_DEFAULT_VOICE;
}

export function azureTtsProfile(language) { return PROFILES[language] || null; }

export function azureTtsCacheModel(language) {
  return `${TTS_DEFAULT_MODEL}/${PROFILES[language].voice}/${TTS_OUTPUT_FORMAT}/r1`;
}

// Voice, format and adapter revision distinguish Azure from all legacy audio.
// The hash calculation for legacy v2 keys remains byte-for-byte compatible.
export async function ttsCacheKey({ language, text, voice, model }) {
  const digest = await sha256Hex(`${language}\u0000${voice}\u0000${model}\u0000${TTS_CACHE_VERSION}\u0000${text}`);
  return `tts/${TTS_CACHE_VERSION}/${language}/${digest}`;
}

export function ttsSsml(text, language) {
  const profile = PROFILES[language];
  const escaped = text.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[char]);
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${profile.locale}"><voice name="${profile.voice}">${escaped}</voice></speak>`;
}

function integerSetting(value, fallback, minimum, maximum) {
  const parsed = Number(String(value ?? "").trim() || NaN);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function ttsError(code, message, status = 503, retryable = true, extra = {}) {
  return Object.assign(new Error(message), { code, status, retryable, ...extra });
}

export function azureSpeechConfig(env = {}) {
  const region = String(env.AZURE_SPEECH_REGION || "").trim().toLowerCase();
  const key = String(env.AZURE_SPEECH_KEY || "").trim();
  // Never forward the secret to arbitrary hosts, redirects, URLs or clients.
  if (!/^[a-z][a-z0-9]{1,39}$/.test(region) || !key || /[\r\n]/.test(key) || /^replace-/i.test(key)) {
    throw ttsError("tts_not_configured", "云端语音尚未配置 Azure Speech 凭据或区域", 503, false);
  }
  return {
    endpoint: `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, key,
    timeoutMs: integerSetting(env.TTS_TIMEOUT_MS, TTS_TIMEOUT_MS, 1_000, 10_000),
  };
}

function retryAfterSeconds(value) {
  if (!value) return 60;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1_000);
  return Number.isFinite(seconds) ? Math.max(1, Math.min(3_600, seconds)) : 60;
}

// Format sniffing rejects JSON/HTML errors even when labelled audio/mpeg.
// Decoder and human listening acceptance are separate release gates.
export function audioContentType(bytes) {
  if (!bytes || bytes.length < 4) return "";
  if (bytes.length >= 44 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.subarray(8, 12)) === "WAVE") return "audio/wav";
  if (String.fromCharCode(...bytes.subarray(0, 4)) === "OggS") return "audio/ogg";
  let offset = 0;
  if (String.fromCharCode(...bytes.subarray(0, 3)) === "ID3" && bytes.length >= 10) {
    if (bytes.subarray(6, 10).some((byte) => byte & 0x80)) return "";
    offset = 10 + (bytes[6] << 21 | bytes[7] << 14 | bytes[8] << 7 | bytes[9]);
    if (bytes[5] & 0x10) offset += 10;
  }
  if (offset + 4 <= bytes.length && bytes[offset] === 0xff && (bytes[offset + 1] & 0xe0) === 0xe0
      && (bytes[offset + 1] & 0x18) !== 0x08 && (bytes[offset + 1] & 0x06) !== 0
      && (bytes[offset + 2] & 0xf0) !== 0xf0 && (bytes[offset + 2] & 0x0c) !== 0x0c) return "audio/mpeg";
  return "";
}

async function readAudioBody(body, size = 0, signal) {
  if (size > TTS_MAX_AUDIO_BYTES) {
    await body?.cancel?.().catch(() => undefined);
    throw ttsError("tts_invalid_audio", "云端语音音频超出大小限制", 503, false);
  }
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
    if (bytes.length > TTS_MAX_AUDIO_BYTES) throw ttsError("tts_invalid_audio", "云端语音音频超出大小限制", 503, false);
    return bytes;
  }
  if (!body?.getReader) return new Uint8Array();
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw ttsError("tts_timeout", "云端语音服务响应超时，请稍后重试", 504);
      if (done) break;
      total += value.byteLength;
      if (total > TTS_MAX_AUDIO_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw ttsError("tts_invalid_audio", "云端语音音频超出大小限制", 503, false);
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** One Azure request; its deadline covers headers and the entire audio body. */
export async function synthesizeAzureSpeech(env, { text, language }, { fetchImpl = fetch } = {}) {
  const { endpoint, key, timeoutMs } = azureSpeechConfig(env);
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(endpoint, {
          // workerd supports manual/follow; reject every redirect below so the
          // subscription key can never be forwarded to a redirect destination.
          method: "POST", redirect: "manual", signal: controller.signal,
          headers: {
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml; charset=utf-8",
            "X-Microsoft-OutputFormat": TTS_OUTPUT_FORMAT,
            "User-Agent": "Aeris-TTS/1.0",
          },
          body: ttsSsml(text, language),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          if ([401, 403].includes(response.status)) throw ttsError("tts_auth_failed", "云端语音认证失败，请联系管理员检查 Azure 密钥和区域", 503, false);
          if (response.status === 429) throw ttsError("tts_quota_exhausted", "云端语音额度或请求速率受限，请稍后再试", 429, true,
            { retryAfter: retryAfterSeconds(response.headers.get("Retry-After")) });
          if ([408, 504].includes(response.status)) throw ttsError("tts_timeout", "云端语音服务响应超时，请稍后重试", 504);
          if (response.status >= 500) throw ttsError("tts_service_unavailable", "云端语音服务暂时不可用，请稍后重试");
          throw ttsError("tts_provider_rejected", "云端语音配置或请求被 Azure 拒绝，请联系管理员", 503, false);
        }
        const contentType = String(response.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
        if (!["audio/mpeg", "audio/mp3", "application/octet-stream"].includes(contentType)) {
          await response.body?.cancel().catch(() => undefined);
          throw ttsError("tts_invalid_audio", "云端语音返回了无效音频", 503, false);
        }
        const bytes = await readAudioBody(response.body, Number(response.headers.get("Content-Length")), controller.signal);
        if (!bytes.length) throw ttsError("tts_empty_audio", "云端语音没有返回音频，请稍后重试");
        if (audioContentType(bytes) !== "audio/mpeg") throw ttsError("tts_invalid_audio", "云端语音返回了无效音频", 503, false);
        return bytes;
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(ttsError("tts_timeout", "云端语音服务响应超时，请稍后重试", 504));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") throw ttsError("tts_timeout", "云端语音服务响应超时，请稍后重试", 504);
    if (error?.code?.startsWith("tts_")) throw error;
    throw ttsError("tts_service_unavailable", "无法连接云端语音服务，请稍后重试");
  } finally { clearTimeout(timer); }
}

function audioResponse(bytes, { cacheHit, model, voice, requestId, etag, attempts = 0 }) {
  return new Response(bytes, { headers: {
    "Content-Type": audioContentType(bytes), "Content-Length": String(bytes.byteLength),
    "Cache-Control": "public, max-age=31536000, immutable", "ETag": `"${etag}"`,
    "X-WYJ-TTS": cacheHit ? "hit" : "miss", "X-WYJ-TTS-Model": model, "X-WYJ-TTS-Voice": voice,
    "X-WYJ-TTS-Version": TTS_CACHE_VERSION, "X-WYJ-TTS-Attempts": String(attempts), "X-Request-Id": requestId,
  } });
}

async function readCachedAudio(bucket, { language, text, voice }, requestId) {
  if (!bucket?.get) return null;
  for (const model of [azureTtsCacheModel(language), ...LEGACY_MODELS]) {
    const key = await ttsCacheKey({ language, text, voice, model });
    try {
      const cached = await bucket.get(key);
      if (!cached?.body) continue;
      const legacy = LEGACY_MODELS.includes(model);
      // Old Japanese objects have no declared voice/locale and may contain
      // kanji read in Chinese. Preserve them; reuse only with a review marker.
      if (legacy && language === "jp" && !(cached.customMetadata?.ttsLocale === "ja-JP"
          && cached.customMetadata?.ttsVerified === "true")) {
        await cached.body.cancel?.().catch(() => undefined);
        continue;
      }
      const bytes = await readAudioBody(cached.body, cached.size);
      if (!audioContentType(bytes)) continue;
      return audioResponse(bytes, { cacheHit: true, model: legacy ? model : TTS_DEFAULT_MODEL,
        voice: legacy ? "legacy" : PROFILES[language].voice, requestId, etag: key });
    } catch (_) { /* A cache outage/corrupt object can still use bounded Azure synthesis. */ }
  }
  return null;
}

export async function handleTtsRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname !== "/api/tts") return null;
  const method = context.request.method.toUpperCase();
  const requestId = requestIdFor(context.request);
  if (!["GET", "POST"].includes(method)) return apiError("method_not_allowed", "只支持 GET 与 POST", 405, requestId);
  const body = method === "POST" ? await context.request.json().catch(() => null) : Object.fromEntries(url.searchParams);
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError("invalid_payload", "请求内容无法解析", 400, requestId);
  const language = normalizeTtsLanguage(body.language || body.lang);
  if (!language) return apiError("tts_language_unsupported", "当前云端语音只支持中文、英语与日语", 400, requestId);
  const voice = normalizeTtsVoice(body.voice);
  if (voice !== TTS_DEFAULT_VOICE) return apiError("tts_voice_unsupported", "当前云端语音只有默认音色，请使用 voice=default", 400, requestId);
  const text = normalizeTtsText(body.text);
  if (!text) return apiError("tts_text_required", "缺少要朗读的文本", 400, requestId);
  if ([...text].length > TTS_MAX_TEXT_CHARS) return apiError("tts_text_too_long", `单次朗读最长 ${TTS_MAX_TEXT_CHARS} 个字符`, 413, requestId);

  const env = context.env || {};
  const limit = await enforceD1RateLimit(context, {
    limit: integerSetting(env.TTS_RATE_LIMIT, TTS_RATE_LIMIT, 1, 1_000), windowSeconds: TTS_RATE_WINDOW_SECONDS, scope: "tts",
  });
  if (!limit.allowed) return apiError("rate_limited", "语音请求过于频繁，请稍后再试", 429, requestId,
    { retryable: true, headers: { "Retry-After": "60" } });
  const cached = await readCachedAudio(env.WYJ_STORAGE, { language, text, voice }, requestId);
  if (cached) return cached;

  const mode = String(env.TTS_MODE || "azure").trim().toLowerCase();
  if (mode === "cache-only") return apiError("tts_unavailable", "云端语音暂时只提供已缓存音频，请稍后重试", 503, requestId, { retryable: true });
  if (mode !== "azure") return apiError("tts_not_configured", "云端语音服务配置无效，请联系管理员", 503, requestId);
  try { azureSpeechConfig(env); } catch (error) {
    return apiError(error.code, error.message, error.status, requestId, { retryable: false });
  }

  let bytes;
  let attempts = 0;
  for (let attempt = 0; attempt < TTS_GENERATION_ATTEMPTS; attempt += 1) {
    // F0 has 20 synthesis transactions/minute for the whole resource. Reuse
    // the existing rate-limit table; cache hits spend no provider budget.
    const providerLimit = await enforceD1RateLimit(context, {
      limit: integerSetting(env.TTS_AZURE_RATE_LIMIT, TTS_AZURE_RATE_LIMIT, 1, 1_000),
      windowSeconds: 60, scope: "tts-azure", subject: "azure-speech-resource",
    });
    if (providerLimit.degraded) return apiError("tts_unavailable", "云端语音限流服务暂时不可用，请稍后重试", 503, requestId, { retryable: true });
    if (!providerLimit.allowed) return apiError("tts_quota_exhausted", "云端语音请求速率受限，请稍后再试", 429, requestId,
      { retryable: true, headers: { "Retry-After": String(Math.max(1, 60 - Math.floor(Date.now() / 1_000) % 60)) } });
    attempts += 1;
    try { bytes = await synthesizeAzureSpeech(env, { text, language }); break; } catch (error) {
      // No retries for auth/quota/timeouts and no fallback provider/device.
      if (error.code === "tts_service_unavailable" && attempt + 1 < TTS_GENERATION_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, integerSetting(env.TTS_RETRY_BASE_MS, TTS_RETRY_BASE_MS, 0, 1_000)));
        continue;
      }
      return apiError(error.code, error.message, error.status, requestId, {
        retryable: error.retryable, headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {},
      });
    }
  }

  const key = await ttsCacheKey({ language, text, voice, model: azureTtsCacheModel(language) });
  if (env.WYJ_STORAGE?.put) await env.WYJ_STORAGE.put(key, bytes, {
    httpMetadata: { contentType: "audio/mpeg", cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { ttsProvider: "azure", ttsLocale: PROFILES[language].locale,
      ttsVoice: PROFILES[language].voice, ttsFormat: TTS_OUTPUT_FORMAT },
  }).catch(() => undefined);
  return audioResponse(bytes, { cacheHit: false, model: TTS_DEFAULT_MODEL,
    voice: PROFILES[language].voice, requestId, etag: key, attempts });
}

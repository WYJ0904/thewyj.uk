/** Shared Web/Android WebView cloud audio player. Device TTS is never used. */
export const CLOUD_TTS_PATH = "/api/tts";
export const CLOUD_TTS_VOICE = "default";
export const CLOUD_TTS_TIMEOUT_MS = 22_000;

export function normalizeSpeechLanguage(value) {
  const language = String(value || "").trim().toLowerCase();
  if (/^(?:ja(?:-|$)|jp$|jpn$|japanese$)/.test(language)) return "ja-JP";
  if (/^(?:zh(?:-|$)|chinese$|中文$)/.test(language)) return "zh-CN";
  return "en-US";
}

export function cloudSpeechLanguage(value) {
  return ({ "ja-JP": "jp", "zh-CN": "zh", "en-US": "en" })[normalizeSpeechLanguage(value)];
}

export function cloudSpeechUrl({ text, lang } = {}) {
  return `${CLOUD_TTS_PATH}?${new URLSearchParams({
    text: [...String(text ?? "")].slice(0, 240).join(""),
    language: cloudSpeechLanguage(lang), voice: CLOUD_TTS_VOICE,
    // Bypass old browser/CDN responses, including unverified Japanese audio.
    // The server can still reuse valid R2 objects with their original keys.
    v: "azure-neural-r1",
  })}`;
}

export function chooseSpeechEngine(globalObject = {}) {
  return typeof globalObject.Audio === "function" && typeof globalObject.fetch === "function" ? "cloud" : "none";
}

function failure(code, message, extra = {}) {
  return { ok: false, engine: "cloud", fallback: false, cloudFailed: true, code, message, ...extra };
}

function playCloud(globalObject, { text, language, speed }) {
  stopSpeech(globalObject);
  const audio = globalObject.__wyjCloudAudio || new globalObject.Audio();
  globalObject.__wyjCloudAudio = audio;
  const urls = globalObject.URL || URL;
  const controller = new AbortController();
  let blobUrl = "";
  let settled = false;
  let resolvePending;
  const pending = new Promise((resolve) => { resolvePending = resolve; });
  const current = () => globalObject.__wyjCloudPlayback === playback;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    audio.removeEventListener?.("playing", onPlaying);
    audio.removeEventListener?.("error", onError);
    resolvePending(result);
  };
  const release = () => {
    controller.abort();
    audio.removeEventListener?.("ended", release);
    if (blobUrl) { urls.revokeObjectURL(blobUrl); blobUrl = ""; }
    if (current()) delete globalObject.__wyjCloudPlayback;
  };
  const fail = (result) => { finish(result); release(); };
  function onPlaying() { finish({ ok: true, engine: "cloud", fallback: false, message: "" }); }
  function onError() { fail(failure("tts_playback_failed", "云端语音音频播放失败，请点击朗读重试。")); }
  const playback = {
    cancel() {
      finish({ ok: false, engine: "cloud", fallback: false, cancelled: true, code: "tts_cancelled", message: "" });
      release();
    },
  };
  globalObject.__wyjCloudPlayback = playback;
  const timer = setTimeout(() => fail(failure("tts_timeout", "云端语音服务响应超时，请稍后重试。")), CLOUD_TTS_TIMEOUT_MS);

  // Read the existing API's error envelope before starting audio so auth,
  // throttling and service errors remain visible on Web and Android alike.
  void (async () => {
    try {
      const response = await globalObject.fetch(cloudSpeechUrl({ text, lang: language }), {
        signal: controller.signal, credentials: "same-origin",
      });
      if (!current()) return;
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        if (!current()) return;
        fail(failure(payload.code || "tts_unavailable", payload.error || "云端语音服务暂时不可用，请稍后重试。", {
          httpStatus: response.status, retryable: payload.retryable === true,
          retryAfter: response.headers.get("Retry-After"),
        }));
        return;
      }
      if (!/^audio\/(?:mpeg|wav|ogg)(?:;|$)/i.test(response.headers.get("Content-Type") || "")) {
        fail(failure("tts_invalid_audio", "云端语音返回了无效音频，请稍后重试。"));
        return;
      }
      const blob = await response.blob();
      if (!current()) return;
      if (!blob.size) { fail(failure("tts_empty_audio", "云端语音没有返回音频，请稍后重试。")); return; }
      blobUrl = urls.createObjectURL(blob);
      audio.preload = "auto";
      audio.addEventListener?.("playing", onPlaying, { once: true });
      audio.addEventListener?.("error", onError, { once: true });
      audio.addEventListener?.("ended", release, { once: true });
      audio.src = blobUrl;
      audio.playbackRate = speed;
      const playing = audio.play();
      playing?.catch?.(() => { if (current()) onError(); });
    } catch (_) {
      if (current()) fail(failure("tts_unavailable", "无法连接云端语音服务，请检查网络后重试。"));
    }
  })();
  return pending;
}

// Keep the result/pending contract used by app.js and the Android WebView.
export function speakText(globalObject, { text, lang, rate } = {}) {
  const value = String(text || "").trim();
  if (!value) return { ok: false, engine: "none", message: "没有可朗读的内容。" };
  if (chooseSpeechEngine(globalObject) === "none") {
    return { ok: false, engine: "none", code: "tts_unavailable", message: "当前环境无法播放云端语音，请使用支持音频的浏览器后重试。" };
  }
  try {
    return { ok: true, engine: "cloud", message: "", pending: playCloud(globalObject, {
      text: value, language: normalizeSpeechLanguage(lang),
      speed: Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : 1,
    }) };
  } catch (_) { return failure("tts_playback_failed", "无法启动云端语音播放器，请稍后重试。"); }
}

export function stopSpeech(globalObject = {}) {
  globalObject.__wyjCloudPlayback?.cancel();
  try {
    const audio = globalObject.__wyjCloudAudio;
    audio?.pause?.();
    audio?.removeAttribute?.("src");
    audio?.load?.();
  } catch (_) { /* Best effort stopping of the cloud audio element. */ }
}

/** Test-only: release cloud playback resources. */
export function resetSpeechState(globalObject = {}) {
  stopSpeech(globalObject);
  delete globalObject.__wyjCloudAudio;
}

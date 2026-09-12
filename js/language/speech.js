/**
 * Dictation speech output (cross-device compatible).
 *
 * Normal online path: thewyj cloud TTS (`/api/tts`) → one server audio asset
 * per `{language, text, voice, version}`, played by the same HTML5 audio player
 * on browsers and inside the Android WebView. Speed is applied with
 * `playbackRate`, so changing the slider never re-synthesises and never depends
 * on a device voice package.
 *
 * Device engines are only an explicit offline fallback: Android system
 * `TextToSpeech` through the `thewyj://speech/*` bridge, or the browser Web
 * Speech API. A missing voice package - or a missing `speechSynthesis` - must
 * never be a prerequisite for normal dictation.
 */

export const CLOUD_TTS_PATH = "/api/tts";
export const CLOUD_TTS_VOICE = "default";

export function normalizeSpeechLanguage(value) {
  return String(value || "").toLowerCase().startsWith("ja") ? "ja-JP" : "en-US";
}

/** Cloud TTS language code (`en` / `jp`), server normalises aliases. */
export function cloudSpeechLanguage(value) {
  return String(value || "").toLowerCase().startsWith("ja") ? "jp" : "en";
}

export function cloudSpeechUrl({ text, lang } = {}) {
  const params = new URLSearchParams({
    text: String(text ?? "").slice(0, 240),
    language: cloudSpeechLanguage(lang),
    voice: CLOUD_TTS_VOICE,
    v: "1",
  });
  return `${CLOUD_TTS_PATH}?${params.toString()}`;
}

/**
 * Engine ladder. Cloud is the normal path whenever the runtime can play audio;
 * the device engines are labelled `*-offline` so every caller can tell the user
 * which path was actually used.
 */
export function chooseSpeechEngine(globalObject = {}, options = {}) {
  const online = options.online !== false;
  if (online && typeof globalObject.Audio === "function") return "cloud";
  if (options.native === true) return "native-offline";
  if (globalObject.speechSynthesis && typeof globalObject.SpeechSynthesisUtterance === "function") {
    return "web-offline";
  }
  return "none";
}

export function nativeSpeechUrl({ text, lang, rate } = {}) {
  const params = new URLSearchParams({
    text: String(text || "").slice(0, 200),
    lang: normalizeSpeechLanguage(lang),
    rate: String(Number(rate) || 1),
  });
  return `thewyj://speech/speak?${params.toString()}`;
}

function ensureAudio(globalObject) {
  const existing = globalObject.__wyjCloudAudio;
  if (existing && typeof existing.play === "function") return existing;
  const audio = new globalObject.Audio();
  audio.preload = "auto";
  globalObject.__wyjCloudAudio = audio;
  return audio;
}

/** One offline utterance through the device engine, used only after cloud failure. */
function speakOffline(globalObject, { text, language, speed, native }) {
  const engine = chooseSpeechEngine(globalObject, { native, online: false });
  if (engine === "native-offline") {
    try {
      // Only the native offline path may arm the `thewyj://speech/stop` bridge.
      globalObject.__wyjNativeSpeech = true;
      globalObject.console?.info?.("WYJ_SPEECH:offline-fallback");
      globalObject.location.href = nativeSpeechUrl({ text, lang: language, rate: speed });
      return { ok: true, engine, message: "云端语音暂时不可用，已改用本机离线语音。" };
    } catch (_) {
      return { ok: false, engine, message: "无法调用本机语音引擎，请检查系统文字转语音设置。" };
    }
  }
  if (engine === "web-offline") {
    try {
      const synth = globalObject.speechSynthesis;
      const utterance = new globalObject.SpeechSynthesisUtterance(text);
      utterance.lang = language;
      utterance.rate = speed;
      synth.cancel();
      synth.speak(utterance);
      return { ok: true, engine, message: "云端语音暂时不可用，已改用浏览器离线语音。" };
    } catch (_) {
      return { ok: false, engine, message: "浏览器离线语音朗读失败，请稍后重试。" };
    }
  }
  return {
    ok: false,
    engine: "none",
    message: "云端语音暂时不可用，且当前环境没有离线语音；请联网后重试。",
  };
}

function playCloud(globalObject, { text, language, speed, native }) {
  const audio = ensureAudio(globalObject);
  let settled = false;
  let failed = false;
  let resolvePending = () => {};
  const pending = new Promise((resolve) => {
    resolvePending = resolve;
  });
  const finish = (result) => {
    if (settled) return;
    settled = true;
    resolvePending(result);
  };

  const cleanup = () => {
    audio.removeEventListener?.("playing", onPlaying);
    audio.removeEventListener?.("error", onError);
  };
  function onPlaying() {
    cleanup();
    finish({ ok: true, engine: "cloud", fallback: false, message: "" });
  }
  function onError() {
    // `play()` rejects and the media element also fires `error`; the offline
    // fallback must run exactly once.
    if (failed || settled) return;
    failed = true;
    cleanup();
    const offline = speakOffline(globalObject, {
      text,
      language,
      speed,
      native: native === true,
    });
    finish({ ...offline, fallback: offline.ok, cloudFailed: true });
  }

  audio.addEventListener?.("playing", onPlaying, { once: true });
  audio.addEventListener?.("error", onError, { once: true });
  audio.pause?.();
  audio.currentTime = 0;
  audio.src = cloudSpeechUrl({ text, lang: language });
  audio.playbackRate = speed;
  try {
    const playResult = audio.play();
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch(() => onError());
    }
  } catch (_) {
    onError();
  }
  return pending;
}

/**
 * Speaks one dictation entry.
 *
 * Returns immediately with the engine that was started; `pending` resolves once
 * the cloud asset is actually playing, or - when the cloud path failed - with
 * the explicit offline fallback result so the UI can tell the user what
 * happened. Nothing here silently falls back without reporting it.
 */
export function speakText(globalObject, { text, lang, rate, native = false } = {}) {
  const value = String(text || "").trim();
  if (!value) return { ok: false, engine: "none", message: "没有可朗读的内容。" };
  const language = normalizeSpeechLanguage(lang);
  const speed = Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : 1;
  const engine = chooseSpeechEngine(globalObject, { native });
  if (engine === "cloud") {
    return {
      ok: true,
      engine,
      message: "",
      pending: playCloud(globalObject, { text: value, language, speed, native }),
    };
  }
  const offline = speakOffline(globalObject, { text: value, language, speed, native });
  return { ...offline, pending: Promise.resolve(offline) };
}

export function stopSpeech(globalObject = {}, { native = false } = {}) {
  try {
    const audio = globalObject.__wyjCloudAudio;
    if (audio) {
      audio.pause?.();
      audio.removeAttribute?.("src");
      audio.load?.();
    }
  } catch (_) {
    // Stopping is best effort.
  }
  try {
    if (native && globalObject.__wyjNativeSpeech === true) {
      globalObject.__wyjNativeSpeech = false;
      globalObject.location.href = "thewyj://speech/stop";
    }
  } catch (_) {
    // Same as above.
  }
  try {
    globalObject.speechSynthesis?.cancel?.();
  } catch (_) {
    // Same as above.
  }
}

/** Test-only: clear playback markers between cases. */
export function resetSpeechState(globalObject = {}) {
  globalObject.__wyjNativeSpeech = false;
  delete globalObject.__wyjCloudAudio;
}

/**
 * Speech output for dictation.
 *
 * Android WebView ships a Web Speech API stub that silently accepts
 * `speechSynthesis.speak()` without producing any audio. Inside the Android
 * app the page therefore asks the native TextToSpeech engine through the
 * existing `thewyj://speech/*` navigation channel; browsers keep using the Web
 * Speech API. Every path returns a user-readable result so the UI can explain
 * why nothing was played instead of failing silently.
 */

export function normalizeSpeechLanguage(value) {
  return String(value || "").toLowerCase().startsWith("ja") ? "ja-JP" : "en-US";
}

export function chooseSpeechEngine(globalObject = {}, options = {}) {
  if (options.native === true) return "native";
  if (globalObject.speechSynthesis && typeof globalObject.SpeechSynthesisUtterance === "function") return "web";
  return "none";
}

export function nativeSpeechUrl({ text, lang, rate } = {}) {
  const params = new URLSearchParams({
    text: String(text || "").slice(0, 200),
    lang: normalizeSpeechLanguage(lang),
    rate: String(Number(rate) || 0.9),
  });
  return `thewyj://speech/speak?${params.toString()}`;
}

export function speakText(globalObject, { text, lang, rate, native = false } = {}) {
  const value = String(text || "").trim();
  if (!value) return { ok: false, engine: "none", message: "没有可朗读的内容。" };
  const language = normalizeSpeechLanguage(lang);
  const speed = Number.isFinite(Number(rate)) && Number(rate) > 0 ? Number(rate) : 0.9;
  const engine = chooseSpeechEngine(globalObject, { native });
  if (engine === "native") {
    try {
      // The Android WebView intercepts this scheme and plays through the
      // system TextToSpeech engine; failures surface as a native notice.
      globalObject.location.href = nativeSpeechUrl({ text: value, lang: language, rate: speed });
      return { ok: true, engine, message: "" };
    } catch (_) {
      return { ok: false, engine, message: "无法调用系统语音引擎，请在系统设置中检查文字转语音服务。" };
    }
  }
  if (engine === "web") {
    try {
      const synth = globalObject.speechSynthesis;
      const utterance = new globalObject.SpeechSynthesisUtterance(value);
      utterance.lang = language;
      utterance.rate = speed;
      synth.cancel();
      synth.speak(utterance);
      return { ok: true, engine, message: "" };
    } catch (_) {
      return { ok: false, engine, message: "浏览器语音朗读失败，请检查系统语音引擎后重试。" };
    }
  }
  return {
    ok: false,
    engine: "none",
    message: "当前环境没有可用的语音引擎。请安装系统「文字转语音」服务，或使用 thewyj Android 应用。",
  };
}

export function stopSpeech(globalObject = {}, { native = false } = {}) {
  try {
    if (native) {
      globalObject.location.href = "thewyj://speech/stop";
    }
  } catch (_) {
    // Stopping is best effort; a missing engine must never break navigation.
  }
  try {
    if (globalObject.speechSynthesis && typeof globalObject.speechSynthesis.cancel === "function") {
      globalObject.speechSynthesis.cancel();
    }
  } catch (_) {
    // Same as above.
  }
}

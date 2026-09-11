/**
 * Per-language dictation speech rate.
 *
 * Range 0.5x – 1.5x in 0.1 steps, default 1.0x. English and Japanese keep
 * separate values so changing one never rewrites the other, and the value is
 * applied to the text-to-speech request (Android: setSpeechRate on the already
 * initialised engine; browsers: SpeechSynthesisUtterance.rate).
 */

export const SPEECH_RATE_MIN = 0.5;
export const SPEECH_RATE_MAX = 1.5;
export const SPEECH_RATE_STEP = 0.1;
export const SPEECH_RATE_DEFAULT = 1.0;

export function normalizeSpeechRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return SPEECH_RATE_DEFAULT;
  const clamped = Math.min(SPEECH_RATE_MAX, Math.max(SPEECH_RATE_MIN, numeric));
  return Math.round(clamped * 10) / 10;
}

export function speechRateStorageKey(language) {
  return String(language || "").toLowerCase().startsWith("ja")
    ? "wyjSpeechRateJapanese"
    : "wyjSpeechRateEnglish";
}

export function loadSpeechRate(storage, language) {
  try {
    const stored = storage?.getItem?.(speechRateStorageKey(language));
    if (stored === null || stored === undefined || stored === "") return SPEECH_RATE_DEFAULT;
    return normalizeSpeechRate(stored);
  } catch (_) {
    return SPEECH_RATE_DEFAULT;
  }
}

export function saveSpeechRate(storage, language, value) {
  const rate = normalizeSpeechRate(value);
  try {
    storage?.setItem?.(speechRateStorageKey(language), String(rate));
  } catch (_) {
    // Private browsing can reject writes; the in-memory value still applies.
  }
  return rate;
}

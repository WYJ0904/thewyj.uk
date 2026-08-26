export const TASK15_SCHEMA_VERSION = "1";
export const TASK15_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
export const TASK15_BUILD = "2026-08-26-task15-cloud-only";
export const QUIZ_SESSION_TTL_SECONDS = 2 * 60 * 60;
export const NORMAL_QUIZ_WORD_LIMIT = 15;
export const MAX_QUIZ_WORDS = 200;
export const MAX_WORD_LENGTH = 120;
export const MAX_AI_INPUT_CHARACTERS = 6000;
export const MAX_AI_OUTPUT_TOKENS = 512;
export const AI_TIMEOUT_MS = 18_000;
export const AI_RETRY_LIMIT = 1;
export const AI_USER_DAILY_LIMIT = 120;
export const AI_GLOBAL_DAILY_LIMIT = 3000;
export const AI_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

export class Task15Error extends Error {
  constructor(message, status = 400, code = "task15_invalid_request", retryable = false) {
    super(message);
    this.name = "Task15Error";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function isoNow(date = new Date()) {
  return date.toISOString();
}

export function cleanLanguage(value) {
  const language = String(value || "").trim().toLowerCase();
  if (!['english', 'japanese'].includes(language)) {
    throw new Task15Error("语言参数无效", 400, "language_invalid");
  }
  return language;
}

export function cleanWord(value, label = "单词") {
  const text = String(value || "").normalize("NFKC").trim();
  if (!text || text.length > MAX_WORD_LENGTH || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new Task15Error(`${label}格式无效`, 400, "word_invalid");
  }
  return text;
}

export function cleanWords(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_QUIZ_WORDS) {
    throw new Task15Error("词表数量无效", 400, "quiz_words_invalid");
  }
  return value.map((word) => cleanWord(word));
}

export function normalizeKana(value) {
  return Array.from(String(value || "").normalize("NFKC"), (character) => {
    const code = character.codePointAt(0);
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : character;
  }).join("");
}

export function normalizeWord(value, language) {
  const text = String(value || "").normalize("NFKC").trim().replace(/\s+/gu, "");
  return language === "english" ? text.toLocaleLowerCase("en") : normalizeKana(text);
}

export function normalizeMeaning(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/[，。；、,;!！?？：:\s]+/gu, "")
    .replace(/^(?:意思是|含义是|就是|是)/u, "");
}

export function isKanaOnly(value) {
  const text = String(value || "").normalize("NFKC").replace(/[\sー・]/gu, "");
  return Boolean(text) && /^[\u3041-\u3096\u30a1-\u30fa]+$/u.test(text);
}

export function requireAllowedFields(payload, allowed) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Task15Error("请求 JSON 格式无效", 400, "invalid_json");
  }
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) throw new Task15Error("请求包含不支持的字段", 400, "task15_fields_forbidden");
  }
}

export function hasLanguageEntitlement(account, language) {
  if (account?.is_super_admin) return true;
  const entitlements = new Set(Array.isArray(account?.entitlements) ? account.entitlements : []);
  return entitlements.has("all_features_access")
    || entitlements.has("language_all_access")
    || entitlements.has(`language_${language}_access`);
}

export function quizLimitFor(account, language) {
  return hasLanguageEntitlement(account, language) ? MAX_QUIZ_WORDS : NORMAL_QUIZ_WORD_LIMIT;
}

export function safeInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export const MAX_ACCEPTED_ANSWERS = 14;
export const MAX_RUBRIC_CACHE_ITEMS = 500;
export const MAX_JAPANESE_READING_CACHE_ITEMS = 2000;
export const DEFAULT_PROFILE = "我";
export const LANGUAGE_LABELS = Object.freeze({
  english: "英语",
  japanese: "日语",
});
export const PRACTICE_LABELS = Object.freeze({
  meaning: "释义",
  dictation: "听写",
});

export function limitText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

export function normalizeMeaning(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：,.!?;:（）()\[\]{}<>《》"“”‘’·•/\\|]/g, "");
}

export function splitMeanings(value) {
  return String(value || "")
    .split(/[\/、，,；;：:|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function semanticMeaningForms(value) {
  const forms = new Set([normalizeMeaning(value)]);
  let changed = true;
  while (changed) {
    changed = false;
    [...forms].forEach((form) => {
      const additions = [];
      if (form.length > 1 && "的地得".includes(form[form.length - 1])) additions.push(form.slice(0, -1));
      if (form.length >= 3 && form.startsWith("有")) additions.push(form.slice(1));
      if (form.length >= 3 && form.endsWith("性")) additions.push(form.slice(0, -1));
      additions.forEach((item) => {
        if (item && !forms.has(item)) {
          forms.add(item);
          changed = true;
        }
      });
    });
  }
  forms.delete("");
  return forms;
}

export function meaningBigrams(value) {
  const normalized = normalizeMeaning(value);
  if (normalized.length < 2) return normalized ? new Set([normalized]) : new Set();
  return new Set(Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2)));
}

export function meaningSimilarity(left, right) {
  const a = meaningBigrams(left);
  const b = meaningBigrams(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / new Set([...a, ...b]).size;
}

export function sanitizeAccepted(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  values.slice(0, MAX_ACCEPTED_ANSWERS).forEach((item) => {
    const value = limitText(item);
    const key = normalizeMeaning(value);
    if (value && key && !seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  });
  return result;
}

export function sanitizeStoredRubric(value, fallbackGloss = "", fallbackAccepted = []) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    language: limitText(source.language, 40),
    gloss: limitText(source.gloss || fallbackGloss),
    accepted: sanitizeAccepted(source.accepted || fallbackAccepted),
    notes: limitText(source.notes),
    reading: limitText(source.reading, 80),
  };
}

export function sanitizeQuestionFeedback(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const type = value.type === "skipped" ? "skipped" : "answer";
  return {
    type,
    correct: type === "skipped" ? false : Boolean(value.correct),
    gloss: limitText(value.gloss) || "（未给出）",
    accepted: sanitizeAccepted(value.accepted),
    kind: value.kind === "dictation" ? "dictation" : "meaning",
    ai_review: Boolean(value.ai_review),
  };
}

export function sanitizePendingAdvance(value, runtime = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const questionIndex = Number.parseInt(value.questionIndex, 10);
  const dueAt = Number(value.dueAt);
  const words = Array.isArray(runtime.words) ? runtime.words : [];
  const roundId = limitText(value.roundId, 100);
  const expectedRoundId = limitText(runtime.roundId, 100);
  const feedback = sanitizeQuestionFeedback(value.feedback);
  if (
    !feedback
    || !Number.isInteger(questionIndex)
    || questionIndex < 0
    || questionIndex >= words.length
    || !Number.isFinite(dueAt)
    || dueAt <= 0
    || (expectedRoundId && roundId !== expectedRoundId)
  ) return null;
  return {
    id: limitText(value.id, 160) || `${roundId}:${questionIndex}:${Math.round(dueAt)}`,
    roundId,
    questionIndex,
    dueAt,
    feedback,
  };
}

export function trimRubricCache(cache) {
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) return {};
  return Object.fromEntries(Object.entries(cache).slice(-MAX_RUBRIC_CACHE_ITEMS));
}

export function normalizeJapaneseReading(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "").trim();
}

export function isJapaneseReading(value) {
  return /^[\u3040-\u30ff\u31f0-\u31ffー・]+$/u.test(normalizeJapaneseReading(value));
}

export function sanitizeJapaneseReadings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const cleaned = {};
  Object.entries(value).forEach(([word, reading]) => {
    const cleanWord = limitText(word, 64);
    const cleanReading = normalizeJapaneseReading(reading).slice(0, 64);
    if (cleanWord && isJapaneseReading(cleanReading)) cleaned[cleanWord] = cleanReading;
  });
  return Object.fromEntries(Object.entries(cleaned).slice(-MAX_JAPANESE_READING_CACHE_ITEMS));
}

export function sanitizeJapaneseWrittenForms(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const cleaned = {};
  Object.entries(value).forEach(([word, written]) => {
    const cleanWord = limitText(word, 64);
    const cleanWritten = limitText(written, 64);
    if (
      cleanWord
      && cleanWritten
      && /^[\u3040-\u30ff\u31f0-\u31ff\u3400-\u9fff々〆ヶー・]+$/u.test(cleanWord)
      && /^[\u3040-\u30ff\u31f0-\u31ff\u3400-\u9fff々〆ヶー・]+$/u.test(cleanWritten)
    ) cleaned[cleanWord] = cleanWritten;
  });
  return Object.fromEntries(Object.entries(cleaned).slice(-MAX_JAPANESE_READING_CACHE_ITEMS));
}

export function sanitizeProfile(value) {
  const cleaned = String(value || "").trim().slice(0, 30);
  return cleaned || DEFAULT_PROFILE;
}

export function profileStorageName(profile) {
  return encodeURIComponent(sanitizeProfile(profile));
}

export function normalizeQuizLanguage(value) {
  if (value === "english" || value === "japanese") return value;
  return "";
}

export function quizLanguageLabel(language) {
  return LANGUAGE_LABELS[language] || "未选语言";
}

export function normalizePracticeMode(value) {
  return value === "dictation" ? "dictation" : "meaning";
}

export function practiceModeLabel(mode) {
  return PRACTICE_LABELS[mode] || "释义";
}

export function wordMatchesLanguage(word, language) {
  const value = String(word || "").trim();
  if (!value) return false;
  if (language === "english") return /^[A-Za-z][A-Za-z'-]*$/.test(value);
  if (language === "japanese") return /[\u3040-\u30ff\u3400-\u9fff々〆ヶ]/u.test(value);
  return true;
}

export function filterWordsByLanguage(words, language) {
  return words.filter((word) => wordMatchesLanguage(word, language));
}

export function hasJapaneseKanji(value) {
  return /[\u3400-\u9fff々〆ヶ]/u.test(String(value || ""));
}

export function normalizeKana(value) {
  return [...normalizeJapaneseReading(value)].map((character) => {
    const code = character.charCodeAt(0);
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : character;
  }).join("");
}

export function normalizeDictationAnswer(value, language) {
  const normalized = String(value || "").normalize("NFKC").trim();
  if (language === "english") return normalized.toLowerCase().replace(/\s+/g, " ");
  return normalized.replace(/\s+/g, "");
}

export function japaneseReadingFor(word, readings = {}) {
  const cleanWord = String(word || "").trim();
  if (readings[cleanWord]) return readings[cleanWord];
  return isJapaneseReading(cleanWord) ? normalizeJapaneseReading(cleanWord) : "";
}

export function japaneseWrittenFormFor(word, writtenForms = {}) {
  const cleanWord = String(word || "").trim();
  return writtenForms[cleanWord] || cleanWord;
}

export function japaneseDictationRequiresBoth(word, readings = {}, writtenForms = {}) {
  const written = japaneseWrittenFormFor(word, writtenForms);
  const reading = japaneseReadingFor(word, readings);
  return Boolean(hasJapaneseKanji(written) && reading && normalizeKana(written) !== normalizeKana(reading));
}

export function formatJapaneseDictationAnswer(word, readings = {}, writtenForms = {}) {
  const written = japaneseWrittenFormFor(word, writtenForms);
  const reading = japaneseReadingFor(word, readings);
  return japaneseDictationRequiresBoth(word, readings, writtenForms)
    ? `${written} / ${reading}`
    : (written || reading || word);
}

export function evaluateDictation(word, answer, options = {}) {
  const language = normalizeQuizLanguage(options.language) || "english";
  const readings = options.readings || {};
  const writtenForms = options.writtenForms || {};
  const expectedWord = normalizeDictationAnswer(word, language);
  const student = normalizeDictationAnswer(answer, language);
  if (language !== "japanese") {
    return { correct: expectedWord === student, expected: word, guidance: "" };
  }

  const written = japaneseWrittenFormFor(word, writtenForms);
  const reading = japaneseReadingFor(word, readings);
  if (!reading || !written) {
    return { correct: false, expected: word, guidance: "未能取得该词的完整写法，请返回词表后重试" };
  }

  const compact = student.replace(/[\/、，,；;：:|｜=＝·・]/g, "");
  const normalizedCompact = normalizeKana(compact);
  const normalizedWritten = normalizeKana(normalizeDictationAnswer(written, language));
  const normalizedReading = normalizeKana(reading);
  const requiresBoth = japaneseDictationRequiresBoth(word, readings, writtenForms);
  const correct = requiresBoth
    ? normalizedCompact === `${normalizedWritten}${normalizedReading}`
      || normalizedCompact === `${normalizedReading}${normalizedWritten}`
    : [expectedWord, normalizedWritten, normalizedReading]
      .map((item) => normalizeKana(item))
      .includes(normalizedCompact);
  const guidance = correct
    ? ""
    : requiresBoth
      ? `请同时填写汉字“${written}”和假名“${reading}”`
      : `正确写法是“${written || reading || word}”`;
  return {
    correct,
    expected: formatJapaneseDictationAnswer(word, readings, writtenForms),
    guidance,
  };
}

export function evaluateLocalMeaning(word, answer, info, options = {}) {
  const gloss = limitText(info && info.correct_answer) || "（未给出释义）";
  const accepted = sanitizeAccepted(info && info.accepted);
  const language = normalizeQuizLanguage(options.language);
  const gradingMode = ["strict", "normal", "lenient"].includes(options.gradingMode)
    ? options.gradingMode
    : "normal";
  const pool = [...new Set([gloss, ...accepted].flatMap(splitMeanings))];
  const student = normalizeMeaning(answer);
  let correct = false;
  if (student) {
    const studentForms = semanticMeaningForms(student);
    correct = pool.some((item) => {
      const expected = normalizeMeaning(item);
      if (!expected) return false;
      const expectedForms = semanticMeaningForms(expected);
      if ([...studentForms].some((form) => expectedForms.has(form))) return true;
      if (gradingMode === "strict") return false;
      if (student.length >= 3 && expected.length >= 3 && (student.includes(expected) || expected.includes(student))) return true;
      return Math.min(student.length, expected.length) >= 3 && meaningSimilarity(student, expected) >= 0.67;
    });
  }
  return {
    correct,
    gloss,
    accepted,
    rubric: { language: quizLanguageLabel(language), gloss, accepted, notes: "本地错题复习" },
    kind: "local-review",
    ai_review: false,
    grading_mode: gradingMode,
    word,
    answer,
  };
}

export function parseWordTextModel(value, language = "") {
  const words = [];
  const readings = {};
  const writtenForms = {};
  String(value || "").split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    const pair = language === "japanese" ? line.match(/^(.+?)\s*[|｜=＝]\s*([^|｜=＝]+)$/u) : null;
    if (pair) {
      const word = pair[1].trim();
      const reading = normalizeJapaneseReading(pair[2]);
      if (wordMatchesLanguage(word, "japanese") && isJapaneseReading(reading)) {
        words.push(word);
        readings[word] = reading;
        writtenForms[word] = word;
        return;
      }
    }
    line.split(/[\s,，、;；]+/).map((word) => word.trim()).filter(Boolean).forEach((word) => words.push(word));
  });
  return { words, readings, writtenForms };
}

export function wordIdentity(word, language = "") {
  const normalized = String(word || "").normalize("NFKC").trim();
  return language === "english" ? normalized.toLocaleLowerCase("en") : normalized;
}

export function analyzeWordList(words, language = "") {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  let duplicates = 0;
  (Array.isArray(words) ? words : []).forEach((item) => {
    const word = limitText(item, 240);
    if (!word) return;
    if (language && !wordMatchesLanguage(word, language)) {
      invalid.push(word);
      return;
    }
    const key = wordIdentity(word, language);
    if (seen.has(key)) {
      duplicates += 1;
      return;
    }
    seen.add(key);
    valid.push(word);
  });
  return { valid, invalid, duplicates };
}

export function formatWordsForInput(words) {
  return words.join("\n");
}

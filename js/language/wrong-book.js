import {
  limitText,
  normalizeQuizLanguage,
  sanitizeAccepted,
  sanitizeStoredRubric,
  wordMatchesLanguage,
} from "./quiz.js?v=20260824-task14-production-r2";

export const MAX_WRONG_BOOK_ITEMS = 250;

export function sanitizeWrongBook(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const cleaned = {};
  Object.entries(value)
    .slice(-MAX_WRONG_BOOK_ITEMS)
    .forEach(([word, info]) => {
      if (!info || typeof info !== "object" || Array.isArray(info)) return;
      const key = limitText(word, 240);
      if (!key) return;
      const count = Number.parseInt(info.wrong_count, 10);
      const language = normalizeQuizLanguage(info.language) || (wordMatchesLanguage(key, "english") ? "english" : "japanese");
      const questionType = info.question_type === "dictation" ? "dictation" : "meaning";
      const gradingMode = ["strict", "normal", "lenient"].includes(info.grading_mode) ? info.grading_mode : "normal";
      const correctAnswer = limitText(info.correct_answer);
      const accepted = sanitizeAccepted(info.accepted);
      cleaned[key] = {
        wrong_count: Number.isFinite(count) ? Math.max(0, Math.min(9999, count)) : 0,
        last_answer: limitText(info.last_answer),
        original_answer: limitText(info.original_answer || info.last_answer),
        correct_answer: correctAnswer,
        accepted,
        skipped: Boolean(info.skipped),
        last_time: limitText(info.last_time, 80),
        question_type: questionType,
        language,
        grading_mode: gradingMode,
        round_id: limitText(info.round_id, 100),
        rubric: sanitizeStoredRubric(info.rubric, correctAnswer, accepted),
        rejudged_at: limitText(info.rejudged_at, 80),
        rejudge_result: ["correct", "incorrect"].includes(info.rejudge_result) ? info.rejudge_result : "",
        rejudge_reason: limitText(info.rejudge_reason),
      };
    });
  return cleaned;
}

export function mergeWrongBooks(current, incoming) {
  const merged = { ...sanitizeWrongBook(current) };
  Object.entries(sanitizeWrongBook(incoming)).forEach(([word, info]) => {
    const previous = merged[word] || {};
    delete merged[word];
    merged[word] = {
      ...previous,
      ...info,
      wrong_count: Math.max(previous.wrong_count || 0, info.wrong_count || 0),
      correct_answer: info.correct_answer || previous.correct_answer || "",
      accepted: info.accepted.length ? info.accepted : previous.accepted || [],
    };
  });
  return sanitizeWrongBook(merged);
}

export function filterWrongBookByLanguage(book, language) {
  if (!language) return {};
  return Object.fromEntries(Object.entries(book || {}).filter(([word]) => wordMatchesLanguage(word, language)));
}

export function removeLanguageFromWrongBook(book, language) {
  return Object.fromEntries(Object.entries(book || {}).filter(([word]) => !wordMatchesLanguage(word, language)));
}

export function updateWrongEntry(book, word, answer, gloss, accepted, context = {}) {
  const current = book[word] || { wrong_count: 0 };
  delete book[word];
  book[word] = {
    wrong_count: (current.wrong_count || 0) + 1,
    last_answer: answer,
    original_answer: answer,
    correct_answer: gloss,
    accepted: accepted || [],
    skipped: Boolean(context.skipped),
    last_time: new Date().toLocaleString(),
    question_type: context.questionType === "dictation" ? "dictation" : "meaning",
    language: normalizeQuizLanguage(context.language),
    grading_mode: ["strict", "normal", "lenient"].includes(context.gradingMode) ? context.gradingMode : "normal",
    round_id: limitText(context.roundId, 100),
    rubric: sanitizeStoredRubric(context.rubric, gloss, accepted),
    rejudged_at: "",
    rejudge_result: "",
    rejudge_reason: "",
  };
  return book[word];
}

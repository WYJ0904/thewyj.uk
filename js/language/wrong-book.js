import {
  limitText,
  normalizeQuizLanguage,
  sanitizeAccepted,
  sanitizeStoredRubric,
  wordMatchesLanguage,
} from "./quiz.js?v=20261031-aeris-task26-p0";
import { sanitizeWrongReview, mergeWrongReview, mergeWrongCounts } from './wrong-review.js?v=20261031-aeris-task26-p0';

export const MAX_WRONG_BOOK_ITEMS = 250;

export function wrongEntryWord(key, info = {}) {
  return limitText(info.word || (key.startsWith('@wr1:') ? key.split(':').slice(3).join(':') : key), 240);
}
export function wrongEntryKey(word, language, questionType = 'meaning',book=null) {
  const existing=book&&findWrongEntry(book,word,language,questionType);
  if(existing)return existing.key;
  return questionType === 'dictation'||book&&Object.hasOwn(book,word) ? `@wr1:${language}:${questionType}:${word}` : word;
}
export function wrongReviewId(word,language,questionType,id='') {
  const prefix=`v1:${language}:${questionType}:${word.length}:${word}:`;
  return id.startsWith(prefix)?id.slice(0,320):prefix+(/^[0-9a-f-]{36}$/i.test(id)?id:'legacy');
}
export function findWrongEntry(book, word, language, questionType = 'meaning') {
  const entry=Object.entries(book||{}).find(([key,info])=>info&&wrongEntryWord(key,info)===word&&info.language===language&&info.question_type===questionType);
  return entry?{key:entry[0],info:entry[1]}:null;
}

export function sanitizeWrongBook(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const cleaned = {};
  Object.entries(value)
    .slice(-MAX_WRONG_BOOK_ITEMS)
    .forEach(([word, info]) => {
      if (!info || typeof info !== "object" || Array.isArray(info)) return;
      const term = wrongEntryWord(word,info);
      if (!term) return;
      const count = Number.parseInt(info.wrong_count, 10);
      const language = normalizeQuizLanguage(info.language) || (wordMatchesLanguage(term, "english") ? "english" : "japanese");
      const questionType = info.question_type === "dictation" ? "dictation" : "meaning";
      // Preserve existing storage/sync IDs; only new colliding variants need a
      // typed key. Moving a legacy dictation key would break its tombstone.
      const key = limitText(word,300);
      const gradingMode = ["strict", "normal", "lenient"].includes(info.grading_mode) ? info.grading_mode : "normal";
      const correctAnswer = limitText(info.correct_answer);
      const accepted = sanitizeAccepted(info.accepted);
      const rubric=sanitizeStoredRubric(info.rubric,correctAnswer,accepted);
      if(questionType==='dictation'&&language==='japanese'&&!rubric.reading){
        const pieces=correctAnswer.split(/\s*[\/|｜]\s*/);
        if(pieces.includes(term))rubric.reading=pieces.find(piece=>/^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(piece))||'';
      }
      cleaned[key] = {
        word: term,
        review_id: wrongReviewId(term,language,questionType,limitText(info.review_id,320)),
        review: sanitizeWrongReview({...info.review,base_wrong_count:info.review?.base_wrong_count??Math.max(0,(Number.isFinite(count)?count:0)-(Array.isArray(info.review?.events)?info.review.events:[]).filter(event=>event?.correct===false&&event.kind!=='correction').length)}),
        wrong_count: Number.isFinite(count) ? Math.max(0, Math.min(9999, count)) : 0,
        last_answer: limitText(info.last_answer),
        original_answer: limitText(info.original_answer || info.last_answer),
        correct_answer: correctAnswer,
        accepted,
        skipped: Boolean(info.skipped),
        last_time: limitText(info.last_time, 80),
        review_updated_at: limitText(info.review_updated_at,80),
        question_type: questionType,
        language,
        grading_mode: gradingMode,
        round_id: limitText(info.round_id, 100),
        rubric,
        rejudged_at: limitText(info.rejudged_at, 80),
        rejudge_result: ["correct", "incorrect"].includes(info.rejudge_result) ? info.rejudge_result : "",
        rejudge_reason: limitText(info.rejudge_reason),
      };
    });
  return cleaned;
}

export function mergeWrongBooks(current, incoming) {
  const merged = { ...sanitizeWrongBook(current) };
  Object.entries(sanitizeWrongBook(incoming)).forEach(([incomingKey, info]) => {
    const existing=findWrongEntry(merged,info.word,info.language,info.question_type);
    const word=existing?.key||(Object.hasOwn(merged,incomingKey)?wrongEntryKey(info.word,info.language,info.question_type,merged):incomingKey);
    const previous = merged[word] || {};
    delete merged[word];
    merged[word] = {
      ...previous,
      ...info,
      wrong_count: mergeWrongCounts(previous,info),
      correct_answer: info.correct_answer || previous.correct_answer || "",
      accepted: info.accepted.length ? info.accepted : previous.accepted || [],
      review: previous.review_id === info.review_id ? mergeWrongReview(previous.review,info.review) : info.review,
    };
  });
  return sanitizeWrongBook(merged);
}

export function filterWrongBookByLanguage(book, language) {
  if (!language) return {};
  return Object.fromEntries(Object.entries(book || {}).filter(([key,info]) => info.language === language && wordMatchesLanguage(wrongEntryWord(key,info), language)));
}

export function removeLanguageFromWrongBook(book, language) {
  return Object.fromEntries(Object.entries(book || {}).filter(([key,info]) => (info.language || (wordMatchesLanguage(wrongEntryWord(key,info),language) ? language : '')) !== language));
}

export function updateWrongEntry(book, word, answer, gloss, accepted, context = {}) {
  const language = normalizeQuizLanguage(context.language);
  const questionType = context.questionType === 'dictation' ? 'dictation' : 'meaning';
  const key = wrongEntryKey(word,language,questionType,book);
  const current = book[key] || { wrong_count: 0 };
  if (context.event && current.review?.events?.some(e => e.id === context.event.id)) return current;
  delete book[key];
  book[key] = {
    word,
    review_id: wrongReviewId(word,language,questionType,current.review_id || context.reviewId || globalThis.crypto.randomUUID()),
    review: mergeWrongReview(current.review, {version:1,algorithm:'wrong-review-v1',events:context.event ? [context.event] : []}),
    wrong_count: (current.wrong_count || 0) + 1,
    last_answer: answer,
    original_answer: answer,
    correct_answer: gloss,
    accepted: accepted || [],
    skipped: Boolean(context.skipped),
    last_time: context.event?.at || new Date().toISOString(),
    review_updated_at: context.event?.at || current.review_updated_at || '',
    question_type: context.questionType === "dictation" ? "dictation" : "meaning",
    language: normalizeQuizLanguage(context.language),
    grading_mode: ["strict", "normal", "lenient"].includes(context.gradingMode) ? context.gradingMode : "normal",
    round_id: limitText(context.roundId, 100),
    rubric: sanitizeStoredRubric(context.rubric, gloss, accepted),
    rejudged_at: "",
    rejudge_result: "",
    rejudge_reason: "",
  };
  return book[key];
}

import { sha256Hex } from "./cloudflare-foundation.mjs";
import { runStructuredAi } from "./task15-ai.mjs";
import {
  MAX_QUIZ_WORDS,
  QUIZ_SESSION_TTL_SECONDS,
  TASK15_SCHEMA_VERSION,
  Task15Error,
  cleanLanguage,
  cleanWord,
  cleanWords,
  isKanaOnly,
  isoNow,
  normalizeKana,
  normalizeMeaning,
  normalizeWord,
  quizLimitFor,
  safeInteger,
} from "./task15-model.mjs";
import {
  COMMON_JAPANESE_FORMS,
  COMMON_RUBRICS,
  searchVocabulary,
  vocabularyLevelExists,
  vocabularyLevelLabel,
} from "./task15-vocabulary.mjs";

const ACCEPTED_LIMIT = 14;
const RUBRIC_TEXT_LIMIT = 240;
const SURRENDER = new Set(["不知道", "我不知道", "不清楚", "我不清楚", "不会", "我不会", "忘了", "不记得", "?", "？", "??", "？？", "???", "？？？"]);
const CONFLICT_GROUPS = [
  ["我", "俺", "本人", "自己"], ["我们", "咱", "咱们"], ["你", "您"], ["他"], ["她"], ["它"],
  ["上", "上面", "上方", "向上"], ["下", "下面", "下方", "向下"],
  ["左", "左边", "左侧", "向左"], ["右", "右边", "右侧", "向右"],
  ["来", "过来", "到来"], ["去", "过去", "离开"], ["买", "购买"], ["卖", "出售"],
  ["开", "打开", "开启"], ["关", "关闭", "关上"], ["有", "存在"], ["没有", "无", "不存在"],
  ["开心", "高兴", "快乐", "愉快", "愉悦"], ["难过", "伤心", "悲伤", "悲哀"],
  ["大", "巨大", "庞大"], ["小", "微小"], ["快", "快速", "迅速"], ["慢", "缓慢"],
  ["重要", "关键"], ["普通", "一般", "平常"], ["花", "花朵", "花儿", "花卉", "植物的花"],
].map((items) => new Set(items.map(normalizeMeaning)));

function requireDatabase(db) {
  if (!db?.prepare) throw new Task15Error("云端学习服务暂时不可用", 503, "dependency_unavailable", true);
  return db;
}

function cleanAccepted(values) {
  const output = [];
  const seen = new Set();
  for (const item of Array.isArray(values) ? values : []) {
    const text = String(item || "").normalize("NFKC").trim().slice(0, RUBRIC_TEXT_LIMIT);
    const key = normalizeMeaning(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key); output.push(text);
    if (output.length >= ACCEPTED_LIMIT) break;
  }
  return output;
}

function cleanReading(value) {
  const reading = String(value || "").normalize("NFKC").replace(/\s+/gu, "").slice(0, 64);
  return /^[\u3040-\u30ff\u31f0-\u31ffー・]+$/u.test(reading) ? reading : "";
}

function cleanWritten(value) {
  const written = String(value || "").normalize("NFKC").replace(/\s+/gu, "").slice(0, 64);
  return /^[\u3040-\u30ff\u31f0-\u31ff\u3400-\u9fff々〆ヶー・]+$/u.test(written) ? written : "";
}

function rubricLanguage(word) {
  return /^[A-Za-z][A-Za-z' -]*$/u.test(word) ? "英语" : "日语";
}

export function sanitizeRubric(value, word = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const gloss = String(value.gloss || "").normalize("NFKC").trim().slice(0, RUBRIC_TEXT_LIMIT);
  if (!gloss || /[\u3040-\u30ff\u31f0-\u31ff]/u.test(gloss)) return null;
  return {
    language: String(value.language || rubricLanguage(word)).trim().slice(0, 40),
    gloss,
    accepted: cleanAccepted(value.accepted),
    notes: String(value.notes || "").trim().slice(0, RUBRIC_TEXT_LIMIT),
    reading: rubricLanguage(word) === "日语" ? cleanReading(value.reading) : "",
  };
}

export async function ensureTask15Schema(db) {
  if (!db?.prepare) return false;
  const row = await db.prepare("SELECT value FROM task15_metadata WHERE key = ?1")
    .bind("schema_version").first();
  return String(row?.value || "") === TASK15_SCHEMA_VERSION;
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function createQuizSession(db, account, languageValue, wordsValue) {
  const language = cleanLanguage(languageValue);
  const unique = [];
  const seen = new Set();
  for (const word of cleanWords(wordsValue)) {
    const key = normalizeWord(word, language);
    if (!seen.has(key)) { seen.add(key); unique.push(word); }
  }
  const limit = quizLimitFor(account, language);
  if (unique.length > limit) {
    throw new Task15Error(`当前账户每次最多测试 ${limit} 个单词，请开通会员`, 403, "membership_required");
  }
  const token = randomToken();
  const digest = await sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + QUIZ_SESSION_TTL_SECONDS * 1000);
  await requireDatabase(db).batch([
    db.prepare("DELETE FROM task15_quiz_sessions WHERE expires_at <= ?1").bind(isoNow(now)),
    db.prepare(`INSERT INTO task15_quiz_sessions (
      token_digest, user_id, language, words_json, word_count, created_at, expires_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
      .bind(digest, account.id, language, JSON.stringify(unique), unique.length, isoNow(now), isoNow(expiresAt)),
  ]);
  return { token, words: unique, limit };
}

export async function validateQuizSession(db, account, token, wordsValue, expectedLanguage = "") {
  const tokenText = String(token || "");
  if (!tokenText || tokenText.length > 100) {
    throw new Task15Error("测试授权已失效，请重新开始测试", 403, "quiz_session_invalid");
  }
  const row = await requireDatabase(db).prepare(`SELECT * FROM task15_quiz_sessions
    WHERE token_digest = ?1 AND user_id = ?2`).bind(await sha256Hex(tokenText), account.id).first();
  if (!row || Date.parse(row.expires_at) <= Date.now()) {
    throw new Task15Error("测试授权已失效，请重新开始测试", 403, "quiz_session_invalid");
  }
  const language = cleanLanguage(row.language);
  if (expectedLanguage && language !== expectedLanguage) {
    throw new Task15Error("测试语言与请求不一致", 400, "language_invalid");
  }
  const currentLimit = quizLimitFor(account, language);
  if (Number(row.word_count) > currentLimit) {
    throw new Task15Error("会员权限已变化，请重新开始测试", 403, "membership_required");
  }
  let storedWords;
  try {
    storedWords = JSON.parse(String(row.words_json || "[]"));
  } catch (_) {
    throw new Task15Error("测试授权数据无效，请重新开始测试", 409, "quiz_session_corrupt");
  }
  if (!Array.isArray(storedWords) || storedWords.length !== Number(row.word_count)) {
    throw new Task15Error("测试授权数据无效，请重新开始测试", 409, "quiz_session_corrupt");
  }
  const authorized = new Set(storedWords.map((word) => normalizeWord(word, language)));
  const words = (Array.isArray(wordsValue) ? wordsValue : [wordsValue]).map((word) => cleanWord(word));
  if (words.some((word) => !authorized.has(normalizeWord(word, language)))) {
    throw new Task15Error("单词不在本轮测试中", 403, "word_not_authorized");
  }
  return { language, words: storedWords, count: Number(row.word_count) };
}

const RUBRIC_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    gloss: { type: "string", maxLength: RUBRIC_TEXT_LIMIT },
    accepted: { type: "array", items: { type: "string", maxLength: RUBRIC_TEXT_LIMIT }, maxItems: ACCEPTED_LIMIT },
    notes: { type: "string", maxLength: RUBRIC_TEXT_LIMIT },
    reading: { type: "string", maxLength: 64 },
  },
  required: ["gloss", "accepted", "notes", "reading"],
  additionalProperties: false,
});

export async function buildRubric(context, account, wordValue) {
  const word = cleanWord(wordValue);
  const common = COMMON_RUBRICS[word] || COMMON_RUBRICS[normalizeWord(word, "english")];
  if (common) return { rubric: { ...common, accepted: [...common.accepted] }, source: "local" };
  const language = rubricLanguage(word);
  const normalizedInput = { language, word: normalizeWord(word, language === "英语" ? "english" : "japanese") };
  const response = await runStructuredAi(context, {
    account,
    taskType: "rubric",
    normalizedInput,
    schema: RUBRIC_SCHEMA,
    validate: (value) => Boolean(sanitizeRubric(value, word)),
    messages: [
      { role: "system", content: "你是外语词汇测验老师。给定英语或日语词，输出最常用且适合中文学习者的中文释义。accepted 只列常见中文同义答案；日语 reading 给标准假名，英语留空。不要重复原词，只输出符合 schema 的 JSON。" },
      { role: "user", content: JSON.stringify({ language, word }) },
    ],
  });
  return { rubric: sanitizeRubric(response.result, word), source: response.cacheHit ? "cache" : "workers_ai" };
}

const READINGS_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    forms: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          word: { type: "string", maxLength: 64 },
          reading: { type: "string", maxLength: 64 },
          written: { type: "string", maxLength: 64 },
        },
        required: ["word", "reading", "written"],
        additionalProperties: false,
      },
    },
  },
  required: ["forms"],
  additionalProperties: false,
});

function validFormsResult(value, expected) {
  if (!Array.isArray(value?.forms) || value.forms.length !== expected.length) return false;
  const expectedSet = new Set(expected);
  const returned = new Set();
  return value.forms.every((item) => {
    const word = String(item?.word || "");
    if (!expectedSet.has(word) || returned.has(word)) return false;
    returned.add(word);
    return Boolean(cleanReading(item.reading) && cleanWritten(item.written));
  });
}

export async function resolveJapaneseForms(context, account, wordsValue) {
  const words = [];
  const seen = new Set();
  for (const item of Array.isArray(wordsValue) ? wordsValue.slice(0, MAX_QUIZ_WORDS) : []) {
    const word = cleanWord(item);
    if (!seen.has(word)) { seen.add(word); words.push(word); }
  }
  if (!words.length) throw new Task15Error("日语词表格式无效", 400, "words_invalid");
  const readings = {};
  const writtenForms = {};
  const missing = [];
  for (const word of words) {
    const common = COMMON_JAPANESE_FORMS[word];
    if (common) {
      readings[word] = common[0]; writtenForms[word] = common[1];
    } else if (isKanaOnly(word)) {
      readings[word] = normalizeKana(word);
      missing.push(word);
    } else {
      writtenForms[word] = word;
      missing.push(word);
    }
  }
  let aiUnavailable = false;
  if (missing.length) {
    try {
      const response = await runStructuredAi(context, {
        account,
        taskType: "readings",
        normalizedInput: { words: missing.map((word) => normalizeWord(word, "japanese")) },
        schema: READINGS_SCHEMA,
        validate: (value) => validFormsResult(value, missing),
        messages: [
          { role: "system", content: "为日语词补全标准假名 reading 和常用 written 写法。输入是汉字时给假名；输入是平假名或片假名时尽量给常用汉字写法，没有常用汉字就保持原写法。不要使用生僻当て字，只输出 JSON。" },
          { role: "user", content: JSON.stringify({ words: missing }) },
        ],
      });
      for (const item of response.result.forms) {
        readings[item.word] = cleanReading(item.reading);
        writtenForms[item.word] = cleanWritten(item.written);
      }
    } catch (error) {
      if (!["ai_unavailable", "ai_timeout", "ai_busy", "quota_exhausted", "dependency_auth_failed", "ai_schema_invalid"].includes(error?.code)) {
        throw error;
      }
      aiUnavailable = true;
    }
  }
  for (const word of words) {
    if (!readings[word] && isKanaOnly(word)) readings[word] = normalizeKana(word);
    if (!writtenForms[word]) writtenForms[word] = word;
  }
  const unresolved = words.filter((word) => !readings[word] || !writtenForms[word]);
  return { readings, written_forms: writtenForms, ai_unavailable: aiUnavailable, unresolved };
}

function validSuggestedWord(word, language) {
  const text = String(word || "").normalize("NFKC").trim();
  if (!text || text.length > 64) return "";
  if (language === "english" && !/^[A-Za-z][A-Za-z' -]*$/u.test(text)) return "";
  if (language === "japanese" && !/^[\u3040-\u30ff\u31f0-\u31ff\u3400-\u9fff々〆ヶー・]+$/u.test(text)) return "";
  return text;
}

const VOCABULARY_SCHEMA = Object.freeze({
  type: "object",
  properties: { words: { type: "array", maxItems: MAX_QUIZ_WORDS, items: { type: "string", maxLength: 64 } } },
  required: ["words"],
  additionalProperties: false,
});

export async function suggestVocabulary(context, account, input) {
  const language = cleanLanguage(input.language);
  const level = String(input.level || "").trim().toLowerCase();
  if (!vocabularyLevelExists(language, level)) throw new Task15Error("学习等级无效", 400, "suggest_level_invalid");
  const count = safeInteger(input.count, 15, 1, MAX_QUIZ_WORDS);
  if (String(input.query || "").length > 64) throw new Task15Error("搜索内容不能超过 64 个字符", 400, "suggest_query_invalid");
  const query = String(input.query || "").normalize("NFKC").trim();
  if (query && !validSuggestedWord(query, language)) throw new Task15Error("搜索内容格式无效", 400, "suggest_query_invalid");
  const limit = quizLimitFor(account, language);
  if (count > limit) throw new Task15Error(`当前账户每次最多测试 ${limit} 个单词，请开通会员`, 403, "membership_required");
  const exclude = (Array.isArray(input.exclude) ? input.exclude.slice(0, MAX_QUIZ_WORDS) : [])
    .map((word) => validSuggestedWord(word, language)).filter(Boolean);
  const matches = searchVocabulary(language, level, query, count, exclude);
  const words = matches.map((item) => item.word);
  let selectionSource = "local";
  if (words.length < count) {
    const missing = count - words.length;
    const excluded = [...exclude, ...words];
    const excludedDigest = await sha256Hex(excluded.map((word) => normalizeWord(word, language)).sort().join("\u0000"));
    try {
      const response = await runStructuredAi(context, {
        account,
        taskType: "vocabulary",
        normalizedInput: { language, level, query: normalizeWord(query, language), count: missing, excluded_digest: excludedDigest },
        schema: VOCABULARY_SCHEMA,
        validate: (value) => Array.isArray(value?.words),
        messages: [
          { role: "system", content: "生成符合指定学习等级的常用英语或日语词汇。若提供 query，优先给出与该词相关、近义或同主题词。不要解释，不要重复，不要输出排除词，只输出 JSON。" },
          { role: "user", content: JSON.stringify({ language, level: vocabularyLevelLabel(language, level), query, count: missing, exclude: excluded.slice(-200) }) },
        ],
      });
      const seenWords = new Set(excluded.map((word) => normalizeWord(word, language)));
      for (const candidate of response.result.words) {
        const word = validSuggestedWord(candidate, language);
        const key = normalizeWord(word, language);
        if (!word || seenWords.has(key)) continue;
        seenWords.add(key); words.push(word);
        if (words.length >= count) break;
      }
      selectionSource = response.cacheHit ? "local_and_cache" : "local_and_workers_ai";
    } catch (error) {
      if (!words.length) throw error;
      selectionSource = "local_partial";
    }
  }
  const forms = language === "japanese"
    ? await resolveJapaneseForms(context, account, words).catch(() => ({ readings: {}, written_forms: {} }))
    : { readings: {}, written_forms: {} };
  return {
    words: words.slice(0, count), matches: matches.slice(0, count), ...forms,
    language, level, level_label: vocabularyLevelLabel(language, level), query,
    online: selectionSource.includes("workers_ai"), partial: words.length < count,
    selection_source: selectionSource,
    sources: [{ title: `内置分级词库 · ${vocabularyLevelLabel(language, level)}`, url: "", kind: "local" }],
  };
}

function splitMeanings(value) {
  return String(value || "").split(/[\/、，,；;：:|]+/u).map((item) => item.trim()).filter(Boolean);
}

function semanticForms(value) {
  const forms = new Set([normalizeMeaning(value)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const form of [...forms]) {
      const additions = [];
      if (form.length > 1 && "的地得".includes(form.at(-1))) additions.push(form.slice(0, -1));
      if (form.length >= 3 && form.startsWith("有")) additions.push(form.slice(1));
      if (form.length >= 3 && form.endsWith("性")) additions.push(form.slice(0, -1));
      for (const item of additions) if (item && !forms.has(item)) { forms.add(item); changed = true; }
    }
  }
  return forms;
}

function conflictIndexes(value) {
  const forms = semanticForms(value);
  return new Set(CONFLICT_GROUPS.map((group, index) => [...forms].some((form) => group.has(form)) ? index : -1).filter((index) => index >= 0));
}

function conflictWithPool(student, pool) {
  const studentGroups = conflictIndexes(student);
  if (!studentGroups.size) return false;
  const expected = new Set(pool.flatMap((item) => [...conflictIndexes(item)]));
  return expected.size > 0 && ![...studentGroups].some((item) => expected.has(item));
}

function bigrams(value) {
  const text = normalizeMeaning(value);
  if (text.length < 2) return new Set(text ? [text] : []);
  return new Set(Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2)));
}

function jaccard(left, right) {
  const a = bigrams(left); const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / new Set([...a, ...b]).size;
}

function localJudge(answer, rubric, strict) {
  const student = normalizeMeaning(answer);
  const pool = [...new Set([rubric.gloss, ...rubric.accepted].flatMap(splitMeanings))];
  if (!student || conflictWithPool(student, pool)) return false;
  const studentForms = semanticForms(student);
  for (const item of pool) {
    const expected = normalizeMeaning(item);
    const expectedForms = semanticForms(expected);
    if ([...studentForms].some((form) => expectedForms.has(form))) return true;
    if ([...conflictIndexes(student)].some((index) => conflictIndexes(expected).has(index))) return true;
    if (!strict && student.length >= 3 && expected.length >= 3
      && (student.includes(expected) || expected.includes(student) || jaccard(student, expected) >= 0.67)) return true;
  }
  return false;
}

const JUDGE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    correct: { type: "boolean" },
    final_gloss: { type: "string", maxLength: RUBRIC_TEXT_LIMIT },
    accepted: { type: "array", items: { type: "string", maxLength: RUBRIC_TEXT_LIMIT }, maxItems: ACCEPTED_LIMIT },
  },
  required: ["correct", "final_gloss", "accepted"],
  additionalProperties: false,
});

export async function judgeAnswer(context, account, input) {
  const word = cleanWord(input.word);
  const answer = String(input.answer || "").normalize("NFKC").trim().slice(0, RUBRIC_TEXT_LIMIT);
  const mode = ["strict", "normal", "lenient"].includes(input.mode) ? input.mode : "normal";
  let rubric = sanitizeRubric(input.rubric, word);
  if (!rubric) rubric = (await buildRubric(context, account, word)).rubric;
  if (!answer || /^\d+$/u.test(answer) || /^[\p{P}\p{S}_]+$/u.test(answer)) {
    return { correct: false, gloss: rubric.gloss, accepted: rubric.accepted, rubric, kind: "invalid", ai_review: false, grading_mode: mode };
  }
  if (SURRENDER.has(answer)) {
    return { correct: false, gloss: rubric.gloss, accepted: rubric.accepted, rubric, kind: "surrender", ai_review: false, grading_mode: mode };
  }
  const local = localJudge(answer, rubric, mode === "strict");
  if (local || mode === "strict" || normalizeMeaning(answer).length <= 1 || conflictWithPool(answer, [rubric.gloss, ...rubric.accepted])) {
    return { correct: local, gloss: rubric.gloss, accepted: rubric.accepted, rubric, kind: "judged", ai_review: false, grading_mode: mode };
  }
  try {
    const answerHash = await sha256Hex(normalizeMeaning(answer));
    const response = await runStructuredAi(context, {
      account,
      taskType: "judge",
      normalizedInput: {
        word: normalizeWord(word, rubric.language === "英语" ? "english" : "japanese"),
        answer_hash: answerHash,
        rubric: { gloss: rubric.gloss, accepted: rubric.accepted },
        mode,
      },
      schema: JUDGE_SCHEMA,
      validate: (value) => typeof value?.correct === "boolean"
        && Boolean(String(value.final_gloss || "").trim()) && Array.isArray(value.accepted),
      messages: [
        { role: "system", content: "你是严格的外语词汇判卷复核老师。学生回答中文意思。只有语义明确等同或常见同义词才正确；相关、笼统、方向/人称/否定/褒贬相反都错误。只输出 JSON。" },
        { role: "user", content: JSON.stringify({ word, student_answer: answer, rubric, mode }) },
      ],
    });
    const reviewedRubric = sanitizeRubric({ ...rubric, gloss: response.result.final_gloss, accepted: response.result.accepted }, word) || rubric;
    const correct = Boolean(response.result.correct) || localJudge(answer, reviewedRubric, false);
    return { correct, gloss: reviewedRubric.gloss, accepted: reviewedRubric.accepted, rubric: reviewedRubric, kind: "judged", ai_review: true, grading_mode: mode };
  } catch (error) {
    if (["ai_unavailable", "ai_timeout", "ai_busy", "quota_exhausted", "dependency_auth_failed", "ai_schema_invalid"].includes(error.code)) {
      return { correct: false, gloss: rubric.gloss, accepted: rubric.accepted, rubric, kind: "rules", ai_review: false, ai_unavailable: true, grading_mode: mode };
    }
    throw error;
  }
}

export const __testing = {
  cleanAccepted,
  cleanReading,
  cleanWritten,
  localJudge,
  sanitizeRubric,
  validFormsResult,
};

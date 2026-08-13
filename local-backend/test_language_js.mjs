import assert from "node:assert/strict";

import { achievementMetrics } from "../js/language/achievements.js";
import {
  calculateLongestStudyStreak,
  calculateStudyStreak,
  sanitizeStudyRecords,
} from "../js/language/history.js";
import {
  analyzeWordList,
  evaluateDictation,
  evaluateLocalMeaning,
  parseWordTextModel,
  sanitizePendingAdvance,
} from "../js/language/quiz.js";
import { createLearningSyncAdapter } from "../js/language/sync-adapter.js";
import { mergeWrongBooks, sanitizeWrongBook, updateWrongEntry } from "../js/language/wrong-book.js";

const parsedJapanese = parseWordTextModel("電話 | でんわ\nみず\n電話", "japanese");
assert.deepEqual(parsedJapanese.words, ["電話", "みず", "電話"]);
assert.equal(parsedJapanese.readings["電話"], "でんわ");
assert.deepEqual(analyzeWordList(parsedJapanese.words, "japanese"), {
  valid: ["電話", "みず"], invalid: [], duplicates: 1,
});
assert.deepEqual(analyzeWordList(["Hello", "hello", "電話"], "english"), {
  valid: ["Hello"], invalid: ["電話"], duplicates: 1,
});

const japaneseContext = {
  language: "japanese",
  readings: { "電話": "でんわ" },
  writtenForms: { "電話": "電話" },
};
assert.equal(evaluateDictation("電話", "電話 でんわ", japaneseContext).correct, true);
assert.equal(evaluateDictation("電話", "でんわ", japaneseContext).correct, false);
assert.match(evaluateDictation("電話", "電話", japaneseContext).guidance, /同时填写汉字/);
assert.equal(evaluateDictation("hello", "HELLO", { language: "english" }).correct, true);

const reviewInfo = { correct_answer: "睡觉", accepted: ["睡眠"] };
assert.equal(evaluateLocalMeaning("sleep", "睡觉", reviewInfo, { language: "english", gradingMode: "strict" }).correct, true);
assert.equal(evaluateLocalMeaning("sleep", "画画", reviewInfo, { language: "english", gradingMode: "lenient" }).correct, false);

const pending = sanitizePendingAdvance({
  roundId: "round-1",
  questionIndex: 1,
  dueAt: Date.now() + 1000,
  feedback: { type: "skipped", gloss: "顾问", kind: "meaning" },
}, { roundId: "round-1", words: ["one", "two"] });
assert.equal(pending.questionIndex, 1);
assert.equal(pending.feedback.type, "skipped");
assert.equal(sanitizePendingAdvance({ ...pending, questionIndex: 2 }, { roundId: "round-1", words: ["one", "two"] }), null);

const wrongBook = {};
updateWrongEntry(wrongBook, "advisor", "（跳过）", "顾问", [], {
  skipped: true, language: "english", gradingMode: "normal", roundId: "round-1",
});
assert.equal(wrongBook.advisor.skipped, true);
assert.equal(wrongBook.advisor.wrong_count, 1);
const merged = mergeWrongBooks(wrongBook, {
  advisor: { ...wrongBook.advisor, wrong_count: 3, correct_answer: "顾问；指导者" },
});
assert.equal(merged.advisor.wrong_count, 3);
assert.equal(merged.advisor.correct_answer, "顾问；指导者");
assert.deepEqual(sanitizeWrongBook(null), {});

const records = sanitizeStudyRecords([
  { id: "r1", finishedAt: "2026-08-12T10:00:00Z", language: "english", practiceMode: "meaning", mode: "normal", total: 10, correct: 9, skipped: 1, durationSec: 70 },
  { id: "r2", finishedAt: "2026-08-13T10:00:00Z", language: "japanese", practiceMode: "dictation", mode: "normal", total: 10, correct: 10, skipped: 0, durationSec: 80 },
]);
assert.equal(records[0].wrong, 0);
assert.equal(records[0].accuracy, 90);
assert.equal(calculateLongestStudyStreak(records), 2);
assert.equal(calculateStudyStreak(records, new Date("2026-08-14T10:00:00Z")), 2);
const metrics = achievementMetrics(records, wrongBook, () => 10);
assert.equal(metrics.rounds, 2);
assert.equal(metrics.bilingualRounds, 1);
assert.equal(metrics.goalDays, 2);

const syncApi = { makeRecordId: (kind, components) => [kind, ...components].join("|") };
const adapter = createLearningSyncAdapter(() => syncApi);
assert.equal(adapter.groupPrefix("wrong", "me", "history"), "wrong|me|history|");
assert.equal(adapter.record("wrong_book", "wrong", ["me", "history", "word"], {}).record_id, "wrong|me|history|word");

console.log("Language JS module tests passed (quiz, Japanese, wrong book, history, achievements, sync adapter).");

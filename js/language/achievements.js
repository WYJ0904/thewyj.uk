import { calculateLongestStudyStreak, localDayKey } from "./history.js?v=20260824-task14-production-r2";

export const ACHIEVEMENT_TIERS = Object.freeze({
  bronze: { label: "初阶", points: 10 },
  silver: { label: "进阶", points: 25 },
  gold: { label: "高阶", points: 50 },
  platinum: { label: "卓越", points: 100 },
});

export const ACHIEVEMENTS = Object.freeze([
  { id: "firstQuiz", category: "入门", tier: "bronze", title: "开测", desc: "完成一次词表测试。", metric: "rounds", goal: 1 },
  { id: "firstCorrect", category: "入门", tier: "bronze", title: "第一题正确", desc: "累计答对 1 题。", metric: "correct", goal: 1 },
  { id: "firstDictation", category: "探索", tier: "bronze", title: "听写启动", desc: "完成一次听写练习。", metric: "dictationRounds", goal: 1 },
  { id: "skipSaved", category: "入门", tier: "bronze", title: "跳过也记录", desc: "跳过的词已进入错题本。", metric: "skipped", goal: 1 },
  { id: "wrongTen", category: "工具", tier: "silver", title: "错题收藏家", desc: "历史错题达到 10 个。", metric: "wrongWords", goal: 10 },
  { id: "perfectRound", category: "能力", tier: "silver", title: "满分一轮", desc: "完成一轮满分测试。", metric: "perfectRounds", goal: 1 },
  { id: "firstPdf", category: "工具", tier: "silver", title: "练习册生成", desc: "导出一次 PDF 错题本。" },
  { id: "longRound", category: "坚持", tier: "silver", title: "长跑", desc: "完成一轮 20 题以上的测试。", metric: "longRounds", goal: 1 },
  { id: "rounds5", category: "坚持", tier: "bronze", title: "渐入佳境", desc: "累计完成 5 轮练习。", metric: "rounds", goal: 5 },
  { id: "rounds25", category: "坚持", tier: "silver", title: "稳定节奏", desc: "累计完成 25 轮练习。", metric: "rounds", goal: 25 },
  { id: "rounds100", category: "坚持", tier: "platinum", title: "百炼成章", desc: "累计完成 100 轮练习。", metric: "rounds", goal: 100 },
  { id: "words50", category: "坚持", tier: "bronze", title: "五十步", desc: "累计完成 50 道题。", metric: "words", goal: 50 },
  { id: "words500", category: "坚持", tier: "silver", title: "五百题", desc: "累计完成 500 道题。", metric: "words", goal: 500 },
  { id: "words2000", category: "坚持", tier: "gold", title: "两千里", desc: "累计完成 2000 道题。", metric: "words", goal: 2000 },
  { id: "correct100", category: "能力", tier: "bronze", title: "百题正确", desc: "累计答对 100 道题。", metric: "correct", goal: 100 },
  { id: "correct1000", category: "能力", tier: "gold", title: "千题正确", desc: "累计答对 1000 道题。", metric: "correct", goal: 1000 },
  { id: "streak3", category: "坚持", tier: "bronze", title: "三日不辍", desc: "最长连续学习 3 天。", metric: "longestStreak", goal: 3 },
  { id: "streak7", category: "坚持", tier: "silver", title: "一周坚持", desc: "最长连续学习 7 天。", metric: "longestStreak", goal: 7 },
  { id: "streak30", category: "坚持", tier: "gold", title: "月度恒心", desc: "最长连续学习 30 天。", metric: "longestStreak", goal: 30 },
  { id: "perfect3", category: "能力", tier: "gold", title: "三连满分", desc: "累计完成 3 轮满分练习。", metric: "perfectRounds", goal: 3 },
  { id: "dictation10", category: "探索", tier: "silver", title: "听辨熟手", desc: "累计完成 10 轮听写。", metric: "dictationRounds", goal: 10 },
  { id: "review10", category: "探索", tier: "silver", title: "回炉有方", desc: "累计完成 10 轮错题复习。", metric: "reviewRounds", goal: 10 },
  { id: "bilingual", category: "探索", tier: "silver", title: "双语启程", desc: "英语和日语各完成至少 1 轮。", metric: "bilingualRounds", goal: 1 },
  { id: "highAccuracy5", category: "能力", tier: "gold", title: "稳定高分", desc: "完成 5 轮至少 10 题且正确率不低于 90% 的练习。", metric: "highAccuracyRounds", goal: 5 },
  { id: "goalDays3", category: "坚持", tier: "gold", title: "目标常客", desc: "累计 3 天达到当日学习目标。", metric: "goalDays", goal: 3 },
]);

export function achievementMetrics(records, wrongBook, goalForLanguage) {
  const languageRounds = { english: 0, japanese: 0 };
  const totals = records.reduce((result, record) => {
    result.rounds += 1;
    result.words += record.total;
    result.correct += record.correct;
    result.skipped += record.skipped;
    if (record.correct === record.total) result.perfectRounds += 1;
    if (record.total >= 20) result.longRounds += 1;
    if (record.practiceMode === "dictation") result.dictationRounds += 1;
    if (record.mode.startsWith("review-")) result.reviewRounds += 1;
    if (record.total >= 10 && record.accuracy >= 90) result.highAccuracyRounds += 1;
    languageRounds[record.language] += 1;
    return result;
  }, {
    rounds: 0, words: 0, correct: 0, skipped: 0, perfectRounds: 0,
    longRounds: 0, dictationRounds: 0, reviewRounds: 0, highAccuracyRounds: 0,
  });
  totals.wrongWords = Object.keys(wrongBook || {}).length;
  totals.longestStreak = calculateLongestStudyStreak(records);
  totals.bilingualRounds = Math.min(languageRounds.english, languageRounds.japanese);

  const dailyTotals = new Map();
  records.forEach((record) => {
    const day = localDayKey(record.finishedAt);
    const key = `${day}:${record.language}`;
    dailyTotals.set(key, (dailyTotals.get(key) || 0) + record.total);
  });
  const completedGoalDays = new Set();
  dailyTotals.forEach((total, key) => {
    const separator = key.lastIndexOf(":");
    const day = key.slice(0, separator);
    const language = key.slice(separator + 1);
    if (total >= goalForLanguage(language)) completedGoalDays.add(day);
  });
  totals.goalDays = completedGoalDays.size;
  return totals;
}

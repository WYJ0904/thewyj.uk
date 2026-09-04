import { limitText, normalizePracticeMode, normalizeQuizLanguage } from "./quiz.js?v=20260904-task20-android-r1";

export const MAX_STUDY_RECORDS = 500;

export function sanitizeStudyRecords(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_STUDY_RECORDS).map((record) => {
    if (!record || typeof record !== "object") return null;
    const language = normalizeQuizLanguage(record.language);
    const parsedTotal = Number.parseInt(record.total, 10) || 0;
    if (parsedTotal < 1) return null;
    const total = Math.min(500, parsedTotal);
    const correct = Math.max(0, Math.min(total, Number.parseInt(record.correct, 10) || 0));
    const skipped = Math.max(0, Math.min(total - correct, Number.parseInt(record.skipped, 10) || 0));
    const wrong = Math.max(0, total - correct - skipped);
    const finishedAt = new Date(record.finishedAt || record.finished_at || "");
    if (!language || !Number.isFinite(finishedAt.getTime())) return null;
    return {
      id: limitText(record.id, 100) || `${finishedAt.getTime()}-${language}`,
      finishedAt: finishedAt.toISOString(),
      language,
      practiceMode: normalizePracticeMode(record.practiceMode),
      mode: ["normal", "review-current", "review-history"].includes(record.mode) ? record.mode : "normal",
      total,
      correct,
      wrong,
      skipped,
      accuracy: Math.round((correct / total) * 100),
      durationSec: Math.max(0, Math.min(24 * 60 * 60, Number.parseInt(record.durationSec, 10) || 0)),
    };
  }).filter(Boolean);
}

export function localDayKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function studyDaySeries(days = 7, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() - (days - index - 1));
    return { date, key: localDayKey(date), total: 0, correct: 0, rounds: 0 };
  });
}

export function calculateLongestStudyStreak(records) {
  const dayNumbers = [...new Set(records.map((record) => localDayKey(record.finishedAt)).filter(Boolean))]
    .map((key) => {
      const [year, month, day] = key.split("-").map(Number);
      return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
    })
    .sort((left, right) => left - right);
  let longest = 0;
  let current = 0;
  let previous = null;
  dayNumbers.forEach((day) => {
    current = previous !== null && day === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = day;
  });
  return longest;
}

export function calculateStudyStreak(records, now = new Date()) {
  const studiedDays = new Set(records.map((record) => localDayKey(record.finishedAt)).filter(Boolean));
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  if (!studiedDays.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (streak < 3660 && studiedDays.has(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function formatDuration(seconds) {
  const value = Math.max(0, Number.parseInt(seconds, 10) || 0);
  if (value < 60) return `${value}秒`;
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  if (minutes < 60) return remainder ? `${minutes}分${remainder}秒` : `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}小时${restMinutes}分` : `${hours}小时`;
}

import {
  AI_TIMEOUT_MS,
  API_GET_TIMEOUT_MS,
  API_TIMEOUT_MS,
  APP_VERSION,
  BACKEND_NETWORK_MESSAGE,
  BACKEND_REFRESH_INTERVAL_MS,
  BUSINESS_TIME_ZONE,
  STATUS_RETRY_BASE_DELAYS_MS,
  STATUS_TIMEOUT_MS,
} from "./js/core/config.js?v=20260826-task15-cloud-only";
import {
  createApiClient,
  fetchWithTimeout,
  isCanonicalSessionFailure,
  retryDelayWithJitter,
  waitForDelay,
} from "./js/core/api.js?v=20260826-task15-cloud-only";
import {
  loadCloudChangelog,
  mergeChangelogEntries,
  staticChangelogEntries,
} from "./js/core/changelog.js?v=20260826-task15-cloud-only";
import { APP_ROUTE_MANIFEST, createRouter } from "./js/core/router.js?v=20260826-task15-cloud-only";
import {
  ACCOUNT_CACHE_KEY,
  clearAccountSessionStorage,
  persistAccountSession,
  restoreAccountSession,
  subscribeAccountSessionChanges,
} from "./js/core/session.js?v=20260826-task15-cloud-only";
import { getSafeStorage, hasStorageWriteFailure, loadJson, safeStorageSet } from "./js/core/storage.js?v=20260826-task15-cloud-only";
import { $, escapeHtml, formatLocalDateTime, writeClipboardText } from "./js/core/ui.js?v=20260826-task15-cloud-only";
import { ACHIEVEMENTS, ACHIEVEMENT_TIERS, achievementMetrics as calculateAchievementMetrics } from "./js/language/achievements.js?v=20260826-task15-cloud-only";
import {
  calculateStudyStreak,
  formatDuration,
  localDayKey,
  sanitizeStudyRecords,
  studyDaySeries,
} from "./js/language/history.js?v=20260826-task15-cloud-only";
import {
  DEFAULT_PROFILE,
  LANGUAGE_LABELS,
  analyzeWordList,
  evaluateDictation,
  evaluateLocalMeaning,
  filterWordsByLanguage,
  formatJapaneseDictationAnswer as formatJapaneseDictationAnswerModel,
  formatWordsForInput,
  hasJapaneseKanji,
  japaneseDictationRequiresBoth as japaneseDictationRequiresBothModel,
  japaneseReadingFor as japaneseReadingForModel,
  japaneseWrittenFormFor as japaneseWrittenFormForModel,
  limitText,
  normalizeDictationAnswer as normalizeDictationAnswerModel,
  normalizeJapaneseReading,
  normalizeKana,
  normalizeMeaning,
  normalizePracticeMode,
  normalizeQuizLanguage,
  parseWordTextModel,
  practiceModeLabel,
  profileStorageName,
  quizLanguageLabel,
  sanitizeAccepted,
  sanitizeJapaneseReadings,
  sanitizeJapaneseWrittenForms,
  sanitizePendingAdvance,
  sanitizeProfile,
  sanitizeQuestionFeedback,
  sanitizeStoredRubric,
  trimRubricCache,
  wordIdentity,
  wordMatchesLanguage,
} from "./js/language/quiz.js?v=20260826-task15-cloud-only";
import { createLearningSyncAdapter } from "./js/language/sync-adapter.js?v=20260826-task15-cloud-only";
import { createWrongBookPdf } from "./js/language/pdf.js?v=20260826-task15-cloud-only";
import {
  filterWrongBookByLanguage as filterWrongBookByLanguageModel,
  mergeWrongBooks,
  removeLanguageFromWrongBook as removeLanguageFromWrongBookModel,
  sanitizeWrongBook,
  updateWrongEntry as updateWrongEntryModel,
} from "./js/language/wrong-book.js?v=20260826-task15-cloud-only";
import {
  accountEntitlements as accountEntitlementsModel,
  accountMembershipSummary as accountMembershipSummaryModel,
  entitlementLabel,
  hasAccountEntitlement as hasAccountEntitlementModel,
  isSuperAdmin as isSuperAdminModel,
  membershipLabel,
} from "./js/membership/account.js?v=20260826-task15-cloud-only";
import {
  MEMBERSHIP_GOALS,
  MEMBERSHIP_PLAN_ORDER,
  membershipGoalAllowsPlan,
  membershipGoalForPlan,
  normalizedMembershipGoal,
  planDetails as planDetailsModel,
} from "./js/membership/plans.js?v=20260826-task15-cloud-only";
import {
  DEFAULT_PAYMENT_METHODS,
  normalizedPaymentMethod as normalizedPaymentMethodModel,
  paymentMethodLabel as paymentMethodLabelModel,
  paymentStatusLabel,
  rechargeStatusLabel,
} from "./js/membership/recharge.js?v=20260826-task15-cloud-only";
import {
  loginLocationLabel,
  loginReasonLabel,
  membershipDateValue as membershipDateValueModel,
} from "./js/admin/formatters.js?v=20260826-task15-cloud-only";

const localStorage = getSafeStorage("localStorage");
const sessionStorage = getSafeStorage("sessionStorage");

const PREVIOUS_QUESTION_TRANSITION_MS = 8000;
const QUESTION_TRANSITION_MS = Math.round(PREVIOUS_QUESTION_TRANSITION_MS * 2 / 3);
const MAX_REJUDGE_LOG_ITEMS = 200;
const MAX_WORD_IMPORT_BYTES = 1024 * 1024;
const MAX_WORD_INPUT_CHARS = 120000;
const PROJECT_RUNTIME_MAX_AGE_MS = 100 * 60 * 1000;
const JAPANESE_READING_CACHE_KEY = "japaneseReadingCache:v1";
const JAPANESE_WRITTEN_FORM_CACHE_KEY = "japaneseWrittenFormCache:v1";
const ACCOUNT_DATA_VERSION = 2;
const STUDY_DATA_VERSION = 1;
const WRONG_BOOK_EXPORT_TYPE = "vocab-wrong-book";
const WRONG_BOOK_EXPORT_VERSION = 1;
const TRIAL_MAX_QUESTIONS = 10;
const TRIAL_MAX_TEXT_CHARS = 200000;
const TRIAL_MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const TRIAL_MAX_IMAGE_PIXELS = 20 * 1000 * 1000;
const TRIAL_TOOL_IDS = new Set(["quiz", "text", "json", "image-compress", "image-format"]);
const CHANGELOG_SEEN_KEY = "wyjChangelogSeenVersion:v1";
const FEEDBACK_TYPE_LABELS = Object.freeze({
  feature_suggestion: "功能建议",
  tool_error: "工具报错",
  page_issue: "页面问题",
  account_issue: "账户问题",
  new_tool: "新工具建议",
  other: "其他反馈",
});
const FEEDBACK_STATUS_LABELS = Object.freeze({
  pending: "待处理",
  viewed: "已查看",
  accepted: "已采纳",
  completed: "已完成",
  rejected: "已拒绝",
});
const TRIAL_QUESTION_BANKS = {
  english: [
    { prompt: "你好", answers: ["hello"] },
    { prompt: "世界", answers: ["world"] },
    { prompt: "学习", answers: ["study", "learn"] },
    { prompt: "朋友", answers: ["friend"] },
    { prompt: "学校", answers: ["school"] },
    { prompt: "水", answers: ["water"] },
    { prompt: "书", answers: ["book"] },
    { prompt: "时间", answers: ["time"] },
    { prompt: "音乐", answers: ["music"] },
    { prompt: "家庭", answers: ["family"] },
  ],
  japanese: [
    { prompt: "水", answers: ["水", "みず"] },
    { prompt: "电话", answers: ["電話", "でんわ"] },
    { prompt: "学校", answers: ["学校", "がっこう"] },
    { prompt: "朋友", answers: ["友達", "ともだち"] },
    { prompt: "时间", answers: ["時間", "じかん"] },
    { prompt: "音乐", answers: ["音楽", "おんがく"] },
    { prompt: "家人", answers: ["家族", "かぞく"] },
    { prompt: "雪", answers: ["雪", "ゆき"] },
    { prompt: "花", answers: ["花", "はな"] },
    { prompt: "词语", answers: ["言葉", "ことば"] },
  ],
};
const VOCABULARY_LEVEL_OPTIONS = {
  japanese: [
    ["n5", "JLPT N5"],
    ["n4", "JLPT N4"],
    ["n3", "JLPT N3"],
    ["n2", "JLPT N2"],
    ["n1", "JLPT N1"],
  ],
  english: [
    ["primary_3", "小学三年级"],
    ["primary_4", "小学四年级"],
    ["primary_5", "小学五年级"],
    ["primary_6", "小学六年级"],
    ["middle_1", "初中一年级"],
    ["middle_2", "初中二年级"],
    ["middle_3", "初中三年级"],
    ["high_1", "高中一年级"],
    ["high_2", "高中二年级"],
    ["high_3", "高中三年级"],
    ["cet_4", "大学英语四级"],
    ["cet_6", "大学英语六级"],
  ],
};
const SKIPPED_ANSWER = "（跳过）";

let resultHideTimer = null;
let nextTimer = null;
let judgeController = null;
let backendAvailable = false;
let aiAvailable = false;
let pendingScreen = "auth";
let pendingAuthMessage = "";
let currentProject = "";
let selectedMembershipGoal = "";
let selectedRechargePlan = "";
let currentPaymentOrder = null;
let membershipPlans = [];
let paymentMethods = [];
let selectedPaymentMethod = "";
let paymentQrObjectUrl = "";
let paymentQrController = null;
let membershipPlansPromise = null;
let membershipModalLoadSequence = 0;
let membershipModalController = null;
let vocabularySearchTimer = null;
let vocabularySearchController = null;
let vocabularySearchSequence = 0;
let toolsInitialized = false;
let routeBusy = false;
let adminUsers = [];
let adminFeedback = [];
let adminLoadSequence = 0;
let feedbackLoadSequence = 0;
let cloudChangelogEntries = null;
let cloudChangelogPromise = null;
let adminFeedbackSearchTimer = null;
let confirmAction = null;
let lastLimitPromptKey = "";
let projectRuntimeNeedsRestore = false;
let backendStatusPromise = null;
let backendRefreshPromise = null;
let backendRecoveryTimer = null;
let achievementFilter = "all";
let achievementToastTimer = null;
let achievementToastHideTimer = null;
let wrongActionTimer = null;
let trialImageObjectUrl = "";
const trialState = {
  tool: "quiz",
  imageMode: "compress",
  quiz: null,
};
const rejudgeInFlight = new Set();
const modalReturnFocus = new Map();
let rejudgeResultScrollPosition = null;
const projectRuntime = {
  english: null,
  japanese: null,
};
let backendFailureMessage = BACKEND_NETWORK_MESSAGE;
let learningSyncManager = null;
let learningSyncAccountId = "";
let applyingLearningSync = false;
let learningSyncRenderQueued = false;
let learningSyncWrongRenderPending = false;
let activeWrongRejudgeKey = "";
let learningSyncStatus = {
  status: "synced",
  label: "已同步",
  detail: "",
  pending: 0,
  server_version: 0,
};

const restoredSession = restoreAccountSession();
const { pushRoute } = createRouter({ onRouteChange: () => renderAccountUi() });
const learningSyncAdapter = createLearningSyncAdapter(() => window.WYJLearningSync);

function migrateProjectPreferences() {
  const legacyGrading = ["strict", "normal", "lenient"].includes(localStorage.getItem("gradingMode"))
    ? localStorage.getItem("gradingMode")
    : "normal";
  const legacyPractice = normalizePracticeMode(localStorage.getItem("practiceMode"));
  Object.keys(LANGUAGE_LABELS).forEach((language) => {
    if (localStorage.getItem(`gradingMode:${language}`) === null) {
      safeStorageSet(localStorage, `gradingMode:${language}`, legacyGrading);
    }
    if (localStorage.getItem(`practiceMode:${language}`) === null) {
      safeStorageSet(localStorage, `practiceMode:${language}`, legacyPractice);
    }
  });
}

migrateProjectPreferences();

function filterWrongBookByLanguage(book, language = state.quizLanguage) {
  return filterWrongBookByLanguageModel(book, language);
}

function removeLanguageFromWrongBook(book, language = state.quizLanguage) {
  return removeLanguageFromWrongBookModel(book, language);
}

const state = {
  session: restoredSession,
  account: loadJson("wyjAccountCache", null),
  quizSession: "",
  profile: sanitizeProfile(localStorage.getItem("vocabProfile") || DEFAULT_PROFILE),
  gradingMode: localStorage.getItem("gradingMode") || "normal",
  practiceMode: normalizePracticeMode(localStorage.getItem("practiceMode")),
  quizLanguage: "",
  words: [],
  index: 0,
  score: 0,
  roundSkipped: 0,
  lastRound: null,
  mode: "normal",
  busy: false,
  answerLocked: false,
  pendingAdvance: null,
  roundActive: false,
  roundStartedAt: 0,
  roundId: "",
  wrongScope: "current",
  rubricCache: loadJson("rubricCache", {}),
  japaneseReadings: sanitizeJapaneseReadings(loadJson(JAPANESE_READING_CACHE_KEY, {})),
  japaneseWrittenForms: sanitizeJapaneseWrittenForms(loadJson(JAPANESE_WRITTEN_FORM_CACHE_KEY, {})),
  currentWrongBook: {},
  historyWrongBook: {},
  achievements: {},
  studyRecords: [],
};

function accountStorageId(account = state.account) {
  return encodeURIComponent(String(account?.id || "guest"));
}

function accountProfileKey(account = state.account) {
  return `vocabProfile:v${ACCOUNT_DATA_VERSION}:${accountStorageId(account)}`;
}

function wrongBookKey(scope, account = state.account, profile = state.profile) {
  return `wrongBook:v${ACCOUNT_DATA_VERSION}:${accountStorageId(account)}:${scope}:${profileStorageName(profile)}`;
}

function wrongRejudgeLogKey(account = state.account, profile = state.profile) {
  return `wrongRejudgeLog:v1:${accountStorageId(account)}:${profileStorageName(profile)}`;
}

function achievementKey(account = state.account, profile = state.profile) {
  return `achievements:v${ACCOUNT_DATA_VERSION}:${accountStorageId(account)}:${profileStorageName(profile)}`;
}

function projectRuntimeKey(language, account = state.account) {
  return `vocabRuntime:v1:${accountStorageId(account)}:${language}`;
}

function studyHistoryKey(account = state.account, profile = state.profile) {
  return `studyHistory:v${STUDY_DATA_VERSION}:${accountStorageId(account)}:${profileStorageName(profile)}`;
}

function studyGoalKey(language = state.quizLanguage, account = state.account, profile = state.profile) {
  return `studyGoal:v${STUDY_DATA_VERSION}:${accountStorageId(account)}:${profileStorageName(profile)}:${language}`;
}

function projectPreferencesKey(language, account = state.account) {
  return `learningPreferences:v1:${accountStorageId(account)}:${language}`;
}

function accountAiSuggestionSettingsKey(language, account = state.account) {
  return `aiSuggestSettings:v2:${accountStorageId(account)}:${language}`;
}

function learningSyncApi() {
  return learningSyncAdapter.api();
}

function learningSyncRecordId(kind, ...components) {
  return learningSyncAdapter.recordId(kind, ...components);
}

function learningSyncGroupPrefix(kind, ...components) {
  return learningSyncAdapter.groupPrefix(kind, ...components);
}

function learningSyncRecord(dataType, kind, components, payload, updatedAt = "") {
  return learningSyncAdapter.record(dataType, kind, components, payload, updatedAt);
}

function decodeProfileStorageName(value) {
  return learningSyncAdapter.decodeProfile(value);
}

function savedProjectPreferences(language, account = state.account) {
  const scoped = loadJson(projectPreferencesKey(language, account), null);
  if (scoped && typeof scoped === "object" && !Array.isArray(scoped)) {
    return {
      gradingMode: ["strict", "normal", "lenient"].includes(scoped.gradingMode) ? scoped.gradingMode : "normal",
      practiceMode: normalizePracticeMode(scoped.practiceMode),
    };
  }
  return {
    gradingMode: ["strict", "normal", "lenient"].includes(localStorage.getItem(`gradingMode:${language}`))
      ? localStorage.getItem(`gradingMode:${language}`)
      : "normal",
    practiceMode: normalizePracticeMode(localStorage.getItem(`practiceMode:${language}`)),
  };
}

function savedAiSuggestionSettings(language, account = state.account) {
  const scoped = loadJson(accountAiSuggestionSettingsKey(language, account), null);
  if (scoped && typeof scoped === "object" && !Array.isArray(scoped)) return scoped;
  return loadJson(`aiSuggestSettings:${language}`, {});
}

function collectLegacyLearningSyncRecords(account = state.account) {
  if (!account?.id || !learningSyncApi()) return [];
  const records = [];
  const encodedAccount = accountStorageId(account);
  const keys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key) keys.push(key);
  }

  const wrongPrefix = `wrongBook:v${ACCOUNT_DATA_VERSION}:${encodedAccount}:`;
  const achievementPrefix = `achievements:v${ACCOUNT_DATA_VERSION}:${encodedAccount}:`;
  const historyPrefix = `studyHistory:v${STUDY_DATA_VERSION}:${encodedAccount}:`;
  const goalPrefix = `studyGoal:v${STUDY_DATA_VERSION}:${encodedAccount}:`;
  keys.forEach((key) => {
    if (key.startsWith(wrongPrefix)) {
      const remainder = key.slice(wrongPrefix.length);
      const separator = remainder.indexOf(":");
      const scope = remainder.slice(0, separator);
      const profile = decodeProfileStorageName(remainder.slice(separator + 1));
      if (!["current", "history"].includes(scope) || separator < 1) return;
      Object.entries(sanitizeWrongBook(loadJson(key, {}))).forEach(([word, info]) => {
        records.push(learningSyncRecord(
          "wrong_book",
          "wrong",
          [profile, scope, word],
          info,
          info.last_time,
        ));
      });
      return;
    }
    if (key.startsWith(achievementPrefix)) {
      const profile = decodeProfileStorageName(key.slice(achievementPrefix.length));
      Object.entries(loadJson(key, {})).forEach(([achievementId, unlockedAt]) => {
        if (!achievementId || !unlockedAt) return;
        records.push(learningSyncRecord(
          "achievement",
          "achievement",
          [profile, achievementId],
          { unlocked_at: String(unlockedAt) },
          unlockedAt,
        ));
      });
      return;
    }
    if (key.startsWith(historyPrefix)) {
      const profile = decodeProfileStorageName(key.slice(historyPrefix.length));
      sanitizeStudyRecords(loadJson(key, [])).forEach((record) => {
        records.push(learningSyncRecord(
          "test_history",
          "history",
          [profile, record.id],
          record,
          record.finishedAt,
        ));
      });
      return;
    }
    if (key.startsWith(goalPrefix)) {
      const remainder = key.slice(goalPrefix.length);
      const separator = remainder.lastIndexOf(":");
      const profile = decodeProfileStorageName(remainder.slice(0, separator));
      const language = remainder.slice(separator + 1);
      const goal = Number.parseInt(localStorage.getItem(key), 10);
      if (separator > 0 && LANGUAGE_LABELS[language] && Number.isInteger(goal) && goal >= 1 && goal <= 500) {
        records.push(learningSyncRecord("daily_goal", "goal", [profile, language], { goal }));
      }
    }
  });

  Object.keys(LANGUAGE_LABELS).forEach((language) => {
    records.push(learningSyncRecord("language_settings", "settings", [language], {
      ...savedProjectPreferences(language, account),
      aiSuggestion: savedAiSuggestionSettings(language, account),
    }));
  });
  records.push(learningSyncRecord("learning_config", "config", ["active_profile"], {
    profile: sanitizeProfile(localStorage.getItem(accountProfileKey(account)) || DEFAULT_PROFILE),
  }));
  return records.filter((record) => record.record_id);
}

function scheduleLearningSyncRender() {
  if (learningSyncRenderQueued) return;
  learningSyncRenderQueued = true;
  queueMicrotask(() => {
    learningSyncRenderQueued = false;
    renderDashboard();
    if ($("wrongView")?.classList.contains("active")) {
      const editingWrongAnswer = $("wrongList")?.querySelector(".wrong-rejudge-form:not(.hidden)");
      if (activeWrongRejudgeKey || editingWrongAnswer) learningSyncWrongRenderPending = true;
      else renderWrongBook();
    }
    if ($("achievementsView")?.classList.contains("active")) renderAchievements();
    if ($("studyView")?.classList.contains("active")) renderStudyDashboard();
  });
}

function applyLearningSyncRecord(record) {
  if (!state.account?.id || learningSyncAccountId !== String(state.account.id)) return;
  const parsed = learningSyncApi()?.parseRecordId(record.record_id);
  if (!parsed) return;
  const [first, second, third] = parsed.components;
  applyingLearningSync = true;
  try {
    if (record.data_type === "wrong_book" && parsed.kind === "wrong" && first && ["current", "history"].includes(second) && third) {
      const key = wrongBookKey(second, state.account, first);
      const book = sanitizeWrongBook(loadJson(key, {}));
      if (record.deleted) delete book[third];
      else {
        const cleaned = sanitizeWrongBook({ [third]: record.payload });
        if (cleaned[third]) book[third] = cleaned[third];
      }
      safeStorageSet(localStorage, key, JSON.stringify(book));
      if (first === state.profile) {
        if (second === "history") state.historyWrongBook = book;
        else state.currentWrongBook = book;
      }
    } else if (record.data_type === "achievement" && parsed.kind === "achievement" && first && second && !record.deleted) {
      const key = achievementKey(state.account, first);
      const achievements = loadJson(key, {});
      if (!achievements[second]) achievements[second] = String(record.payload.unlocked_at || new Date().toLocaleString());
      safeStorageSet(localStorage, key, JSON.stringify(achievements));
      if (first === state.profile) state.achievements = achievements;
    } else if (record.data_type === "test_history" && parsed.kind === "history" && first && second) {
      const key = studyHistoryKey(state.account, first);
      const history = sanitizeStudyRecords(loadJson(key, [])).filter((item) => item.id !== second);
      if (!record.deleted) history.push(record.payload);
      const cleaned = sanitizeStudyRecords(history);
      safeStorageSet(localStorage, key, JSON.stringify(cleaned));
      if (first === state.profile) state.studyRecords = cleaned;
    } else if (record.data_type === "daily_goal" && parsed.kind === "goal" && first && LANGUAGE_LABELS[second]) {
      const key = studyGoalKey(second, state.account, first);
      if (record.deleted) localStorage.removeItem(key);
      else {
        const goal = Math.max(1, Math.min(500, Number.parseInt(record.payload.goal, 10) || 20));
        safeStorageSet(localStorage, key, String(goal));
      }
    } else if (record.data_type === "language_settings" && parsed.kind === "settings" && LANGUAGE_LABELS[first]) {
      if (record.deleted) {
        localStorage.removeItem(projectPreferencesKey(first));
        localStorage.removeItem(accountAiSuggestionSettingsKey(first));
      } else {
        const settings = {
          gradingMode: ["strict", "normal", "lenient"].includes(record.payload.gradingMode)
            ? record.payload.gradingMode
            : "normal",
          practiceMode: normalizePracticeMode(record.payload.practiceMode),
        };
        safeStorageSet(localStorage, projectPreferencesKey(first), JSON.stringify(settings));
        const aiSuggestion = record.payload.aiSuggestion && typeof record.payload.aiSuggestion === "object"
          ? record.payload.aiSuggestion
          : {};
        safeStorageSet(localStorage, accountAiSuggestionSettingsKey(first), JSON.stringify(aiSuggestion));
        if (first === state.quizLanguage && !state.roundActive) {
          state.gradingMode = settings.gradingMode;
          state.practiceMode = settings.practiceMode;
          if ($("gradingModeSelect")) $("gradingModeSelect").value = settings.gradingMode;
          updatePracticeUi();
          updateAiSuggestionControls();
        }
      }
    } else if (record.data_type === "learning_config" && parsed.kind === "config" && first === "active_profile" && !record.deleted) {
      safeStorageSet(localStorage, accountProfileKey(), sanitizeProfile(record.payload.profile));
    }
  } finally {
    applyingLearningSync = false;
  }
  scheduleLearningSyncRender();
}

function updateLearningSyncStatus(status) {
  learningSyncStatus = { ...learningSyncStatus, ...status };
  const button = $("learningSyncNowBtn");
  if (button) button.disabled = status.status === "syncing";
  const detail = $("learningSyncDetail");
  if (detail) {
    detail.textContent = status.detail || (status.pending ? `${status.pending} 项本地变更等待上传` : `服务器版本 ${status.server_version || 0}`);
  }
  if (state.account) renderLearningSyncDashboardStatus();
}

function renderLearningSyncDashboardStatus() {
  if (hasStorageWriteFailure()) {
    setDashboardService("dashboardSyncStatus", "浏览器存储受限", "is-warning");
    return;
  }
  const status = learningSyncStatus.status;
  const style = status === "synced" || status === "merged"
    ? "is-online"
    : status === "failed"
      ? "is-offline"
      : "is-warning";
  setDashboardService("dashboardSyncStatus", learningSyncStatus.label || "本地可用", style);
}

function ensureLearningSyncManager() {
  if (learningSyncManager) return learningSyncManager;
  const SyncManager = learningSyncApi()?.LearningSyncManager;
  if (typeof SyncManager !== "function") return null;
  learningSyncManager = new SyncManager({
    storage: localStorage,
    onlineSource: window,
    crypto: window.crypto,
    transport: (payload, options = {}) => api("/api/learning/sync", payload, {
      timeoutMs: 15000,
      signal: options.signal,
    }),
    applyRecord: applyLearningSyncRecord,
    onStatus: updateLearningSyncStatus,
  });
  return learningSyncManager;
}

function startLearningDataSync() {
  if (!state.account?.id || !state.session) return;
  const accountId = String(state.account.id);
  if (learningSyncAccountId === accountId && learningSyncManager?.state) return;
  try {
    const manager = ensureLearningSyncManager();
    if (!manager) return;
    learningSyncAccountId = accountId;
    manager.start({
      accountId,
      clientVersion: APP_VERSION,
      legacyRecords: collectLegacyLearningSyncRecords(state.account),
    });
  } catch (error) {
    learningSyncAccountId = "";
    updateLearningSyncStatus({ status: "failed", label: "同步失败", detail: error.message, pending: 0 });
  }
}

function stopLearningDataSync() {
  learningSyncAccountId = "";
  learningSyncManager?.stop();
  learningSyncStatus = { status: "synced", label: "已同步", detail: "", pending: 0, server_version: 0 };
}

function canQueueLearningSync() {
  return Boolean(
    !applyingLearningSync
    && state.account?.id
    && learningSyncManager?.state
    && learningSyncAccountId === String(state.account.id),
  );
}

function queueWrongBooksForSync() {
  if (!canQueueLearningSync()) return;
  [["current", state.currentWrongBook], ["history", state.historyWrongBook]].forEach(([scope, book]) => {
    const records = Object.entries(sanitizeWrongBook(book)).map(([word, info]) => learningSyncRecord(
      "wrong_book",
      "wrong",
      [state.profile, scope, word],
      info,
      info.last_time,
    ));
    learningSyncManager.replaceGroup(
      "wrong_book",
      learningSyncGroupPrefix("wrong", state.profile, scope),
      records,
    );
  });
}

function queueAchievementsForSync() {
  if (!canQueueLearningSync()) return;
  Object.entries(state.achievements).forEach(([achievementId, unlockedAt]) => {
    if (!achievementId || !unlockedAt) return;
    learningSyncManager.upsert(learningSyncRecord(
      "achievement",
      "achievement",
      [state.profile, achievementId],
      { unlocked_at: String(unlockedAt) },
      unlockedAt,
    ));
  });
}

function queueStudyRecordsForSync() {
  if (!canQueueLearningSync()) return;
  const records = sanitizeStudyRecords(state.studyRecords).map((record) => learningSyncRecord(
    "test_history",
    "history",
    [state.profile, record.id],
    record,
    record.finishedAt,
  ));
  learningSyncManager.replaceGroup(
    "test_history",
    learningSyncGroupPrefix("history", state.profile),
    records,
  );
}

function queueStudyGoalForSync(language = state.quizLanguage, profile = state.profile) {
  if (!canQueueLearningSync() || !LANGUAGE_LABELS[language]) return;
  const goal = Number.parseInt(localStorage.getItem(studyGoalKey(language, state.account, profile)), 10);
  if (!Number.isInteger(goal) || goal < 1 || goal > 500) return;
  learningSyncManager.upsert(learningSyncRecord("daily_goal", "goal", [profile, language], { goal }));
}

function queueLanguageSettingsForSync(language = state.quizLanguage) {
  if (!canQueueLearningSync() || !LANGUAGE_LABELS[language]) return;
  learningSyncManager.upsert(learningSyncRecord("language_settings", "settings", [language], {
    ...savedProjectPreferences(language),
    aiSuggestion: savedAiSuggestionSettings(language),
  }));
}

function queueActiveProfileForSync() {
  if (!canQueueLearningSync()) return;
  learningSyncManager.upsert(learningSyncRecord("learning_config", "config", ["active_profile"], {
    profile: state.profile,
  }));
}

async function syncLearningDataNow() {
  if (!learningSyncManager?.state) return;
  await learningSyncManager.syncNow();
}

function exportLearningSyncBackup() {
  if (!learningSyncManager?.state) return;
  try {
    downloadText(`wyj-learning-data-${Date.now()}.json`, learningSyncManager.exportBackup(), "application/json;charset=utf-8");
  } catch (error) {
    alert(`学习数据导出失败：${error.message}`);
  }
}

async function importLearningSyncBackup(event) {
  const file = event.target.files?.[0];
  if (!file || !learningSyncManager?.state) return;
  try {
    if (file.size > (learningSyncApi()?.MAX_BACKUP_BYTES || 5 * 1024 * 1024)) throw new Error("学习数据备份不能超过 5 MB");
    const result = learningSyncManager.importBackup(await file.text());
    alert(`学习数据已导入 ${result.imported} 项，忽略 ${result.ignored} 项旧记录。`);
  } catch (error) {
    alert(`学习数据导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
}

function loadStudyRecords() {
  if (!state.account?.id) {
    state.studyRecords = [];
    return;
  }
  state.studyRecords = sanitizeStudyRecords(loadJson(studyHistoryKey(), []));
}

function saveStudyRecords() {
  if (!state.account?.id) return;
  state.studyRecords = sanitizeStudyRecords(state.studyRecords);
  safeStorageSet(localStorage, studyHistoryKey(), JSON.stringify(state.studyRecords));
  queueStudyRecordsForSync();
  renderDashboard();
}

function appendWrongRejudgeLog(entry) {
  if (!state.account?.id || !entry?.word) return;
  const key = wrongRejudgeLogKey();
  const existing = loadJson(key, []);
  const identity = `${entry.word}|${entry.round_id || "legacy"}|${entry.original_answer || ""}`;
  const next = [
    ...existing.filter((item) => `${item?.word || ""}|${item?.round_id || "legacy"}|${item?.original_answer || ""}` !== identity),
    entry,
  ].slice(-MAX_REJUDGE_LOG_ITEMS);
  safeStorageSet(localStorage, key, JSON.stringify(next));
}

function migrateLegacyAccountData() {
  if (!state.account?.id) return;
  const accountId = accountStorageId();
  const migratedKey = `accountLocalDataMigrated:v${ACCOUNT_DATA_VERSION}:${accountId}`;
  if (localStorage.getItem(migratedKey)) return;
  const claimedKey = `accountLocalDataLegacyOwner:v${ACCOUNT_DATA_VERSION}`;
  const claimedBy = localStorage.getItem(claimedKey);
  if (!claimedBy || claimedBy === accountId) {
    const legacyProfile = sanitizeProfile(localStorage.getItem("vocabProfile") || DEFAULT_PROFILE);
    if (localStorage.getItem(accountProfileKey()) === null) {
      safeStorageSet(localStorage, accountProfileKey(), legacyProfile);
    }
    ["current", "history"].forEach((scope) => {
      const legacy = loadJson(`wrongBook:${scope}:${profileStorageName(legacyProfile)}`, {});
      const target = wrongBookKey(scope, state.account, legacyProfile);
      if (localStorage.getItem(target) === null && Object.keys(legacy).length) {
        safeStorageSet(localStorage, target, JSON.stringify(sanitizeWrongBook(legacy)));
      }
    });
    const legacyAchievements = loadJson(`achievements:${profileStorageName(legacyProfile)}`, {});
    const targetAchievements = achievementKey(state.account, legacyProfile);
    if (localStorage.getItem(targetAchievements) === null && Object.keys(legacyAchievements).length) {
      safeStorageSet(localStorage, targetAchievements, JSON.stringify(legacyAchievements));
    }
    safeStorageSet(localStorage, claimedKey, accountId);
  }
  safeStorageSet(localStorage, migratedKey, "1");
}

function migrateLegacyWrongBook() {
  const flag = `wrongBookMigrated:v${ACCOUNT_DATA_VERSION}:${accountStorageId()}:${profileStorageName(state.profile)}`;
  const legacy = loadJson("wrongBook", {});
  if (localStorage.getItem(flag) || !Object.keys(legacy).length) return;

  state.historyWrongBook = { ...legacy, ...state.historyWrongBook };
  safeStorageSet(localStorage, flag, "1");
  localStorage.removeItem("wrongBook");
}

function loadAccountLocalState() {
  if (!state.account?.id) return;
  migrateLegacyAccountData();
  state.profile = sanitizeProfile(localStorage.getItem(accountProfileKey()) || DEFAULT_PROFILE);
  if ($("profileInput")) $("profileInput").value = state.profile;
  loadWrongBooks();
  loadAchievements();
  loadStudyRecords();
}

function resetLocalViewState() {
  state.profile = DEFAULT_PROFILE;
  state.currentWrongBook = {};
  state.historyWrongBook = {};
  state.achievements = {};
  state.studyRecords = [];
  state.words = [];
  state.index = 0;
  state.score = 0;
  state.roundSkipped = 0;
  state.lastRound = null;
  state.quizSession = "";
  state.roundActive = false;
  state.answerLocked = false;
  state.pendingAdvance = null;
  state.roundStartedAt = 0;
  state.roundId = "";
  if ($("profileInput")) $("profileInput").value = state.profile;
}

function loadWrongBooks() {
  if (!state.account?.id) {
    state.currentWrongBook = {};
    state.historyWrongBook = {};
    return;
  }
  state.currentWrongBook = sanitizeWrongBook(loadJson(wrongBookKey("current"), {}));
  state.historyWrongBook = sanitizeWrongBook(loadJson(wrongBookKey("history"), {}));
  migrateLegacyWrongBook();
}

function saveWrongBooks() {
  if (!state.account?.id) return;
  safeStorageSet(localStorage, wrongBookKey("current"), JSON.stringify(state.currentWrongBook));
  safeStorageSet(localStorage, wrongBookKey("history"), JSON.stringify(state.historyWrongBook));
  queueWrongBooksForSync();
  renderDashboard();
}

function loadAchievements() {
  if (!state.account?.id) {
    state.achievements = {};
    return;
  }
  state.achievements = loadJson(achievementKey(), {});
}

function saveAchievements() {
  if (!state.account?.id) return;
  safeStorageSet(localStorage, achievementKey(), JSON.stringify(state.achievements));
  queueAchievementsForSync();
}

function loadProjectPreferences(language) {
  if (!LANGUAGE_LABELS[language]) return;
  const preferences = savedProjectPreferences(language);
  state.gradingMode = preferences.gradingMode;
  state.practiceMode = preferences.practiceMode;
  safeStorageSet(localStorage, projectPreferencesKey(language), JSON.stringify(preferences));
  if ($("gradingModeSelect")) $("gradingModeSelect").value = state.gradingMode;
  updatePracticeUi();
}

function saveProjectPreferences() {
  if (!LANGUAGE_LABELS[state.quizLanguage]) return;
  const preferences = {
    gradingMode: state.gradingMode,
    practiceMode: state.practiceMode,
  };
  safeStorageSet(localStorage, projectPreferencesKey(state.quizLanguage), JSON.stringify(preferences));
  safeStorageSet(localStorage, `gradingMode:${state.quizLanguage}`, state.gradingMode);
  safeStorageSet(localStorage, `practiceMode:${state.quizLanguage}`, state.practiceMode);
  queueLanguageSettingsForSync(state.quizLanguage);
}

function saveState() {
  safeStorageSet(localStorage, "vocabAppVersion", APP_VERSION);
  safeStorageSet(localStorage, "vocabProfile", state.profile);
  if (state.account?.id) safeStorageSet(localStorage, accountProfileKey(), state.profile);
  queueActiveProfileForSync();
  safeStorageSet(localStorage, "gradingMode", state.gradingMode);
  safeStorageSet(localStorage, "practiceMode", state.practiceMode);
  safeStorageSet(localStorage, "quizLanguage", state.quizLanguage);
  saveProjectPreferences();
  state.rubricCache = trimRubricCache(state.rubricCache);
  safeStorageSet(localStorage, "rubricCache", JSON.stringify(state.rubricCache));
  state.japaneseReadings = sanitizeJapaneseReadings(state.japaneseReadings);
  safeStorageSet(localStorage, JAPANESE_READING_CACHE_KEY, JSON.stringify(state.japaneseReadings));
  state.japaneseWrittenForms = sanitizeJapaneseWrittenForms(state.japaneseWrittenForms);
  safeStorageSet(localStorage, JAPANESE_WRITTEN_FORM_CACHE_KEY, JSON.stringify(state.japaneseWrittenForms));
  saveWrongBooks();
  saveAchievements();
}

function activeWrongBook(scope = state.wrongScope) {
  const source = scope === "history" ? state.historyWrongBook : state.currentWrongBook;
  return filterWrongBookByLanguage(source);
}

function hasLocalReviewData() {
  return Object.keys(activeWrongBook("current")).length > 0 || Object.keys(activeWrongBook("history")).length > 0;
}

function setActiveWrongBook(scope, book) {
  if (scope === "history") state.historyWrongBook = book;
  else state.currentWrongBook = book;
}

function clearSession() {
  stopLearningDataSync();
  releasePaymentQr();
  cancelVocabularySearch();
  state.session = "";
  state.account = null;
  state.quizSession = "";
  clearAccountSessionStorage();
  ["secretInput", "registerSecretInput", "registerConfirmInput", "currentSecretInput", "newSecretInput", "newSecretConfirmInput", "deleteSecretInput", "adminNewSecretInput"].forEach((id) => {
    const input = $(id);
    if (input) input.value = "";
  });
  clearOwnSecretEditor();
  clearAdminSecretEditor();
  resetLocalViewState();
  renderAccountUi();
}

function adoptExternalAccountSession(nextSession) {
  stopLearningDataSync();
  releasePaymentQr();
  cancelVocabularySearch();
  if (judgeController) judgeController.abort();
  clearNextTimer();
  hideResultPanel();
  state.session = nextSession;
  state.account = null;
  state.quizSession = "";
  localStorage.removeItem(ACCOUNT_CACHE_KEY);
  resetLocalViewState();
  pendingScreen = "workspace";
  pendingAuthMessage = "正在验证另一页面的登录状态…";
  renderAccountUi();
  scheduleBackendRecovery(0);
}

function accountEntitlements(account = state.account) {
  return accountEntitlementsModel(account);
}

function hasAccountEntitlement(code, account = state.account) {
  return hasAccountEntitlementModel(code, account);
}

function accountMembershipSummary(account = state.account) {
  return accountMembershipSummaryModel(account);
}

function isSuperAdmin(account = state.account) {
  return isSuperAdminModel(account);
}

function applyAccount(account) {
  const previousAccountId = String(state.account?.id || "");
  const nextAccountId = String(account?.id || "");
  state.account = account || null;
  if (state.account) safeStorageSet(localStorage, "wyjAccountCache", JSON.stringify(state.account));
  else localStorage.removeItem("wyjAccountCache");
  if (state.account && previousAccountId !== nextAccountId) {
    loadAccountLocalState();
    startLearningDataSync();
  }
  if (state.account && !learningSyncAccountId) startLearningDataSync();
  if (!state.account && previousAccountId) resetLocalViewState();
  renderAccountUi();
  updateStats();
  updateAiSuggestionControls();
}

function accountWordLimit(language = state.quizLanguage) {
  const account = state.account;
  if (!account) return 15;
  if (isSuperAdmin(account) || hasAccountEntitlement("language_all_access", account)) return Infinity;
  if (language === "japanese" && hasAccountEntitlement("language_japanese_access", account)) return Infinity;
  if (language === "english" && hasAccountEntitlement("language_english_access", account)) return Infinity;
  return 15;
}

function renderAccountUi() {
  const account = state.session && state.account ? state.account : null;
  const badge = $("accountBadge");
  if (!badge) return;
  const summary = accountMembershipSummary(account);
  $("accountBar")?.classList.remove("hidden");
  $("navGuestActions")?.classList.toggle("hidden", Boolean(account));
  $("accountMenu")?.classList.toggle("hidden", !account);
  if (!account && $("accountMenu")) $("accountMenu").open = false;
  if ($("navHomeLabel")) $("navHomeLabel").textContent = account ? "个人首页" : "首页";
  const activeNavigation = location.pathname.startsWith("/language")
    ? "language"
    : location.pathname.startsWith("/tools")
      ? "tools"
      : location.pathname === "/trial"
        ? (trialState.tool === "quiz" ? "language" : "tools")
        : location.pathname === "/changelog"
          ? "changelog"
          : ["/", "/select", "/login", "/register"].includes(location.pathname)
            ? "home"
            : "";
  document.querySelectorAll(".site-nav-links [data-site-nav]").forEach((link) => {
    const active = link.dataset.siteNav === activeNavigation;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  badge.textContent = account ? `${account.username} · ${summary.name}` : "未登录";
  $("membershipBtn")?.classList.toggle("hidden", !account);
  $("feedbackBtn")?.classList.toggle("hidden", !account);
  $("accountBtn")?.classList.toggle("hidden", !account);
  $("logoutBtn")?.classList.toggle("hidden", !account);
  $("adminBtn")?.classList.toggle("hidden", !isSuperAdmin(account));
  $("homeBtn")?.classList.toggle("hidden", !account || location.pathname === "/select");
  if ($("moduleMembershipStatus")) {
    $("moduleMembershipStatus").textContent = summary.permanent
      ? `${summary.name} · 永久有效`
      : `${summary.name}${summary.expires_at ? ` · 到期 ${formatLocalDateTime(summary.expires_at)}` : ""}`;
  }
  if ($("toolsMemberBadge")) {
    $("toolsMemberBadge").textContent = isSuperAdmin(account) || hasAccountEntitlement("tools_access", account)
      ? "可使用"
      : "会员功能";
    $("toolsMemberBadge").classList.toggle("active", Boolean(account && (isSuperAdmin(account) || hasAccountEntitlement("tools_access", account))));
  }
  renderAccountDetails();
  renderDashboard();
}

function renderAccountDetails() {
  const details = $("accountDetails");
  if (!details || !state.account) return;
  const account = state.account;
  const summary = accountMembershipSummary(account);
  const memberships = Array.isArray(account.memberships) ? account.memberships : [];
  const membershipText = memberships.length
    ? memberships.map((item) => {
      const expiry = item.is_lifetime ? "永久" : formatLocalDateTime(item.expires_at, "无到期时间");
      return `${item.plan_name || membershipLabel(item.plan_code)}（${expiry}）`;
    }).join("；")
    : "无";
  const entitlementText = accountEntitlements(account).size
    ? [...accountEntitlements(account)].map(entitlementLabel).join("、")
    : "基础功能";
  const rows = [
    ["用户名", account.username],
    ["用户 ID", account.id],
    ["账户类型", isSuperAdmin(account) ? "超级管理员" : "普通账户"],
    ["当前等级", summary.name],
    ["有效会员", membershipText],
    ["当前权益", entitlementText],
    ["注册时间", formatLocalDateTime(account.registered_at, "未知")],
    ["最后登录", formatLocalDateTime(account.last_login_at, "从未")],
  ];
  details.innerHTML = "";
  rows.forEach(([label, value]) => {
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    details.append(term, description);
  });
  $("changeSecretForm")?.classList.toggle("hidden", isSuperAdmin(account));
  $("openDeleteAccountBtn")?.closest(".danger-zone")?.classList.toggle("hidden", isSuperAdmin(account));
}

function dashboardGoal(language) {
  const stored = Number.parseInt(localStorage.getItem(studyGoalKey(language)), 10);
  const goal = Number.isInteger(stored) && stored >= 1 && stored <= 500 ? stored : 20;
  const today = localDayKey(new Date());
  const completed = state.studyRecords
    .filter((record) => record.language === language && localDayKey(record.finishedAt) === today)
    .reduce((sum, record) => sum + record.total, 0);
  return { completed, goal };
}

function setDashboardService(id, label, status) {
  const node = $(id);
  if (!node) return;
  node.textContent = label;
  node.classList.remove("is-online", "is-warning", "is-offline");
  node.classList.add(status);
}

function renderDashboardToolShelf(id, items, emptyMessage) {
  const target = $(id);
  if (!target) return;
  target.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "dashboard-empty";
    empty.textContent = emptyMessage;
    target.appendChild(empty);
    return;
  }
  items.slice(0, 5).forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dashboard-tool-link";
    button.textContent = item.name || item.tool_id;
    button.addEventListener("click", () => showTools(`/tools/${encodeURIComponent(item.tool_id)}`, true));
    target.appendChild(button);
  });
}

function changelogEntries() {
  return mergeChangelogEntries(cloudChangelogEntries || [], staticChangelogEntries(window));
}

function refreshCloudChangelog() {
  if (cloudChangelogPromise) return cloudChangelogPromise;
  cloudChangelogPromise = loadCloudChangelog()
    .then((entries) => {
      cloudChangelogEntries = entries;
      renderChangelog();
      renderLatestUpdate();
      return entries;
    })
    .catch(() => changelogEntries());
  return cloudChangelogPromise;
}

function latestChangelog() {
  return changelogEntries()[0] || null;
}

function changelogSectionMarkup(label, items) {
  if (!Array.isArray(items) || !items.length) return "";
  return `<section><h3>${escapeHtml(label)}</h3><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`;
}

function renderChangelog() {
  const list = $("changelogList");
  const entries = changelogEntries();
  if (!list) return;
  list.innerHTML = entries.map((entry) => `<article>
    <header class="changelog-entry-header"><time datetime="${escapeHtml(entry.date)}">${escapeHtml(String(entry.date || "").replaceAll("-", "/"))}</time><span>v${escapeHtml(entry.version)}</span></header>
    <div class="changelog-entry-content"><h2>${escapeHtml(entry.title)}</h2><div class="changelog-sections">
      ${changelogSectionMarkup("新功能", entry.features)}
      ${changelogSectionMarkup("优化", entry.improvements)}
      ${changelogSectionMarkup("修复", entry.fixes)}
      ${changelogSectionMarkup("安全更新", entry.security)}
    </div></div>
  </article>`).join("") || '<p class="dashboard-empty">暂无更新记录。</p>';
  const latest = latestChangelog();
  if ($("changelogCurrentVersion")) $("changelogCurrentVersion").textContent = latest ? `v${latest.version}` : APP_VERSION;
  if ($("siteVersionLabel")) $("siteVersionLabel").textContent = latest ? `v${latest.version}` : APP_VERSION;
}

function renderLatestUpdate() {
  const latest = latestChangelog();
  if (!latest) return;
  if ($("dashboardUpdateDate")) $("dashboardUpdateDate").textContent = `${latest.date.replaceAll("-", "/")} · v${latest.version}`;
  const highlights = [latest.features?.[0], latest.improvements?.[0], latest.fixes?.[0]].filter(Boolean);
  if ($("dashboardUpdateSummary")) $("dashboardUpdateSummary").textContent = highlights.join(" ") || latest.title;
}

function maybeShowVersionNotice() {
  const latest = latestChangelog();
  const notice = $("versionNotice");
  if (!latest || !notice || localStorage.getItem(CHANGELOG_SEEN_KEY) === latest.build) return;
  $("versionNoticeTitle").textContent = `已更新至 v${latest.version}`;
  $("versionNoticeMessage").textContent = latest.title;
  notice.classList.remove("hidden");
}

function dismissVersionNotice() {
  const latest = latestChangelog();
  if (latest) safeStorageSet(localStorage, CHANGELOG_SEEN_KEY, latest.build);
  $("versionNotice")?.classList.add("hidden");
}

function renderDashboard() {
  if (!$('modulePicker') || !state.account) return;
  const account = state.account;
  const summary = accountMembershipSummary(account);
  const entitlements = [...accountEntitlements(account)].map(entitlementLabel);
  const records = [...state.studyRecords].sort((left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt));
  const latest = records[0];
  const englishGoal = dashboardGoal("english");
  const japaneseGoal = dashboardGoal("japanese");

  $("dashboardGreeting").textContent = `${account.username}，欢迎回来`;
  $("dashboardMembershipName").textContent = summary.name || "普通用户";
  $("dashboardMembershipExpiry").textContent = summary.permanent
    ? "永久有效"
    : summary.expires_at
      ? `到期 ${formatLocalDateTime(summary.expires_at)}`
      : "无有效会员到期时间";
  $("dashboardEntitlements").textContent = entitlements.length ? entitlements.join("、") : "基础功能";
  $("dashboardStreak").textContent = String(calculateStudyStreak(records));
  $("dashboardWrongCount").textContent = String(Object.keys(state.historyWrongBook).length);
  $("dashboardEnglishGoal").textContent = `${englishGoal.completed} / ${englishGoal.goal} 题`;
  $("dashboardJapaneseGoal").textContent = `${japaneseGoal.completed} / ${japaneseGoal.goal} 题`;
  $("dashboardLatestResult").textContent = latest
    ? `最近一次：${quizLanguageLabel(latest.language)} ${practiceModeLabel(latest.practiceMode)}，${latest.total} 题，正确率 ${latest.accuracy}%`
    : "完成第一轮测试后显示结果。";

  const resumable = ["english", "japanese"].filter((language) => Boolean(loadProjectRuntime(language)?.roundActive));
  $("dashboardResumeSection").classList.toggle("hidden", !resumable.length);
  [["dashboardResumeEnglish", "english"], ["dashboardResumeJapanese", "japanese"]].forEach(([id, language]) => {
    $(id).classList.toggle("hidden", !resumable.includes(language));
  });

  const toolSummary = window.WYJTools?.getSummary?.() || { favorites: [], recent: [] };
  renderDashboardToolShelf("dashboardFavoriteTools", toolSummary.favorites || [], "还没有收藏工具。");
  renderDashboardToolShelf("dashboardRecentTools", toolSummary.recent || [], "还没有使用记录。");
  renderLatestUpdate();

  setDashboardService("dashboardAccountStatus", backendAvailable ? "在线" : "离线", backendAvailable ? "is-online" : "is-offline");
  renderLearningSyncDashboardStatus();
  setDashboardService(
    "dashboardAiStatus",
    !backendAvailable ? "网络不可用" : aiAvailable ? "可用" : "规则模式",
    backendAvailable && aiAvailable ? "is-online" : "is-warning",
  );
  const canShare = isSuperAdmin(account) || hasAccountEntitlement("temporary_share_access", account);
  setDashboardService(
    "dashboardShareStatus",
    canShare ? (backendAvailable ? "可用" : "离线") : "未开通",
    canShare && backendAvailable ? "is-online" : canShare ? "is-offline" : "is-warning",
  );
}

function feedbackTypeLabel(value) {
  return FEEDBACK_TYPE_LABELS[value] || value || "其他反馈";
}

function feedbackStatusLabel(value) {
  return FEEDBACK_STATUS_LABELS[value] || value || "待处理";
}

function feedbackMetadata(item) {
  return [
    item.route ? `页面 ${item.route}` : "",
    item.tool_id ? `工具 ${item.tool_id}` : "",
    item.app_version ? `版本 ${item.app_version}` : "",
    item.error_code ? `错误代码 ${item.error_code}` : "",
  ].filter(Boolean).join(" · ");
}

function renderMyFeedback(items) {
  const list = $("myFeedbackList");
  if (!list) return;
  list.innerHTML = (items || []).map((item) => `<article class="feedback-card">
    <header><div><span class="feedback-type">${escapeHtml(feedbackTypeLabel(item.type))}</span><h3>${escapeHtml(item.title)}</h3></div><span class="status-badge feedback-status" data-status="${escapeHtml(item.status)}">${escapeHtml(feedbackStatusLabel(item.status))}</span></header>
    <p class="feedback-card-content">${escapeHtml(item.content)}</p>
    ${feedbackMetadata(item) ? `<p class="feedback-card-meta">${escapeHtml(feedbackMetadata(item))}</p>` : ""}
    <footer><time>${escapeHtml(formatLocalDateTime(item.created_at, "未知"))}</time>${item.merged_into_id ? `<span>已合并至 ${escapeHtml(item.merged_into_id)}</span>` : ""}${["feature_suggestion", "new_tool"].includes(item.type) ? `<span>${escapeHtml(item.vote_count)} 票</span>` : ""}</footer>
  </article>`).join("") || '<p class="dashboard-empty">你还没有提交反馈。</p>';
}

function renderFeatureVoting(items) {
  const list = $("featureVotingList");
  if (!list) return;
  list.innerHTML = (items || []).map((item) => `<article class="feedback-card feedback-vote-card" data-feedback-id="${escapeHtml(item.id)}">
    <div><span class="feedback-type">${escapeHtml(feedbackTypeLabel(item.type))}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(feedbackStatusLabel(item.status))} · ${escapeHtml(item.vote_count)} 票</p></div>
    <button class="${item.voted ? "button-secondary active" : "button-secondary"}" type="button" data-feedback-vote aria-pressed="${String(Boolean(item.voted))}">${item.voted ? "取消投票" : "投一票"}</button>
  </article>`).join("") || '<p class="dashboard-empty">暂时没有开放投票的建议。建议需经管理员采纳后才会显示，提交者和反馈正文不会公开。</p>';
  list.querySelectorAll("[data-feedback-vote]").forEach((button) => button.addEventListener("click", () => voteForFeature(button.closest("[data-feedback-id]").dataset.feedbackId, button.getAttribute("aria-pressed") !== "true")));
}

function showFeedbackView(viewId) {
  document.querySelectorAll("[data-feedback-view]").forEach((button) => {
    const active = button.dataset.feedbackView === viewId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".feedback-view").forEach((view) => view.classList.toggle("active", view.id === viewId));
}

async function loadMyFeedback() {
  const sequence = ++feedbackLoadSequence;
  $("myFeedbackList").innerHTML = '<p class="dashboard-empty">正在加载你的反馈…</p>';
  try {
    const data = await apiGet("/api/feedback/mine");
    if (sequence !== feedbackLoadSequence) return;
    renderMyFeedback(data.feedback || []);
  } catch (error) {
    if (sequence !== feedbackLoadSequence) return;
    $("myFeedbackList").innerHTML = `<p class="dashboard-empty">${escapeHtml(error.message)}</p>`;
  }
}

async function loadFeatureVoting() {
  $("featureVotingList").innerHTML = '<p class="dashboard-empty">正在加载功能建议…</p>';
  try {
    const data = await apiGet("/api/feedback/voting");
    renderFeatureVoting(data.suggestions || []);
  } catch (error) {
    $("featureVotingList").innerHTML = `<p class="dashboard-empty">${escapeHtml(error.message)}</p>`;
  }
}

async function openFeedbackModal() {
  closeAccountMenu();
  if (!state.session || !state.account) {
    showAuth("登录后才能提交和查看自己的反馈", { mode: "login", path: "/login" });
    return;
  }
  $("feedbackMessage").textContent = "";
  showFeedbackView("feedbackSubmitView");
  openModal("feedbackModal");
  await Promise.allSettled([loadMyFeedback(), loadFeatureVoting()]);
}

async function submitFeedback(event) {
  event.preventDefault();
  const button = $("submitFeedbackBtn");
  if (button.disabled) return;
  button.disabled = true;
  $("feedbackMessage").textContent = "";
  try {
    await api("/api/feedback", {
      type: $("feedbackType").value,
      title: $("feedbackTitleInput").value.trim(),
      content: $("feedbackContent").value.trim(),
      route: $("feedbackIncludeRoute").checked ? location.pathname : "",
      tool_id: $("feedbackToolId").value.trim().toLowerCase(),
      app_version: $("feedbackIncludeVersion").checked ? APP_VERSION : "",
      browser_info: $("feedbackIncludeBrowser").checked ? navigator.userAgent.slice(0, 240) : "",
      error_code: $("feedbackErrorCode").value.trim(),
    });
    $("feedbackTitleInput").value = "";
    $("feedbackContent").value = "";
    $("feedbackToolId").value = "";
    $("feedbackErrorCode").value = "";
    $("feedbackMessage").textContent = "反馈已提交，管理员处理后会更新状态。";
    await loadMyFeedback();
    showFeedbackView("feedbackMineView");
  } catch (error) {
    $("feedbackMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function voteForFeature(feedbackId, voted) {
  const card = [...document.querySelectorAll("[data-feedback-id]")]
    .find((item) => item.dataset.feedbackId === feedbackId);
  const button = card?.querySelector("[data-feedback-vote]");
  if (button) button.disabled = true;
  try {
    await api("/api/feedback/vote", { feedback_id: feedbackId, voted });
    await Promise.allSettled([loadFeatureVoting(), loadMyFeedback()]);
    $("feedbackMessage").textContent = voted ? "投票已记录。" : "已取消投票。";
  } catch (error) {
    $("feedbackMessage").textContent = error.message;
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;
  if (!modalReturnFocus.has(id) && document.activeElement instanceof HTMLElement) {
    modalReturnFocus.set(id, document.activeElement);
  }
  modal.classList.remove("hidden", "is-closing");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  if ($("appShell")) $("appShell").inert = true;
  modal.querySelector("button, input, select")?.focus();
}

function closeModal(id, immediate = false) {
  const modal = $(id);
  if (!modal || modal.classList.contains("hidden")) return;
  if (id === "membershipModal") {
    membershipModalLoadSequence += 1;
    membershipModalController?.abort();
    membershipModalController = null;
    releasePaymentQr();
  }
  const finish = () => {
    modal.classList.add("hidden");
    modal.classList.remove("is-closing");
    modal.setAttribute("aria-hidden", "true");
    if (id === "accountModal") clearOwnSecretEditor();
    if (id === "adminEditModal") clearAdminSecretEditor();
    if (!document.querySelector(".modal-layer:not(.hidden)")) {
      document.body.classList.remove("modal-open");
      if ($("appShell")) $("appShell").inert = false;
    }
    const returnFocus = modalReturnFocus.get(id);
    modalReturnFocus.delete(id);
    if (returnFocus?.isConnected && !returnFocus.closest(".modal-layer.hidden")) returnFocus.focus();
    if ((id === "membershipModal" && location.pathname === "/recharge") || (id === "accountModal" && location.pathname === "/account")) {
      if (state.session && state.account) {
        showModulePicker(false);
        pushRoute("/select", true);
      }
    }
  };
  if (immediate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) finish();
  else {
    modal.classList.add("is-closing");
    window.setTimeout(finish, 180);
  }
}

function showAuthMode(mode, updateRoute = false) {
  const register = mode === "register";
  $("loginForm").classList.toggle("hidden", register);
  $("registerForm").classList.toggle("hidden", !register);
  $("showLoginBtn").classList.toggle("active", !register);
  $("showRegisterBtn").classList.toggle("active", register);
  $("showLoginBtn").setAttribute("aria-selected", String(!register));
  $("showRegisterBtn").setAttribute("aria-selected", String(register));
  $("authTitle").textContent = register ? "注册账户" : "账户登录";
  $("loginError").textContent = "";
  if (updateRoute) pushRoute(register ? "/register" : "/login");
}

async function registerAccount(event) {
  event.preventDefault();
  const button = $("registerSubmitBtn");
  if (button.disabled) return;
  $("loginError").textContent = "";
  button.disabled = true;
  try {
    $("loginError").textContent = "正在连接服务器…";
    if (!(await ensureBackendConnection())) throw new Error(backendFailureMessage);
    const username = $("registerUsernameInput").value.trim();
    const secret = $("registerSecretInput").value;
    const confirmSecret = $("registerConfirmInput").value;
    await api("/api/register", { username, secret, confirm_secret: confirmSecret });
    $("usernameInput").value = username;
    $("secretInput").value = secret;
    showAuthMode("login", true);
    $("loginError").textContent = "注册成功，请登录";
  } catch (error) {
    $("loginError").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function logoutAccount() {
  const session = state.session;
  const account = state.account;
  stopLearningDataSync();
  try {
    if (session) await api("/api/logout");
  } catch (_) {
    // Local cleanup still signs the browser out when the network is unavailable.
  }
  clearSavedWordDrafts(account);
  clearSession();
  pendingScreen = "auth";
  pendingAuthMessage = "已退出登录";
  showAuth(pendingAuthMessage, { path: "/login", replace: true });
}

function planDetails(plan) {
  return planDetailsModel(membershipPlans, plan);
}

function showRejudgeResultModal(title, message, tone = "info") {
  const modal = $("rejudgeResultModal");
  const panel = $("rejudgeResultPanel");
  if (!modal || !panel) return;
  rejudgeResultScrollPosition = { left: window.scrollX, top: window.scrollY };
  $("rejudgeResultTitle").textContent = title;
  $("rejudgeResultMessage").textContent = message;
  panel.dataset.tone = ["success", "warning", "error"].includes(tone) ? tone : "info";
  openModal("rejudgeResultModal");
}

function closeRejudgeResultModal() {
  const position = rejudgeResultScrollPosition;
  rejudgeResultScrollPosition = null;
  closeModal("rejudgeResultModal", true);
  if (!position) return;
  window.requestAnimationFrame(() => {
    window.scrollTo(position.left, position.top);
    window.requestAnimationFrame(() => window.scrollTo(position.left, position.top));
  });
}

function membershipGoalForCurrentContext() {
  if (location.pathname.startsWith("/tools")) return "tools";
  if (currentProject === "english" || state.quizLanguage === "english") return "english";
  if (currentProject === "japanese" || state.quizLanguage === "japanese") return "japanese";
  return "";
}

function updateMembershipPurchaseSummary() {
  const summary = $("purchaseSummary");
  if (!summary) return;
  const goal = MEMBERSHIP_GOALS[selectedMembershipGoal];
  if (!goal) {
    summary.textContent = "请先选择需要的功能";
    return;
  }
  if (!selectedRechargePlan) {
    summary.textContent = `已选择：${goal.label}。请选择适合的套餐。`;
    return;
  }
  const [name, price, description] = planDetails(selectedRechargePlan);
  const method = normalizedPaymentMethod(selectedPaymentMethod);
  summary.textContent = `${name} · ${price} · ${method ? paymentMethodLabel(method) : "请选择支付方式"} · ${description}`;
}

function normalizedPaymentMethod(value) {
  return normalizedPaymentMethodModel(value, paymentMethods);
}

function paymentMethodLabel(value) {
  return paymentMethodLabelModel(value, paymentMethods);
}

function renderPaymentMethods() {
  const list = $("paymentMethodList");
  if (!list) return;
  const methods = paymentMethods.length ? paymentMethods : DEFAULT_PAYMENT_METHODS;
  selectedPaymentMethod = normalizedPaymentMethod(selectedPaymentMethod);
  list.innerHTML = methods.map((item) => `<label>
    <input type="radio" name="paymentMethod" value="${escapeHtml(item.code)}" ${item.code === selectedPaymentMethod ? "checked" : ""} />
    <span>${escapeHtml(item.name)}</span>
  </label>`).join("");
  list.querySelectorAll('input[name="paymentMethod"]').forEach((input) => {
    input.addEventListener("change", () => {
      selectedPaymentMethod = normalizedPaymentMethod(input.value);
      updateMembershipPurchaseSummary();
      $("submitRechargeBtn").disabled = !selectedRechargePlan || !selectedPaymentMethod;
      $("rechargeMessage").textContent = selectedPaymentMethod
        ? `已选择${paymentMethodLabel(selectedPaymentMethod)}，确认套餐后即可创建订单。`
        : "请先选择微信支付或支付宝。";
    });
  });
}

function setPaymentControlsLocked(locked) {
  document.querySelectorAll("[data-membership-goal]").forEach((button) => {
    button.disabled = locked;
  });
  document.querySelectorAll("[data-plan]").forEach((button) => {
    button.disabled = locked;
  });
  document.querySelectorAll('input[name="paymentMethod"]').forEach((input) => {
    input.disabled = locked;
  });
  if ($("trialLanguageSelect")) {
    $("trialLanguageSelect").disabled = locked || selectedRechargePlan === "trial_single_language";
  }
}

function releasePaymentQr() {
  if (paymentQrController) {
    paymentQrController.abort();
    paymentQrController = null;
  }
  if (paymentQrObjectUrl) {
    URL.revokeObjectURL(paymentQrObjectUrl);
    paymentQrObjectUrl = "";
  }
  const image = $("paymentQrImage");
  if (image) image.removeAttribute("src");
  $("paymentQrWrap")?.classList.add("hidden");
  if ($("paymentQrMessage")) $("paymentQrMessage").textContent = "";
}

function waitForImageReady(image, signal, timeoutMs = 4000) {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
      signal?.removeEventListener("abort", handleAbort);
      if (error) reject(error);
      else resolve();
    };
    const handleLoad = () => finish();
    const handleError = () => finish(new Error("二维码图片无法解码"));
    const handleAbort = () => {
      const error = new Error("请求已取消");
      error.name = "AbortError";
      finish(error);
    };
    const timer = window.setTimeout(() => finish(new Error("二维码图片加载超时")), timeoutMs);
    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", handleError, { once: true });
    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    if (typeof image.decode === "function") {
      image.decode().then(handleLoad).catch(() => {
        if (image.complete && image.naturalWidth > 0) handleLoad();
      });
    }
  });
}

async function loadPaymentQr(record, modalSequence = membershipModalLoadSequence) {
  releasePaymentQr();
  if (!record?.id || !["pending_payment", "user_paid", "processing"].includes(record.status)) return;
  if (!normalizedPaymentMethod(record.payment_method)) {
    $("rechargeMessage").textContent = "该订单没有有效支付方式，不能加载二维码。请取消后重新创建订单。";
    return;
  }
  if ($("membershipModal")?.classList.contains("hidden")) return;
  const wrap = $("paymentQrWrap");
  const image = $("paymentQrImage");
  const message = $("paymentQrMessage");
  wrap.classList.remove("hidden");
  image.classList.add("hidden");
  message.textContent = "正在安全加载当前订单二维码…";
  const controller = new AbortController();
  paymentQrController = controller;
  try {
    const response = await fetchWithTimeout(
      `/api/recharge/qr?request_id=${encodeURIComponent(record.id)}`,
      {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-Session-Token": state.session },
        controller,
      },
      API_GET_TIMEOUT_MS,
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (isCanonicalSessionFailure(data)) {
        clearSession();
        showAuth(data.error || "登录已失效，请重新登录", { replace: true });
        return;
      }
      throw new Error(data.error || "二维码暂时无法加载");
    }
    const contentType = response.headers.get("Content-Type") || "";
    if (!contentType.startsWith("image/png")) throw new Error("二维码资源格式无效");
    const blob = await response.blob();
    if (!blob.size || blob.size > 3 * 1024 * 1024) throw new Error("二维码资源大小无效");
    if (currentPaymentOrder?.id !== record.id || controller.signal.aborted || modalSequence !== membershipModalLoadSequence) return;
    paymentQrObjectUrl = URL.createObjectURL(blob);
    image.src = paymentQrObjectUrl;
    await waitForImageReady(image, controller.signal);
    if (currentPaymentOrder?.id !== record.id || controller.signal.aborted || modalSequence !== membershipModalLoadSequence) return;
    image.classList.remove("hidden");
    message.textContent = "请核对金额、套餐和支付方式后扫码。";
  } catch (error) {
    if (error.name !== "AbortError" && modalSequence === membershipModalLoadSequence) {
      message.textContent = error.message;
    }
  } finally {
    if (paymentQrController === controller) paymentQrController = null;
  }
}

function renderMembershipGoals() {
  document.querySelectorAll("[data-membership-goal]").forEach((button) => {
    const selected = button.dataset.membershipGoal === selectedMembershipGoal;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const config = MEMBERSHIP_GOALS[selectedMembershipGoal];
  if ($("membershipGoalHint")) {
    $("membershipGoalHint").textContent = config
      ? `${config.label}：${config.description}`
      : "先选择用途，页面只会显示适合该用途的套餐。";
  }
}

function resetRechargeOrderUi() {
  $("submitRechargeBtn").textContent = "确认订单并显示二维码";
  $("confirmPaymentBtn").classList.add("hidden");
  $("cancelPaymentOrderBtn").classList.add("hidden");
  $("paymentOrderBox").classList.add("hidden");
}

function renderMembershipPlans() {
  const list = $("membershipPlanList");
  const config = MEMBERSHIP_GOALS[selectedMembershipGoal];
  $("membershipPlanStep")?.classList.toggle("hidden", !config);
  if (list) {
    const visiblePlans = config
      ? membershipPlans.filter((item) => config.plans.includes(item.code))
      : [];
    if (!config) {
      list.innerHTML = "";
    } else if (membershipPlans.length) {
      list.innerHTML = visiblePlans.map((item) => `<button class="plan-option" data-plan="${escapeHtml(item.code)}" type="button" aria-pressed="${item.code === selectedRechargePlan}">
        <strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.price)} ${escapeHtml(item.currency)}${item.duration_months ? "/月" : ""}</span><small>${escapeHtml(item.description)}</small>
      </button>`).join("");
      list.querySelectorAll("[data-plan]").forEach((button) => {
        button.classList.toggle("selected", button.dataset.plan === selectedRechargePlan);
        button.addEventListener("click", () => selectRechargePlan(button.dataset.plan));
      });
    }
  }
  const singleLanguage = selectedRechargePlan === "trial_single_language";
  $("trialLanguageField")?.classList.toggle("hidden", !singleLanguage);
  if ($("trialLanguageSelect")) {
    $("trialLanguageSelect").required = singleLanguage;
    if (singleLanguage && config?.trialLanguage) $("trialLanguageSelect").value = config.trialLanguage;
  }
  $("paymentMethodField")?.classList.toggle("hidden", !selectedRechargePlan);
  renderPaymentMethods();
  updateMembershipPurchaseSummary();
  $("submitRechargeBtn").disabled = !selectedRechargePlan || !selectedPaymentMethod;
  setPaymentControlsLocked(Boolean(currentPaymentOrder && ["pending_payment", "user_paid", "processing"].includes(currentPaymentOrder.status)));
  if (membershipPlans.length) $("membershipPlanRecovery")?.classList.add("hidden");
}

function selectMembershipGoal(goal, options = {}) {
  const normalized = normalizedMembershipGoal(goal);
  if (!options.preserveOrder) {
    releasePaymentQr();
    currentPaymentOrder = null;
    selectedPaymentMethod = "";
    resetRechargeOrderUi();
  }
  selectedMembershipGoal = normalized;
  if (!options.preservePlan || !membershipGoalAllowsPlan(normalized, selectedRechargePlan)) {
    selectedRechargePlan = "";
  }
  const trialLanguage = MEMBERSHIP_GOALS[normalized]?.trialLanguage;
  if (trialLanguage && $("trialLanguageSelect")) $("trialLanguageSelect").value = trialLanguage;
  renderMembershipGoals();
  renderMembershipPlans();
  if (!options.preserveOrder) $("rechargeMessage").textContent = "";
}

function showMembershipPlanRecovery(message) {
  if (!membershipPlans.length) $("membershipPlanList").innerHTML = "";
  $("membershipPlanError").textContent = message || "会员方案暂时无法加载。";
  $("membershipPlanRecovery").classList.remove("hidden");
}

async function loadMembershipPlans(force = false, options = {}) {
  if (membershipPlans.length && !force) {
    renderMembershipPlans();
    return membershipPlans;
  }
  if (membershipPlansPromise) return membershipPlansPromise;
  const list = $("membershipPlanList");
  list?.setAttribute("aria-busy", "true");
  if (!membershipPlans.length && list) list.innerHTML = '<p class="plan-loading">正在连接服务器并加载会员方案…</p>';
  $("membershipPlanRecovery")?.classList.add("hidden");

  membershipPlansPromise = (async () => {
    const data = await requestJsonGet("/api/membership/plans", {
      timeoutMs: STATUS_TIMEOUT_MS,
      controller: options.controller,
    });
    if (!Array.isArray(data.plans) || !data.plans.length) throw new Error("服务器没有返回可购买的会员方案");
    paymentMethods = Array.isArray(data.payment_methods) ? data.payment_methods.filter((item) => ["wechat", "alipay"].includes(item.code)) : [];
    const rank = (code) => {
      const index = MEMBERSHIP_PLAN_ORDER.indexOf(code);
      return index < 0 ? MEMBERSHIP_PLAN_ORDER.length : index;
    };
    membershipPlans = [...data.plans].sort((left, right) => rank(left.code) - rank(right.code));
    renderMembershipPlans();
    return membershipPlans;
  })().catch((error) => {
    if (error?.name !== "AbortError") {
      showMembershipPlanRecovery(`${error.message} 请点击下方按钮重试。`);
    }
    throw error;
  }).finally(() => {
    list?.setAttribute("aria-busy", "false");
    membershipPlansPromise = null;
  });
  return membershipPlansPromise;
}

async function reloadMembershipPlans() {
  const button = $("retryMembershipPlansBtn");
  button.disabled = true;
  $("rechargeMessage").textContent = "正在重新连接并加载套餐…";
  try {
    await loadMembershipPlans(true);
    selectRechargePlan("");
    $("rechargeMessage").textContent = selectedMembershipGoal
      ? "套餐已重新加载，请选择方案。"
      : "套餐已重新加载，请先选择需要的功能。";
  } catch (error) {
    $("rechargeMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function openMembershipModal(options = {}) {
  if (!state.session || !state.account) {
    showAuth("请先登录后查看会员方案", { path: "/login" });
    return;
  }
  membershipModalController?.abort();
  const controller = new AbortController();
  membershipModalController = controller;
  const sequence = ++membershipModalLoadSequence;
  releasePaymentQr();
  currentPaymentOrder = null;
  selectedRechargePlan = "";
  selectedPaymentMethod = "";
  selectedMembershipGoal = normalizedMembershipGoal(options.goal);
  resetRechargeOrderUi();
  renderMembershipGoals();
  renderMembershipPlans();
  $("rechargeMessage").textContent = "正在加载套餐与订单状态…";
  openModal("membershipModal");
  let openOrder = null;
  const loadErrors = [];
  const [plansResult, ordersResult] = await Promise.allSettled([
    loadMembershipPlans(options.forcePlans === true, { controller }),
    apiGet("/api/recharge/mine", { controller }),
  ]);
  if (sequence !== membershipModalLoadSequence) return membershipPlans;
  if (plansResult.status === "rejected" && plansResult.reason?.name !== "AbortError") {
    loadErrors.push(plansResult.reason?.message || "会员方案加载失败");
  }
  if (ordersResult.status === "fulfilled") {
    const restoredOrder = (ordersResult.value.requests || []).find((item) => ["pending_payment", "user_paid", "processing"].includes(item.status)) || null;
    if (restoredOrder && normalizedPaymentMethod(restoredOrder.payment_method)) {
      openOrder = restoredOrder;
    } else if (restoredOrder) {
      loadErrors.push("未完成订单缺少有效支付方式，服务器将关闭该旧订单，请重新创建");
    }
  } else if (ordersResult.reason?.name !== "AbortError") {
    loadErrors.push(ordersResult.reason?.message || "订单状态加载失败");
  }
  if (!state.session || !state.account) {
    closeModal("membershipModal", true);
    return;
  }
  if (openOrder) {
    selectedMembershipGoal = membershipGoalAllowsPlan(selectedMembershipGoal, openOrder.plan_code)
      ? selectedMembershipGoal
      : membershipGoalForPlan(openOrder.plan_code, openOrder.trial_language);
    renderPaymentOrder(openOrder);
    $("rechargeMessage").textContent = {
      pending_payment: "订单金额和支付方式已锁定。请扫码付款，再点击“我已付款”。",
      user_paid: "已通知管理员，正在等待人工核对付款。",
      processing: "管理员正在核对付款，请稍候。",
    }[openOrder.status] || "订单处理中。";
  } else if (loadErrors.length) {
    $("rechargeMessage").textContent = `${[...new Set(loadErrors)].join("；")} 已加载的内容仍可使用。`;
  } else {
    $("rechargeMessage").textContent = selectedMembershipGoal
      ? "请选择适合的会员方案。"
      : "请先选择你需要的功能。";
  }
  return membershipPlans;
}

function selectRechargePlan(plan, options = {}) {
  const planCode = String(plan || "").trim();
  if (planCode && !selectedMembershipGoal) {
    selectedMembershipGoal = membershipGoalForPlan(planCode, $("trialLanguageSelect")?.value);
  }
  if (planCode && membershipPlans.some((item) => item.code === planCode) && !membershipGoalAllowsPlan(selectedMembershipGoal, planCode)) return;
  if (!options.preserveOrder) releasePaymentQr();
  if (!options.preserveOrder && planCode !== selectedRechargePlan) selectedPaymentMethod = "";
  selectedRechargePlan = planCode;
  if (!options.preserveOrder) {
    currentPaymentOrder = null;
    resetRechargeOrderUi();
  }
  renderMembershipGoals();
  renderMembershipPlans();
  if (!options.preserveOrder) $("rechargeMessage").textContent = "";
}

function renderPaymentOrder(record) {
  if (!record) return;
  const orderPaymentMethod = normalizedPaymentMethod(record.payment_method);
  if (!orderPaymentMethod) {
    releasePaymentQr();
    currentPaymentOrder = null;
    selectedPaymentMethod = "";
    resetRechargeOrderUi();
    renderMembershipPlans();
    $("rechargeMessage").textContent = "该旧订单没有有效支付方式，不能恢复或确认付款。请重新创建订单。";
    return;
  }
  currentPaymentOrder = record;
  selectedMembershipGoal = membershipGoalAllowsPlan(selectedMembershipGoal, record.plan_code)
    ? selectedMembershipGoal
    : membershipGoalForPlan(record.plan_code, record.trial_language);
  selectedRechargePlan = record.plan_code;
  selectedPaymentMethod = orderPaymentMethod;
  renderMembershipGoals();
  renderMembershipPlans();
  setPaymentControlsLocked(true);
  document.querySelectorAll("[data-plan]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.plan === record.plan_code);
  });
  const plan = membershipPlans.find((item) => item.code === record.plan_code);
  $("paymentUsername").textContent = record.username || state.account?.username || "-";
  $("paymentPlan").textContent = record.plan_name || plan?.name || membershipLabel(record.plan_code);
  const languageLabel = { english: "英语", japanese: "日语" }[record.trial_language] || "";
  $("paymentLanguageTerm").classList.toggle("hidden", !languageLabel);
  $("paymentLanguage").classList.toggle("hidden", !languageLabel);
  $("paymentLanguage").textContent = languageLabel || "-";
  if (languageLabel) $("trialLanguageSelect").value = record.trial_language;
  $("paymentMethod").textContent = paymentMethodLabel(orderPaymentMethod);
  $("paymentAmount").textContent = `${(Number(record.amount_cents || 0) / 100).toFixed(2)} ${record.currency || "CNY"}`;
  $("paymentOrderNumber").textContent = record.order_number || "-";
  $("paymentNote").textContent = record.payment_note || "-";
  $("paymentStatus").textContent = paymentStatusLabel(record.status);
  $("paymentQrLabel").textContent = `请使用${paymentMethodLabel(orderPaymentMethod)}扫码付款`;
  $("paymentOrderBox").classList.remove("hidden");
  $("confirmPaymentBtn").classList.toggle("hidden", record.status !== "pending_payment");
  $("cancelPaymentOrderBtn").classList.toggle("hidden", record.status !== "pending_payment");
  $("submitRechargeBtn").textContent = {
    pending_payment: "订单已锁定",
    user_paid: "等待管理员确认",
    processing: "管理员核对中",
  }[record.status] || "确认订单并显示二维码";
  $("submitRechargeBtn").disabled = ["pending_payment", "user_paid", "processing"].includes(record.status);
  loadPaymentQr(record, membershipModalLoadSequence);
}

async function submitRechargeRequest() {
  if (!state.account || !state.session) {
    closeModal("membershipModal", true);
    showAuth("请先登录后再提交充值申请", { path: "/login", replace: true });
    return;
  }
  const button = $("submitRechargeBtn");
  if (currentPaymentOrder && ["pending_payment", "user_paid", "processing"].includes(currentPaymentOrder.status)) return;
  if (!selectedRechargePlan) {
    $("rechargeMessage").textContent = "请先选择会员套餐。";
    return;
  }
  const paymentMethod = normalizedPaymentMethod(selectedPaymentMethod);
  if (!paymentMethod) {
    $("rechargeMessage").textContent = "请先选择微信支付或支付宝。";
    $("paymentMethodField")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  button.disabled = true;
  try {
    const data = await api("/api/recharge/request", {
      plan: selectedRechargePlan,
      payment_method: paymentMethod,
      trial_language: selectedRechargePlan === "trial_single_language" ? $("trialLanguageSelect").value : "",
    });
    if (normalizedPaymentMethod(data.request?.payment_method) !== paymentMethod) {
      throw new Error("订单支付方式保存失败，请刷新订单状态后重试");
    }
    renderPaymentOrder(data.request);
    $("rechargeMessage").textContent = data.created
      ? "订单已生成并锁定。请核对二维码、金额与备注，付款后再点“我已付款”。"
      : "你已有未完成订单，已为你显示原订单。";
  } catch (error) {
    $("rechargeMessage").textContent = error.message;
  } finally {
    button.disabled = !selectedRechargePlan || !selectedPaymentMethod || ["pending_payment", "user_paid", "processing"].includes(currentPaymentOrder?.status);
  }
}

async function cancelRechargeOrder() {
  if (!currentPaymentOrder?.id || currentPaymentOrder.status !== "pending_payment") return;
  const button = $("cancelPaymentOrderBtn");
  button.disabled = true;
  try {
    await api("/api/recharge/cancel", { request_id: currentPaymentOrder.id });
    const retainedPlan = currentPaymentOrder.plan_code;
    const retainedGoal = membershipGoalAllowsPlan(selectedMembershipGoal, retainedPlan)
      ? selectedMembershipGoal
      : membershipGoalForPlan(retainedPlan, currentPaymentOrder.trial_language);
    releasePaymentQr();
    currentPaymentOrder = null;
    selectedMembershipGoal = retainedGoal;
    selectRechargePlan(retainedPlan);
    $("rechargeMessage").textContent = "原订单已取消。现在可以更换套餐或支付方式并创建新订单。";
  } catch (error) {
    $("rechargeMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function confirmRechargePayment() {
  if (!currentPaymentOrder?.id || currentPaymentOrder.status !== "pending_payment") return;
  if (!normalizedPaymentMethod(currentPaymentOrder.payment_method)) {
    $("rechargeMessage").textContent = "订单没有有效支付方式，不能通知管理员。请取消后重新创建订单。";
    return;
  }
  const button = $("confirmPaymentBtn");
  button.disabled = true;
  try {
    const data = await api("/api/recharge/confirm", { request_id: currentPaymentOrder.id });
    renderPaymentOrder(data.request);
    $("rechargeMessage").textContent = "已通知管理员。只有管理员核对付款后才会开通会员。";
  } catch (error) {
    $("rechargeMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function changeOwnSecret(event) {
  event.preventDefault();
  const message = $("accountMessage");
  const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
  const newSecret = $("newSecretInput").value;
  const confirmation = $("newSecretConfirmInput").value;
  if (newSecret !== confirmation) {
    message.textContent = "两次输入的新登录密钥不一致";
    $("newSecretConfirmInput").focus();
    return;
  }
  button.disabled = true;
  try {
    await api("/api/account/secret", {
      current_secret: $("currentSecretInput").value,
      new_secret: newSecret,
      confirm_secret: confirmation,
    });
    message.textContent = "密钥已修改，请使用新密钥重新登录";
    window.setTimeout(() => {
      closeModal("accountModal", true);
      clearSession();
      showAuth("密钥已修改，请重新登录");
    }, 700);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function deleteOwnAccount(event) {
  event.preventDefault();
  const button = $("confirmDeleteAccountBtn");
  button.disabled = true;
  stopLearningDataSync();
  try {
    const deletedAccount = state.account;
    await api("/api/account/delete", { secret: $("deleteSecretInput").value });
    closeModal("deleteAccountModal", true);
    closeModal("accountModal", true);
    clearAccountLocalData(deletedAccount);
    clearSession();
    showAuth("账户已注销", { path: "/login", replace: true });
    alert("账户已永久注销");
  } catch (error) {
    startLearningDataSync();
    $("accountMessage").textContent = error.message;
    closeModal("deleteAccountModal");
  } finally {
    button.disabled = false;
  }
}

async function copyTextWithFeedback(value, button) {
  if (!button) return false;
  const originalLabel = button.dataset.copyLabel || button.textContent;
  button.dataset.copyLabel = originalLabel;
  const copied = await writeClipboardText(value);
  button.textContent = copied ? "已复制" : "复制失败";
  window.setTimeout(() => {
    if (button.isConnected) button.textContent = button.dataset.copyLabel || originalLabel;
  }, 1600);
  return copied;
}

function clearAdminSecretResult() {
  const result = $("adminSecretResult");
  const value = $("adminSecretResultValue");
  if (value) value.textContent = "";
  if (result) result.classList.add("hidden");
}

function setAdminSecretVisibility(visible) {
  const input = $("adminNewSecretInput");
  const button = $("toggleAdminSecretBtn");
  if (input) input.type = visible ? "text" : "password";
  if (button) {
    button.textContent = visible ? "隐藏" : "显示";
    button.setAttribute("aria-pressed", String(Boolean(visible)));
  }
}

function clearAdminSecretEditor() {
  const input = $("adminNewSecretInput");
  if (input) input.value = "";
  setAdminSecretVisibility(false);
  clearAdminSecretResult();
}

function secureRandomIndex(maximum) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 0x100000000) {
    throw new Error("随机范围无效");
  }
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("当前浏览器不支持安全随机数，请手动设置新密钥");
  }
  const values = new Uint32Array(1);
  const range = 0x100000000;
  const limit = range - (range % maximum);
  do globalThis.crypto.getRandomValues(values); while (values[0] >= limit);
  return values[0] % maximum;
}

function generateSecureSecret(length = 24) {
  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%*-_=+?",
  ];
  const all = groups.join("");
  const characters = groups.map((group) => group[secureRandomIndex(group.length)]);
  while (characters.length < length) characters.push(all[secureRandomIndex(all.length)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandomIndex(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
}

function generateAdminSecretForEditor() {
  try {
    const input = $("adminNewSecretInput");
    input.value = generateSecureSecret();
    clearAdminSecretResult();
    setAdminSecretVisibility(true);
    $("adminEditMessage").textContent = "已生成安全密钥；保存后请把它交给该用户。";
    input.focus();
    input.select();
  } catch (error) {
    $("adminEditMessage").textContent = error.message;
  }
}

function setSecretFieldsVisibility(inputIds, buttonId, visible) {
  inputIds.forEach((id) => {
    const input = $(id);
    if (input) input.type = visible ? "text" : "password";
  });
  const button = $(buttonId);
  if (button) {
    button.textContent = visible ? "隐藏" : "显示";
    button.setAttribute("aria-pressed", String(Boolean(visible)));
  }
}

function clearOwnSecretEditor() {
  ["currentSecretInput", "newSecretInput", "newSecretConfirmInput"].forEach((id) => {
    const input = $(id);
    if (input) input.value = "";
  });
  setSecretFieldsVisibility(["currentSecretInput"], "toggleCurrentSecretBtn", false);
  setSecretFieldsVisibility(["newSecretInput", "newSecretConfirmInput"], "toggleNewSecretBtn", false);
}

function generateOwnSecret() {
  try {
    const secret = generateSecureSecret();
    $("newSecretInput").value = secret;
    $("newSecretConfirmInput").value = secret;
    setSecretFieldsVisibility(["newSecretInput", "newSecretConfirmInput"], "toggleNewSecretBtn", true);
    $("accountMessage").textContent = "已生成安全密钥；保存前请确认你已记住或安全保存。";
    $("newSecretInput").focus();
    $("newSecretInput").select();
  } catch (error) {
    $("accountMessage").textContent = error.message;
  }
}

function adminUserById(id) {
  return adminUsers.find((user) => user.id === id);
}

function renderAdminUsers(users = null) {
  if (Array.isArray(users)) adminUsers = users;
  const list = $("adminUserList");
  const query = $("adminUserSearch")?.value.trim().toLocaleLowerCase() || "";
  const visibleUsers = query
    ? adminUsers.filter((user) => [user.username, user.id].some((value) => String(value || "").toLocaleLowerCase().includes(query)))
    : adminUsers;
  const count = $("adminUserCount");
  if (count) count.textContent = query ? `显示 ${visibleUsers.length} / ${adminUsers.length} 个用户` : `共 ${adminUsers.length} 个用户`;
  list.innerHTML = visibleUsers.map((user) => {
    const protectedUser = user.is_super_admin;
    const stateClass = user.banned ? "account-state-bad" : "account-state-good";
    const summary = accountMembershipSummary(user);
    const memberships = (user.memberships || []).map((item) => `${item.plan_name || membershipLabel(item.plan_code)}${item.is_lifetime ? " · 永久" : item.expires_at ? ` · 至 ${formatLocalDateTime(item.expires_at)}` : ""}`).join("；") || "无有效会员";
    const entitlements = (user.entitlements || []).map((item) => ({
      language_japanese_access: "日语",
      language_english_access: "英语",
      language_all_access: "全部语言",
      tools_access: "工具箱",
      tools_batch_access: "批量处理",
      temporary_share_access: "临时分享",
      save_tool_config: "配置保存",
      all_features_access: "全功能",
    }[item] || item)).join("、") || "基础功能";
    return `<article class="admin-user-card" data-user-id="${escapeHtml(user.id)}">
      <div class="admin-user-identity"><h3>${escapeHtml(user.username)}</h3><p class="admin-user-id">${escapeHtml(user.id)}</p><p class="${stateClass}">${user.banned ? "已永久封禁" : "正常"}</p></div>
      <div class="admin-user-facts"><p><span>最高等级</span><strong>${escapeHtml(summary.name)}</strong></p><p><span>有效会员</span><strong>${escapeHtml(memberships)}</strong></p><p><span>合并权益</span><strong>${escapeHtml(entitlements)}</strong></p></div>
      <div class="admin-user-security"><p><span class="admin-field-name">登录密钥</span><span class="secret-value">不可读取 · 可安全重置</span></p><p class="admin-last-login">最后登录：${escapeHtml(formatLocalDateTime(user.last_login_at, "从未"))}</p></div>
      <div class="action-row compact admin-user-actions"><button data-admin-edit type="button" ${protectedUser ? "disabled" : ""}>编辑</button></div>
    </article>`;
  }).join("") || `<p class="admin-empty-state">${query ? "没有匹配的用户" : "暂无用户"}</p>`;
  list.querySelectorAll("[data-admin-edit]").forEach((button) => button.addEventListener("click", () => openAdminEditor(button.closest("[data-user-id]").dataset.userId)));
}

function renderAdminRecharge(requests) {
  const list = $("adminRechargeList");
  list.innerHTML = (requests || []).map((request) => `<article class="admin-user-card" data-request-id="${escapeHtml(request.id)}">
    <div class="admin-user-identity"><h3>${escapeHtml(request.username)}</h3><p class="admin-user-id">${escapeHtml(request.order_number || request.id)}</p><p class="admin-last-login">申请：${escapeHtml(formatLocalDateTime(request.requested_at, "未知"))}</p></div>
    <div class="admin-user-facts"><p><span>套餐</span><strong>${escapeHtml(request.plan_name || membershipLabel(request.plan_code || request.plan))}</strong></p><p><span>支付方式</span><strong>${escapeHtml(paymentMethodLabel(request.payment_method))}</strong></p><p><span>金额</span><strong>${escapeHtml(`${(Number(request.amount_cents || 0) / 100).toFixed(2)} ${request.currency || "CNY"}`)}</strong></p><p><span>付款备注</span><strong>${escapeHtml(request.payment_note || "-")}</strong></p></div>
    <div class="admin-request-status"><span>状态</span><strong>${escapeHtml(rechargeStatusLabel(request.status))}</strong>${request.user_confirmed_at ? `<small>用户确认：${escapeHtml(formatLocalDateTime(request.user_confirmed_at))}</small>` : ""}</div>
    <div class="action-row compact admin-user-actions">${request.status === "user_paid" ? '<button data-recharge-approve type="button">确认付款并开通</button><button data-recharge-reject type="button">拒绝</button>' : ""}</div>
  </article>`).join("") || "<p>暂无充值申请</p>";
  list.querySelectorAll("[data-recharge-approve], [data-recharge-reject]").forEach((button) => button.addEventListener("click", () => {
    const requestId = button.closest("[data-request-id]").dataset.requestId;
    const action = button.hasAttribute("data-recharge-approve") ? "approve" : "reject";
    askConfirmation(action === "approve" ? "确认开通该会员套餐？" : "确认拒绝该充值申请？", async () => {
      await api("/api/admin/recharge/process", {
        request_id: requestId,
        action,
        admin_note: action === "approve" ? "管理员人工核对付款通过" : "管理员人工核对未通过",
      });
      await loadAdminData();
    });
  }));
}

function renderAdminAudit(logs) {
  const list = $("adminAuditList");
  list.innerHTML = (logs || []).map((log) => `<article class="admin-log-card">
    <div><strong>${escapeHtml(log.action)}</strong><time>${escapeHtml(formatLocalDateTime(log.created_at))}</time></div>
    <p>管理员：${escapeHtml(log.actor_username || "-")} · 对象：${escapeHtml(log.target_username || "-")}</p>
    <p>${escapeHtml(log.note || "无备注")}</p>
  </article>`).join("") || "<p>暂无审计记录</p>";
}

function renderAdminLoginLogs(logs) {
  const list = $("adminLoginList");
  list.innerHTML = (logs || []).map((log) => {
    const success = Boolean(log.success);
    const username = log.username || "未知账号";
    const source = { cloudflare_pages: "网站代理", cloudflare: "Cloudflare", direct: "直接连接" }[log.source] || log.source || "未知来源";
    return `<article class="admin-log-card admin-login-card">
      <div><strong class="${success ? "login-success" : "login-failed"}">${escapeHtml(username)} · ${escapeHtml(loginReasonLabel(log.reason))}</strong><time>${escapeHtml(formatLocalDateTime(log.created_at))}</time></div>
      <p class="admin-login-location">位置：${escapeHtml(loginLocationLabel(log))} · IP：${escapeHtml(log.ip_address || "未知")} · ${escapeHtml(source)}</p>
      <p class="admin-login-agent">设备：${escapeHtml(log.user_agent || "未知浏览器")}</p>
    </article>`;
  }).join("") || '<p class="admin-empty-state">暂无登录记录</p>';
}

function renderAdminToolStats(tools) {
  const list = $("adminToolStatsList");
  list.innerHTML = (tools || []).map((item) => `<article class="admin-log-card"><div><strong>${escapeHtml(item.tool_id)}</strong><span>${escapeHtml(item.uses || 0)} 次 · ${escapeHtml(item.users || 0)} 人</span></div><p>最近使用：${escapeHtml(formatLocalDateTime(item.last_used_at, "无"))}</p></article>`).join("") || "<p>暂无工具使用记录</p>";
}

function adminFeedbackQueryPath() {
  const params = new URLSearchParams();
  const query = $("adminFeedbackSearch")?.value.trim() || "";
  const type = $("adminFeedbackType")?.value || "";
  const status = $("adminFeedbackStatus")?.value || "";
  if (query) params.set("query", query);
  if (type) params.set("type", type);
  if (status) params.set("status", status);
  const suffix = params.toString();
  return `/api/admin/feedback${suffix ? `?${suffix}` : ""}`;
}

function adminFeedbackStatusOptions(selected) {
  return Object.entries(FEEDBACK_STATUS_LABELS).map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function renderAdminFeedback(items = null) {
  if (Array.isArray(items)) adminFeedback = items;
  const list = $("adminFeedbackList");
  if (!list) return;
  list.innerHTML = adminFeedback.map((item) => `<article class="admin-feedback-card" data-admin-feedback-id="${escapeHtml(item.id)}">
    <header><div><span class="feedback-type">${escapeHtml(feedbackTypeLabel(item.type))}</span><h3>${escapeHtml(item.title)}</h3></div><div class="admin-feedback-summary"><span>${escapeHtml(item.vote_count)} 票</span><span>${escapeHtml(feedbackStatusLabel(item.status))}</span></div></header>
    <p class="admin-feedback-author">${escapeHtml(item.username)} · ${escapeHtml(formatLocalDateTime(item.created_at, "未知"))} · ${escapeHtml(item.id)}</p>
    <p class="admin-feedback-content">${escapeHtml(item.content)}</p>
    ${feedbackMetadata(item) ? `<p class="admin-feedback-meta">${escapeHtml(feedbackMetadata(item))}</p>` : ""}
    ${item.browser_info ? `<p class="admin-feedback-meta">浏览器：${escapeHtml(item.browser_info)}</p>` : ""}
    ${item.merged_into_id ? `<p class="admin-feedback-meta">已合并至：${escapeHtml(item.merged_into_id)}</p>` : ""}
    <div class="admin-feedback-controls">
      <label><span>状态</span><select data-feedback-admin-status>${adminFeedbackStatusOptions(item.status)}</select></label>
      <label class="admin-feedback-note"><span>管理员备注</span><textarea data-feedback-admin-note maxlength="1000" placeholder="内部处理备注">${escapeHtml(item.admin_note || "")}</textarea></label>
      <button class="primary" data-feedback-admin-save type="button">保存状态与备注</button>
    </div>
    <div class="admin-feedback-merge">
      <label><span>合并到建议 ID</span><input data-feedback-merge-target maxlength="64" placeholder="目标反馈 ID" /></label>
      <button data-feedback-admin-merge type="button" ${["feature_suggestion", "new_tool"].includes(item.type) ? "" : "disabled"}>合并重复建议</button>
      <button class="danger-button" data-feedback-admin-delete type="button">删除垃圾反馈</button>
    </div>
  </article>`).join("") || '<p class="admin-empty-state">没有符合条件的反馈。</p>';
  list.querySelectorAll("[data-feedback-admin-save]").forEach((button) => button.addEventListener("click", () => adminFeedbackAction(button.closest("[data-admin-feedback-id]"), "update")));
  list.querySelectorAll("[data-feedback-admin-merge]").forEach((button) => button.addEventListener("click", () => adminFeedbackAction(button.closest("[data-admin-feedback-id]"), "merge")));
  list.querySelectorAll("[data-feedback-admin-delete]").forEach((button) => button.addEventListener("click", () => adminFeedbackAction(button.closest("[data-admin-feedback-id]"), "delete_spam")));
}

async function loadAdminFeedback() {
  if (!isSuperAdmin()) return;
  const list = $("adminFeedbackList");
  if (list) list.setAttribute("aria-busy", "true");
  try {
    const data = await apiGet(adminFeedbackQueryPath());
    renderAdminFeedback(data.feedback || []);
    $("adminError").textContent = "";
  } catch (error) {
    $("adminError").textContent = error.message;
    if (list && !adminFeedback.length) list.innerHTML = `<p class="admin-empty-state">${escapeHtml(error.message)}</p>`;
  } finally {
    if (list) list.setAttribute("aria-busy", "false");
  }
}

async function applyAdminFeedbackAction(card, action) {
  const feedbackId = card.dataset.adminFeedbackId;
  const payload = {
    feedback_id: feedbackId,
    action,
    status: card.querySelector("[data-feedback-admin-status]").value,
    admin_note: card.querySelector("[data-feedback-admin-note]").value.trim(),
    merged_into_id: card.querySelector("[data-feedback-merge-target]").value.trim(),
  };
  await api("/api/admin/feedback/update", payload);
  const [feedbackResult, auditResult] = await Promise.allSettled([
    apiGet(adminFeedbackQueryPath()),
    apiGet("/api/admin/audit"),
  ]);
  if (feedbackResult.status === "fulfilled") renderAdminFeedback(feedbackResult.value.feedback || []);
  if (auditResult.status === "fulfilled") renderAdminAudit(auditResult.value.logs || []);
  $("adminError").textContent = feedbackResult.status === "rejected" ? feedbackResult.reason.message : "";
}

function adminFeedbackAction(card, action) {
  const feedbackId = card.dataset.adminFeedbackId;
  if (action === "merge" && !card.querySelector("[data-feedback-merge-target]").value.trim()) {
    $("adminError").textContent = "请先填写要合并到的建议 ID。";
    return;
  }
  if (action === "update") {
    applyAdminFeedbackAction(card, action).catch((error) => { $("adminError").textContent = error.message; });
    return;
  }
  const message = action === "merge"
    ? `确认合并反馈 ${feedbackId}？投票会去重后转移到目标建议。`
    : `确认永久删除垃圾反馈 ${feedbackId}？此操作会记录审计。`;
  askConfirmation(message, async () => {
    try {
      await applyAdminFeedbackAction(card, action);
    } catch (error) {
      $("adminError").textContent = error.message;
    }
  });
}

async function loadAdminData() {
  if (!isSuperAdmin()) return;
  const sequence = ++adminLoadSequence;
  const refreshButton = $("refreshAdminBtn");
  refreshButton.disabled = true;
  refreshButton.textContent = "刷新中…";
  $("adminPanel").setAttribute("aria-busy", "true");
  $("adminError").textContent = "";
  if (!adminUsers.length) {
    $("adminUserCount").textContent = "正在加载用户…";
    if (!$("adminUserList").children.length) $("adminUserList").innerHTML = '<p class="admin-empty-state">正在连接服务器…</p>';
  }
  const requests = [
    { label: "用户", path: "/api/admin/users", target: "adminUserList", apply: (data) => renderAdminUsers(data.users) },
    { label: "充值申请", path: "/api/admin/recharge", target: "adminRechargeList", apply: (data) => renderAdminRecharge(data.requests) },
    { label: "审计日志", path: "/api/admin/audit", target: "adminAuditList", apply: (data) => renderAdminAudit(data.logs) },
    { label: "登录记录", path: "/api/admin/login-logs", target: "adminLoginList", apply: (data) => renderAdminLoginLogs(data.logs) },
    { label: "工具统计", path: "/api/admin/tool-stats", target: "adminToolStatsList", apply: (data) => renderAdminToolStats(data.tools) },
    { label: "反馈与投票", path: adminFeedbackQueryPath(), target: "adminFeedbackList", apply: (data) => renderAdminFeedback(data.feedback) },
  ];
  try {
    const results = await Promise.allSettled(requests.map((request) => apiGet(request.path)));
    if (sequence !== adminLoadSequence || !state.session || !isSuperAdmin()) return;
    const failures = [];
    results.forEach((result, index) => {
      const request = requests[index];
      if (result.status === "fulfilled") {
        try {
          request.apply(result.value);
        } catch (_error) {
          failures.push(`${request.label}返回格式异常`);
        }
        return;
      }
      failures.push(`${request.label}：${result.reason?.message || "加载失败"}`);
      const target = $(request.target);
      const missingUsers = request.label === "用户" && !adminUsers.length;
      if (target && (!target.children.length || missingUsers)) target.innerHTML = `<p class="admin-empty-state">${request.label}尚未加载，请点击刷新重试。</p>`;
      if (missingUsers) $("adminUserCount").textContent = "用户尚未加载";
    });
    $("adminError").textContent = failures.length
      ? `${failures.join("；")}。已加载的内容会保留，请点击刷新重试。`
      : "";
  } finally {
    if (sequence === adminLoadSequence) {
      refreshButton.disabled = false;
      refreshButton.textContent = "刷新";
      $("adminPanel").setAttribute("aria-busy", "false");
    }
  }
}

async function showAdminPanel(pushHistory = true) {
  if (!state.session || !state.account) {
    showAuth("请先登录管理员账户", { path: "/login", replace: true });
    return;
  }
  if (!isSuperAdmin()) {
    history.replaceState({}, "", "/select");
    showModulePicker(false, "当前账户没有管理员权限，已返回功能选择。");
    return;
  }
  if (pushHistory && location.pathname !== "/admin") history.pushState({}, "", "/admin");
  hidePrimaryScreens();
  $("adminPanel").classList.remove("hidden");
  $("adminPanel").setAttribute("aria-hidden", "false");
  renderAccountUi();
  await loadAdminData();
}

function leaveAdminPanel() {
  showModulePicker(true);
}

function localDateValue(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}/${parts.month}/${parts.day}`;
}

function membershipDateValue(value) {
  return membershipDateValueModel(value, localDateValue);
}

function updateAdminMembershipFields(fillDefaults = true) {
  const action = $("adminMembershipAction").value;
  const membership = $("adminMembershipSelect").value;
  const cancelling = action === "cancel" || action === "cancel_all";
  const lifetime = ["japanese_lifetime", "dual_language_lifetime", "all_access_lifetime"].includes(membership);
  const singleLanguage = membership === "trial_single_language";
  const fieldsDisabled = cancelling;
  $("adminTrialLanguageField")?.classList.toggle("hidden", cancelling || !singleLanguage);
  $("adminTrialLanguageSelect").required = !cancelling && singleLanguage;
  $("adminMembershipSelect").disabled = action === "cancel_all";
  $("adminMembershipStart").disabled = fieldsDisabled;
  $("adminMembershipExpires").disabled = fieldsDisabled || lifetime;
  $("adminMembershipStartField").classList.toggle("field-disabled", fieldsDisabled);
  $("adminMembershipExpiresField").classList.toggle("field-disabled", fieldsDisabled || lifetime);
  $("adminPreserveJapanese").closest("label").classList.toggle("hidden", action !== "cancel_all");
  if (cancelling) {
    $("adminMembershipStart").value = "";
    $("adminMembershipExpires").value = "";
    return;
  }
  if (fillDefaults && !$("adminMembershipStart").value) $("adminMembershipStart").value = localDateValue();
  if (lifetime) {
    $("adminMembershipExpires").value = "";
  } else if (fillDefaults && !$("adminMembershipExpires").value) {
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 1);
    $("adminMembershipExpires").value = localDateValue(expiry);
  }
}

function renderAdminCurrentMemberships(user) {
  const target = $("adminCurrentMemberships");
  const memberships = Array.isArray(user?.memberships) ? user.memberships : [];
  target.innerHTML = memberships.map((item) => {
    const language = { english: "英语", japanese: "日语" }[item.metadata?.language] || "";
    const source = `来源：${item.source || "系统"}`;
    return `<article><strong>${escapeHtml(item.plan_name || membershipLabel(item.plan_code))}</strong><span>${item.is_lifetime ? "永久有效" : `到期 ${escapeHtml(formatLocalDateTime(item.expires_at, "未知"))}`}</span><small>${escapeHtml([language, source].filter(Boolean).join(" · "))}</small></article>`;
  }).join("") || "<p>当前没有有效会员</p>";
}

function openAdminEditor(userId) {
  const user = adminUserById(userId);
  if (!user || user.is_super_admin) return;
  $("adminEditUserId").value = user.id;
  $("adminEditTitle").textContent = `编辑 ${user.username}`;
  const preferred = (user.memberships || [])
    .filter((item) => ["all_access_lifetime", "dual_language_lifetime", "all_access_monthly", "dual_language_monthly", "tools_monthly", "japanese_lifetime", "trial_single_language"].includes(item.plan_code))
    .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0))[0];
  $("adminMembershipAction").value = "grant";
  $("adminMembershipSelect").value = preferred?.plan_code === "dual_language_lifetime"
    ? "japanese_lifetime"
    : preferred?.plan_code || "trial_single_language";
  $("adminMembershipStart").value = membershipDateValue(preferred?.starts_at);
  $("adminMembershipExpires").value = membershipDateValue(preferred?.expires_at);
  $("adminTrialLanguageSelect").value = preferred?.metadata?.language || "";
  $("adminMembershipNote").value = "";
  $("adminPreserveJapanese").checked = false;
  clearAdminSecretEditor();
  $("adminToggleBanBtn").textContent = user.banned ? "解除封禁" : "永久封禁";
  $("adminEditMessage").textContent = "";
  renderAdminCurrentMemberships(user);
  updateAdminMembershipFields(false);
  openModal("adminEditModal");
}

async function saveAdminMembership() {
  const userId = $("adminEditUserId").value;
  const button = $("saveAdminMembershipBtn");
  if (button.disabled) return;
  const action = $("adminMembershipAction").value;
  const planCode = $("adminMembershipSelect").value;
  const user = adminUserById(userId);
  const actionLabel = { grant: "开通或覆盖", extend: "续期", cancel: "取消所选会员", cancel_all: "降级为普通用户" }[action] || action;
  askConfirmation(`确认对“${user?.username || userId}”执行“${actionLabel}”？`, async () => {
    button.disabled = true;
    try {
      const data = await api("/api/admin/membership/manage", {
        user_id: userId,
        action,
        plan_code: planCode,
        membership_start: $("adminMembershipStart").value.trim(),
        membership_expires: $("adminMembershipExpires").value.trim(),
        note: $("adminMembershipNote").value.trim(),
        preserve_japanese: $("adminPreserveJapanese").checked,
        trial_language: planCode === "trial_single_language" ? $("adminTrialLanguageSelect").value : "",
      });
      await loadAdminData();
      const refreshed = adminUserById(userId) || data.user;
      renderAdminCurrentMemberships(refreshed);
      $("adminEditMessage").textContent = "会员设置已保存并立即生效";
    } catch (error) {
      $("adminEditMessage").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

function updateAdminToolsOverride(allowed) {
  const userId = $("adminEditUserId").value;
  const user = adminUserById(userId);
  const message = allowed === false
    ? `确认仅取消“${user?.username || userId}”的在线工具箱权限？语言会员不会受影响。`
    : `确认移除“${user?.username || userId}”的工具权限覆盖，并恢复按会员方案计算？`;
  askConfirmation(message, async () => {
    await api("/api/admin/entitlement", {
      user_id: userId,
      entitlement: "tools_access",
      allowed,
      note: $("adminMembershipNote").value.trim(),
    });
    await loadAdminData();
    renderAdminCurrentMemberships(adminUserById(userId));
    $("adminEditMessage").textContent = allowed === false ? "已单独取消工具权限" : "已恢复按会员方案计算工具权限";
  });
}

function saveAdminSecret() {
  const secret = $("adminNewSecretInput").value;
  const saveButton = $("saveAdminSecretBtn");
  const generateButton = $("generateAdminSecretBtn");
  if (!secret) {
    $("adminEditMessage").textContent = "请先输入或生成新的登录密钥";
    $("adminNewSecretInput").focus();
    return;
  }
  const userId = $("adminEditUserId").value;
  const user = adminUserById(userId);
  askConfirmation(`确认重置“${user?.username || userId}”的登录密钥并退出其全部会话？`, async () => {
    saveButton.disabled = true;
    generateButton.disabled = true;
    try {
      await api("/api/admin/secret", { user_id: userId, secret });
      await loadAdminData();
      $("adminNewSecretInput").value = "";
      setAdminSecretVisibility(false);
      $("adminSecretResultValue").textContent = secret;
      $("adminSecretResult").classList.remove("hidden");
      $("adminEditMessage").textContent = "密钥已修改，旧密钥和旧会话均已失效。请立即复制新密钥。";
    } finally {
      saveButton.disabled = false;
      generateButton.disabled = false;
    }
  });
}

function askConfirmation(message, action) {
  $("confirmMessage").textContent = message;
  confirmAction = action;
  openModal("confirmModal");
}

async function runConfirmedAction() {
  const action = confirmAction;
  confirmAction = null;
  $("acceptConfirmBtn").disabled = true;
  try {
    closeModal("confirmModal");
    if (action) await action();
  } catch (error) {
    $("adminEditMessage").textContent = error.message;
  } finally {
    $("acceptConfirmBtn").disabled = false;
  }
}

function adminUserAction(kind) {
  const userId = $("adminEditUserId").value;
  const user = adminUserById(userId);
  if (!user || user.is_super_admin) return;
  const configs = {
    ban: [user.banned ? "确认解除该用户的永久封禁？" : "确认永久封禁该用户并立即退出其所有会话？", "/api/admin/ban", { user_id: userId, banned: !user.banned }],
    logout: ["确认强制退出该用户的全部登录会话？", "/api/admin/logout-user", { user_id: userId }],
    delete: ["确认删除该用户、会员资格、充值申请和全部会话？此操作不可恢复。", "/api/admin/delete-user", { user_id: userId }],
  };
  const [message, path, payload] = configs[kind];
  askConfirmation(message, async () => {
    await api(path, payload);
    await loadAdminData();
    closeModal("adminEditModal");
  });
}

function wordDraftKey(language = state.quizLanguage, profile = state.profile) {
  const accountId = encodeURIComponent(String(state.account?.id || "no-account"));
  return `vocabWords:${accountId}:${language}:${profileStorageName(profile)}`;
}

function clearSavedWordDrafts(account = state.account) {
  const accountId = account?.id ? encodeURIComponent(String(account.id)) : "";
  const accountPrefix = accountId ? `vocabWords:${accountId}:` : "";
  const keysToRemove = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) || "";
    const legacySharedKey = /^vocabWords:(english|japanese):/.test(key);
    if (legacySharedKey || (accountPrefix && key.startsWith(accountPrefix))) keysToRemove.push(key);
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
  ["english", "japanese"].forEach((language) => sessionStorage.removeItem(projectRuntimeKey(language, account)));
  projectRuntime.english = null;
  projectRuntime.japanese = null;
  projectRuntimeNeedsRestore = false;
  state.words = [];
  state.index = 0;
  state.score = 0;
  state.roundSkipped = 0;
  state.quizSession = "";
  state.roundActive = false;
  state.answerLocked = false;
  state.pendingAdvance = null;
  state.roundStartedAt = 0;
  state.roundId = "";
  if ($("wordInput")) $("wordInput").value = "";
}

function clearAccountLocalData(account = state.account) {
  if (!account?.id) return;
  const accountId = accountStorageId(account);
  const localPrefixes = [
    `vocabWords:${accountId}:`,
    `wrongBook:v${ACCOUNT_DATA_VERSION}:${accountId}:`,
    `achievements:v${ACCOUNT_DATA_VERSION}:${accountId}:`,
    `studyHistory:v${STUDY_DATA_VERSION}:${accountId}:`,
    `studyGoal:v${STUDY_DATA_VERSION}:${accountId}:`,
    `wrongRejudgeLog:v1:${accountId}:`,
    `toolPreferences:v1:${accountId}`,
    `learningPreferences:v1:${accountId}:`,
    `aiSuggestSettings:v2:${accountId}:`,
  ];
  const exactLocalKeys = [
    `vocabProfile:v${ACCOUNT_DATA_VERSION}:${accountId}`,
    `accountLocalDataMigrated:v${ACCOUNT_DATA_VERSION}:${accountId}`,
    `wyjLearningSync:v1:${encodeURIComponent(String(account.id))}`,
  ];
  const localKeys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index) || "";
    if (exactLocalKeys.includes(key) || localPrefixes.some((prefix) => key.startsWith(prefix))) localKeys.push(key);
  }
  localKeys.forEach((key) => localStorage.removeItem(key));
  ["english", "japanese"].forEach((language) => sessionStorage.removeItem(projectRuntimeKey(language, account)));
  clearSavedWordDrafts(account);
}

function saveCurrentWordDraft() {
  const input = $("wordInput");
  if (!input || !currentProject || !state.account) return;
  safeStorageSet(localStorage, wordDraftKey(currentProject), input.value);
}

function loadCurrentWordDraft() {
  const input = $("wordInput");
  if (!input || !currentProject || !state.account) return;
  const key = wordDraftKey(currentProject);
  const saved = localStorage.getItem(key) || "";
  if (currentProject === "japanese" && /[|｜=＝]/u.test(saved)) {
    const normalized = formatWordsForInput(parseWordText(saved));
    input.value = normalized;
    safeStorageSet(localStorage, key, normalized);
    return;
  }
  input.value = saved;
}

function saveProjectRuntime() {
  if (!currentProject || !state.account?.id) return;
  const runtime = {
    language: currentProject,
    words: [...state.words],
    index: state.index,
    score: state.score,
    roundSkipped: state.roundSkipped,
    quizSession: state.quizSession,
    roundActive: state.roundActive,
    answerLocked: state.answerLocked,
    pendingAdvance: state.pendingAdvance,
    roundStartedAt: state.roundStartedAt,
    roundId: state.roundId,
    lastRound: state.lastRound,
    mode: state.mode,
    view: document.querySelector(".view.active")?.id || "setupView",
    savedAt: Date.now(),
  };
  projectRuntime[currentProject] = runtime;
  safeStorageSet(sessionStorage, projectRuntimeKey(currentProject), JSON.stringify(runtime));
}

function loadProjectRuntime(language) {
  if (projectRuntime[language]) return projectRuntime[language];
  const key = projectRuntimeKey(language);
  let runtime = null;
  try {
    runtime = JSON.parse(sessionStorage.getItem(key) || "null");
  } catch (_) {
    runtime = null;
  }
  const valid = runtime
    && runtime.language === language
    && Array.isArray(runtime.words)
    && Number.isFinite(Number(runtime.savedAt))
    && Date.now() - Number(runtime.savedAt) <= PROJECT_RUNTIME_MAX_AGE_MS;
  if (!valid) {
    sessionStorage.removeItem(key);
    return null;
  }
  runtime.words = filterWordsByLanguage(runtime.words.map((word) => limitText(word, 240)), language).slice(0, 500);
  runtime.index = Math.max(0, Math.min(Number.parseInt(runtime.index, 10) || 0, Math.max(0, runtime.words.length - 1)));
  runtime.score = Math.max(0, Math.min(Number.parseInt(runtime.score, 10) || 0, runtime.words.length));
  runtime.roundSkipped = Math.max(0, Math.min(Number.parseInt(runtime.roundSkipped, 10) || 0, runtime.words.length));
  runtime.mode = ["normal", "review-current", "review-history"].includes(runtime.mode) ? runtime.mode : "normal";
  runtime.view = ["setupView", "quizView", "wrongView", "achievementsView", "studyView"].includes(runtime.view) ? runtime.view : "setupView";
  runtime.quizSession = limitText(runtime.quizSession, 160);
  runtime.roundActive = Boolean(runtime.roundActive && runtime.words.length);
  runtime.roundStartedAt = runtime.roundActive && Number.isFinite(Number(runtime.roundStartedAt))
    ? Math.min(Date.now(), Math.max(0, Number(runtime.roundStartedAt)))
    : 0;
  runtime.roundId = limitText(runtime.roundId, 100) || (runtime.roundActive ? `${runtime.savedAt}-${language}` : "");
  runtime.pendingAdvance = runtime.roundActive ? sanitizePendingAdvance(runtime.pendingAdvance, runtime) : null;
  // Old runtimes only stored answerLocked and cannot prove which question was consumed.
  // Keeping the current question is safer than silently skipping it.
  runtime.answerLocked = Boolean(runtime.pendingAdvance);
  projectRuntime[language] = runtime;
  return runtime;
}

function removeProjectRuntime(language = currentProject) {
  if (!language) return;
  projectRuntime[language] = null;
  sessionStorage.removeItem(projectRuntimeKey(language));
}

function restoreProjectRuntime() {
  if (!currentProject || !projectRuntimeNeedsRestore) return;
  projectRuntimeNeedsRestore = false;
  const runtime = loadProjectRuntime(currentProject);
  if (!runtime) {
    state.words = [];
    state.index = 0;
    state.score = 0;
    state.roundSkipped = 0;
    state.quizSession = "";
    state.lastRound = null;
    state.roundActive = false;
    state.answerLocked = false;
    state.pendingAdvance = null;
    state.roundStartedAt = 0;
    state.roundId = "";
    state.mode = "normal";
    setView("setupView");
    updateStats();
    return;
  }
  state.words = [...runtime.words];
  state.index = Math.min(runtime.index, Math.max(0, state.words.length - 1));
  state.score = runtime.score;
  state.roundSkipped = runtime.roundSkipped;
  state.quizSession = runtime.quizSession;
  state.lastRound = runtime.lastRound || null;
  state.roundActive = runtime.roundActive;
  state.answerLocked = runtime.answerLocked;
  state.pendingAdvance = runtime.pendingAdvance;
  state.roundStartedAt = runtime.roundStartedAt;
  state.roundId = runtime.roundId;
  state.mode = runtime.mode;
  const view = runtime.view === "quizView" && !state.roundActive ? "setupView" : runtime.view;
  if (state.roundActive) {
    showWord({ preserveTransition: Boolean(state.pendingAdvance), focus: false });
    if (state.pendingAdvance) renderQuestionFeedback(state.pendingAdvance.feedback);
  }
  setView(view);
  if (state.roundActive) {
    if (state.pendingAdvance) resumeQuestionTransition();
    else {
      setAnswerLocked(false);
      saveProjectRuntime();
    }
  }
  updateStats();
}

function releaseTrialImageOutput() {
  if (trialImageObjectUrl) URL.revokeObjectURL(trialImageObjectUrl);
  trialImageObjectUrl = "";
  const result = $("trialImageResult");
  const preview = $("trialImagePreview");
  const download = $("trialImageDownload");
  result?.classList.add("hidden");
  if (preview) preview.removeAttribute("src");
  if (download) download.removeAttribute("href");
}

function setTrialMessage(id, message = "", status = "") {
  const node = $(id);
  if (!node) return;
  node.textContent = message;
  node.classList.remove("is-error", "is-success");
  if (status) node.classList.add(`is-${status}`);
}

function shuffledTrialQuestions(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    let randomValue;
    if (globalThis.crypto?.getRandomValues) {
      const values = new Uint32Array(1);
      globalThis.crypto.getRandomValues(values);
      randomValue = values[0] / 0x100000000;
    } else {
      randomValue = Math.random();
    }
    const swapIndex = Math.floor(randomValue * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function normalizeTrialAnswer(value, language) {
  const compact = String(value || "").normalize("NFKC").trim().replace(/\s+/g, language === "english" ? " " : "");
  return language === "japanese" ? normalizeKana(compact) : compact.toLocaleLowerCase("en");
}

function resetTrialQuiz() {
  trialState.quiz = null;
  $("trialQuizSetup")?.classList.remove("hidden");
  $("trialQuizRun")?.classList.add("hidden");
  $("trialQuizSummary")?.classList.add("hidden");
  if ($("trialQuizAnswer")) $("trialQuizAnswer").value = "";
  setTrialMessage("trialQuizMessage");
}

function renderTrialQuestion() {
  const quiz = trialState.quiz;
  if (!quiz || !quiz.questions[quiz.index]) return;
  const item = quiz.questions[quiz.index];
  $("trialQuizProgress").textContent = `${quiz.index + 1} / ${quiz.questions.length}`;
  $("trialQuizScore").textContent = `答对 ${quiz.correct}`;
  $("trialQuizInstruction").textContent = quiz.language === "japanese"
    ? "请写出对应的日语词，汉字或假名均可"
    : "请写出对应的英语单词";
  $("trialQuizPrompt").textContent = item.prompt;
  $("trialQuizAnswer").value = "";
  $("trialQuizAnswer").disabled = false;
  $("trialQuizSubmitBtn").disabled = false;
  $("trialQuizNextBtn").classList.add("hidden");
  setTrialMessage("trialQuizMessage");
  $("trialQuizAnswer").focus();
}

function startTrialQuiz() {
  const language = normalizeQuizLanguage($("trialQuizLanguage").value) || "english";
  const rawCount = Number.parseInt($("trialQuizCount").value, 10);
  const count = Math.max(1, Math.min(TRIAL_MAX_QUESTIONS, Number.isInteger(rawCount) ? rawCount : 5));
  $("trialQuizCount").value = String(count);
  trialState.quiz = {
    language,
    questions: shuffledTrialQuestions(TRIAL_QUESTION_BANKS[language]).slice(0, count),
    index: 0,
    correct: 0,
    answered: false,
  };
  $("trialQuizSetup").classList.add("hidden");
  $("trialQuizSummary").classList.add("hidden");
  $("trialQuizRun").classList.remove("hidden");
  renderTrialQuestion();
}

function submitTrialQuizAnswer(event) {
  event?.preventDefault();
  const quiz = trialState.quiz;
  const item = quiz?.questions?.[quiz.index];
  if (!quiz || !item || quiz.answered) return;
  const answer = $("trialQuizAnswer").value.trim();
  if (!answer) {
    setTrialMessage("trialQuizMessage", "请输入答案后再提交。", "error");
    $("trialQuizAnswer").focus();
    return;
  }
  const normalized = normalizeTrialAnswer(answer, quiz.language);
  const correct = item.answers.some((candidate) => normalizeTrialAnswer(candidate, quiz.language) === normalized);
  if (correct) quiz.correct += 1;
  quiz.answered = true;
  $("trialQuizScore").textContent = `答对 ${quiz.correct}`;
  $("trialQuizAnswer").disabled = true;
  $("trialQuizSubmitBtn").disabled = true;
  setTrialMessage(
    "trialQuizMessage",
    correct ? "回答正确。" : `本题答案：${item.answers.join(" / ")}`,
    correct ? "success" : "error",
  );
  $("trialQuizNextBtn").textContent = quiz.index + 1 >= quiz.questions.length ? "查看结果" : "下一题";
  $("trialQuizNextBtn").classList.remove("hidden");
  $("trialQuizNextBtn").focus();
}

function nextTrialQuestion() {
  const quiz = trialState.quiz;
  if (!quiz?.answered) return;
  if (quiz.index + 1 >= quiz.questions.length) {
    $("trialQuizRun").classList.add("hidden");
    $("trialQuizSummary").classList.remove("hidden");
    $("trialQuizFinalScore").textContent = `${quiz.correct} / ${quiz.questions.length}`;
    $("trialQuizRegisterBtn").focus();
    return;
  }
  quiz.index += 1;
  quiz.answered = false;
  renderTrialQuestion();
}

function countTrialWords(text) {
  if (!text.trim()) return 0;
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    return [...segmenter.segment(text)].filter((item) => item.isWordLike).length;
  } catch (_) {
    return (text.match(/[A-Za-z0-9]+|[\u3400-\u9fff\u3040-\u30ff]/gu) || []).length;
  }
}

function updateTrialTextStats() {
  const text = $("trialTextInput").value.slice(0, TRIAL_MAX_TEXT_CHARS);
  if (text !== $("trialTextInput").value) $("trialTextInput").value = text;
  const words = countTrialWords(text);
  $("trialTextCharacters").textContent = String(Array.from(text).length);
  $("trialTextWords").textContent = String(words);
  $("trialTextLines").textContent = String(text ? text.split(/\r?\n/).length : 0);
  $("trialTextParagraphs").textContent = String(text.trim() ? text.trim().split(/(?:\r?\n){2,}/).filter(Boolean).length : 0);
  $("trialTextReading").textContent = `${words ? Math.max(1, Math.ceil(words / 220)) : 0} 分钟`;
}

function parseTrialJson() {
  const input = $("trialJsonInput").value.trim();
  if (!input) throw new Error("请先输入 JSON 内容");
  if (input.length > TRIAL_MAX_TEXT_CHARS) throw new Error("JSON 内容超过 200,000 个字符");
  return JSON.parse(input);
}

function formatTrialJson() {
  try {
    const parsed = parseTrialJson();
    $("trialJsonOutput").textContent = JSON.stringify(parsed, null, 2);
    $("trialJsonOutput").classList.remove("hidden");
    setTrialMessage("trialJsonMessage", "JSON 合法，已在本机完成格式化。", "success");
  } catch (error) {
    $("trialJsonOutput").classList.add("hidden");
    setTrialMessage("trialJsonMessage", `JSON 无效：${error.message}`, "error");
  }
}

function validateTrialJson() {
  try {
    parseTrialJson();
    $("trialJsonOutput").classList.add("hidden");
    setTrialMessage("trialJsonMessage", "JSON 格式合法。", "success");
  } catch (error) {
    $("trialJsonOutput").classList.add("hidden");
    setTrialMessage("trialJsonMessage", `JSON 无效：${error.message}`, "error");
  }
}

function clearTrialJson() {
  $("trialJsonInput").value = "";
  $("trialJsonOutput").textContent = "";
  $("trialJsonOutput").classList.add("hidden");
  setTrialMessage("trialJsonMessage");
  $("trialJsonInput").focus();
}

async function decodeTrialImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
    } catch (_) {
      // Safari and some embedded browsers need the HTMLImageElement fallback.
    }
  }
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("浏览器无法读取这张图片"));
      image.src = sourceUrl;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => {} };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function canvasToTrialBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("浏览器不支持所选输出格式")), type, quality);
  });
}

function trialImageFileName(originalName, mimeType) {
  const base = String(originalName || "image").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "image";
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[mimeType] || "png";
  return `${base}-trial.${extension}`;
}

function formatTrialBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

async function processTrialImage() {
  const button = $("trialImageProcessBtn");
  const file = $("trialImageInput").files?.[0];
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  releaseTrialImageOutput();
  setTrialMessage("trialImageMessage");
  if (!file) {
    setTrialMessage("trialImageMessage", "请先选择一张图片。", "error");
    return;
  }
  if (!allowedTypes.has(file.type)) {
    setTrialMessage("trialImageMessage", "仅支持 PNG、JPG 和 WebP 图片。", "error");
    return;
  }
  if (file.size > TRIAL_MAX_IMAGE_BYTES) {
    setTrialMessage("trialImageMessage", "图片超过 12 MB，请选择较小文件。", "error");
    return;
  }
  button.disabled = true;
  button.textContent = "处理中…";
  let decoded;
  try {
    decoded = await decodeTrialImage(file);
    if (!decoded.width || !decoded.height || decoded.width * decoded.height > TRIAL_MAX_IMAGE_PIXELS) {
      throw new Error("图片像素超过 2000 万或尺寸无效");
    }
    const canvas = document.createElement("canvas");
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("浏览器无法建立图片处理画布");
    const requestedType = trialState.imageMode === "format"
      ? $("trialImageFormat").value
      : (file.type === "image/png" ? "image/webp" : file.type);
    if (requestedType === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    const quality = Math.max(0.2, Math.min(0.95, Number($("trialImageQuality").value) / 100 || 0.82));
    const blob = await canvasToTrialBlob(canvas, requestedType, quality);
    trialImageObjectUrl = URL.createObjectURL(blob);
    $("trialImagePreview").src = trialImageObjectUrl;
    $("trialImageDownload").href = trialImageObjectUrl;
    $("trialImageDownload").download = trialImageFileName(file.name, blob.type);
    $("trialImageDetails").textContent = `${decoded.width} × ${decoded.height} · 原文件 ${formatTrialBytes(file.size)} · 输出 ${formatTrialBytes(blob.size)} · ${blob.type.replace("image/", "").toUpperCase()}`;
    $("trialImageResult").classList.remove("hidden");
    const larger = trialState.imageMode === "compress" && blob.size >= file.size;
    setTrialMessage("trialImageMessage", larger ? "处理完成，但当前格式没有变小；可以调整质量或尝试格式转换。" : "处理完成，结果仅保存在当前浏览器内存中。", larger ? "" : "success");
  } catch (error) {
    setTrialMessage("trialImageMessage", error.message, "error");
  } finally {
    decoded?.close?.();
    button.disabled = false;
    button.textContent = trialState.imageMode === "format" ? "转换格式" : "压缩图片";
  }
}

function setTrialTool(value) {
  const tool = TRIAL_TOOL_IDS.has(value) ? value : "quiz";
  trialState.tool = tool;
  document.querySelectorAll("[data-trial-tool]").forEach((button) => {
    const active = button.dataset.trialTool === tool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-trial-panel]").forEach((panel) => {
    const panelName = tool.startsWith("image-") ? "image" : tool;
    panel.classList.toggle("hidden", panel.dataset.trialPanel !== panelName);
  });
  if (tool.startsWith("image-")) {
    trialState.imageMode = tool === "image-format" ? "format" : "compress";
    $("trialImageTitle").textContent = trialState.imageMode === "format" ? "单张图片格式转换" : "单张图片压缩";
    $("trialImageDescription").textContent = trialState.imageMode === "format"
      ? "在 PNG、JPG 和 WebP 之间转换，结果只生成在本机。"
      : "调整质量后生成一个新的本地图片文件。";
    $("trialImageQualityField").classList.toggle("hidden", trialState.imageMode === "format");
    $("trialImageFormatField").classList.toggle("hidden", trialState.imageMode !== "format");
    $("trialImageProcessBtn").textContent = trialState.imageMode === "format" ? "转换格式" : "压缩图片";
    releaseTrialImageOutput();
    setTrialMessage("trialImageMessage");
  }
  renderAccountUi();
}

function showPublicHome(pushHistory = true) {
  stopProjectActivity();
  currentProject = "";
  state.quizLanguage = "";
  hidePrimaryScreens();
  $("publicHome").classList.remove("hidden");
  $("publicHome").setAttribute("aria-hidden", "false");
  document.body.classList.remove("project-picker-active");
  if (pushHistory) pushRoute("/");
  renderAccountUi();
}

function showChangelog(pushHistory = true) {
  stopProjectActivity();
  currentProject = "";
  state.quizLanguage = "";
  hidePrimaryScreens();
  $("changelogPage").classList.remove("hidden");
  $("changelogPage").setAttribute("aria-hidden", "false");
  document.body.classList.remove("project-picker-active");
  renderChangelog();
  if (pushHistory) pushRoute("/changelog");
  renderAccountUi();
}

function showTrial(pushHistory = true, tool = "") {
  stopProjectActivity();
  currentProject = "";
  state.quizLanguage = "";
  hidePrimaryScreens();
  $("trialPage").classList.remove("hidden");
  $("trialPage").setAttribute("aria-hidden", "false");
  document.body.classList.remove("project-picker-active");
  setTrialTool(tool || trialState.tool);
  if (pushHistory) pushRoute("/trial");
  renderAccountUi();
}

function runSplashSequence(revealContent) {
  const screen = $("entryScreen");
  if (!screen) {
    revealContent?.();
    return Promise.resolve();
  }

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const visibleMs = reducedMotion ? 0 : 450;
  const exitMs = reducedMotion ? 0 : 180;
  const image = $("splashImage");
  const markImageFailed = () => screen.classList.add("image-failed");
  image?.addEventListener("error", markImageFailed, { once: true });
  if (image?.complete && !image.naturalWidth) markImageFailed();

  return new Promise((resolve) => {
    window.setTimeout(() => {
      revealContent?.();
      const finish = () => {
        screen.setAttribute("aria-hidden", "true");
        screen.remove();
        resolve();
      };
      if (reducedMotion) {
        finish();
        return;
      }
      window.requestAnimationFrame(() => {
        screen.classList.add("is-exiting");
        window.setTimeout(finish, exitMs);
      });
    }, visibleMs);
  });
}

function showLanguageGate() {
  showProjectPicker();
}

function hidePrimaryScreens() {
  const leavingTrial = Boolean($("trialPage") && !$("trialPage").classList.contains("hidden"));
  ["publicHome", "changelogPage", "trialPage", "modulePicker", "projectPicker", "projectApp", "toolsPanel", "shareViewer", "adminPanel"].forEach((id) => {
    const element = $(id);
    if (!element) return;
    element.classList.add("hidden");
    element.setAttribute("aria-hidden", "true");
  });
  if (leavingTrial) releaseTrialImageOutput();
  $("topbar")?.classList.add("hidden");
  $("authPanel")?.classList.add("hidden");
  $("workspace")?.classList.add("hidden");
  window.WYJTools?.hide?.();
}

function stopProjectActivity() {
  if (currentProject) {
    saveCurrentWordDraft();
    saveProjectRuntime();
  }
  if (judgeController) judgeController.abort();
  clearNextTimer();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function showModulePicker(pushHistory = true, message = "") {
  if (!state.session || !state.account) {
    showAuth(pendingAuthMessage || "请先登录", { replace: true });
    return;
  }
  stopProjectActivity();
  currentProject = "";
  state.quizLanguage = "";
  hidePrimaryScreens();
  $("modulePicker").classList.remove("hidden");
  $("modulePicker").setAttribute("aria-hidden", "false");
  const accessMessage = $("moduleAccessMessage");
  if (accessMessage) {
    accessMessage.textContent = message;
    accessMessage.classList.toggle("hidden", !message);
  }
  document.body.classList.add("project-picker-active");
  if (pushHistory) pushRoute("/select");
  renderAccountUi();
  renderDashboard();
}

function showProjectPicker(pushHistory = true) {
  if (!state.session || !state.account) {
    showAuth(pendingAuthMessage || "请先登录后选择测试项目", { replace: true });
    return;
  }
  stopProjectActivity();
  currentProject = "";
  state.quizLanguage = "";
  hidePrimaryScreens();
  $("projectPicker").classList.remove("hidden");
  $("projectPicker").setAttribute("aria-hidden", "false");
  document.body.classList.add("project-picker-active");
  if (pushHistory) pushRoute("/language");
  renderAccountUi();
}

function showMainShell() {
  if (!currentProject) return;
  hidePrimaryScreens();
  $("languagePanel").classList.add("hidden");
  $("projectApp").classList.remove("hidden");
  $("projectApp").setAttribute("aria-hidden", "false");
  $("topbar").classList.remove("hidden");
  document.body.classList.remove("project-picker-active");
}

function applyPendingScreen() {
  if (!currentProject) return;
  if (pendingScreen === "workspace") showWorkspace();
  else showAuth(pendingAuthMessage);
}

function enterProject(value, pushHistory = true) {
  if (!state.session || !state.account) {
    showAuth("请先登录后选择测试项目");
    return;
  }
  const language = normalizeQuizLanguage(value);
  if (!language) return;
  if (currentProject && currentProject !== language) {
    saveCurrentWordDraft();
    saveProjectRuntime();
  }
  currentProject = language;
  if ($("wrongSearchInput")) $("wrongSearchInput").value = "";
  state.quizLanguage = language;
  loadProjectPreferences(language);
  projectRuntimeNeedsRestore = true;
  loadCurrentWordDraft();
  saveState();
  updateLanguageUi();
  applyPendingScreen();
  if (pushHistory) pushRoute(`/language/${language}`);
  renderAccountUi();
}

function showAuth(message = "", options = {}) {
  pendingScreen = "auth";
  pendingAuthMessage = message;
  stopProjectActivity();
  currentProject = "";
  state.quizLanguage = "";
  const mode = options.mode || (options.path === "/register" || location.pathname === "/register" ? "register" : "login");
  showAuthMode(mode);
  hidePrimaryScreens();
  $("projectApp").classList.remove("hidden");
  $("projectApp").setAttribute("aria-hidden", "false");
  $("topbar").classList.add("hidden");
  $("projectNameLabel").textContent = "";
  $("authPanel").classList.remove("hidden");
  $("workspace").classList.add("hidden");
  $("loginError").textContent = message;
  $("offlineReviewBtn").classList.add("hidden");
  document.body.classList.add("project-picker-active");
  const path = options.path || (mode === "register" ? "/register" : "/login");
  if (!options.skipRoute) pushRoute(path, Boolean(options.replace));
  renderAccountUi();
}

function showWorkspace() {
  pendingScreen = "workspace";
  if (!currentProject) return;
  showMainShell();
  $("authPanel").classList.add("hidden");
  $("workspace").classList.remove("hidden");
  $("statusDot").classList.toggle("online", backendAvailable);
  if (!backendAvailable) $("modelLabel").textContent = "离线模式";
  else if (!aiAvailable) $("modelLabel").textContent = "规则模式";
  restoreProjectRuntime();
}

async function showTools(path = "/tools", pushHistory = true) {
  if (!state.session || !state.account) {
    showAuth("请先登录后使用在线工具箱", { replace: true });
    return;
  }
  try {
    let access = null;
    let offline = false;
    try {
      access = await apiGet("/api/tools/access");
    } catch (error) {
      const cachedAccess = isSuperAdmin() || hasAccountEntitlement("tools_access");
      if (error.code === "membership_required" || !cachedAccess) throw error;
      offline = true;
    }
    stopProjectActivity();
    currentProject = "";
    state.quizLanguage = "";
    hidePrimaryScreens();
    if (pushHistory) pushRoute(path);
    await window.WYJTools.show(path, { access, offline });
    document.body.classList.remove("project-picker-active");
    renderAccountUi();
  } catch (error) {
    const accessMessage = error.code === "membership_required"
      ? ""
      : `在线工具箱暂时无法打开：${error.message || "请稍后重试"}`;
    showModulePicker(false, accessMessage);
    pushRoute("/select", true);
    if (error.code === "membership_required") {
      $("rechargeMessage").textContent = "当前会员不包含在线工具箱，请选择工具箱或全功能会员。";
      await openMembershipModal({ goal: "tools" });
    }
  }
}

function showShareRoute(path) {
  stopProjectActivity();
  currentProject = "";
  state.quizLanguage = "";
  hidePrimaryScreens();
  if (!window.WYJTools?.showShareViewer?.(path)) return false;
  document.body.classList.add("project-picker-active");
  renderAccountUi();
  return true;
}

async function routeCurrent() {
  if (routeBusy) return;
  routeBusy = true;
  try {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    if (path.startsWith("/share/")) {
      if (!showShareRoute(path)) pushRoute(state.session && state.account ? "/select" : "/login", true);
      return;
    }
    if (!state.session || !state.account) {
      if (path === "/") {
        showPublicHome(false);
        return;
      }
      if (path === "/trial") {
        showTrial(false);
        return;
      }
      if (path === "/changelog") {
        showChangelog(false);
        return;
      }
      const register = path === "/register";
      showAuth(pendingAuthMessage, { mode: register ? "register" : "login", path: register ? "/register" : "/login", replace: !["/login", "/register"].includes(path) });
      return;
    }
    if (path === "/changelog") {
      showChangelog(false);
      return;
    }
    if (path === "/trial") {
      showTrial(false);
      return;
    }
    if (["/", "/login", "/register", "/select"].includes(path)) {
      showModulePicker(false);
      if (path !== "/select") pushRoute("/select", true);
      return;
    }
    if (path === "/language") {
      showProjectPicker(false);
      return;
    }
    const languageMatch = path.match(/^\/language\/(english|japanese)$/);
    if (languageMatch) {
      pendingScreen = "workspace";
      enterProject(languageMatch[1], false);
      return;
    }
    if (path === "/tools" || path.startsWith("/tools/")) {
      await showTools(path, false);
      return;
    }
    if (path === "/admin") {
      await showAdminPanel(false);
      return;
    }
    if (path === "/account") {
      showModulePicker(false);
      openModal("accountModal");
      return;
    }
    if (path === "/recharge") {
      showModulePicker(false);
      await openMembershipModal();
      return;
    }
    showModulePicker(false);
    pushRoute("/select", true);
  } finally {
    routeBusy = false;
  }
}

function updateLanguageUi() {
  const language = state.quizLanguage;
  const select = $("languageSelect");
  if (select) select.value = language;

  document.querySelectorAll("[data-language-choice]").forEach((button) => {
    button.classList.toggle("active", button.dataset.languageChoice === language);
  });

  const quizLabel = $("quizLanguageLabel");
  if (quizLabel) quizLabel.textContent = quizLanguageLabel(language);
  const projectLabel = $("projectNameLabel");
  if (projectLabel) projectLabel.textContent = language ? `${quizLanguageLabel(language)}测试` : "";
  const input = $("wordInput");
  if (input) input.placeholder = language === "japanese"
    ? "输入日语词表，每行一个词；汉字或假名都可以"
    : "输入英语词表，每行一个词";
  updateAiSuggestionControls();
  const searchInput = $("aiSearchInput");
  if (searchInput) {
    searchInput.placeholder = language === "japanese" ? "输入日语词或假名前缀" : "输入英语单词或前缀";
    if (searchInput.value.trim()) scheduleVocabularySearch();
  }
}

function aiSuggestionSettingsKey(language = state.quizLanguage) {
  return state.account?.id
    ? accountAiSuggestionSettingsKey(language)
    : `aiSuggestSettings:${language}`;
}

function saveAiSuggestionSettings() {
  if (!LANGUAGE_LABELS[state.quizLanguage]) return;
  const level = $("aiLevelSelect")?.value || "";
  const count = Number($("aiSuggestCount")?.value);
  const mode = $("aiSuggestMode")?.value === "append" ? "append" : "replace";
  const settings = { level, count, mode };
  safeStorageSet(localStorage, aiSuggestionSettingsKey(), JSON.stringify(settings));
  safeStorageSet(localStorage, `aiSuggestSettings:${state.quizLanguage}`, JSON.stringify(settings));
  queueLanguageSettingsForSync(state.quizLanguage);
}

function updateAiSuggestionControls() {
  const language = state.quizLanguage;
  const levelSelect = $("aiLevelSelect");
  const countInput = $("aiSuggestCount");
  if (!levelSelect || !countInput || !VOCABULARY_LEVEL_OPTIONS[language]) return;
  const previousLanguage = levelSelect.dataset.language || "";
  const previousLevel = previousLanguage === language ? levelSelect.value : "";
  const saved = previousLanguage === language ? null : savedAiSuggestionSettings(language);
  levelSelect.replaceChildren();
  VOCABULARY_LEVEL_OPTIONS[language].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    levelSelect.append(option);
  });
  const savedLevel = String(saved?.level || "");
  if (previousLevel && VOCABULARY_LEVEL_OPTIONS[language].some(([value]) => value === previousLevel)) {
    levelSelect.value = previousLevel;
  } else if (savedLevel && VOCABULARY_LEVEL_OPTIONS[language].some(([value]) => value === savedLevel)) {
    levelSelect.value = savedLevel;
  }
  levelSelect.dataset.language = language;
  $("aiSuggestLanguage").textContent = quizLanguageLabel(language);
  const accountLimit = accountWordLimit(language);
  const maxCount = Number.isFinite(accountLimit) ? accountLimit : 200;
  countInput.max = String(maxCount);
  if (saved && Number.isInteger(Number(saved.count))) countInput.value = String(saved.count);
  if (saved && $("aiSuggestMode")) $("aiSuggestMode").value = saved.mode === "append" ? "append" : "replace";
  const currentCount = Number(countInput.value);
  if (!Number.isInteger(currentCount) || currentCount < 1 || currentCount > maxCount) {
    countInput.value = String(Math.min(10, maxCount));
  }
  if (previousLanguage && previousLanguage !== language) $("aiSuggestMessage").textContent = "";
}

function updatePracticeUi() {
  const select = $("practiceModeSelect");
  if (select) select.value = state.practiceMode;
  const label = $("practiceModeLabel");
  if (label) label.textContent = practiceModeLabel(state.practiceMode);
}

function setQuizLanguage(value) {
  const language = normalizeQuizLanguage(value);
  if (!language) return;
  if (!currentProject) enterProject(language);
}

function setPracticeMode(value) {
  state.practiceMode = normalizePracticeMode(value);
  saveState();
  updatePracticeUi();
  updateStats();
}

function ensureQuizLanguage() {
  if (state.quizLanguage) return state.quizLanguage;
  showProjectPicker();
  alert("请先从项目选择页进入英语测试或日语测试。");
  return "";
}

function unlockAchievement(id) {
  const item = ACHIEVEMENTS.find((achievement) => achievement.id === id);
  if (!item || state.achievements[id]) return;
  state.achievements[id] = new Date().toLocaleString();
  saveAchievements();
  showAchievementToast(`解锁成就：${item.title}`);
  renderAchievements();
}

function showAchievementToast(message) {
  const toast = $("achievementToast");
  if (!toast) return;
  clearTimeout(achievementToastTimer);
  clearTimeout(achievementToastHideTimer);
  toast.textContent = message;
  toast.classList.remove("hidden", "is-leaving");
  window.requestAnimationFrame(() => toast.classList.add("is-visible"));
  achievementToastTimer = window.setTimeout(() => {
    toast.classList.add("is-leaving");
    toast.classList.remove("is-visible");
    achievementToastHideTimer = window.setTimeout(() => toast.classList.add("hidden"), 240);
  }, 3200);
}

function achievementMetrics() {
  return calculateAchievementMetrics(state.studyRecords, state.historyWrongBook, (language) => {
    const storedGoal = Number.parseInt(localStorage.getItem(studyGoalKey(language)), 10);
    return Number.isInteger(storedGoal) && storedGoal >= 1 && storedGoal <= 500 ? storedGoal : 20;
  });
}

function evaluateAchievements(notify = false) {
  const metrics = achievementMetrics();
  const unlockedNow = [];
  ACHIEVEMENTS.forEach((item) => {
    if (!item.metric || state.achievements[item.id]) return;
    if ((metrics[item.metric] || 0) < item.goal) return;
    state.achievements[item.id] = new Date().toLocaleString();
    unlockedNow.push(item);
  });
  if (unlockedNow.length) {
    saveAchievements();
    if (notify) {
      showAchievementToast(unlockedNow.length === 1
        ? `解锁成就：${unlockedNow[0].title}`
        : `一次解锁 ${unlockedNow.length} 个成就`);
    }
  }
  return metrics;
}

function renderAchievements() {
  const list = $("achievementList");
  if (!list) return;
  list.innerHTML = "";
  const metrics = evaluateAchievements(false);
  const unlockedCount = ACHIEVEMENTS.filter((item) => state.achievements[item.id]).length;
  const points = ACHIEVEMENTS.reduce((sum, item) => (
    state.achievements[item.id] ? sum + (ACHIEVEMENT_TIERS[item.tier]?.points || 0) : sum
  ), 0);
  $("achievementSummary").textContent = `${state.profile} · ${ACHIEVEMENTS.length} 个挑战`;
  $("achievementPoints").textContent = `${points} 点`;
  $("achievementUnlockedCount").textContent = unlockedCount;
  $("achievementInProgressCount").textContent = ACHIEVEMENTS.length - unlockedCount;
  $("achievementCompletion").textContent = `${Math.round((unlockedCount / ACHIEVEMENTS.length) * 100)}%`;
  $("achievementTotalProgress").max = ACHIEVEMENTS.length;
  $("achievementTotalProgress").value = unlockedCount;

  document.querySelectorAll("[data-achievement-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.achievementFilter === achievementFilter);
  });

  const visibleItems = ACHIEVEMENTS.filter((item) => {
    const unlocked = Boolean(state.achievements[item.id]);
    if (achievementFilter === "unlocked") return unlocked;
    if (achievementFilter === "progress") return !unlocked;
    return true;
  });

  visibleItems.forEach((item) => {
    const node = document.createElement("article");
    const unlockedAt = state.achievements[item.id];
    const tier = ACHIEVEMENT_TIERS[item.tier] || ACHIEVEMENT_TIERS.bronze;
    const current = item.metric ? Math.max(0, metrics[item.metric] || 0) : unlockedAt ? 1 : 0;
    const goal = item.goal || 1;
    node.className = `achievement-item tier-${item.tier || "bronze"}${unlockedAt ? " unlocked" : ""}`;
    const title = document.createElement("h3");
    const name = document.createElement("strong");
    const mark = document.createElement("span");
    mark.className = "achievement-tier";
    const desc = document.createElement("p");
    name.textContent = item.title;
    mark.textContent = `${item.category} · ${tier.label}`;
    title.appendChild(name);
    title.appendChild(mark);
    desc.textContent = item.desc;
    node.appendChild(title);
    node.appendChild(desc);

    const progress = document.createElement("div");
    progress.className = "achievement-card-progress";
    const bar = document.createElement("progress");
    bar.max = goal;
    bar.value = unlockedAt ? goal : Math.min(current, goal);
    const detail = document.createElement("div");
    const count = document.createElement("span");
    count.textContent = item.metric ? `${Math.min(current, goal)} / ${goal}` : unlockedAt ? "已完成" : "等待触发";
    const reward = document.createElement("span");
    reward.textContent = `${tier.points} 点`;
    detail.append(count, reward);
    progress.append(bar, detail);
    node.appendChild(progress);

    const status = document.createElement("p");
    status.className = "achievement-status";
    status.textContent = unlockedAt ? `已获得 · ${unlockedAt}` : "尚未完成";
    node.appendChild(status);
    list.appendChild(node);
  });
  if (!visibleItems.length) {
    const empty = document.createElement("p");
    empty.className = "achievement-empty";
    empty.textContent = achievementFilter === "unlocked" ? "还没有已获得的成就" : "所有成就都已完成";
    list.appendChild(empty);
  }
}

function currentStudyRecords() {
  return state.studyRecords
    .filter((record) => record.language === state.quizLanguage)
    .sort((left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt));
}

function studyGoalValue() {
  const stored = Number.parseInt(localStorage.getItem(studyGoalKey()), 10);
  return Number.isInteger(stored) && stored >= 1 && stored <= 500 ? stored : 20;
}

function saveStudyGoal() {
  const input = $("studyGoalInput");
  if (!input || !state.account?.id || !state.quizLanguage) return;
  const goal = Math.max(1, Math.min(500, Number.parseInt(input.value, 10) || 20));
  input.value = String(goal);
  safeStorageSet(localStorage, studyGoalKey(), String(goal));
  queueStudyGoalForSync();
  renderStudyDashboard();
  renderDashboard();
}

function recordStudyRound(summary) {
  if (!state.account?.id || !summary?.total || !normalizeQuizLanguage(summary.language)) return;
  const finishedAt = new Date().toISOString();
  state.studyRecords.push({
    id: limitText(summary.roundId, 100) || `${Date.now()}-${summary.language}-${state.studyRecords.length}`,
    finishedAt,
    language: summary.language,
    practiceMode: normalizePracticeMode(summary.practiceMode),
    mode: summary.mode,
    total: summary.total,
    correct: summary.correct,
    wrong: summary.wrong,
    skipped: summary.skipped,
    accuracy: summary.accuracy,
    durationSec: summary.durationSec,
  });
  saveStudyRecords();
  evaluateAchievements(true);
  if ($("studyView")?.classList.contains("active")) renderStudyDashboard();
}

function renderStudyDashboard() {
  const history = $("studyHistory");
  const chart = $("studyWeekChart");
  if (!history || !chart) return;
  const records = currentStudyRecords();
  const days = studyDaySeries(7);
  const dayByKey = new Map(days.map((day) => [day.key, day]));
  records.forEach((record) => {
    const day = dayByKey.get(localDayKey(record.finishedAt));
    if (!day) return;
    day.total += record.total;
    day.correct += record.correct;
    day.rounds += 1;
  });

  const totalWords = records.reduce((sum, record) => sum + record.total, 0);
  const weekWords = days.reduce((sum, day) => sum + day.total, 0);
  const weekCorrect = days.reduce((sum, day) => sum + day.correct, 0);
  const today = days[days.length - 1];
  const goal = studyGoalValue();
  const recent = records[0];

  $("studyGoalInput").value = String(goal);
  $("studyGoalProgress").textContent = `${today.total} / ${goal}`;
  $("studyGoalBar").max = goal;
  $("studyGoalBar").value = Math.min(today.total, goal);
  $("studyGoalBar").textContent = `${today.total} / ${goal}`;
  $("studyGoalBar").setAttribute("aria-valuetext", `${today.total} / ${goal} 题`);
  $("studyTotalRounds").textContent = records.length;
  $("studyTotalWords").textContent = totalWords;
  $("studyWeekAccuracy").textContent = weekWords ? `${Math.round((weekCorrect / weekWords) * 100)}%` : "--";
  $("studyStreak").textContent = calculateStudyStreak(records);
  $("studyWeekTotal").textContent = `${weekWords} 题`;
  $("studyRecordCount").textContent = `${records.length} 条`;
  $("studySummary").textContent = recent
    ? `${state.profile} · ${quizLanguageLabel(state.quizLanguage)} · 最近学习 ${new Date(recent.finishedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
    : `${state.profile} · ${quizLanguageLabel(state.quizLanguage)} · 暂无完成记录`;

  chart.innerHTML = "";
  const maxTotal = Math.max(1, ...days.map((day) => day.total));
  days.forEach((day) => {
    const item = document.createElement("div");
    item.className = `study-day${day.total ? "" : " is-empty"}`;
    item.title = `${day.date.toLocaleDateString("zh-CN")} · ${day.total} 题${day.total ? ` · 正确率 ${Math.round((day.correct / day.total) * 100)}%` : ""}`;
    const count = document.createElement("span");
    count.className = "study-day-count";
    count.textContent = String(day.total);
    const track = document.createElement("div");
    track.className = "study-day-track";
    const bar = document.createElement("i");
    bar.className = "study-day-bar";
    bar.style.height = day.total ? `${Math.max(8, Math.round((day.total / maxTotal) * 100))}%` : "0";
    track.appendChild(bar);
    const label = document.createElement("span");
    label.className = "study-day-label";
    label.textContent = day.date.toLocaleDateString("zh-CN", { weekday: "short" });
    item.append(count, track, label);
    chart.appendChild(item);
  });
  chart.setAttribute("aria-label", `最近七天共完成 ${weekWords} 题`);

  history.innerHTML = "";
  records.slice(0, 20).forEach((record) => {
    const row = document.createElement("article");
    row.className = "study-history-row";
    const time = document.createElement("strong");
    time.textContent = new Date(record.finishedAt).toLocaleString("zh-CN", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    const mode = document.createElement("span");
    mode.textContent = record.mode.startsWith("review-") ? "错题复习" : practiceModeLabel(record.practiceMode);
    const total = document.createElement("span");
    total.textContent = `${record.total} 题`;
    const accuracy = document.createElement("span");
    accuracy.className = "study-history-accuracy";
    accuracy.textContent = `${record.accuracy}%`;
    const duration = document.createElement("span");
    duration.textContent = formatDuration(record.durationSec);
    const main = document.createElement("div");
    main.className = "study-history-main";
    main.append(time, mode);
    const facts = document.createElement("div");
    facts.className = "study-history-facts";
    facts.append(total, accuracy, duration);
    row.append(main, facts);
    history.appendChild(row);
  });
  if (!records.length) {
    const empty = document.createElement("p");
    empty.className = "study-empty";
    empty.textContent = "完成一轮测试或错题复习后，这里会显示学习趋势。";
    history.appendChild(empty);
  }
  $("exportStudyBtn").disabled = !records.length;
  $("clearStudyBtn").disabled = !records.length;
}

function exportStudyRecords() {
  const records = currentStudyRecords();
  if (!records.length) return;
  const payload = {
    type: "wyj-study-history",
    version: STUDY_DATA_VERSION,
    exported_at: new Date().toISOString(),
    profile: state.profile,
    language: state.quizLanguage,
    daily_goal: studyGoalValue(),
    records,
  };
  const safeProfile = profileStorageName(state.profile).replace(/[^\w\u4e00-\u9fff-]+/gu, "-");
  downloadText(`study-${state.quizLanguage}-${safeProfile}-${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
}

function confirmClearStudyRecords() {
  const records = currentStudyRecords();
  if (!records.length) return;
  askConfirmation(`确认清除${quizLanguageLabel(state.quizLanguage)}的 ${records.length} 条学习统计？错题和成就不会被删除。`, () => {
    state.studyRecords = state.studyRecords.filter((record) => record.language !== state.quizLanguage);
    saveStudyRecords();
    renderStudyDashboard();
  });
}

function backendErrorMessage(error) {
  const detail = String(error?.message || "");
  if (navigator.onLine === false) return "设备当前没有网络连接，请联网后重试。";
  if (error?.code === "request_timeout" || error?.name === "TimeoutError" || detail.includes("超时")) {
    return "服务器响应超时，可保留当前页面稍后重试。";
  }
  if (Number(error?.status) === 530) {
    return "Cloudflare 云端服务暂时无法处理请求，请稍后重试。";
  }
  if ([502, 503, 504].includes(Number(error?.status))) {
    return "云端服务正在恢复，请稍候几秒后重试。";
  }
  return BACKEND_NETWORK_MESSAGE;
}

const { api, apiGet, publicApi, requestJsonGet, uploadApi, uploadBinaryApi } = createApiClient({
  getSession: () => state.session,
  backendErrorMessage,
  markBackendReachable,
  markGetReachable: () => { backendAvailable = true; },
  markNetworkFailure: (message, source) => {
    backendAvailable = false;
    if (source !== "upload") backendFailureMessage = message;
  },
  handleSessionExpired: (options = {}) => {
    clearSession();
    showAuth("登录已失效，请重新登录", options);
  },
  handleMembershipRequired: () => openMembershipModal({ goal: membershipGoalForCurrentContext() }),
});

function applyBackendStatus(data) {
  markBackendReachable(data);
  aiAvailable = data.ai_ready !== false;
  $("modelLabel").textContent = data.model || (aiAvailable ? "Workers AI" : "规则模式");
  $("statusDot").classList.toggle("online", true);
}

function markBackendReachable(data = {}) {
  backendAvailable = true;
  backendFailureMessage = "";
  if (typeof data.ai_ready === "boolean") aiAvailable = data.ai_ready;
  if (data.model && $("modelLabel")) $("modelLabel").textContent = data.model;
  $("statusDot")?.classList.toggle("online", backendAvailable);
}

async function requestBackendStatus() {
  let lastError = new Error(BACKEND_NETWORK_MESSAGE);
  for (const baseDelay of STATUS_RETRY_BASE_DELAYS_MS) {
    const delay = retryDelayWithJitter(baseDelay);
    if (delay) await waitForDelay(delay);
    try {
      const response = await fetchWithTimeout("/api/status", { cache: "no-store" }, STATUS_TIMEOUT_MS);
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok) return data;
      const error = new Error(data.error || `服务器返回 ${response.status}`);
      error.status = response.status;
      error.code = data.code || "status_unavailable";
      lastError = error;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function checkBackendStatus() {
  if (!backendStatusPromise) {
    backendStatusPromise = requestBackendStatus().finally(() => {
      backendStatusPromise = null;
    });
  }
  return backendStatusPromise;
}

async function ensureBackendConnection() {
  if (backendAvailable) return true;
  try {
    applyBackendStatus(await checkBackendStatus());
    return true;
  } catch (error) {
    backendAvailable = false;
    aiAvailable = false;
    backendFailureMessage = backendErrorMessage(error);
    $("modelLabel").textContent = "离线模式";
    $("statusDot").classList.remove("online");
    return false;
  }
}

function setView(id) {
  if (id === "quizView" && !state.roundActive) id = "setupView";
  const leavingQuiz = id !== "quizView" && $("quizView")?.classList.contains("active");
  if (leavingQuiz) {
    if (judgeController) judgeController.abort();
  }
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === id));
  document.querySelectorAll(".tabs button").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === id));
  if (id === "quizView" && state.roundActive) {
    if (state.pendingAdvance) resumeQuestionTransition();
    else $("answerInput")?.focus();
  }
  if (id === "wrongView") renderWrongBook({ force: true });
  if (id === "achievementsView") renderAchievements();
  if (id === "studyView") renderStudyDashboard();
  if (currentProject && state.roundActive) saveProjectRuntime();
}

function updateStats() {
  const analysis = analyzeWordList(parseWords(), state.quizLanguage);
  const eligibleWords = analysis.valid;
  $("statWords").textContent = eligibleWords.length || state.words.length;
  $("statWrong").textContent = Object.keys(activeWrongBook("current")).length;
  $("statScore").textContent = state.score;
  if ($("scoreLabel") && state.roundActive) $("scoreLabel").textContent = `得分 ${state.score}`;
  const limit = accountWordLimit(state.quizLanguage);
  const exceeded = Number.isFinite(limit) && eligibleWords.length > limit;
  $("wordInput")?.classList.toggle("limit-exceeded", exceeded);
  if ($("wordLimitHint")) {
    $("wordLimitHint").textContent = Number.isFinite(limit)
      ? `当前账户每次最多测试 ${limit} 个单词${exceeded ? "，请开通会员后继续" : ""}`
      : "当前语言不限单次测试数量";
  }
  if ($("wordQualityHint")) {
    const ignored = [];
    if (analysis.duplicates) ignored.push(`${analysis.duplicates} 个重复词`);
    if (analysis.invalid.length) ignored.push(`${analysis.invalid.length} 个其他语言或无效词`);
    $("wordQualityHint").textContent = hasStorageWriteFailure()
      ? "浏览器存储空间不足，本次更改可能无法在刷新后保留"
      : ignored.length
        ? `可测试 ${eligibleWords.length} 个，开始时将忽略${ignored.join("、")}`
        : eligibleWords.length ? `已识别 ${eligibleWords.length} 个可测试词` : "";
    $("wordQualityHint").classList.toggle("has-warning", hasStorageWriteFailure() || ignored.length > 0);
  }
  const quizTab = document.querySelector('[data-view="quizView"]');
  if (quizTab) {
    quizTab.disabled = !state.roundActive;
    quizTab.title = state.roundActive ? "继续当前测试" : "尚未开始测试";
  }
  updateSetupActionState();
  const promptKey = `${state.quizLanguage}:${eligibleWords.length}`;
  if (exceeded && promptKey !== lastLimitPromptKey && !$("entryScreen")) {
    lastLimitPromptKey = promptKey;
    openMembershipModal({ goal: state.quizLanguage });
  }
}

function setBusy(busy) {
  state.busy = busy;
  ["reviewBtn", "reviewHistoryBtn"].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = busy;
  });
  updateQuestionControls();
  updateSetupActionState();
}

function updateQuestionControls() {
  const disabled = state.busy || state.answerLocked || !state.roundActive;
  ["submitBtn", "skipBtn", "speakBtn", "answerInput"].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = disabled;
  });
}

function setAnswerLocked(locked) {
  state.answerLocked = Boolean(locked);
  updateQuestionControls();
}

function updateSetupActionState() {
  const wordCount = analyzeWordList(parseWords(), state.quizLanguage).valid.length;
  if ($("startBtn")) $("startBtn").disabled = state.busy || wordCount === 0;
  if ($("shuffleBtn")) $("shuffleBtn").disabled = state.busy || wordCount < 2;
  if ($("clearBtn")) $("clearBtn").disabled = state.busy || wordCount === 0;
  if ($("exportWordsBtn")) $("exportWordsBtn").disabled = state.busy || wordCount === 0;
  if ($("importWordsBtn")) $("importWordsBtn").disabled = state.busy;
  if ($("wordInput")) $("wordInput").disabled = state.busy;
}

function setNextNowEnabled(enabled) {
  const el = $("nextNowBtn");
  if (el) el.disabled = !enabled || state.busy;
}

function clearNextTimer() {
  if (nextTimer) {
    clearTimeout(nextTimer);
    nextTimer = null;
  }
}

function hideResultPanel() {
  if (resultHideTimer) {
    clearTimeout(resultHideTimer);
    resultHideTimer = null;
  }
  $("resultPanel").classList.remove("grading", "ai-review");
  $("resultPanel").classList.add("hidden");
}

function scheduleResultHide(delayMs = QUESTION_TRANSITION_MS) {
  if (resultHideTimer) clearTimeout(resultHideTimer);
  resultHideTimer = setTimeout(() => {
    resultHideTimer = null;
    $("resultPanel").classList.add("hidden");
  }, delayMs);
}

function pendingAdvanceMatchesCurrentQuestion(pending = state.pendingAdvance) {
  return Boolean(
    pending
    && state.roundActive
    && pending.roundId === state.roundId
    && pending.questionIndex === state.index,
  );
}

function scheduleNext() {
  clearNextTimer();
  if (!pendingAdvanceMatchesCurrentQuestion()) {
    setNextNowEnabled(false);
    return;
  }
  const pendingId = state.pendingAdvance.id;
  const remainingMs = Math.max(0, state.pendingAdvance.dueAt - Date.now());
  setNextNowEnabled(true);
  nextTimer = setTimeout(() => {
    nextTimer = null;
    nextWord(pendingId);
  }, remainingMs);
}

function beginQuestionTransition(feedback) {
  const cleanFeedback = sanitizeQuestionFeedback(feedback);
  if (!cleanFeedback || !state.roundActive || state.pendingAdvance) return false;
  const dueAt = Date.now() + QUESTION_TRANSITION_MS;
  state.pendingAdvance = {
    id: `${state.roundId}:${state.index}:${dueAt}`,
    roundId: state.roundId,
    questionIndex: state.index,
    dueAt,
    feedback: cleanFeedback,
  };
  setAnswerLocked(true);
  renderQuestionFeedback(cleanFeedback);
  saveProjectRuntime();
  scheduleNext();
  return true;
}

function resumeQuestionTransition() {
  if (!state.pendingAdvance) return false;
  if (!pendingAdvanceMatchesCurrentQuestion()) {
    state.pendingAdvance = null;
    setAnswerLocked(false);
    clearNextTimer();
    setNextNowEnabled(false);
    hideResultPanel();
    saveProjectRuntime();
    return false;
  }
  renderQuestionFeedback(state.pendingAdvance.feedback);
  if (state.pendingAdvance.dueAt <= Date.now()) nextWord(state.pendingAdvance.id);
  else scheduleNext();
  return true;
}

function isDictationMode() {
  return state.mode === "normal" && state.practiceMode === "dictation";
}

function speechLang() {
  return state.quizLanguage === "japanese" ? "ja-JP" : "en-US";
}

function speakCurrentWord() {
  const word = state.words[state.index];
  if (!word || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = speechLang();
  utterance.rate = state.quizLanguage === "japanese" ? 0.82 : 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function normalizeDictationAnswer(value) {
  return normalizeDictationAnswerModel(value, state.quizLanguage);
}

function rememberJapaneseVocabularyData(readings, writtenForms = {}, persist = true) {
  const cleanReadings = sanitizeJapaneseReadings(readings);
  const cleanWrittenForms = sanitizeJapaneseWrittenForms(writtenForms);
  if (Object.keys(cleanReadings).length) {
    state.japaneseReadings = sanitizeJapaneseReadings({ ...state.japaneseReadings, ...cleanReadings });
  }
  if (Object.keys(cleanWrittenForms).length) {
    state.japaneseWrittenForms = sanitizeJapaneseWrittenForms({
      ...state.japaneseWrittenForms,
      ...cleanWrittenForms,
    });
  }
  if (persist) {
    safeStorageSet(localStorage, JAPANESE_READING_CACHE_KEY, JSON.stringify(state.japaneseReadings));
    safeStorageSet(localStorage, JAPANESE_WRITTEN_FORM_CACHE_KEY, JSON.stringify(state.japaneseWrittenForms));
  }
}

function rememberJapaneseReadings(readings, persist = true) {
  rememberJapaneseVocabularyData(readings, {}, persist);
}

function japaneseReadingFor(word) {
  return japaneseReadingForModel(word, state.japaneseReadings);
}

function japaneseWrittenFormFor(word) {
  return japaneseWrittenFormForModel(word, state.japaneseWrittenForms);
}

function japaneseDictationRequiresBoth(word) {
  return japaneseDictationRequiresBothModel(word, state.japaneseReadings, state.japaneseWrittenForms);
}

function formatJapaneseDictationAnswer(word) {
  return formatJapaneseDictationAnswerModel(word, state.japaneseReadings, state.japaneseWrittenForms);
}

function installLocalTestBindings() {
  const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(location.hostname);
  if (!isLoopback || globalThis.__WYJ_TEST_MODE__ !== true) return;

  const values = {
    APP_VERSION: () => APP_VERSION,
    QUESTION_TRANSITION_MS: () => QUESTION_TRANSITION_MS,
    activeWrongRejudgeKey: () => activeWrongRejudgeKey,
    adminFeedback: () => adminFeedback,
    backendAvailable: () => backendAvailable,
    currentPaymentOrder: () => currentPaymentOrder,
    currentProject: () => currentProject,
    learningSyncManager: () => learningSyncManager,
    learningSyncStatus: () => learningSyncStatus,
    learningSyncWrongRenderPending: () => learningSyncWrongRenderPending,
    paymentQrObjectUrl: () => paymentQrObjectUrl,
    pendingScreen: () => pendingScreen,
    selectedMembershipGoal: () => selectedMembershipGoal,
    selectedPaymentMethod: () => selectedPaymentMethod,
    state: () => state,
  };
  const functions = {
    activeWrongBook,
    formatJapaneseDictationAnswer,
    japaneseReadingFor,
    japaneseWrittenFormFor,
    queueStudyGoalForSync,
    rememberJapaneseVocabularyData,
    renderDashboard,
    renderWrongBook,
    shuffle,
    studyGoalKey,
    wrongRejudgeLogKey,
  };

  Object.entries(values).forEach(([name, read]) => {
    Object.defineProperty(globalThis, name, { configurable: true, get: read });
  });
  Object.entries(functions).forEach(([name, value]) => {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  });
}

function dictationEvaluation(word, answer, language = state.quizLanguage) {
  return evaluateDictation(word, answer, {
    language,
    readings: state.japaneseReadings,
    writtenForms: state.japaneseWrittenForms,
  });
}

function reviewEntryForWord(word) {
  if (state.mode === "review-current") return state.currentWrongBook[word];
  if (state.mode === "review-history") return state.historyWrongBook[word];
  return null;
}

function rubricCacheKey(word) {
  return `${APP_VERSION}:${state.quizLanguage}:${String(word || "").trim()}`;
}

function cachedRubric(word) {
  return state.rubricCache[rubricCacheKey(word)] || state.rubricCache[word] || null;
}

function cacheRubric(word, rubric) {
  if (!rubric || typeof rubric !== "object") return;
  state.rubricCache[rubricCacheKey(word)] = rubric;
  if (rubric.reading) rememberJapaneseReadings({ [word]: rubric.reading });
}

function hasUsableMeaning(info) {
  const answer = limitText(info && info.correct_answer);
  return Boolean(answer && !answer.startsWith("跳过：") && answer !== "（未给出释义）");
}

function localReviewResult(word, answer, info, options = {}) {
  return evaluateLocalMeaning(word, answer, info, {
    language: normalizeQuizLanguage(options.language) || state.quizLanguage,
    gradingMode: ["strict", "normal", "lenient"].includes(options.gradingMode)
      ? options.gradingMode
      : state.gradingMode,
  });
}

function parseWordText(value, captureReadings = true) {
  const parsed = parseWordTextModel(value, state.quizLanguage);
  if (captureReadings) rememberJapaneseVocabularyData(parsed.readings, parsed.writtenForms);
  return parsed.words;
}

function parseWords() {
  return parseWordText($("wordInput").value);
}

function cancelVocabularySearch() {
  if (vocabularySearchTimer) {
    window.clearTimeout(vocabularySearchTimer);
    vocabularySearchTimer = null;
  }
  if (vocabularySearchController) {
    vocabularySearchController.abort();
    vocabularySearchController = null;
  }
  vocabularySearchSequence += 1;
}

function addVocabularySearchWord(word) {
  const language = ensureQuizLanguage();
  if (!language) return;
  const current = analyzeWordList(parseWords(), language).valid;
  const seen = new Set(current.map((item) => wordIdentity(item, language)));
  if (seen.has(wordIdentity(word, language))) {
    $("aiSuggestMessage").textContent = `“${word}”已在词表中`;
    return;
  }
  current.push(word);
  $("wordInput").value = formatWordsForInput(current);
  saveCurrentWordDraft();
  updateStats();
  $("aiSuggestMessage").classList.remove("error");
  $("aiSuggestMessage").textContent = `已将“${word}”加入词表`;
}

function renderVocabularySearchResults(matches, query) {
  const target = $("aiSearchResults");
  if (!target) return;
  const values = Array.isArray(matches) ? matches : [];
  if (!query || !values.length) {
    target.replaceChildren();
    target.classList.add("hidden");
    if (query) $("aiSuggestMessage").textContent = "当前等级没有匹配词，可尝试缩短关键词";
    return;
  }
  target.innerHTML = values.map((item) => `<button type="button" data-vocabulary-word="${escapeHtml(item.word)}" title="${escapeHtml(item.match_type || "匹配")}">${escapeHtml(item.word)}</button>`).join("");
  target.querySelectorAll("[data-vocabulary-word]").forEach((button) => {
    button.addEventListener("click", () => addVocabularySearchWord(button.dataset.vocabularyWord));
  });
  target.classList.remove("hidden");
}

async function runVocabularySearch() {
  const input = $("aiSearchInput");
  const query = input?.value.trim() || "";
  if (!query) {
    cancelVocabularySearch();
    renderVocabularySearchResults([], "");
    return;
  }
  const language = ensureQuizLanguage();
  if (!language || !state.session || !state.account) return;
  if (!backendAvailable && !(await ensureBackendConnection())) return;
  if (vocabularySearchController) vocabularySearchController.abort();
  const controller = new AbortController();
  const sequence = ++vocabularySearchSequence;
  vocabularySearchController = controller;
  $("aiSuggestMessage").classList.remove("error");
  $("aiSuggestMessage").textContent = "正在本地分级索引中搜索…";
  try {
    const data = await api(
      "/api/vocabulary/suggest",
      {
        language,
        level: $("aiLevelSelect").value,
        count: 12,
        query,
        exclude: [],
      },
      { controller, timeoutMs: 5000 },
    );
    if (sequence !== vocabularySearchSequence || controller.signal.aborted) return;
    renderVocabularySearchResults(data.matches || (data.words || []).map((word) => ({ word })), query);
    $("aiSuggestMessage").textContent = data.words?.length
      ? `找到 ${data.words.length} 个分级匹配词，点击即可加入词表`
      : "当前等级没有匹配词，可尝试缩短关键词";
  } catch (error) {
    if (error.name !== "AbortError" && sequence === vocabularySearchSequence) {
      $("aiSuggestMessage").textContent = error.message;
      $("aiSuggestMessage").classList.add("error");
    }
  } finally {
    if (vocabularySearchController === controller) vocabularySearchController = null;
  }
}

function scheduleVocabularySearch() {
  if (vocabularySearchTimer) window.clearTimeout(vocabularySearchTimer);
  if (vocabularySearchController) vocabularySearchController.abort();
  vocabularySearchTimer = window.setTimeout(() => {
    vocabularySearchTimer = null;
    runVocabularySearch();
  }, 200);
}

async function generateAiVocabulary() {
  const language = ensureQuizLanguage();
  if (!language) return;
  const message = $("aiSuggestMessage");
  const button = $("aiSuggestBtn");
  if (button.disabled) return;
  if (!state.session || !state.account) {
    showAuth("请先登录后使用 AI 联网选词");
    return;
  }
  if (!backendAvailable) {
    message.textContent = "正在重新连接服务器…";
    if (!(await ensureBackendConnection())) {
      message.textContent = backendFailureMessage;
      message.classList.add("error");
      return;
    }
  }
  const level = $("aiLevelSelect").value;
  const count = Number($("aiSuggestCount").value);
  const mode = $("aiSuggestMode").value;
  const maxCount = Number($("aiSuggestCount").max || 200);
  const baseWords = mode === "append" ? analyzeWordList(parseWords(), language).valid : [];
  const existingLanguageWords = baseWords;
  if (!Number.isInteger(count) || count < 1 || count > maxCount) {
    message.textContent = `请输入 1 至 ${maxCount} 之间的整数`;
    message.classList.add("error");
    return;
  }
  const accountLimit = accountWordLimit(language);
  const remaining = Number.isFinite(accountLimit) ? Math.max(0, accountLimit - new Set(existingLanguageWords).size) : Infinity;
  if (mode === "append" && count > remaining) {
    message.textContent = remaining > 0
      ? `当前词表还能追加 ${remaining} 个词，请减少数量`
      : "当前词表已达到本次测试上限，请改用替换词表或开通会员";
    message.classList.add("error");
    return;
  }

  button.disabled = true;
  button.textContent = "搜索中…";
  message.classList.remove("error");
  message.textContent = "正在从内置分级索引选词；不足时才会调用 Workers AI…";
  saveAiSuggestionSettings();
  try {
    const data = await api(
      "/api/vocabulary/suggest",
      { language, level, count, exclude: existingLanguageWords, query: "" },
      { timeoutMs: 240000 },
    );
    rememberJapaneseVocabularyData(data.readings || {}, data.written_forms || {});
    const generated = filterWordsByLanguage(data.words || [], language);
    if (!generated.length) throw new Error("没有生成可用词汇，请重试");
    const existingKeys = new Set(baseWords.map((word) => wordIdentity(word, language)));
    const added = generated.filter((word) => {
      const key = wordIdentity(word, language);
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
    if (!added.length) throw new Error("这次找到的词都已在词表中，请重试或改用替换词表");
    const words = mode === "append" ? [...baseWords, ...added] : added;
    $("wordInput").value = formatWordsForInput(words);
    saveCurrentWordDraft();
    updateStats();
    const sourceText = data.selection_source === "local" ? "内置分级索引" : "内置索引与 Workers AI";
    message.textContent = `${sourceText} 已${mode === "append" ? "追加" : "生成"} ${added.length} 个${data.level_label || ""}词汇`;
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  } finally {
    button.disabled = false;
    button.textContent = "生成词表";
  }
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function ensureJapaneseQuestionForms(words) {
  if (state.quizLanguage !== "japanese") return true;
  const dictation = state.practiceMode === "dictation";
  const required = words.filter((word) => wordMatchesLanguage(word, "japanese"));
  const missing = required.filter((word) => {
    const hasReading = Boolean(japaneseReadingFor(word));
    if (!dictation) return hasJapaneseKanji(word) && !hasReading;
    const hasWrittenResolution = hasJapaneseKanji(word)
      || Object.prototype.hasOwnProperty.call(state.japaneseWrittenForms, word);
    return !hasReading || !hasWrittenResolution;
  });
  if (!missing.length) return true;
  if (!backendAvailable || !state.session) {
    alert(dictation
      ? "这些日语词还缺少完整的汉字或假名写法，请联网后重试。"
      : "这些日语汉字还缺少假名读音，请联网后重试。");
    return false;
  }

  let resolution = null;
  try {
    resolution = await api(
      "/api/japanese/readings",
      { words: missing, quiz_session: state.quizSession },
      { timeoutMs: 180000 },
    );
    rememberJapaneseVocabularyData(resolution.readings || {}, resolution.written_forms || {});
  } catch (error) {
    alert(`${dictation ? "获取日语完整写法" : "获取日语假名读音"}失败：${error.message}。内置词库未收录的生僻词需要 Workers AI 可用。`);
    return false;
  }

  const unresolved = required.filter((word) => {
    const hasReading = Boolean(japaneseReadingFor(word));
    if (!dictation) return hasJapaneseKanji(word) && !hasReading;
    const hasWrittenResolution = hasJapaneseKanji(word)
      || Object.prototype.hasOwnProperty.call(state.japaneseWrittenForms, word);
    return !hasReading || !hasWrittenResolution;
  });
  if (unresolved.length) {
    const preview = unresolved.slice(0, 5).join("、");
    if (!dictation && resolution?.ai_unavailable) {
      alert(`AI 暂时不可用，${preview}${unresolved.length > 5 ? "等" : ""}暂不显示假名标音；释义练习仍可继续。`);
      return true;
    }
    alert(`AI 暂时未找到这些词的${dictation ? "完整写法" : "假名读音"}：${preview}${unresolved.length > 5 ? "等" : ""}。请稍后重试。`);
    return false;
  }
  return true;
}

async function startQuiz(words, mode = "normal", options = {}) {
  const language = ensureQuizLanguage();
  if (!language) return;

  if (state.roundActive && !options.replaceActive) {
    askConfirmation("当前测试尚未完成，确认放弃当前进度并开始新一轮？", () => (
      startQuiz(words, mode, { replaceActive: true })
    ));
    return;
  }

  if (mode === "normal" && (!backendAvailable || !state.session)) {
    if (backendAvailable) {
      showAuth("开始测试前请登录账户；错题复习仍可离线进行。未登录时不能绕过测试数量限制。");
    } else {
      alert("当前离线：可以复习已有错题；开始新测试需要连接 Cloudflare 云端服务并登录账户。");
    }
    return;
  }

  const analysis = analyzeWordList(words, language);
  const quizWords = analysis.valid;
  const excludedCount = analysis.invalid.length;
  if (!quizWords.length) {
    alert(`当前选择的是${quizLanguageLabel(language)}，词表里没有可测试的${quizLanguageLabel(language)}词。`);
    return;
  }
  if (excludedCount > 0 || analysis.duplicates > 0) {
    const ignored = [];
    if (excludedCount) ignored.push(`${excludedCount} 个其他语言或无效词`);
    if (analysis.duplicates) ignored.push(`${analysis.duplicates} 个重复词`);
    alert(`已按${quizLanguageLabel(language)}模式忽略${ignored.join("、")}。`);
  }

  state.quizSession = "";
  if (backendAvailable && state.session) {
    setBusy(true);
    try {
      const authorization = await api("/api/quiz/start", { language, words: quizWords });
      state.quizSession = authorization.quiz_session;
      applyAccount(authorization.account);
      if (mode === "normal" && !(await ensureJapaneseQuestionForms(quizWords))) return;
    } catch (error) {
      if (error.code === "membership_required") {
        await openMembershipModal({ goal: language });
        $("rechargeMessage").textContent = error.message || "当前词表超过普通账户上限，请选择适合的会员方案。";
      } else {
        alert(error.message);
      }
      return;
    } finally {
      setBusy(false);
    }
  } else if (mode === "normal") {
    return;
  }

  clearNextTimer();
  hideResultPanel();
  setNextNowEnabled(false);

  if (mode === "normal") {
    state.currentWrongBook = removeLanguageFromWrongBook(state.currentWrongBook, language);
    state.wrongScope = "current";
    saveWrongBooks();
  }

  state.words = shuffle(quizWords);
  state.index = 0;
  state.score = 0;
  state.roundSkipped = 0;
  state.lastRound = null;
  state.mode = mode;
  state.roundActive = true;
  state.answerLocked = false;
  state.pendingAdvance = null;
  state.roundStartedAt = Date.now();
  state.roundId = globalThis.crypto?.randomUUID?.() || `${state.roundStartedAt}-${language}-${Math.random().toString(36).slice(2, 10)}`;
  updateStats();
  setView("quizView");
  showWord();
  saveProjectRuntime();
}

function showWord(options = {}) {
  if (!state.roundActive) return;
  const preserveTransition = Boolean(options.preserveTransition && state.pendingAdvance);
  const word = state.words[state.index] || "-";
  const dictation = isDictationMode();
  const reading = !dictation && state.quizLanguage === "japanese" && hasJapaneseKanji(word)
    ? japaneseReadingFor(word)
    : "";
  $("wordText").textContent = dictation ? "听写" : word;
  $("wordReading").textContent = reading;
  $("wordReading").classList.toggle("hidden", !reading);
  $("wordReading").setAttribute("aria-hidden", String(!reading));
  $("wordLabel").setAttribute("aria-label", reading ? `${word}，读音 ${reading}` : (dictation ? "听写" : word));
  $("wordLabel").classList.toggle("has-reading", Boolean(reading));
  $("wordLabel").classList.toggle("dictation-display", dictation);
  $("progressLabel").textContent = `${state.index + 1}/${state.words.length}`;
  $("scoreLabel").textContent = `得分 ${state.score}`;
  $("quizLanguageLabel").textContent = quizLanguageLabel(state.quizLanguage);
  $("practiceModeLabel").textContent = state.mode.startsWith("review-") ? "错题复习" : practiceModeLabel(state.practiceMode);
  $("answerInput").value = "";
  $("answerInput").placeholder = dictation
    ? state.quizLanguage === "japanese"
      ? japaneseDictationRequiresBoth(word)
        ? "输入汉字和假名，例如 学校 / がっこう"
        : "输入听到的假名"
      : "输入听到的单词"
    : "中文意思";
  clearAnswerValidation();
  setAnswerLocked(preserveTransition);
  $("speakBtn").classList.toggle("hidden", !dictation);
  if (!preserveTransition) {
    hideResultPanel();
    clearNextTimer();
    setNextNowEnabled(false);
  }
  $("acceptedChips").innerHTML = "";
  const quizVisible = $("quizView")?.classList.contains("active") && !$("workspace")?.classList.contains("hidden");
  if (options.focus !== false && quizVisible && !preserveTransition) $("answerInput").focus();
  if (dictation && !preserveTransition) speakCurrentWord();
}

function updateWrongEntry(book, word, answer, gloss, accepted, context = {}) {
  return updateWrongEntryModel(book, word, answer, gloss, accepted, {
    ...context,
    skipped: answer === SKIPPED_ANSWER,
    language: normalizeQuizLanguage(context.language) || state.quizLanguage,
    gradingMode: ["strict", "normal", "lenient"].includes(context.gradingMode)
      ? context.gradingMode
      : state.gradingMode,
  });
}

function markWrong(word, answer, gloss, accepted, rubric = null) {
  const context = {
    questionType: isDictationMode() ? "dictation" : "meaning",
    language: state.quizLanguage,
    gradingMode: state.gradingMode,
    roundId: state.roundId,
    rubric,
  };
  updateWrongEntry(state.currentWrongBook, word, answer, gloss, accepted, context);
  updateWrongEntry(state.historyWrongBook, word, answer, gloss, accepted, context);
  saveState();
  updateStats();
  if (answer === SKIPPED_ANSWER) unlockAchievement("skipSaved");
  if (Object.keys(state.historyWrongBook).length >= 10) unlockAchievement("wrongTen");
}

function removeReviewedWord(word) {
  if (state.mode === "review-current") delete state.currentWrongBook[word];
  if (state.mode === "review-history") delete state.historyWrongBook[word];
  saveState();
}

function questionFeedbackFromResult(result) {
  return sanitizeQuestionFeedback({
    type: "answer",
    correct: result.correct,
    gloss: result.gloss,
    accepted: result.accepted,
    kind: result.kind,
    ai_review: result.ai_review,
  });
}

function renderQuestionFeedback(feedback) {
  const result = sanitizeQuestionFeedback(feedback);
  if (!result) return;
  if (resultHideTimer) {
    clearTimeout(resultHideTimer);
    resultHideTimer = null;
  }
  $("resultPanel").classList.remove("hidden", "grading", "ai-review");
  void $("resultPanel").offsetWidth;
  $("resultPanel").classList.toggle("ai-review", Boolean(result.ai_review));
  $("resultTitle").className = `result-title ${result.correct ? "ok" : "bad"}`;
  $("resultTitle").textContent = result.type === "skipped" ? "已跳过" : result.correct ? "正确" : "错误";
  const label = result.kind === "dictation" ? "正确答案" : "标准释义";
  $("resultGloss").textContent = result.type === "skipped"
    ? `${label}：${result.gloss}\n已加入错题本`
    : `${label}：${result.gloss}`;
  $("acceptedChips").innerHTML = "";
  (result.accepted || []).slice(0, 12).forEach((item) => {
    const chip = document.createElement("span");
    chip.textContent = item;
    $("acceptedChips").appendChild(chip);
  });
}

function clearAnswerValidation() {
  const input = $("answerInput");
  const message = $("answerValidation");
  if (input) {
    input.classList.remove("input-invalid");
    input.removeAttribute("aria-invalid");
  }
  if (message) {
    message.textContent = "";
    message.classList.add("hidden");
  }
}

function showAnswerValidation(customMessage = "") {
  const dictation = isDictationMode();
  const currentWord = state.words[state.index];
  const text = customMessage || (!dictation
    ? "请输入中文意思"
    : state.quizLanguage === "japanese"
      ? japaneseDictationRequiresBoth(currentWord)
        ? "请输入汉字和假名，答案仍停留在本题"
        : "请输入听到的假名，答案仍停留在本题"
      : "请输入听到的英语单词");
  const input = $("answerInput");
  const message = $("answerValidation");
  clearNextTimer();
  if (input) {
    input.classList.add("input-invalid");
    input.setAttribute("aria-invalid", "true");
    input.focus();
  }
  if (message) {
    message.textContent = text;
    message.classList.remove("hidden");
  }
}

function nextWord(expectedPendingId = "") {
  const pending = state.pendingAdvance;
  if (!pendingAdvanceMatchesCurrentQuestion(pending)) return;
  if (typeof expectedPendingId === "string" && expectedPendingId && pending.id !== expectedPendingId) return;
  state.pendingAdvance = null;
  clearNextTimer();
  hideResultPanel();
  setAnswerLocked(false);
  setNextNowEnabled(false);
  if (state.index < state.words.length - 1) {
    state.index += 1;
    showWord();
    saveProjectRuntime();
  } else {
    const summary = finishRound();
    const hasWrong = Object.keys(activeWrongBook("current")).length > 0;
    setView(hasWrong ? "wrongView" : "setupView");
    showRoundSummary(summary);
  }
}

function finishRound() {
  if (!state.words.length) return null;
  const total = state.words.length;
  const skipped = Math.min(state.roundSkipped, total);
  const wrong = Math.max(0, total - state.score - skipped);
  const durationSec = state.roundStartedAt
    ? Math.max(1, Math.round((Date.now() - state.roundStartedAt) / 1000))
    : 0;
  const summary = {
    total,
    correct: state.score,
    wrong,
    skipped,
    accuracy: Math.round((state.score / total) * 100),
    words: [...state.words],
    mode: state.mode,
    language: state.quizLanguage,
    practiceMode: state.practiceMode,
    durationSec,
    roundId: state.roundId,
  };
  state.lastRound = summary;
  state.roundActive = false;
  state.answerLocked = false;
  state.pendingAdvance = null;
  if (state.score === state.words.length) unlockAchievement("perfectRound");
  if (state.words.length >= 20) unlockAchievement("longRound");
  if (state.mode === "normal") {
    unlockAchievement("firstQuiz");
    if (state.practiceMode === "dictation") unlockAchievement("firstDictation");
  }
  recordStudyRound(summary);
  state.roundStartedAt = 0;
  state.roundId = "";
  state.quizSession = "";
  removeProjectRuntime();
  updateQuestionControls();
  return summary;
}

function showRoundSummary(summary) {
  if (!summary) return;
  $("roundSummaryTitle").textContent = summary.correct === summary.total ? "本轮满分" : "本轮完成";
  $("roundSummaryMessage").textContent = `${quizLanguageLabel(summary.language)} · ${summary.mode.startsWith("review-") ? "错题复习" : practiceModeLabel(summary.practiceMode)}`;
  $("roundTotalCount").textContent = summary.total;
  $("roundCorrectCount").textContent = summary.correct;
  $("roundWrongCount").textContent = summary.wrong;
  $("roundSkippedCount").textContent = summary.skipped;
  $("roundDuration").textContent = formatDuration(summary.durationSec);
  $("roundAccuracy").textContent = `正确率 ${summary.accuracy}%`;
  $("roundWrongBtn").disabled = summary.wrong + summary.skipped === 0;
  openModal("roundSummaryModal");
}

async function retryLastRound() {
  const summary = state.lastRound;
  if (!summary?.words?.length) return;
  closeModal("roundSummaryModal", true);
  await startQuiz(summary.words, summary.mode);
}

async function resolveCurrentQuestionRubric(word) {
  const cached = sanitizeStoredRubric(cachedRubric(word));
  if (cached.gloss && !cached.gloss.startsWith("跳过：") && cached.gloss !== "（未给出释义）") return cached;

  const reviewInfo = reviewEntryForWord(word);
  if (hasUsableMeaning(reviewInfo)) {
    return sanitizeStoredRubric(reviewInfo.rubric, reviewInfo.correct_answer, reviewInfo.accepted);
  }
  if (!backendAvailable || !state.session || !state.quizSession) {
    throw new Error("暂时无法取得这道题的标准释义，请恢复网络后重试");
  }
  const data = await api("/api/rubric", { word, quiz_session: state.quizSession }, { timeoutMs: AI_TIMEOUT_MS });
  const rubric = sanitizeStoredRubric(data.rubric);
  if (!rubric.gloss || rubric.gloss === "（未给出释义）") throw new Error("服务暂未返回可用的标准释义，请稍后重试");
  cacheRubric(word, rubric);
  saveState();
  return rubric;
}

async function requestMeaningJudgement({ word, answer, quizSession, rubric, gradingMode, language, controller = null }) {
  return api("/api/judge", {
    word,
    answer,
    quiz_session: quizSession,
    rubric: rubric || null,
    mode: gradingMode,
    language,
  }, { controller, timeoutMs: AI_TIMEOUT_MS });
}

async function skipWord() {
  if (state.busy || state.answerLocked || !state.roundActive) return;

  const word = state.words[state.index];
  if (!word) return;
  clearAnswerValidation();
  const snapshot = { roundId: state.roundId, index: state.index, word, language: currentProject };
  setBusy(true);
  try {
    const rubric = await resolveCurrentQuestionRubric(word);
    const unchanged = state.roundActive
      && state.roundId === snapshot.roundId
      && state.index === snapshot.index
      && state.words[state.index] === snapshot.word
      && currentProject === snapshot.language
      && !state.pendingAdvance;
    if (!unchanged) return;
    state.roundSkipped += 1;
    markWrong(word, SKIPPED_ANSWER, rubric.gloss, rubric.accepted, rubric);
    updateStats();
    beginQuestionTransition({
      type: "skipped",
      gloss: rubric.gloss,
      accepted: rubric.accepted,
      kind: isDictationMode() ? "dictation" : "meaning",
    });
  } catch (error) {
    showAnswerValidation(`无法跳过：${error.message}`);
  } finally {
    setBusy(false);
    if (state.pendingAdvance) setNextNowEnabled(true);
  }
}

async function submitAnswer(event) {
  event.preventDefault();
  if (state.busy || state.answerLocked || !state.roundActive) return;
  const word = state.words[state.index];
  const answer = $("answerInput").value.trim();
  if (!word) return;
  if (!answer) {
    showAnswerValidation();
    return;
  }
  clearAnswerValidation();

  if (isDictationMode()) {
    clearNextTimer();
    hideResultPanel();
    setNextNowEnabled(false);
    const evaluation = dictationEvaluation(word, answer);
    if (evaluation.correct) {
      state.score += 1;
      removeReviewedWord(word);
      unlockAchievement("firstCorrect");
    } else {
      markWrong(word, answer, evaluation.expected, [evaluation.expected], {
        language: quizLanguageLabel(state.quizLanguage),
        gloss: evaluation.expected,
        accepted: [evaluation.expected],
        notes: evaluation.guidance,
      });
    }
    saveState();
    const result = {
      correct: evaluation.correct,
      gloss: evaluation.expected,
      accepted: evaluation.guidance ? [evaluation.guidance] : [],
      kind: "dictation",
    };
    updateStats();
    beginQuestionTransition(questionFeedbackFromResult(result));
    return;
  }

  if (state.mode === "review-current" || state.mode === "review-history") {
    setBusy(true);
    clearNextTimer();
    hideResultPanel();
    setNextNowEnabled(false);

    try {
      let info = reviewEntryForWord(word);
      if (!info) throw new Error("错题记录不存在，请重新进入错题复习");

      if (!hasUsableMeaning(info) && backendAvailable && aiAvailable && state.session) {
        $("resultPanel").classList.remove("hidden");
        $("resultTitle").className = "result-title";
        $("resultTitle").textContent = "首次准备释义";
        $("resultGloss").textContent = "正在获取标准释义，保存后可继续离线复习";
        const data = await api("/api/rubric", { word, quiz_session: state.quizSession }, { timeoutMs: AI_TIMEOUT_MS });
        const rubric = data.rubric || {};
        info.correct_answer = limitText(rubric.gloss) || info.correct_answer;
        info.accepted = sanitizeAccepted(rubric.accepted);
        cacheRubric(word, rubric);
        saveState();
      }

      info = reviewEntryForWord(word);
      if (!hasUsableMeaning(info)) {
        throw new Error("这条旧错题没有保存标准释义；请联网获取一次后再复习。");
      }

      const result = localReviewResult(word, answer, info);
      if (result.correct) {
        state.score += 1;
        removeReviewedWord(word);
        unlockAchievement("firstCorrect");
      } else {
        markWrong(word, answer, result.gloss, result.accepted, result.rubric);
      }
      saveState();
      updateStats();
      beginQuestionTransition(questionFeedbackFromResult(result));
    } catch (error) {
      $("resultPanel").classList.remove("grading", "ai-review", "hidden");
      $("resultTitle").className = "result-title bad";
      $("resultTitle").textContent = "错题复习暂不可用";
      $("resultGloss").textContent = error.message;
      scheduleResultHide();
    } finally {
      setBusy(false);
      if (nextTimer) setNextNowEnabled(true);
    }
    return;
  }

  setBusy(true);
  clearNextTimer();
  hideResultPanel();
  setNextNowEnabled(false);
  $("resultPanel").classList.add("grading");
  $("resultPanel").classList.remove("hidden");
  $("resultTitle").className = "result-title";
  $("resultTitle").textContent = "判卷中";
  $("resultGloss").textContent = "";
  $("acceptedChips").innerHTML = "";
  judgeController = new AbortController();
  $("cancelJudgeBtn").classList.remove("hidden");

  try {
    const result = await requestMeaningJudgement({
      word,
      answer,
      quizSession: state.quizSession,
      rubric: cachedRubric(word),
      gradingMode: state.gradingMode,
      language: state.quizLanguage,
      controller: judgeController,
    });
    if (result.rubric) cacheRubric(word, result.rubric);

    if (result.correct) {
      state.score += 1;
      removeReviewedWord(word);
      unlockAchievement("firstCorrect");
    } else {
      markWrong(word, answer, result.gloss, result.accepted, result.rubric);
    }

    saveState();
    updateStats();
    beginQuestionTransition(questionFeedbackFromResult(result));
  } catch (error) {
    if (error.name === "AbortError") {
      hideResultPanel();
    } else {
      $("resultPanel").classList.remove("grading", "ai-review");
      $("resultTitle").className = "result-title bad";
      $("resultTitle").textContent = "判卷失败";
      $("resultGloss").textContent = error.message;
      scheduleResultHide();
    }
  } finally {
    judgeController = null;
    $("cancelJudgeBtn").classList.add("hidden");
    setBusy(false);
    if (nextTimer) setNextNowEnabled(true);
  }
}

function setWrongScope(scope) {
  state.wrongScope = scope === "history" ? "history" : "current";
  $("currentWrongTab").classList.toggle("active", state.wrongScope === "current");
  $("historyWrongTab").classList.toggle("active", state.wrongScope === "history");
  showWrongActionMessage("");
  renderWrongBook({ force: true });
}

function showWrongActionMessage(message, isError = false) {
  const node = $("wrongActionMessage");
  if (!node) return;
  if (wrongActionTimer) window.clearTimeout(wrongActionTimer);
  wrongActionTimer = null;
  node.textContent = message || "";
  node.classList.toggle("hidden", !message);
  node.classList.toggle("is-error", Boolean(message && isError));
  if (message) {
    wrongActionTimer = window.setTimeout(() => {
      node.textContent = "";
      node.classList.add("hidden");
      node.classList.remove("is-error");
      wrongActionTimer = null;
    }, 9000);
  }
}

function adjustStudyRecordAfterRejudge(info) {
  if (!info?.round_id) return false;
  const record = state.studyRecords.find((item) => item.id === info.round_id);
  if (!record) return false;
  if (info.skipped && record.skipped > 0) record.skipped -= 1;
  else if (!info.skipped && record.wrong > 0) record.wrong -= 1;
  else return false;
  record.correct = Math.min(record.total, record.correct + 1);
  record.accuracy = Math.round((record.correct / record.total) * 100);
  saveStudyRecords();
  return true;
}

function adjustActiveRoundAfterRejudge(word, info, result) {
  if (!state.roundActive || !info?.round_id || info.round_id !== state.roundId) return false;
  if (info.skipped) {
    if (state.roundSkipped <= 0) return false;
    state.roundSkipped -= 1;
  }
  state.score = Math.min(state.words.length, state.score + 1);
  if (state.pendingAdvance?.roundId === state.roundId && state.pendingAdvance.questionIndex === state.index) {
    state.pendingAdvance.feedback = sanitizeQuestionFeedback({
      type: "answer",
      correct: true,
      gloss: result.gloss || info.correct_answer,
      accepted: result.accepted || info.accepted,
      kind: info.question_type === "dictation" ? "dictation" : "meaning",
    });
  }
  updateStats();
  saveProjectRuntime();
  return true;
}

async function evaluateWrongRejudgeAnswer(word, answer, info) {
  const language = normalizeQuizLanguage(info.language) || (wordMatchesLanguage(word, "english") ? "english" : "japanese");
  const gradingMode = ["strict", "normal", "lenient"].includes(info.grading_mode) ? info.grading_mode : "normal";
  if (info.question_type === "dictation") {
    const evaluation = dictationEvaluation(word, answer, language);
    return {
      correct: evaluation.correct,
      gloss: evaluation.expected,
      accepted: evaluation.guidance ? [evaluation.guidance] : [],
      reason: evaluation.correct ? "按当前听写规则判定正确" : evaluation.guidance || "按当前听写规则仍不正确",
    };
  }

  const localResult = () => localReviewResult(word, answer, info, { language, gradingMode });
  if (backendAvailable && state.session) {
    try {
      const authorization = await api("/api/quiz/start", { language, words: [word] });
      const storedRubric = sanitizeStoredRubric(info.rubric, info.correct_answer, info.accepted);
      const result = await requestMeaningJudgement({
        word,
        answer,
        quizSession: authorization.quiz_session,
        rubric: storedRubric.gloss ? storedRubric : null,
        gradingMode,
        language,
      });
      return {
        correct: Boolean(result.correct),
        gloss: result.gloss || storedRubric.gloss,
        accepted: result.accepted || storedRubric.accepted,
        reason: result.correct ? "按当前服务端判卷规则判定正确" : "按当前服务端判卷规则仍不正确",
      };
    } catch (error) {
      if (!hasUsableMeaning(info)) throw error;
      const result = localResult();
      return {
        correct: result.correct,
        gloss: result.gloss,
        accepted: result.accepted,
        reason: `${result.correct ? "本地规则判定正确" : "本地规则仍判为错误"}（服务端暂不可用）`,
      };
    }
  }
  if (!hasUsableMeaning(info)) throw new Error("这条旧错题没有可用于重新判定的标准释义");
  const result = localResult();
  return {
    correct: result.correct,
    gloss: result.gloss,
    accepted: result.accepted,
    reason: result.correct ? "按当前本地判卷规则判定正确" : "按当前本地判卷规则仍不正确",
  };
}

async function rejudgeWrongAnswer(word, scope, answer, controls) {
  const key = `${scope}:${word}`;
  if (rejudgeInFlight.has(key)) return;
  const source = scope === "history" ? state.historyWrongBook : state.currentWrongBook;
  const info = source[word];
  if (!info) return;
  const cleanAnswer = limitText(answer, 240);
  if (!cleanAnswer) {
    controls.input.setAttribute("aria-invalid", "true");
    controls.status.textContent = info.question_type === "dictation" ? "请输入听写答案" : "请输入中文意思";
    controls.input.focus();
    return;
  }
  rejudgeInFlight.add(key);
  const idleStatus = controls.status.textContent;
  controls.input.removeAttribute("aria-invalid");
  controls.submit.disabled = true;
  controls.cancel.disabled = true;
  controls.submit.textContent = "判定中…";
  controls.status.textContent = "正在按正式答题规则判定新答案…";
  try {
    const result = await evaluateWrongRejudgeAnswer(word, cleanAnswer, info);
    const checkedAt = new Date().toISOString();
    appendWrongRejudgeLog({
      word,
      original_answer: info.original_answer || info.last_answer || "",
      submitted_answer: cleanAnswer,
      question_type: info.question_type,
      language: info.language,
      grading_mode: info.grading_mode,
      round_id: info.round_id,
      old_result: "incorrect",
      new_result: result.correct ? "correct" : "incorrect",
      reason: result.reason,
      checked_at: checkedAt,
    });
    if (result.correct) {
      delete state.currentWrongBook[word];
      delete state.historyWrongBook[word];
      const adjusted = adjustActiveRoundAfterRejudge(word, info, result) || adjustStudyRecordAfterRejudge(info);
      saveWrongBooks();
      renderWrongBook({ force: true });
      showRejudgeResultModal(
        "重新判定正确",
        `“${word}”重新作答正确，已从错题本移除${adjusted ? "并校正对应测试统计" : ""}。`,
        "success",
      );
    } else {
      [state.currentWrongBook, state.historyWrongBook].forEach((book) => {
        if (!book[word]) return;
        book[word] = sanitizeWrongBook({ [word]: {
          ...book[word],
          rejudged_at: checkedAt,
          rejudge_result: "incorrect",
          rejudge_reason: result.reason,
        } })[word];
      });
      saveWrongBooks();
      renderWrongBook({ force: true });
      showRejudgeResultModal(
        "重新判定仍不正确",
        `“${word}”已保留在错题本；错误次数未增加。`,
        "warning",
      );
    }
  } catch (error) {
    controls.status.textContent = idleStatus;
    showRejudgeResultModal(
      "重新判定失败",
      `“${word}”重新判定失败：${error.message || "请检查网络后重试"}`,
      "error",
    );
  } finally {
    rejudgeInFlight.delete(key);
    if (controls.submit.isConnected) {
      controls.submit.disabled = false;
      controls.cancel.disabled = false;
      controls.submit.textContent = "提交判定";
    }
  }
}

function renderWrongBook(options = {}) {
  const list = $("wrongList");
  const editingWrongAnswer = list.querySelector(".wrong-rejudge-form:not(.hidden)");
  if (!options.force && (activeWrongRejudgeKey || editingWrongAnswer)) {
    learningSyncWrongRenderPending = true;
    return false;
  }
  learningSyncWrongRenderPending = false;
  activeWrongRejudgeKey = "";
  list.innerHTML = "";
  const currentCount = Object.keys(activeWrongBook("current")).length;
  const historyCount = Object.keys(activeWrongBook("history")).length;
  [["reviewBtn", currentCount], ["exportBtn", currentCount], ["clearWrongBtn", currentCount], ["reviewHistoryBtn", historyCount], ["exportHistoryBtn", historyCount], ["clearHistoryBtn", historyCount]].forEach(([id, count]) => {
    const button = $(id);
    if (!button) return;
    button.disabled = count === 0;
    button.title = count === 0 ? "暂无可操作的错题" : "";
  });
  const scope = state.wrongScope;
  const book = activeWrongBook(scope);
  const query = normalizeMeaning($("wrongSearchInput")?.value || "");
  const allEntries = Object.entries(book).sort((a, b) => (b[1].wrong_count || 0) - (a[1].wrong_count || 0));
  const entries = query ? allEntries.filter(([word, info]) => (
    [word, info.last_answer, info.correct_answer, ...(info.accepted || [])]
      .some((value) => normalizeMeaning(value).includes(query))
  )) : allEntries;
  $("wrongScopeLabel").textContent = `${state.profile} · ${scope === "history" ? "历史错题" : "本轮错题"} · ${allEntries.length} 个${query ? ` · 显示 ${entries.length} 个` : ""}`;

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "error";
    empty.textContent = query ? "没有匹配的错题" : scope === "history" ? "历史错题为空" : "本轮还没有错题";
    list.appendChild(empty);
    updateStats();
    return;
  }

  const template = $("wrongItemTemplate");
  entries.forEach(([word, info], entryIndex) => {
    const node = template.content.cloneNode(true);
    node.querySelector(".wrong-item").dataset.word = word;
    node.querySelector("h3").textContent = word;
    node.querySelector("p").textContent = info.skipped
      ? `已跳过 · 标准：${info.correct_answer || "（未给出）"}`
      : `你答：${info.last_answer || ""} · 标准：${info.correct_answer || ""}`;
    node.querySelector("strong").textContent = `${info.wrong_count || 0}次`;
    const rejudgeStatus = node.querySelector(".wrong-rejudge-status");
    const persistedStatus = "可重新作答；答错不会增加错误次数";
    rejudgeStatus.textContent = persistedStatus;
    const openButton = node.querySelector(".wrong-rejudge-button");
    const form = node.querySelector(".wrong-rejudge-form");
    const input = node.querySelector(".wrong-rejudge-input");
    const submit = node.querySelector(".wrong-rejudge-submit");
    const cancel = node.querySelector(".wrong-rejudge-cancel");
    const formId = `wrongRejudgeForm-${scope}-${entryIndex}`;
    const interactionKey = `${scope}:${word}`;
    let openingGuardTimer = null;
    form.id = formId;
    openButton.setAttribute("aria-controls", formId);
    openButton.setAttribute("aria-expanded", "false");
    input.placeholder = info.question_type === "dictation" ? "输入新的听写答案" : "输入新的中文意思";
    const guardOpeningInteraction = () => {
      activeWrongRejudgeKey = interactionKey;
      window.clearTimeout(openingGuardTimer);
      openingGuardTimer = window.setTimeout(() => {
        if (form.classList.contains("hidden") && activeWrongRejudgeKey === interactionKey) {
          activeWrongRejudgeKey = "";
          if (learningSyncWrongRenderPending) queueMicrotask(renderWrongBook);
        }
      }, 1000);
    };
    openButton.addEventListener("pointerdown", guardOpeningInteraction, { passive: true });
    openButton.addEventListener("mousedown", guardOpeningInteraction, { passive: true });
    openButton.addEventListener("click", () => {
      window.clearTimeout(openingGuardTimer);
      const opening = form.classList.contains("hidden");
      form.classList.toggle("hidden", !opening);
      activeWrongRejudgeKey = opening ? interactionKey : "";
      openButton.setAttribute("aria-expanded", String(opening));
      rejudgeStatus.textContent = opening ? "请输入新答案后提交判定" : persistedStatus;
      if (opening) input.focus();
    });
    cancel.addEventListener("click", () => {
      form.classList.add("hidden");
      activeWrongRejudgeKey = "";
      openButton.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-invalid");
      rejudgeStatus.textContent = persistedStatus;
      if (learningSyncWrongRenderPending) {
        queueMicrotask(renderWrongBook);
      } else {
        openButton.focus();
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      rejudgeWrongAnswer(word, scope, input.value, { input, submit, cancel, status: rejudgeStatus });
    });
    node.querySelector(".wrong-remove-button").addEventListener("click", () => {
      askConfirmation(`确认从${scope === "history" ? "历史" : "本轮"}错题中移除“${word}”？`, () => {
        const target = scope === "history" ? state.historyWrongBook : state.currentWrongBook;
        delete target[word];
        saveState();
        renderWrongBook({ force: true });
      });
    });
    list.appendChild(node);
  });
  updateStats();
  return true;
}

function startWrongReview(scope) {
  const words = Object.keys(activeWrongBook(scope));
  if (!words.length) {
    renderWrongBook({ force: true });
    return;
  }
  startQuiz(words, scope === "history" ? "review-history" : "review-current");
}

async function exportWrongBook(scope = "current") {
  const book = activeWrongBook(scope);
  if (!Object.keys(book).length) {
    showWrongActionMessage(scope === "history"
      ? "历史错题为空，暂无可导出的 PDF"
      : "本轮错题为空，暂无可导出的 PDF", true);
    return;
  }

  const button = scope === "history" ? $("exportHistoryBtn") : $("exportBtn");
  const previousText = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = "导出中...";
  }
  showWrongActionMessage("");

  try {
    const blob = await createWrongBookPdf(book, {
      title: scope === "history" ? "WYJ的网站历史错题本" : "WYJ的网站本轮错题本",
      meta: {
        profile: state.profile,
        scope: scope === "history" ? "历史错题" : "本轮错题",
        grading_mode: state.gradingMode,
        language: state.quizLanguage,
        practice_mode: state.practiceMode,
        achievement_count: ACHIEVEMENTS.filter((item) => state.achievements[item.id]).length,
      },
    });
    const contentType = blob.type || "";
    const signature = await blob.slice(0, 4).text();
    if (!contentType.includes("application/pdf") || signature !== "%PDF") throw new Error("浏览器没有生成有效 PDF");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wrong-book-${scope}-${Date.now()}.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    unlockAchievement("firstPdf");
    showWrongActionMessage("PDF 已生成并开始下载。如果没有看到文件，请检查浏览器的下载权限。");
  } catch (error) {
    showWrongActionMessage(`导出失败：${error.message || "请检查浏览器下载权限"}`, true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousText;
    }
  }
}

function exportWrongData() {
  const payload = {
    type: WRONG_BOOK_EXPORT_TYPE,
    version: WRONG_BOOK_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    profile: state.profile,
    language: state.quizLanguage,
    currentWrongBook: sanitizeWrongBook(activeWrongBook("current")),
    historyWrongBook: sanitizeWrongBook(activeWrongBook("history")),
  };
  const safeProfile = state.profile.replace(/[\\/:*?"<>|]+/g, "-") || "default";
  downloadText(`wrong-book-${safeProfile}-${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  showWrongActionMessage("错题数据已开始下载。");
}

function importedWrongBooks(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("错题数据格式不正确");
  }

  if (payload.type === WRONG_BOOK_EXPORT_TYPE) {
    if (Number(payload.version) > WRONG_BOOK_EXPORT_VERSION) throw new Error("错题数据版本过新，请先更新网站");
    return {
      current: sanitizeWrongBook(payload.currentWrongBook),
      history: sanitizeWrongBook(payload.historyWrongBook),
      language: normalizeQuizLanguage(payload.language),
    };
  }

  if (payload.wrongBook && typeof payload.wrongBook === "object") {
    const book = sanitizeWrongBook(payload.wrongBook);
    return {
      current: payload.scope === "current" ? book : {},
      history: book,
      language: normalizeQuizLanguage(payload.language),
    };
  }

  return { current: {}, history: sanitizeWrongBook(payload), language: "" };
}

async function importWrongData(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  try {
    if (file.size > 1024 * 1024) throw new Error("错题数据文件不能超过 1 MB");
    const payload = JSON.parse(await file.text());
    const imported = importedWrongBooks(payload);
    if (imported.language && imported.language !== state.quizLanguage) {
      throw new Error(`该文件属于${quizLanguageLabel(imported.language)}项目，请返回项目选择页后再导入`);
    }
    state.currentWrongBook = mergeWrongBooks(state.currentWrongBook, imported.current);
    state.historyWrongBook = mergeWrongBooks(state.historyWrongBook, imported.history);
    if (!state.quizLanguage && imported.language) state.quizLanguage = imported.language;
    saveState();
    updateLanguageUi();
    updateStats();
    renderWrongBook({ force: true });
    $("offlineReviewBtn").classList.toggle("hidden", !hasLocalReviewData());
    alert(`错题数据导入完成：历史错题 ${Object.keys(state.historyWrongBook).length} 个。可以直接进入本地复习。`);
  } catch (error) {
    alert(`错题数据导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
}

function downloadText(filename, text, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportWords() {
  const words = analyzeWordList(parseWords(), state.quizLanguage).valid;
  if (!words.length) return;
  downloadText(`vocab-words-${Date.now()}.txt`, formatWordsForInput(words));
}

function confirmClearWords() {
  const count = parseWords().length;
  if (!count) return;
  askConfirmation(`确认清空当前词表中的 ${count} 个词？`, () => {
    $("wordInput").value = "";
    saveCurrentWordDraft();
    updateStats();
  });
}

function confirmClearWrongBook(scope) {
  const history = scope === "history";
  const count = Object.keys(activeWrongBook(history ? "history" : "current")).length;
  if (!count) return;
  askConfirmation(`确认清空${history ? "历史" : "本轮"}错题中的 ${count} 个词？此操作不可撤销。`, () => {
    if (history) state.historyWrongBook = removeLanguageFromWrongBook(state.historyWrongBook);
    else state.currentWrongBook = removeLanguageFromWrongBook(state.currentWrongBook);
    saveState();
    renderWrongBook({ force: true });
  });
}

function parseImportedWords(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const data = JSON.parse(trimmed);
    if (Array.isArray(data)) return parseWordText(data.map(String).join("\n"));
    if (Array.isArray(data.words)) {
      rememberJapaneseVocabularyData(data.readings || {}, data.written_forms || {});
      return parseWordText(data.words.map(String).join("\n"));
    }
  } catch (_) {
    // Fall through to plain text parsing.
  }

  return parseWordText(trimmed);
}

async function importWords(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    if (file.size > MAX_WORD_IMPORT_BYTES) throw new Error("词表文件不能超过 1 MB");
    const text = await file.text();
    if (text.length > MAX_WORD_INPUT_CHARS) throw new Error("词表内容过长，请分成多个文件导入");
    const analysis = analyzeWordList(parseImportedWords(text), state.quizLanguage);
    if (analysis.valid.length) {
      $("wordInput").value = formatWordsForInput(analysis.valid);
      saveCurrentWordDraft();
      updateStats();
      if (analysis.invalid.length || analysis.duplicates) {
        alert(`词表已导入，并忽略 ${analysis.invalid.length} 个无效词、${analysis.duplicates} 个重复词。`);
      }
    } else {
      throw new Error(`没有识别到可用于${quizLanguageLabel(state.quizLanguage)}测试的词`);
    }
  } catch (error) {
    alert(`词表导入失败：${error.message}`);
  } finally {
    event.target.value = "";
  }
}

function discardActiveRound() {
  if (!state.roundActive) return;
  if (judgeController) judgeController.abort();
  clearNextTimer();
  hideResultPanel();
  setNextNowEnabled(false);
  removeProjectRuntime();
  state.words = [];
  state.index = 0;
  state.score = 0;
  state.roundSkipped = 0;
  state.quizSession = "";
  state.lastRound = null;
  state.mode = "normal";
  state.roundActive = false;
  state.answerLocked = false;
  state.pendingAdvance = null;
  state.roundStartedAt = 0;
  state.roundId = "";
  updateQuestionControls();
  setView("setupView");
}

function changeProfile(value, options = {}) {
  const nextProfile = sanitizeProfile(value);
  if (state.roundActive && nextProfile !== state.profile && !options.abandonActive) {
    $("profileInput").value = state.profile;
    askConfirmation(`切换到“${nextProfile}”会放弃当前未完成的测试，确认继续？`, () => {
      changeProfile(nextProfile, { abandonActive: true });
    });
    return;
  }
  saveCurrentWordDraft();
  saveWrongBooks();
  saveAchievements();
  saveStudyRecords();
  if (options.abandonActive) discardActiveRound();
  state.profile = nextProfile;
  $("profileInput").value = state.profile;
  loadWrongBooks();
  loadAchievements();
  loadStudyRecords();
  loadCurrentWordDraft();
  saveState();
  updateStats();
  if ($("wrongView").classList.contains("active")) renderWrongBook({ force: true });
  if ($("achievementsView").classList.contains("active")) renderAchievements();
  if ($("studyView").classList.contains("active")) renderStudyDashboard();
}

async function login(event) {
  event.preventDefault();
  $("loginError").textContent = "";
  const button = $("loginSubmitBtn");
  if (button.disabled) return;
  button.disabled = true;
  try {
    if (!backendAvailable) {
      $("loginError").textContent = "正在重新连接服务器…";
      if (!(await ensureBackendConnection())) throw new Error(backendFailureMessage);
    }
    const data = await api("/api/login", {
      username: $("usernameInput").value.trim(),
      secret: $("secretInput").value,
    });
    state.session = data.session;
    const persisted = persistAccountSession(state.session);
    applyAccount(data.account);
    $("secretInput").value = "";
    clearSavedWordDrafts(data.account);
    pendingScreen = "workspace";
    pendingAuthMessage = "";
    $("modelLabel").textContent = data.model || "Cloudflare 云端";
    showModulePicker(false);
    pushRoute("/select", true);
    updateStats();
    if (!persisted) {
      window.setTimeout(() => alert(
        "已登录，但浏览器无法保存登录状态。当前页面仍可使用；关闭或刷新后可能需要重新登录。请检查隐私模式或站点存储权限。",
      ), 0);
    }
  } catch (error) {
    $("loginError").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function performBackendRefresh() {
  try {
    const data = await checkBackendStatus();
    applyBackendStatus(data);

    if (state.session) {
      const healthResponse = await fetchWithTimeout(
        "/api/health",
        {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            "X-Session-Token": state.session,
          },
          body: "{}",
        },
        STATUS_TIMEOUT_MS,
      );
      const health = await healthResponse.json().catch(() => ({}));
      if (!healthResponse.ok) {
        if (isCanonicalSessionFailure(health)) {
          clearSession();
          pendingScreen = "auth";
          pendingAuthMessage = health.error || "登录已失效，请重新登录";
        } else {
          backendAvailable = false;
          backendFailureMessage = health.error || "账户服务暂时不可用，请稍后重试。";
          pendingScreen = state.session && state.account ? "workspace" : "auth";
          pendingAuthMessage = state.session && state.account ? "" : backendFailureMessage;
        }
      } else {
        applyAccount(health.account);
        aiAvailable = health.ai_ready !== false;
        $("modelLabel").textContent = health.model || data.model || (aiAvailable ? "Workers AI" : "规则模式");
        $("statusDot").classList.toggle("online", true);
        pendingScreen = "workspace";
        pendingAuthMessage = "";
      }
    } else {
      pendingScreen = "auth";
      pendingAuthMessage = "";
    }
  } catch (error) {
    backendAvailable = false;
    aiAvailable = false;
    backendFailureMessage = backendErrorMessage(error);
    pendingScreen = state.session && state.account ? "workspace" : "auth";
    pendingAuthMessage = state.session && state.account ? "" : backendFailureMessage;
    $("modelLabel").textContent = "离线模式";
    $("statusDot").classList.remove("online");
  }
  applyPendingScreen();
  renderDashboard();
}

function refreshBackendState() {
  if (!backendRefreshPromise) {
    backendRefreshPromise = performBackendRefresh().finally(() => {
      backendRefreshPromise = null;
    });
  }
  return backendRefreshPromise;
}

function markBackendDisconnected(message = "设备当前没有网络连接，联网后会自动重连。") {
  backendAvailable = false;
  aiAvailable = false;
  backendFailureMessage = message;
  if ($("modelLabel")) $("modelLabel").textContent = "离线模式";
  $("statusDot")?.classList.remove("online");
  renderDashboard();
}

function scheduleBackendRecovery(baseDelayMs = 250) {
  if (navigator.onLine === false) return;
  window.clearTimeout(backendRecoveryTimer);
  backendRecoveryTimer = window.setTimeout(() => {
    backendRecoveryTimer = null;
    refreshBackendState();
  }, retryDelayWithJitter(baseDelayMs));
}

function closeAccountMenu() {
  const menu = $("accountMenu");
  if (menu) menu.open = false;
}

async function navigateFromSiteNav(destination) {
  closeAccountMenu();
  if (destination === "home") {
    if (state.session && state.account) showModulePicker(true);
    else showPublicHome(true);
    return;
  }
  if (destination === "changelog") {
    showChangelog(true);
    return;
  }
  if (destination === "language") {
    if (state.session && state.account) showProjectPicker(true);
    else showTrial(true, "quiz");
    return;
  }
  if (destination === "tools") {
    if (state.session && state.account) await showTools("/tools", true);
    else showTrial(true, "text");
  }
}

async function boot() {
  installLocalTestBindings();
  if (state.account?.id) {
    loadAccountLocalState();
    startLearningDataSync();
  }
  else resetLocalViewState();
  state.quizLanguage = "";

  $("profileInput").value = state.profile;
  $("gradingModeSelect").value = ["strict", "normal", "lenient"].includes(state.gradingMode) ? state.gradingMode : "normal";
  state.gradingMode = $("gradingModeSelect").value;
  state.practiceMode = normalizePracticeMode(state.practiceMode);
  $("practiceModeSelect").value = state.practiceMode;
  updateLanguageUi();
  updatePracticeUi();
  renderChangelog();
  renderAccountUi();

  $("loginForm").addEventListener("submit", login);
  $("registerForm").addEventListener("submit", registerAccount);
  $("showLoginBtn").addEventListener("click", () => showAuthMode("login", true));
  $("showRegisterBtn").addEventListener("click", () => showAuthMode("register", true));
  $("navLoginBtn").addEventListener("click", () => showAuth("", { mode: "login", path: "/login" }));
  $("navRegisterBtn").addEventListener("click", () => showAuth("", { mode: "register", path: "/register" }));
  document.querySelectorAll("[data-site-nav]").forEach((link) => link.addEventListener("click", async (event) => {
    event.preventDefault();
    await navigateFromSiteNav(link.dataset.siteNav);
  }));
  $("publicTrialBtn")?.addEventListener("click", () => showTrial(true, "quiz"));
  $("publicLanguageTrialBtn")?.addEventListener("click", () => showTrial(true, "quiz"));
  $("publicToolsTrialBtn")?.addEventListener("click", () => showTrial(true, "text"));
  $("publicRegisterBtn")?.addEventListener("click", () => showAuth("", { mode: "register", path: "/register" }));
  $("publicPlansBtn")?.addEventListener("click", () => showAuth("登录后可查看实时套餐并提交充值申请", { mode: "login", path: "/login" }));
  $("publicChangelogBtn")?.addEventListener("click", () => showChangelog(true));
  $("changelogTrialBtn")?.addEventListener("click", () => showTrial(true, "quiz"));
  $("dashboardChangelogBtn")?.addEventListener("click", () => showChangelog(true));
  $("learningSyncNowBtn")?.addEventListener("click", syncLearningDataNow);
  $("learningSyncExportBtn")?.addEventListener("click", exportLearningSyncBackup);
  $("learningSyncImportBtn")?.addEventListener("click", () => $("learningSyncFileInput")?.click());
  $("learningSyncFileInput")?.addEventListener("change", importLearningSyncBackup);
  $("dismissVersionNoticeBtn")?.addEventListener("click", dismissVersionNotice);
  $("viewVersionDetailsBtn")?.addEventListener("click", () => { dismissVersionNotice(); showChangelog(true); });
  $("trialHomeBtn")?.addEventListener("click", () => state.session && state.account ? showModulePicker(true) : showPublicHome(true));
  ["trialRegisterBtn", "trialQuizRegisterBtn"].forEach((id) => $(id)?.addEventListener("click", () => showAuth("注册后可保存词表、错题和学习记录", { mode: "register", path: "/register" })));
  document.querySelectorAll("[data-trial-tool]").forEach((button) => button.addEventListener("click", () => setTrialTool(button.dataset.trialTool)));
  $("trialQuizStartBtn")?.addEventListener("click", startTrialQuiz);
  $("trialQuizAnswerForm")?.addEventListener("submit", submitTrialQuizAnswer);
  $("trialQuizNextBtn")?.addEventListener("click", nextTrialQuestion);
  $("trialQuizRestartBtn")?.addEventListener("click", resetTrialQuiz);
  $("trialTextInput")?.addEventListener("input", updateTrialTextStats);
  $("trialJsonFormatBtn")?.addEventListener("click", formatTrialJson);
  $("trialJsonValidateBtn")?.addEventListener("click", validateTrialJson);
  $("trialJsonClearBtn")?.addEventListener("click", clearTrialJson);
  $("trialImageQuality")?.addEventListener("input", () => { $("trialImageQualityValue").textContent = `${$("trialImageQuality").value}%`; });
  $("trialImageInput")?.addEventListener("change", () => { releaseTrialImageOutput(); setTrialMessage("trialImageMessage"); });
  $("trialImageProcessBtn")?.addEventListener("click", processTrialImage);
  $("membershipBtn").addEventListener("click", async () => { closeAccountMenu(); pushRoute("/recharge"); await openMembershipModal(); });
  $("feedbackBtn").addEventListener("click", openFeedbackModal);
  $("accountBtn").addEventListener("click", () => { closeAccountMenu(); pushRoute("/account"); openModal("accountModal"); });
  $("homeBtn").addEventListener("click", () => { closeAccountMenu(); showModulePicker(true); });
  $("adminBtn").addEventListener("click", () => { closeAccountMenu(); showAdminPanel(true); });
  $("logoutBtn").addEventListener("click", () => { closeAccountMenu(); logoutAccount(); });
  document.querySelectorAll("[data-membership-goal]").forEach((button) => {
    button.addEventListener("click", () => selectMembershipGoal(button.dataset.membershipGoal));
  });
  $("submitRechargeBtn").addEventListener("click", submitRechargeRequest);
  $("confirmPaymentBtn").addEventListener("click", confirmRechargePayment);
  $("cancelPaymentOrderBtn").addEventListener("click", cancelRechargeOrder);
  $("retryMembershipPlansBtn").addEventListener("click", reloadMembershipPlans);
  $("copyOrderBtn").addEventListener("click", () => copyTextWithFeedback(currentPaymentOrder?.order_number || "", $("copyOrderBtn")));
  $("copyPaymentNoteBtn").addEventListener("click", () => copyTextWithFeedback(currentPaymentOrder?.payment_note || "", $("copyPaymentNoteBtn")));
  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.closeModal)));
  document.querySelectorAll(".modal-layer").forEach((modal) => modal.addEventListener("click", (event) => {
    if (event.target === modal && !modal.hasAttribute("data-confirm-only")) closeModal(modal.id);
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const openModals = [...document.querySelectorAll(".modal-layer:not(.hidden)")];
    const modal = openModals[openModals.length - 1];
    if (!modal) {
      closeAccountMenu();
      return;
    }
    if (modal.hasAttribute("data-confirm-only")) {
      modal.querySelector("button")?.focus();
      return;
    }
    if (modal.id === "confirmModal") confirmAction = null;
    closeModal(modal.id);
  });
  document.addEventListener("click", (event) => {
    const menu = $("accountMenu");
    if (menu?.open && !menu.contains(event.target)) closeAccountMenu();
  });
  $("changeSecretForm").addEventListener("submit", changeOwnSecret);
  $("toggleCurrentSecretBtn").addEventListener("click", () => setSecretFieldsVisibility(["currentSecretInput"], "toggleCurrentSecretBtn", $("currentSecretInput").type === "password"));
  $("toggleNewSecretBtn").addEventListener("click", () => setSecretFieldsVisibility(["newSecretInput", "newSecretConfirmInput"], "toggleNewSecretBtn", $("newSecretInput").type === "password"));
  $("generateOwnSecretBtn").addEventListener("click", generateOwnSecret);
  $("openDeleteAccountBtn").addEventListener("click", () => openModal("deleteAccountModal"));
  $("deleteAccountForm").addEventListener("submit", deleteOwnAccount);
  $("feedbackForm").addEventListener("submit", submitFeedback);
  document.querySelectorAll("[data-feedback-view]").forEach((button) => button.addEventListener("click", () => showFeedbackView(button.dataset.feedbackView)));
  $("refreshMyFeedbackBtn").addEventListener("click", loadMyFeedback);
  $("refreshVotingBtn").addEventListener("click", loadFeatureVoting);
  $("refreshAdminBtn").addEventListener("click", loadAdminData);
  $("leaveAdminBtn").addEventListener("click", leaveAdminPanel);
  $("adminUserSearch").addEventListener("input", () => renderAdminUsers());
  document.querySelectorAll("[data-admin-view]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-admin-view]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".admin-view").forEach((view) => view.classList.toggle("active", view.id === button.dataset.adminView));
    if (button.dataset.adminView === "adminFeedbackView") loadAdminFeedback();
  }));
  $("adminFeedbackSearch").addEventListener("input", () => {
    window.clearTimeout(adminFeedbackSearchTimer);
    adminFeedbackSearchTimer = window.setTimeout(loadAdminFeedback, 250);
  });
  ["adminFeedbackType", "adminFeedbackStatus"].forEach((id) => $(id).addEventListener("change", loadAdminFeedback));
  $("saveAdminMembershipBtn").addEventListener("click", saveAdminMembership);
  $("adminMembershipSelect").addEventListener("change", () => updateAdminMembershipFields(true));
  $("adminMembershipAction").addEventListener("change", () => updateAdminMembershipFields(true));
  $("adminDisableToolsBtn").addEventListener("click", () => updateAdminToolsOverride(false));
  $("adminEnableToolsBtn").addEventListener("click", () => updateAdminToolsOverride(null));
  $("toggleAdminSecretBtn").addEventListener("click", () => setAdminSecretVisibility($("adminNewSecretInput").type === "password"));
  $("generateAdminSecretBtn").addEventListener("click", generateAdminSecretForEditor);
  $("adminNewSecretInput").addEventListener("input", clearAdminSecretResult);
  $("saveAdminSecretBtn").addEventListener("click", saveAdminSecret);
  $("copyAdminSecretBtn").addEventListener("click", () => copyTextWithFeedback($("adminSecretResultValue").textContent, $("copyAdminSecretBtn")));
  $("adminToggleBanBtn").addEventListener("click", () => adminUserAction("ban"));
  $("adminForceLogoutBtn").addEventListener("click", () => adminUserAction("logout"));
  $("adminDeleteUserBtn").addEventListener("click", () => adminUserAction("delete"));
  $("cancelConfirmBtn").addEventListener("click", () => { confirmAction = null; closeModal("confirmModal"); });
  $("acceptConfirmBtn").addEventListener("click", runConfirmedAction);
  $("rejudgeResultConfirmBtn").addEventListener("click", closeRejudgeResultModal);
  $("roundRetryBtn").addEventListener("click", retryLastRound);
  $("roundWrongBtn").addEventListener("click", () => {
    closeModal("roundSummaryModal", true);
    setView("wrongView");
  });
  $("roundSetupBtn").addEventListener("click", () => {
    closeModal("roundSummaryModal", true);
    setView("setupView");
  });
  window.addEventListener("popstate", () => routeCurrent());
  $("offlineReviewBtn").addEventListener("click", () => {
    pendingScreen = "workspace";
    showWorkspace();
    setView("wrongView");
  });
  $("answerForm").addEventListener("submit", submitAnswer);
  $("answerInput").addEventListener("input", clearAnswerValidation);
  $("startBtn").addEventListener("click", () => startQuiz(parseWords()));
  $("aiSuggestBtn").addEventListener("click", generateAiVocabulary);
  $("aiSearchInput").addEventListener("input", scheduleVocabularySearch);
  ["aiLevelSelect", "aiSuggestCount", "aiSuggestMode"].forEach((id) => {
    $(id).addEventListener("change", () => {
      saveAiSuggestionSettings();
      if (id === "aiLevelSelect" && $("aiSearchInput").value.trim()) scheduleVocabularySearch();
    });
  });
  $("shuffleBtn").addEventListener("click", () => {
    $("wordInput").value = formatWordsForInput(shuffle(analyzeWordList(parseWords(), state.quizLanguage).valid));
    saveCurrentWordDraft();
    updateStats();
  });
  $("clearBtn").addEventListener("click", confirmClearWords);
  $("importWordsBtn").addEventListener("click", () => $("wordFileInput").click());
  $("exportWordsBtn").addEventListener("click", exportWords);
  $("wordFileInput").addEventListener("change", importWords);
  $("speakBtn").addEventListener("click", speakCurrentWord);
  $("skipBtn").addEventListener("click", skipWord);
  $("nextNowBtn").addEventListener("click", () => nextWord());
  $("cancelJudgeBtn").addEventListener("click", () => {
    if (judgeController) judgeController.abort();
  });
  $("backBtn").addEventListener("click", () => setView("setupView"));
  $("reviewBtn").addEventListener("click", () => startWrongReview("current"));
  $("reviewHistoryBtn").addEventListener("click", () => startWrongReview("history"));
  $("exportBtn").addEventListener("click", () => exportWrongBook("current"));
  $("exportHistoryBtn").addEventListener("click", () => exportWrongBook("history"));
  $("exportWrongDataBtn").addEventListener("click", exportWrongData);
  $("importWrongDataBtn").addEventListener("click", () => $("wrongDataFileInput").click());
  $("wrongDataFileInput").addEventListener("change", importWrongData);
  $("clearWrongBtn").addEventListener("click", () => confirmClearWrongBook("current"));
  $("clearHistoryBtn").addEventListener("click", () => confirmClearWrongBook("history"));
  $("studyGoalInput").addEventListener("change", saveStudyGoal);
  $("exportStudyBtn").addEventListener("click", exportStudyRecords);
  $("clearStudyBtn").addEventListener("click", confirmClearStudyRecords);
  $("currentWrongTab").addEventListener("click", () => setWrongScope("current"));
  $("historyWrongTab").addEventListener("click", () => setWrongScope("history"));
  $("wrongSearchInput").addEventListener("input", () => renderWrongBook({ force: true }));
  $("wordInput").addEventListener("input", () => {
    saveCurrentWordDraft();
    updateStats();
  });
  $("profileInput").addEventListener("change", (event) => changeProfile(event.target.value));
  $("languageSelect").addEventListener("change", (event) => setQuizLanguage(event.target.value));
  $("practiceModeSelect").addEventListener("change", (event) => setPracticeMode(event.target.value));
  document.querySelectorAll("[data-language-choice]").forEach((button) => {
    button.addEventListener("click", () => setQuizLanguage(button.dataset.languageChoice));
  });
  document.querySelectorAll("[data-project]").forEach((button) => {
    button.addEventListener("click", () => enterProject(button.dataset.project));
  });
  document.querySelectorAll("[data-dashboard-project], [data-dashboard-resume]").forEach((button) => {
    button.addEventListener("click", () => enterProject(button.dataset.dashboardProject || button.dataset.dashboardResume));
  });
  document.querySelectorAll("[data-module]").forEach((button) => button.addEventListener("click", async () => {
    if (button.dataset.module === "language") showProjectPicker(true);
    else await showTools("/tools", true);
  }));
  $("languageBackBtn").addEventListener("click", () => showModulePicker(true));
  $("backProjectBtn").addEventListener("click", () => showProjectPicker(true));
  $("leaveToolsBtn").addEventListener("click", () => showModulePicker(true));
  $("toolsAccountBtn").addEventListener("click", () => { pushRoute("/account"); openModal("accountModal"); });
  $("dashboardMembershipBtn")?.addEventListener("click", () => { pushRoute("/recharge"); openMembershipModal(); });
  $("shareLoginBtn").addEventListener("click", () => state.session && state.account ? showModulePicker(true) : showAuth("", { path: "/login" }));
  $("gradingModeSelect").addEventListener("change", (event) => {
    state.gradingMode = event.target.value;
    saveState();
  });
  document.querySelectorAll(".tabs button").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
  document.querySelectorAll("[data-achievement-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      achievementFilter = ["all", "progress", "unlocked"].includes(button.dataset.achievementFilter)
        ? button.dataset.achievementFilter
        : "all";
      renderAchievements();
    });
  });

  saveState();
  updateStats();
  renderWrongBook({ force: true });
  renderAchievements();

  if (window.WYJTools && !toolsInitialized) {
    window.WYJTools.init({
      api,
      apiGet,
      publicApi,
      requestJsonGet,
      uploadApi,
      uploadBinaryApi,
      copyText: writeClipboardText,
      formatDate: formatLocalDateTime,
      navigate: (path) => pushRoute(path),
      account: () => state.account,
      accountId: () => accountStorageId(),
      onPreferencesChanged: renderDashboard,
    });
    toolsInitialized = true;
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register(`/sw.js?v=${APP_VERSION}`).catch(() => {});
  }
  const initialPath = location.pathname.replace(/\/+$/, "") || "/";
  const shouldProbeCloudBackend = () => !location.pathname.startsWith("/share/");
  window.addEventListener("offline", () => {
    if (shouldProbeCloudBackend()) markBackendDisconnected();
  });
  window.addEventListener("online", () => {
    if (shouldProbeCloudBackend()) scheduleBackendRecovery(150);
  });
  window.addEventListener("pageshow", (event) => {
    if (shouldProbeCloudBackend() && (event.persisted || !backendAvailable)) scheduleBackendRecovery(200);
  });
  navigator.connection?.addEventListener?.("change", () => {
    if (shouldProbeCloudBackend()) scheduleBackendRecovery(300);
  });
  subscribeAccountSessionChanges((nextSession) => {
    if (nextSession === state.session) return;
    if (!nextSession) {
      if (state.session) {
        clearSession();
        showAuth("账户已在另一个页面退出", { path: "/login", replace: true });
      }
      return;
    }
    adoptExternalAccountSession(nextSession);
  });
  document.addEventListener("visibilitychange", () => {
    if (shouldProbeCloudBackend() && document.visibilityState === "visible" && (state.session || !backendAvailable)) {
      scheduleBackendRecovery(150);
    }
  });
  window.setInterval(() => {
    if (shouldProbeCloudBackend() && document.visibilityState === "visible" && navigator.onLine !== false) {
      refreshBackendState();
    }
  }, BACKEND_REFRESH_INTERVAL_MS);

  void refreshCloudChangelog();
  const backendPromise = initialPath.startsWith("/share/") ? Promise.resolve() : refreshBackendState();
  await runSplashSequence(() => {
    $("appShell").classList.remove("app-shell-pending");
    $("appShell").classList.add("app-shell-ready");
    $("appShell").setAttribute("aria-hidden", "false");
    if (initialPath.startsWith("/share/") && showShareRoute(initialPath)) return;
    if (!state.session || !state.account) {
      if (initialPath === "/") {
        showPublicHome(false);
        return;
      }
      if (initialPath === "/trial") {
        showTrial(false);
        return;
      }
      if (initialPath === "/changelog") {
        showChangelog(false);
        return;
      }
    }
    const shouldResumeWorkspace = Boolean(state.session && state.account);
    showAuth(state.session ? "正在验证登录状态…" : "", {
      mode: initialPath === "/register" ? "register" : "login",
      path: initialPath,
      skipRoute: true,
    });
    if (shouldResumeWorkspace && state.session && state.account) pendingScreen = "workspace";
  });
  await backendPromise;
  await routeCurrent();
  maybeShowVersionNotice();
}

boot();

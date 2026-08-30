import {
  apiError,
  classifyCloudError,
  enforceD1RateLimit,
  featureFlags,
  jsonResponse,
} from "./cloudflare-foundation.mjs";
import { resolveTask12Account } from "./task12-auth.mjs";
import { enrichAccountWithTask13 } from "./task13-service.mjs";
import {
  TASK15_AI_MODEL,
  TASK15_BUILD,
  Task15Error,
  requireAllowedFields,
} from "./task15-model.mjs";
import {
  buildRubric,
  createQuizSession,
  ensureTask15Schema,
  judgeAnswer,
  resolveJapaneseForms,
  suggestVocabulary,
  validateQuizSession,
} from "./task15-service.mjs";
import {
  clearToolHistory,
  deleteToolConfig,
  importToolData,
  listToolPreferences,
  listToolUsageStats,
  recordToolUsage,
  rollbackToolImport,
  saveToolConfig,
  setToolFavorite,
  task15ImportCounts,
  task15ImportStatus,
} from "./task15-tools.mjs";

const ROUTES = new Map([
  ["GET /api/health", { body: 0, limit: 120, window: 60 }],
  ["POST /api/health", { body: 2 * 1024, limit: 120, window: 60 }],
  ["POST /api/quiz/start", { body: 132 * 1024, limit: 30, window: 60 }],
  ["POST /api/vocabulary/suggest", { body: 132 * 1024, limit: 30, window: 60 }],
  ["POST /api/japanese/readings", { body: 132 * 1024, limit: 30, window: 60 }],
  ["POST /api/rubric", { body: 4 * 1024, limit: 90, window: 60 }],
  ["POST /api/judge", { body: 16 * 1024, limit: 120, window: 60 }],
  ["GET /api/tools/access", { body: 0, limit: 120, window: 60 }],
  ["GET /api/tools/preferences", { body: 0, limit: 120, window: 60 }],
  ["POST /api/tools/favorite", { body: 2 * 1024, limit: 120, window: 60 }],
  ["POST /api/tools/recent", { body: 2 * 1024, limit: 180, window: 60 }],
  ["POST /api/tools/history/clear", { body: 2 * 1024, limit: 30, window: 60 }],
  ["POST /api/tools/config/save", { body: 64 * 1024, limit: 60, window: 60 }],
  ["POST /api/tools/config/delete", { body: 2 * 1024, limit: 60, window: 60 }],
  ["GET /api/admin/tool-stats", { body: 0, limit: 60, window: 60, admin: true }],
  ["POST /api/admin/task15/import", { body: 512 * 1024, limit: 10, window: 60, admin: true, owner: true, import: true }],
  ["POST /api/admin/task15/import/rollback", { body: 4 * 1024, limit: 5, window: 60, admin: true, owner: true, import: true }],
  ["GET /api/admin/task15/import/status", { body: 0, limit: 30, window: 60, admin: true, owner: true, import: true }],
]);

const METHODS_BY_PATH = new Map();
for (const key of ROUTES.keys()) {
  const [method, path] = key.split(" ");
  if (!METHODS_BY_PATH.has(path)) METHODS_BY_PATH.set(path, new Set());
  METHODS_BY_PATH.get(path).add(method);
}

function requestId(context) {
  return context.data?.requestId || "";
}

function response(payload, status, context, headers = {}) {
  return jsonResponse(payload, status, requestId(context), headers);
}

async function readJson(request, maximumBytes) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maximumBytes) throw new Task15Error("请求内容过大", 413, "request_too_large");
  const body = await request.arrayBuffer();
  if (body.byteLength > maximumBytes) throw new Task15Error("请求内容过大", 413, "request_too_large");
  try { return JSON.parse(new TextDecoder().decode(body) || "{}"); }
  catch (_) { throw new Task15Error("请求 JSON 格式无效", 400, "invalid_json"); }
}

function authenticationError(result, context) {
  const messages = {
    authentication_required: "请先登录",
    canonical_session_invalid: "登录会话无效，请重新登录",
    session_expired: "登录会话已过期，请重新登录",
    session_revoked: "登录会话已被撤销，请重新登录",
    session_generation_invalid: "账户安全状态已变化，请重新登录",
    account_deleted: "账户已删除",
    account_banned: "账户已被封禁",
  };
  const code = String(result.code || "canonical_session_invalid");
  return apiError(code, messages[code] || "账户不可用", result.status || 401, requestId(context));
}

async function execute(context, path, account, flags) {
  const db = context.env.WYJ_DB;
  if (path === "/api/health") {
    if (context.request.method.toUpperCase() === "POST") {
      const healthPayload = await readJson(context.request, ROUTES.get("POST /api/health").body);
      requireAllowedFields(healthPayload, new Set());
    }
    return response({
      ok: true,
      model: TASK15_AI_MODEL,
      ai_ready: Boolean(flags.workersAi && context.env?.AI?.run),
      build: TASK15_BUILD,
      account,
      cloud_only: true,
    }, 200, context);
  }
  if (path === "/api/tools/access") {
    const preferences = await listToolPreferences(db, account);
    return response({ ok: true, account, tools_access: true, preference_counts: {
      favorites: preferences.favorites.length,
      recent: preferences.recent.length,
      configs: preferences.configs.length,
    } }, 200, context);
  }
  if (path === "/api/tools/preferences") {
    return response({ ok: true, account, ...await listToolPreferences(db, account) }, 200, context);
  }
  if (path === "/api/admin/tool-stats") {
    return response({ ok: true, tools: await listToolUsageStats(db, account) }, 200, context);
  }
  if (path === "/api/admin/task15/import/status") {
    const sourceKey = new URL(context.request.url).searchParams.get("source_key") || "";
    return response({
      ok: true,
      counts: await task15ImportCounts(db),
      imports: await task15ImportStatus(db, sourceKey),
      build: TASK15_BUILD,
    }, 200, context);
  }
  const payload = await readJson(context.request, ROUTES.get(`POST ${path}`).body);
  if (path === "/api/quiz/start") {
    requireAllowedFields(payload, new Set(["language", "words"]));
    const quiz = await createQuizSession(db, account, payload.language, payload.words);
    return response({
      ok: true,
      quiz_session: quiz.token,
      word_count: quiz.words.length,
      max_words: quiz.limit,
      unlimited: quiz.limit >= 200,
      account,
      build: TASK15_BUILD,
    }, 200, context);
  }
  if (path === "/api/vocabulary/suggest") {
    requireAllowedFields(payload, new Set(["language", "level", "count", "exclude", "query"]));
    return response({ ok: true, ...await suggestVocabulary(context, account, payload), build: TASK15_BUILD }, 200, context);
  }
  if (path === "/api/japanese/readings") {
    requireAllowedFields(payload, new Set(["words", "quiz_session"]));
    const words = Array.isArray(payload.words) ? payload.words : [];
    await validateQuizSession(db, account, payload.quiz_session, words, "japanese");
    return response({ ok: true, ...await resolveJapaneseForms(context, account, words), build: TASK15_BUILD }, 200, context);
  }
  if (path === "/api/rubric") {
    requireAllowedFields(payload, new Set(["word", "quiz_session"]));
    await validateQuizSession(db, account, payload.quiz_session, payload.word);
    const result = await buildRubric(context, account, payload.word);
    return response({ ok: true, word: payload.word, rubric: result.rubric, source: result.source, build: TASK15_BUILD }, 200, context);
  }
  if (path === "/api/judge") {
    requireAllowedFields(payload, new Set(["word", "answer", "quiz_session", "rubric", "mode", "language"]));
    const quiz = await validateQuizSession(db, account, payload.quiz_session, payload.word);
    if (payload.language && String(payload.language).toLowerCase() !== quiz.language) {
      throw new Task15Error("测试语言与请求不一致", 400, "language_invalid");
    }
    return response({
      ok: true,
      word: payload.word,
      answer: String(payload.answer || "").slice(0, 240),
      ...await judgeAnswer(context, account, payload),
      build: TASK15_BUILD,
    }, 200, context);
  }
  if (path === "/api/tools/favorite") {
    requireAllowedFields(payload, new Set(["tool_id", "favorite", "pinned"]));
    return response({ ok: true, ...await setToolFavorite(db, account, payload) }, 200, context);
  }
  if (path === "/api/tools/recent") {
    requireAllowedFields(payload, new Set(["tool_id"]));
    return response({ ok: true, ...await recordToolUsage(db, account, payload) }, 200, context);
  }
  if (path === "/api/tools/history/clear") {
    requireAllowedFields(payload, new Set());
    return response({ ok: true, ...await clearToolHistory(db, account) }, 200, context);
  }
  if (path === "/api/tools/config/save") {
    requireAllowedFields(payload, new Set(["id", "tool_id", "name", "config"]));
    return response({ ok: true, ...await saveToolConfig(db, account, payload) }, 200, context);
  }
  if (path === "/api/tools/config/delete") {
    requireAllowedFields(payload, new Set(["id"]));
    return response({ ok: true, ...await deleteToolConfig(db, account, payload) }, 200, context);
  }
  if (path === "/api/admin/task15/import") {
    requireAllowedFields(payload, new Set(["source_key", "kind", "batch_key", "source_count", "records", "complete"]));
    return response({ ok: true, ...await importToolData(db, payload) }, 200, context);
  }
  if (path === "/api/admin/task15/import/rollback") {
    requireAllowedFields(payload, new Set(["source_key"]));
    return response({ ok: true, rollback: await rollbackToolImport(db, payload) }, 200, context);
  }
  throw new Task15Error("云端学习接口不存在", 404, "task15_route_not_found");
}

function productionImportAllowed(context, flags) {
  if (String(context.env?.WYJ_ENVIRONMENT || "").toLowerCase() !== "production") return true;
  return flags.task15ProductionImport
    && context.request.headers.get("X-WYJ-Task15-Production-Confirm") === "TASK15-PRODUCTION-REMAINING-DATA-MIGRATION";
}

export async function handleTask15Request(context) {
  const url = new URL(context.request.url);
  const method = context.request.method.toUpperCase();
  const descriptor = ROUTES.get(`${method} ${url.pathname}`);
  if (!descriptor) {
    const allowed = METHODS_BY_PATH.get(url.pathname);
    if (!allowed) return null;
    return apiError("method_not_allowed", "此接口不支持当前请求方法", 405, requestId(context), {
      headers: { Allow: [...allowed].join(", ") },
    });
  }
  const flags = featureFlags(context.env);
  if (!flags.task15CloudOnly || !flags.task12CloudAccounts || !flags.cloudFoundation) {
    return apiError("cloud_learning_disabled", "云端学习服务当前未启用", 503, requestId(context));
  }
  if (descriptor.import && !flags.task15Import) {
    return apiError("task15_import_disabled", "Task 15 导入接口未启用", 404, requestId(context));
  }
  if (descriptor.import && !productionImportAllowed(context, flags)) {
    return apiError(
      "task15_production_import_confirmation_required",
      "Production 剩余数据导入需要单独启用并明确确认",
      403,
      requestId(context),
    );
  }
  try {
    if (!await ensureTask15Schema(context.env.WYJ_DB)) {
      throw new Task15Error("云端学习数据结构尚未就绪", 503, "task15_schema_not_ready", true);
    }
    const authenticated = await resolveTask12Account(context);
    if (!authenticated.authenticated) return authenticationError(authenticated, context);
    const account = flags.task13CloudReads
      ? await enrichAccountWithTask13(context.env.WYJ_DB, authenticated.account)
      : authenticated.account;
    if (descriptor.owner && !account.is_super_admin) {
      throw new Task15Error("无管理员权限", 403, "forbidden");
    }
    if (descriptor.admin && !account.is_admin) {
      throw new Task15Error("无管理员权限", 403, "forbidden");
    }
    const rate = await enforceD1RateLimit(context, {
      enabled: flags.d1RateLimit,
      limit: descriptor.limit,
      windowSeconds: descriptor.window,
      scope: `${method}:${url.pathname}`,
      subject: account.id,
    });
    if (!rate.allowed) {
      return apiError("learning_rate_limited", "学习请求过于频繁，请稍后再试", 429, requestId(context), {
        retryable: true, headers: { "Retry-After": String(rate.retryAfter || 60) },
      });
    }
    return await execute(context, url.pathname, account, flags);
  } catch (error) {
    if (error instanceof Task15Error) {
      return apiError(error.code, error.message, error.status, requestId(context), { retryable: error.retryable });
    }
    console.error(JSON.stringify({
      event: "task15_cloud_error",
      request_id: requestId(context),
      route: url.pathname,
      error_name: String(error?.name || "Error"),
    }));
    const classification = classifyCloudError(error);
    return apiError(`task15_${classification}`, "云端学习服务暂时不可用，请稍后重试", 503, requestId(context), { retryable: true });
  }
}

export const __testing = { METHODS_BY_PATH, ROUTES, readJson };

import { featureFlags, sha256Hex } from "./cloudflare-foundation.mjs";
import {
  AI_CACHE_TTL_SECONDS,
  AI_GLOBAL_DAILY_LIMIT,
  AI_RETRY_LIMIT,
  AI_TIMEOUT_MS,
  AI_USER_DAILY_LIMIT,
  MAX_AI_INPUT_CHARACTERS,
  MAX_AI_OUTPUT_TOKENS,
  TASK15_AI_MODEL,
  Task15Error,
  isoNow,
} from "./task15-model.mjs";

function requireDatabase(context) {
  if (!context.env?.WYJ_DB?.prepare) {
    throw new Task15Error("AI 缓存和限额服务暂时不可用", 503, "dependency_unavailable", true);
  }
  return context.env.WYJ_DB;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function futureIso(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function safeJson(value) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); }
  catch (_) { return null; }
}

function resultObject(value) {
  const root = safeJson(value);
  if (!root) return null;
  if (root.response && typeof root.response === "object") return root.response;
  if (typeof root.response === "string") return safeJson(root.response);
  return root;
}

function aiFailure(error) {
  if (error instanceof Task15Error) return error;
  const text = String(error?.message || error || "").toLowerCase();
  const status = Number(error?.status || error?.statusCode || 0);
  if (status === 429 || /quota|rate.?limit|too many/.test(text)) {
    return new Task15Error("AI 今日额度已用完，请稍后再试", 429, "quota_exhausted", true);
  }
  if ([401, 403].includes(status) || /unauthori[sz]ed|forbidden|credential/.test(text)) {
    return new Task15Error("AI 服务认证暂时异常", 503, "dependency_auth_failed", true);
  }
  return new Task15Error("AI 暂时不可用，已保留登录状态，可稍后重试", 503, "ai_unavailable", true);
}

function shouldRetry(error) {
  if (error instanceof Task15Error) return false;
  const status = Number(error?.status || error?.statusCode || 0);
  return [500, 502, 503, 504].includes(status);
}

function retryDelay(attempt) {
  const base = Math.min(250, 50 * (2 ** attempt));
  return new Promise((resolve) => setTimeout(resolve, base + Math.floor(Math.random() * 50)));
}

async function cacheRead(db, cacheKey, taskType) {
  const now = isoNow();
  const row = await db.prepare(`SELECT result_json FROM task15_ai_cache
    WHERE cache_key = ?1 AND task_type = ?2 AND expires_at > ?3`)
    .bind(cacheKey, taskType, now).first();
  if (!row) return null;
  await db.prepare(`UPDATE task15_ai_cache SET hit_count = hit_count + 1, last_hit_at = ?2
    WHERE cache_key = ?1`).bind(cacheKey, now).run().catch(() => undefined);
  return safeJson(row.result_json);
}

async function cacheWrite(db, cacheKey, taskType, result) {
  const now = isoNow();
  await db.batch([
    db.prepare(`DELETE FROM task15_ai_cache WHERE cache_key IN (
      SELECT cache_key FROM task15_ai_cache WHERE expires_at <= ?1
      ORDER BY expires_at LIMIT 32
    )`).bind(now),
    db.prepare(`INSERT INTO task15_ai_cache (
      cache_key, task_type, model, result_json, created_at, expires_at, hit_count, last_hit_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, '')
    ON CONFLICT(cache_key) DO UPDATE SET
      task_type = excluded.task_type, model = excluded.model, result_json = excluded.result_json,
      created_at = excluded.created_at, expires_at = excluded.expires_at`)
      .bind(cacheKey, taskType, TASK15_AI_MODEL, JSON.stringify(result), now, futureIso(AI_CACHE_TTL_SECONDS)),
  ]);
}

async function consumeQuota(db, scopeKey, scopeType, limit) {
  const now = isoNow();
  const row = await db.prepare(`INSERT INTO task15_ai_usage_daily (
      usage_date, scope_key, scope_type, request_count, success_count,
      failure_count, cache_hit_count, latency_ms_total, updated_at
    ) VALUES (?1, ?2, ?3, 1, 0, 0, 0, 0, ?4)
    ON CONFLICT(usage_date, scope_key) DO UPDATE SET
      request_count = task15_ai_usage_daily.request_count + 1,
      updated_at = excluded.updated_at
    WHERE task15_ai_usage_daily.request_count < ?5
    RETURNING request_count`)
    .bind(today(), scopeKey, scopeType, now, limit).first();
  if (!row) throw new Task15Error("AI 今日额度已用完，请明天再试", 429, "quota_exhausted", true);
}

async function refundQuota(db, scopeKey) {
  await db.prepare(`UPDATE task15_ai_usage_daily SET
      request_count = MAX(0, request_count - 1), updated_at = ?3
    WHERE usage_date = ?1 AND scope_key = ?2`)
    .bind(today(), scopeKey, isoNow()).run();
}

async function usageOutcome(db, scopeKeys, outcome, latencyMs = 0, cacheHit = false) {
  const field = cacheHit ? "cache_hit_count" : outcome === "success" ? "success_count" : "failure_count";
  const statements = scopeKeys.map((scopeKey) => db.prepare(`UPDATE task15_ai_usage_daily
    SET ${field} = ${field} + 1, latency_ms_total = latency_ms_total + ?3, updated_at = ?4
    WHERE usage_date = ?1 AND scope_key = ?2`)
    .bind(today(), scopeKey, Math.max(0, Math.floor(latencyMs)), isoNow()));
  if (statements.length) await db.batch(statements);
}

async function recordCacheHit(db, scopeKeys) {
  const now = isoNow();
  const statements = scopeKeys.map((scopeKey) => db.prepare(`INSERT INTO task15_ai_usage_daily (
      usage_date, scope_key, scope_type, request_count, success_count,
      failure_count, cache_hit_count, latency_ms_total, updated_at
    ) VALUES (?1, ?2, ?3, 0, 0, 0, 1, 0, ?4)
    ON CONFLICT(usage_date, scope_key) DO UPDATE SET
      cache_hit_count = task15_ai_usage_daily.cache_hit_count + 1,
      updated_at = excluded.updated_at`)
    .bind(today(), scopeKey, scopeKey === "global" ? "global" : "user", now));
  if (statements.length) await db.batch(statements);
}

async function acquireLease(db, subjectHash) {
  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare(`UPDATE task15_ai_leases SET
      lease_token = ?1, subject_hash = ?2, leased_until = ?3, updated_at = ?4
    WHERE slot_id = (
      SELECT slot_id FROM task15_ai_leases WHERE leased_until <= ?5 ORDER BY slot_id LIMIT 1
    ) RETURNING slot_id`)
    .bind(token, subjectHash, now + 30, isoNow(), now).first();
  if (!row) throw new Task15Error("AI 当前请求较多，请稍后重试", 503, "ai_busy", true);
  return { token, slotId: Number(row.slot_id) };
}

async function releaseLease(db, lease) {
  if (!lease) return;
  await db.prepare(`UPDATE task15_ai_leases SET lease_token = '', subject_hash = '',
    leased_until = 0, updated_at = ?3 WHERE slot_id = ?1 AND lease_token = ?2`)
    .bind(lease.slotId, lease.token, isoNow()).run();
}

async function runWithTimeout(context, invocation, timeoutMs = AI_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Task15Error("AI 请求超时，请稍后重试", 504, "ai_timeout", true)), timeoutMs);
  });
  try {
    return await Promise.race([invocation, timeout]);
  } catch (error) {
    if (error instanceof Task15Error && error.code === "ai_timeout" && typeof context.waitUntil === "function") {
      context.waitUntil(invocation.catch(() => undefined));
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function invokeWithRetry(context, createInvocation, timeoutMs) {
  for (let attempt = 0; ; attempt += 1) {
    const invocation = Promise.resolve().then(createInvocation);
    try {
      return await runWithTimeout(context, invocation, timeoutMs);
    } catch (error) {
      if (attempt >= AI_RETRY_LIMIT || !shouldRetry(error)) throw error;
      await retryDelay(attempt);
    }
  }
}

export async function runStructuredAi(context, options) {
  const flags = featureFlags(context.env);
  if (!flags.workersAi || !context.env?.AI?.run) {
    throw new Task15Error("AI 暂时不可用，规则判断和本地词库仍可使用", 503, "ai_unavailable", true);
  }
  const db = requireDatabase(context);
  const taskType = String(options.taskType || "");
  const normalizedInput = options.normalizedInput && typeof options.normalizedInput === "object"
    ? options.normalizedInput : {};
  const serialized = JSON.stringify(normalizedInput);
  if (serialized.length > MAX_AI_INPUT_CHARACTERS) {
    throw new Task15Error("AI 输入内容过长", 413, "ai_input_too_large");
  }
  const cacheKey = await sha256Hex(`task15\u0000${TASK15_AI_MODEL}\u0000${taskType}\u0000${serialized}`);
  const userHash = await sha256Hex(`task15-user\u0000${String(options.account?.id || "anonymous")}`);
  const userScope = `user:${userHash}`;
  const globalScope = "global";
  const cached = await cacheRead(db, cacheKey, taskType);
  if (cached && options.validate(cached)) {
    await recordCacheHit(db, [globalScope, userScope]).catch(() => undefined);
    return { result: cached, cacheHit: true, model: TASK15_AI_MODEL };
  }

  const lease = await acquireLease(db, userHash);
  let userQuotaReserved = false;
  try {
    await consumeQuota(db, userScope, "user", AI_USER_DAILY_LIMIT);
    userQuotaReserved = true;
    await consumeQuota(db, globalScope, "global", AI_GLOBAL_DAILY_LIMIT);
  } catch (error) {
    if (userQuotaReserved) await refundQuota(db, userScope).catch(() => undefined);
    await releaseLease(db, lease).catch(() => undefined);
    throw error;
  }
  const scopes = [globalScope, userScope];
  const started = Date.now();
  let releaseImmediately = true;
  try {
    const timeoutMs = options.timeoutMs === undefined
      ? AI_TIMEOUT_MS
      : Math.max(1, Math.min(AI_TIMEOUT_MS, Number(options.timeoutMs) || AI_TIMEOUT_MS));
    const output = resultObject(await invokeWithRetry(context, () => context.env.AI.run(TASK15_AI_MODEL, {
      messages: options.messages,
      max_tokens: Math.min(MAX_AI_OUTPUT_TOKENS, Number(options.maxTokens || MAX_AI_OUTPUT_TOKENS)),
      temperature: 0.1,
      response_format: { type: "json_schema", json_schema: options.schema },
    }), timeoutMs));
    if (!output || !options.validate(output)) {
      throw new Task15Error("AI 返回格式无效，请稍后重试", 503, "ai_schema_invalid", true);
    }
    await cacheWrite(db, cacheKey, taskType, output).catch(() => undefined);
    await usageOutcome(db, scopes, "success", Date.now() - started).catch(() => undefined);
    return { result: output, cacheHit: false, model: TASK15_AI_MODEL };
  } catch (error) {
    if (error instanceof Task15Error && error.code === "ai_timeout") {
      // The binding call cannot be aborted. Keep this slot leased until its short TTL
      // instead of admitting another request while the timed-out invocation still runs.
      releaseImmediately = false;
    }
    await usageOutcome(db, scopes, "failure", Date.now() - started).catch(() => undefined);
    throw aiFailure(error);
  } finally {
    if (releaseImmediately) await releaseLease(db, lease).catch(() => undefined);
  }
}

export const __testing = {
  aiFailure,
  recordCacheHit,
  resultObject,
  shouldRetry,
};

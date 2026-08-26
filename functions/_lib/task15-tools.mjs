import { Task15Error, isoNow } from "./task15-model.mjs";

const TOOL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/u;
const SOURCE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/u;
const WORKFLOW_ID_PATTERN = /^(?:wf|step)_[a-z0-9][a-z0-9_-]{5,63}$/u;
const MAX_CONFIG_BYTES = 50 * 1024;
const MAX_WORKFLOW_BYTES = 48 * 1024;
const MAX_WORKFLOW_STEPS = 20;
const MAX_WORKFLOW_CONFIGS = 50;
const MAX_CONFIGS = 100;
const MAX_RECENT_ROWS = 200;
const MAX_IMPORT_RECORDS = 200;
const MAX_IMPORT_SOURCE_RECORDS = 100_000;

const WORKFLOW_CAPABILITIES = Object.freeze({
  "text-encoding": { input: ["text-file"], output: ["text"], preserve: false, keys: ["encoding"] },
  "remove-empty-lines": { input: ["text"], output: ["text"], preserve: false, keys: [] },
  "dedupe-lines": { input: ["text"], output: ["text"], preserve: false, keys: [] },
  "sort-lines": { input: ["text"], output: ["text"], preserve: false, keys: ["order"] },
  "csv-json": { input: ["text"], output: ["json"], preserve: false, keys: [] },
  "json-csv": { input: ["json"], output: ["text"], preserve: false, keys: [] },
  "text-split": { input: ["text"], output: ["archive"], preserve: false, keys: ["lines"] },
  "image-resize": { input: ["image", "image-list"], output: ["image", "image-list"], preserve: true, keys: ["height", "width"] },
  "image-format": { input: ["image", "image-list"], output: ["image", "image-list"], preserve: true, keys: ["format", "quality"] },
  "text-watermark": { input: ["image", "image-list"], output: ["image", "image-list"], preserve: true, keys: ["color", "text"] },
  "exif-remove": { input: ["image", "image-list"], output: ["image", "image-list"], preserve: true, keys: [] },
  "files-zip": { input: ["file-list", "image-list"], output: ["archive"], preserve: false, keys: [] },
});

function cleanToolId(value) {
  const toolId = String(value || "").trim();
  if (!TOOL_ID_PATTERN.test(toolId)) throw new Task15Error("工具标识无效", 400, "tool_id_invalid");
  return toolId;
}

function cleanRecordId(value, label = "记录") {
  const id = String(value || "").trim();
  if (!RECORD_ID_PATTERN.test(id)) throw new Task15Error(`${label}标识无效`, 400, "record_id_invalid");
  return id;
}

function cleanTimestamp(value, fallback = "") {
  const text = String(value || fallback).trim();
  if (!text || !Number.isFinite(Date.parse(text))) throw new Task15Error("时间格式无效", 400, "timestamp_invalid");
  return new Date(text).toISOString();
}

function sameKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function serialized(value, maximum = MAX_CONFIG_BYTES) {
  if (!value || typeof value !== "object") throw new Task15Error("工具配置格式无效", 400, "config_invalid");
  let text;
  try { text = JSON.stringify(value); }
  catch (_) { throw new Task15Error("工具配置格式无效", 400, "config_invalid"); }
  if (new TextEncoder().encode(text).byteLength > maximum) {
    throw new Task15Error("工具配置不能超过 50 KB", 413, "config_too_large");
  }
  return text;
}

function validateWorkflowConfig(config, name) {
  const fields = ["created_at", "id", "name", "schema_version", "steps", "updated_at"];
  if (!sameKeys(config, fields) || config.schema_version !== 1) {
    throw new Task15Error("工作流字段不完整或版本不受支持", 400, "workflow_fields_invalid");
  }
  if (!WORKFLOW_ID_PATTERN.test(String(config.id || "")) || !String(config.id).startsWith("wf_")) {
    throw new Task15Error("工作流 ID 无效", 400, "workflow_id_invalid");
  }
  const workflowName = String(config.name || "").trim();
  if (!workflowName || workflowName.length > 80 || workflowName !== name) {
    throw new Task15Error("工作流名称与配置名称不一致", 400, "workflow_name_mismatch");
  }
  const createdAt = cleanTimestamp(config.created_at);
  const updatedAt = cleanTimestamp(config.updated_at);
  if (!Array.isArray(config.steps) || config.steps.length > MAX_WORKFLOW_STEPS) {
    throw new Task15Error("工作流步骤数量无效", 400, "workflow_steps_invalid");
  }
  const seen = new Set();
  let possibleTypes = null;
  const steps = config.steps.map((step, index) => {
    if (!sameKeys(step, ["config", "enabled", "id", "tool_id"])) {
      throw new Task15Error(`第 ${index + 1} 步字段无效`, 400, "workflow_step_fields_invalid");
    }
    const id = String(step.id || "");
    const toolId = String(step.tool_id || "");
    const capability = WORKFLOW_CAPABILITIES[toolId];
    if (!WORKFLOW_ID_PATTERN.test(id) || !id.startsWith("step_") || seen.has(id)) {
      throw new Task15Error(`第 ${index + 1} 步 ID 无效或重复`, 400, "workflow_step_id_invalid");
    }
    seen.add(id);
    if (!capability) throw new Task15Error(`第 ${index + 1} 步工具未注册`, 400, "workflow_tool_invalid");
    if (typeof step.enabled !== "boolean" || !sameKeys(step.config, capability.keys)) {
      throw new Task15Error(`第 ${index + 1} 步参数无效`, 400, "workflow_config_invalid");
    }
    const clean = structuredClone(step.config);
    if (toolId === "text-encoding" && !["utf-8", "gbk", "big5", "shift_jis"].includes(clean.encoding)) {
      throw new Task15Error("文本编码参数无效", 400, "workflow_config_invalid");
    }
    if (toolId === "sort-lines" && !["asc", "desc"].includes(clean.order)) {
      throw new Task15Error("排序参数无效", 400, "workflow_config_invalid");
    }
    if (toolId === "text-split" && (!Number.isInteger(clean.lines) || clean.lines < 1 || clean.lines > 100000)) {
      throw new Task15Error("文本分割行数无效", 400, "workflow_config_invalid");
    }
    if (toolId === "image-resize" && [clean.width, clean.height].some((item) => !Number.isInteger(item) || item < 1 || item > 4096)) {
      throw new Task15Error("图片尺寸参数无效", 400, "workflow_config_invalid");
    }
    if (toolId === "image-format" && (
      !["image/png", "image/jpeg", "image/webp"].includes(clean.format)
      || typeof clean.quality !== "number" || clean.quality < 0.1 || clean.quality > 1
    )) throw new Task15Error("图片格式参数无效", 400, "workflow_config_invalid");
    if (toolId === "text-watermark" && (
      typeof clean.text !== "string" || clean.text.length < 1 || clean.text.length > 100
      || !/^#[0-9a-f]{6}$/iu.test(String(clean.color || ""))
    )) throw new Task15Error("水印参数无效", 400, "workflow_config_invalid");
    if (step.enabled) {
      const compatible = possibleTypes === null
        ? new Set(capability.input)
        : new Set(capability.input.filter((item) => possibleTypes.has(item)));
      if (!compatible.size) throw new Task15Error(`第 ${index + 1} 步与上一步类型不兼容`, 400, "workflow_type_mismatch");
      possibleTypes = capability.preserve
        ? new Set([...compatible].map((item) => item === "image-list" ? "image-list" : "image"))
        : new Set(capability.output);
    }
    return { id, tool_id: toolId, enabled: step.enabled, config: clean };
  });
  const normalized = { schema_version: 1, id: config.id, name: workflowName, created_at: createdAt, updated_at: updatedAt, steps };
  serialized(normalized, MAX_WORKFLOW_BYTES);
  return normalized;
}

function entitlementSet(account) {
  return new Set(Array.isArray(account?.entitlements) ? account.entitlements : []);
}

export function requireToolEntitlement(account, entitlement = "tools_access") {
  const entitlements = entitlementSet(account);
  if (account?.is_super_admin || entitlements.has("all_features_access") || entitlements.has(entitlement)) return;
  throw new Task15Error(
    entitlement === "save_tool_config" ? "当前会员不包含云端配置保存" : "在线工具箱需要对应会员权限",
    403,
    "membership_required",
  );
}

async function all(db, sql, values = []) {
  const result = await db.prepare(sql).bind(...values).all();
  return Array.isArray(result?.results) ? result.results : [];
}

async function first(db, sql, values = []) {
  return await db.prepare(sql).bind(...values).first();
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

export async function listToolPreferences(db, account) {
  requireToolEntitlement(account);
  const [favorites, recent, configs] = await Promise.all([
    all(db, `SELECT tool_id, pinned, created_at, updated_at FROM task15_tool_favorites
      WHERE user_id = ?1 ORDER BY pinned DESC, updated_at DESC`, [account.id]),
    all(db, `SELECT tool_id, MAX(used_at) AS used_at FROM task15_tool_recent_usage
      WHERE user_id = ?1 GROUP BY tool_id ORDER BY used_at DESC LIMIT 30`, [account.id]),
    all(db, `SELECT id, tool_id, name, config_json, created_at, updated_at
      FROM task15_saved_tool_configs WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT 100`, [account.id]),
  ]);
  return {
    favorites: favorites.map((item) => ({ ...item, pinned: Boolean(item.pinned) })),
    recent,
    configs: configs.map(({ config_json: text, ...item }) => {
      try { return { ...item, config: JSON.parse(text) }; }
      catch (_) { return { ...item, config: {} }; }
    }),
  };
}

export async function setToolFavorite(db, account, payload) {
  requireToolEntitlement(account);
  const toolId = cleanToolId(payload.tool_id);
  const favorite = payload.favorite !== false;
  const pinned = Boolean(payload.pinned);
  const now = isoNow();
  if (favorite) {
    await db.prepare(`INSERT INTO task15_tool_favorites (
      user_id, tool_id, pinned, created_at, updated_at, source, source_ref
    ) VALUES (?1, ?2, ?3, ?4, ?4, 'cloud', '')
    ON CONFLICT(user_id, tool_id) DO UPDATE SET pinned = excluded.pinned,
      updated_at = excluded.updated_at, source = 'cloud', source_ref = ''`)
      .bind(account.id, toolId, pinned ? 1 : 0, now).run();
  } else {
    await db.prepare("DELETE FROM task15_tool_favorites WHERE user_id = ?1 AND tool_id = ?2")
      .bind(account.id, toolId).run();
  }
  return { tool_id: toolId, favorite, pinned: favorite && pinned };
}

export async function recordToolUsage(db, account, payload) {
  requireToolEntitlement(account);
  const toolId = cleanToolId(payload.tool_id);
  const id = crypto.randomUUID();
  const now = isoNow();
  await db.batch([
    db.prepare(`INSERT INTO task15_tool_recent_usage (
      id, user_id, tool_id, used_at, source, source_ref
    ) VALUES (?1, ?2, ?3, ?4, 'cloud', '')`).bind(id, account.id, toolId, now),
    db.prepare(`DELETE FROM task15_tool_recent_usage WHERE id IN (
      SELECT id FROM task15_tool_recent_usage WHERE user_id = ?1
      ORDER BY used_at DESC, id DESC LIMIT -1 OFFSET ?2
    )`).bind(account.id, MAX_RECENT_ROWS),
  ]);
  return { id, tool_id: toolId, used_at: now };
}

export async function clearToolHistory(db, account) {
  requireToolEntitlement(account);
  const result = await db.prepare("DELETE FROM task15_tool_recent_usage WHERE user_id = ?1").bind(account.id).run();
  return { cleared: changes(result) };
}

export async function saveToolConfig(db, account, payload) {
  requireToolEntitlement(account, "save_tool_config");
  const toolId = cleanToolId(payload.tool_id);
  const name = String(payload.name || "").trim();
  if (!name || name.length > 80) throw new Task15Error("配置名称不能为空且不能超过 80 字", 400, "config_name_required");
  const config = toolId === "workflow" ? validateWorkflowConfig(payload.config, name) : payload.config;
  const configJson = serialized(config);
  const suppliedId = String(payload.id || "").trim();
  const now = isoNow();
  if (suppliedId) {
    const id = cleanRecordId(suppliedId, "配置");
    const existing = await first(db, "SELECT tool_id FROM task15_saved_tool_configs WHERE id = ?1 AND user_id = ?2", [id, account.id]);
    if (!existing) throw new Task15Error("工具配置不存在", 404, "config_not_found");
    if (existing.tool_id !== toolId && [existing.tool_id, toolId].includes("workflow")) {
      throw new Task15Error("工作流配置不能与其他工具配置互相覆盖", 409, "workflow_config_collision");
    }
    await db.prepare(`UPDATE task15_saved_tool_configs SET tool_id = ?1, name = ?2,
      config_json = ?3, updated_at = ?4, source = 'cloud', source_ref = ''
      WHERE id = ?5 AND user_id = ?6`).bind(toolId, name, configJson, now, id, account.id).run();
    return { id, updated: true };
  }
  const counts = await first(db, `SELECT COUNT(*) AS total,
    SUM(CASE WHEN tool_id = 'workflow' THEN 1 ELSE 0 END) AS workflows
    FROM task15_saved_tool_configs WHERE user_id = ?1`, [account.id]);
  if (Number(counts?.total || 0) >= MAX_CONFIGS) throw new Task15Error("每个账号最多保存 100 个工具配置", 409, "config_limit_reached");
  if (toolId === "workflow" && Number(counts?.workflows || 0) >= MAX_WORKFLOW_CONFIGS) {
    throw new Task15Error("每个账号最多保存 50 个云端工作流", 409, "workflow_limit_reached");
  }
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO task15_saved_tool_configs (
    id, user_id, tool_id, name, config_json, created_at, updated_at, source, source_ref
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 'cloud', '')`)
    .bind(id, account.id, toolId, name, configJson, now).run();
  return { id, updated: false };
}

export async function deleteToolConfig(db, account, payload) {
  requireToolEntitlement(account, "save_tool_config");
  const id = cleanRecordId(payload.id, "配置");
  const result = await db.prepare("DELETE FROM task15_saved_tool_configs WHERE id = ?1 AND user_id = ?2")
    .bind(id, account.id).run();
  return { id, deleted: changes(result) > 0 };
}

export async function listToolUsageStats(db, account) {
  if (!account?.is_super_admin) throw new Task15Error("无管理员权限", 403, "forbidden");
  return await all(db, `SELECT tool_id, COUNT(*) AS uses, COUNT(DISTINCT user_id) AS users,
    MAX(used_at) AS last_used_at FROM task15_tool_recent_usage
    GROUP BY tool_id ORDER BY uses DESC, tool_id LIMIT 200`);
}

function importSourceKey(value) {
  const text = String(value || "").trim();
  if (!SOURCE_KEY_PATTERN.test(text)) throw new Task15Error("导入来源标识无效", 400, "task15_import_source_invalid");
  return text;
}

function importConstraintError(error) {
  const message = String(error?.message || error || "");
  const matches = [
    ["task15_import_source_count_conflict", "导入来源总数与先前批次不一致"],
    ["task15_import_already_complete", "导入来源已经完成，不能追加新批次"],
    ["task15_import_incomplete_source", "导入批次数量与来源总数不一致"],
  ];
  for (const [code, userMessage] of matches) {
    if (message.includes(code)) return new Task15Error(userMessage, 409, code);
  }
  return null;
}

async function importBatchDigest(sourceCount, complete, records) {
  const bytes = new TextEncoder().encode(JSON.stringify({ source_count: sourceCount, complete, records }));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function refreshImportBatch(db, sourceKey, kind, sourceCount) {
  await db.prepare(`UPDATE task15_import_batches SET
    source_count = ?3,
    received_count = COALESCE((SELECT SUM(received_count) FROM task15_import_receipts
      WHERE source_key = ?1 AND kind = ?2), 0),
    applied_count = COALESCE((SELECT SUM(applied_count) FROM task15_import_receipts
      WHERE source_key = ?1 AND kind = ?2), 0),
    complete = CASE WHEN EXISTS (SELECT 1 FROM task15_import_receipts
      WHERE source_key = ?1 AND kind = ?2 AND complete = 1) THEN 1 ELSE 0 END,
    updated_at = ?4
    WHERE source_key = ?1 AND kind = ?2`)
    .bind(sourceKey, kind, sourceCount, isoNow()).run();
}

async function requireImportUsers(db, records) {
  const userIds = [...new Set(records.map((item) => String(item.user_id || "")))];
  for (const userId of userIds) {
    if (!userId || !await first(db, "SELECT id FROM task12_users WHERE id = ?1", [userId])) {
      throw new Task15Error("导入记录的用户不存在", 409, "task15_import_user_missing");
    }
  }
}

export async function importToolData(db, payload) {
  const kind = String(payload.kind || "");
  if (!["favorites", "recent", "configs"].includes(kind)) throw new Task15Error("导入类型无效", 400, "task15_import_kind_invalid");
  const sourceKey = importSourceKey(payload.source_key);
  const batchKey = importSourceKey(payload.batch_key);
  const records = Array.isArray(payload.records) ? payload.records : [];
  if (records.length > MAX_IMPORT_RECORDS) throw new Task15Error("单批导入记录过多", 413, "task15_import_batch_too_large");
  const sourceCount = Number.parseInt(String(payload.source_count ?? records.length), 10);
  if (!Number.isInteger(sourceCount) || sourceCount < records.length || sourceCount > MAX_IMPORT_SOURCE_RECORDS) {
    throw new Task15Error("导入来源记录数量无效", 400, "task15_import_source_count_invalid");
  }
  const complete = payload.complete === true;
  await requireImportUsers(db, records);
  const batchDigest = await importBatchDigest(sourceCount, complete, records);
  const priorBatch = await first(db, `SELECT batch_digest, received_count, applied_count, complete
    FROM task15_import_receipts WHERE source_key = ?1 AND kind = ?2 AND batch_key = ?3`,
    [sourceKey, kind, batchKey]);
  if (priorBatch) {
    if (priorBatch.batch_digest !== batchDigest) {
      throw new Task15Error("导入批次内容与已接收批次不一致", 409, "task15_import_batch_conflict");
    }
    await refreshImportBatch(db, sourceKey, kind, sourceCount);
    return {
      source_key: sourceKey,
      kind,
      batch_key: batchKey,
      received: Number(priorBatch.received_count || 0),
      applied: 0,
      originally_applied: Number(priorBatch.applied_count || 0),
      complete: Boolean(priorBatch.complete),
      replayed: true,
    };
  }
  const priorImport = await first(db, "SELECT source_count, received_count, complete FROM task15_import_batches WHERE source_key = ?1 AND kind = ?2", [sourceKey, kind]);
  if (priorImport && Number(priorImport.source_count) !== sourceCount) {
    throw new Task15Error("导入来源总数与先前批次不一致", 409, "task15_import_source_count_conflict");
  }
  if (priorImport?.complete) {
    throw new Task15Error("导入来源已经完成，不能追加新批次", 409, "task15_import_already_complete");
  }
  const receivedBefore = Number(priorImport?.received_count || 0);
  const receivedAfter = receivedBefore + records.length;
  if (receivedAfter > sourceCount || (complete && receivedAfter !== sourceCount)) {
    throw new Task15Error("导入批次数量与来源总数不一致", 409, "task15_import_incomplete_source");
  }
  await db.prepare(`INSERT INTO task15_import_batches (
    source_key, kind, source_count, received_count, applied_count, complete, updated_at
  ) VALUES (?1, ?2, ?3, 0, 0, 0, ?4)
  ON CONFLICT(source_key, kind) DO UPDATE SET updated_at = excluded.updated_at`)
    .bind(sourceKey, kind, sourceCount, isoNow()).run();
  const mutations = [];
  let applied = 0;
  for (const raw of records) {
    const userId = String(raw.user_id || "");
    const toolId = cleanToolId(raw.tool_id);
    if (kind === "favorites") {
      const existing = await first(db, "SELECT user_id FROM task15_tool_favorites WHERE user_id = ?1 AND tool_id = ?2", [userId, toolId]);
      const createdAt = cleanTimestamp(raw.created_at, isoNow());
      const updatedAt = cleanTimestamp(raw.updated_at, createdAt);
      mutations.push(db.prepare(`INSERT INTO task15_tool_favorites (
        user_id, tool_id, pinned, created_at, updated_at, source, source_ref
      ) VALUES (?1, ?2, ?3, ?4, ?5, 'legacy_import', ?6)
      ON CONFLICT(user_id, tool_id) DO NOTHING`)
        .bind(userId, toolId, raw.pinned ? 1 : 0, createdAt, updatedAt, sourceKey));
      if (!existing) applied += 1;
    } else if (kind === "recent") {
      const id = cleanRecordId(raw.id, "最近使用记录");
      const existing = await first(db, "SELECT user_id, tool_id FROM task15_tool_recent_usage WHERE id = ?1", [id]);
      if (existing && (existing.user_id !== userId || existing.tool_id !== toolId)) {
        throw new Task15Error("最近使用记录身份冲突", 409, "task15_import_identity_conflict");
      }
      mutations.push(db.prepare(`INSERT INTO task15_tool_recent_usage (
        id, user_id, tool_id, used_at, source, source_ref
      ) VALUES (?1, ?2, ?3, ?4, 'legacy_import', ?5)
      ON CONFLICT(id) DO NOTHING`)
        .bind(id, userId, toolId, cleanTimestamp(raw.used_at), sourceKey));
      if (!existing) applied += 1;
    } else {
      const id = cleanRecordId(raw.id, "配置");
      const name = String(raw.name || "").trim();
      if (!name || name.length > 80) throw new Task15Error("配置名称无效", 400, "config_name_required");
      const config = toolId === "workflow" ? validateWorkflowConfig(raw.config, name) : raw.config;
      const configJson = serialized(config);
      const existing = await first(db, "SELECT user_id, tool_id FROM task15_saved_tool_configs WHERE id = ?1", [id]);
      if (existing && (existing.user_id !== userId || existing.tool_id !== toolId)) {
        throw new Task15Error("工具配置身份冲突", 409, "task15_import_identity_conflict");
      }
      const createdAt = cleanTimestamp(raw.created_at, isoNow());
      const updatedAt = cleanTimestamp(raw.updated_at, createdAt);
      mutations.push(db.prepare(`INSERT INTO task15_saved_tool_configs (
        id, user_id, tool_id, name, config_json, created_at, updated_at, source, source_ref
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'legacy_import', ?8)
      ON CONFLICT(id) DO NOTHING`)
        .bind(id, userId, toolId, name, configJson, createdAt, updatedAt, sourceKey));
      if (!existing) applied += 1;
    }
  }
  mutations.push(db.prepare(`INSERT INTO task15_import_receipts (
    source_key, kind, batch_key, batch_digest, source_count,
    received_count, applied_count, complete, created_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
    .bind(sourceKey, kind, batchKey, batchDigest, sourceCount,
      records.length, applied, complete ? 1 : 0, isoNow()));
  try {
    await db.batch(mutations);
  } catch (error) {
    const concurrent = await first(db, `SELECT batch_digest, received_count, applied_count, complete
      FROM task15_import_receipts WHERE source_key = ?1 AND kind = ?2 AND batch_key = ?3`,
      [sourceKey, kind, batchKey]);
    if (!concurrent || concurrent.batch_digest !== batchDigest) {
      throw importConstraintError(error) || error;
    }
    await refreshImportBatch(db, sourceKey, kind, sourceCount);
    return {
      source_key: sourceKey,
      kind,
      batch_key: batchKey,
      received: Number(concurrent.received_count || 0),
      applied: 0,
      originally_applied: Number(concurrent.applied_count || 0),
      complete: Boolean(concurrent.complete),
      replayed: true,
    };
  }
  await refreshImportBatch(db, sourceKey, kind, sourceCount);
  return { source_key: sourceKey, kind, batch_key: batchKey, received: records.length, applied, complete, replayed: false };
}

export async function rollbackToolImport(db, payload) {
  const sourceKey = importSourceKey(payload.source_key);
  const results = await db.batch([
    db.prepare("DELETE FROM task15_tool_favorites WHERE source = 'legacy_import' AND source_ref = ?1").bind(sourceKey),
    db.prepare("DELETE FROM task15_tool_recent_usage WHERE source = 'legacy_import' AND source_ref = ?1").bind(sourceKey),
    db.prepare("DELETE FROM task15_saved_tool_configs WHERE source = 'legacy_import' AND source_ref = ?1").bind(sourceKey),
    db.prepare("DELETE FROM task15_import_receipts WHERE source_key = ?1").bind(sourceKey),
    db.prepare("DELETE FROM task15_import_batches WHERE source_key = ?1").bind(sourceKey),
  ]);
  return { source_key: sourceKey, removed: results.slice(0, 3).reduce((sum, result) => sum + changes(result), 0) };
}

export async function task15ImportCounts(db) {
  const row = await first(db, `SELECT
    (SELECT COUNT(*) FROM task15_tool_favorites) AS favorites,
    (SELECT COUNT(*) FROM task15_tool_recent_usage) AS recent,
    (SELECT COUNT(*) FROM task15_saved_tool_configs) AS configs,
    (SELECT COUNT(*) FROM task15_import_batches WHERE complete = 1) AS complete_batches`);
  return {
    favorites: Number(row?.favorites || 0),
    recent: Number(row?.recent || 0),
    configs: Number(row?.configs || 0),
    complete_batches: Number(row?.complete_batches || 0),
  };
}

export async function task15ImportStatus(db, sourceKeyValue = "") {
  const sourceKey = sourceKeyValue ? importSourceKey(sourceKeyValue) : "";
  const query = sourceKey
    ? `SELECT source_key, kind, source_count, received_count, applied_count, complete, updated_at
       FROM task15_import_batches WHERE source_key = ?1 ORDER BY kind`
    : `SELECT source_key, kind, source_count, received_count, applied_count, complete, updated_at
       FROM task15_import_batches ORDER BY updated_at DESC, source_key, kind LIMIT 100`;
  const rows = sourceKey ? await all(db, query, [sourceKey]) : await all(db, query);
  return rows.map((row) => ({
    source_key: String(row.source_key || ""),
    kind: String(row.kind || ""),
    source_count: Number(row.source_count || 0),
    received_count: Number(row.received_count || 0),
    applied_count: Number(row.applied_count || 0),
    complete: Boolean(row.complete),
    updated_at: String(row.updated_at || ""),
  }));
}

export const __testing = Object.freeze({
  cleanToolId,
  serialized,
  validateWorkflowConfig,
});

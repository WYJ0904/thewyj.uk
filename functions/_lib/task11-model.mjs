export const TASK11_SCHEMA_VERSION = 1;
export const LEARNING_SYNC_SCHEMA_VERSION = 1;
export const LEARNING_SYNC_TYPES = new Set([
  "wrong_book",
  "achievement",
  "test_history",
  "daily_goal",
  "language_settings",
  "learning_config",
]);
export const LEARNING_SYNC_TYPE_LIMITS = Object.freeze({
  wrong_book: 2000,
  achievement: 500,
  test_history: 5000,
  daily_goal: 200,
  language_settings: 20,
  learning_config: 500,
});
export const LEARNING_SYNC_MAX_CHANGES = 200;
export const LEARNING_SYNC_PULL_LIMIT = 500;
export const LEARNING_SYNC_MAX_RECORD_ID = 700;
export const LEARNING_SYNC_MAX_PAYLOAD_BYTES = 384 * 1024;
export const LEARNING_SYNC_MAX_TOTAL_RECORDS = Object.values(LEARNING_SYNC_TYPE_LIMITS)
  .reduce((total, value) => total + value, 0);

const FEEDBACK_TYPES = new Set([
  "feature_suggestion", "tool_error", "page_issue",
  "account_issue", "new_tool", "other",
]);
export const FEEDBACK_PUBLIC_TYPES = new Set(["feature_suggestion", "new_tool"]);
export const FEEDBACK_STATUSES = new Set(["pending", "viewed", "accepted", "completed", "rejected"]);
const FEEDBACK_ALLOWED_FIELDS = new Set([
  "type", "title", "content", "route", "tool_id",
  "app_version", "browser_info", "error_code",
]);
const FEEDBACK_SENSITIVE_PATTERN = /(?:[A-Za-z]:\\(?:Users|Documents|Desktop)\\|file:\/\/|\/(?:Users|home)\/[^/\s]+\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{10,}|\bsk-[A-Za-z0-9_-]{12,}|\b(?:session|token|password)\s*[:=]\s*\S{6,})/i;
const CONTROL_CHARACTER_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const CLIENT_PATTERN = /^[A-Za-z0-9._~:-]{8,80}$/;
const RECORD_PATTERN = /^[A-Za-z0-9._~|:-]{1,700}$/;
const TOOL_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,79}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const TELEMETRY_FEATURE_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const TELEMETRY_ERROR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const encoder = new TextEncoder();

export class Task11Error extends Error {
  constructor(message, status = 400, code = "task11_invalid", retryable = false) {
    super(message);
    this.name = "Task11Error";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function reject(message, status, code) {
  throw new Task11Error(message, status, code);
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function feedbackField(value, field, maximum, { required = false, singleLine = false } = {}) {
  let text = String(value || "").trim();
  if (required && !text) reject(`${field}不能为空`, 400, "feedback_field_required");
  if (text.length > maximum) reject(`${field}最多 ${maximum} 个字符`, 400, "feedback_field_too_long");
  if (CONTROL_CHARACTER_PATTERN.test(text)) reject(`${field}包含无效控制字符`, 400, "feedback_field_invalid");
  if (singleLine) text = text.replace(/\s+/g, " ");
  return text;
}

export function validateFeedbackInput(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    reject("反馈格式无效", 400, "feedback_invalid");
  }
  if (Object.keys(payload).some((key) => !FEEDBACK_ALLOWED_FIELDS.has(key))) {
    reject("反馈包含不允许提交的字段", 400, "feedback_fields_forbidden");
  }
  const type = String(payload.type || "").trim();
  if (!FEEDBACK_TYPES.has(type)) reject("反馈类型无效", 400, "feedback_type_invalid");
  const result = {
    feedback_type: type,
    title: feedbackField(payload.title, "标题", 120, { required: true, singleLine: true }),
    content: feedbackField(payload.content, "反馈内容", 2000, { required: true }),
    route: feedbackField(payload.route, "当前页面", 180, { singleLine: true }),
    tool_id: feedbackField(payload.tool_id, "工具 ID", 80, { singleLine: true }),
    app_version: feedbackField(payload.app_version, "应用版本", 80, { singleLine: true }),
    browser_info: feedbackField(payload.browser_info, "浏览器信息", 240, { singleLine: true }),
    error_code: feedbackField(payload.error_code, "错误代码", 80, { singleLine: true }),
  };
  if (result.route && (!result.route.startsWith("/") || result.route.includes("://"))) {
    reject("当前页面必须是站内路径", 400, "feedback_route_invalid");
  }
  if (result.tool_id && !TOOL_PATTERN.test(result.tool_id)) {
    reject("工具 ID 格式无效", 400, "feedback_tool_invalid");
  }
  if (result.app_version && !VERSION_PATTERN.test(result.app_version)) {
    reject("应用版本格式无效", 400, "feedback_version_invalid");
  }
  if (result.error_code && !VERSION_PATTERN.test(result.error_code)) {
    reject("错误代码格式无效", 400, "feedback_error_code_invalid");
  }
  const combined = Object.values(result).join("\n");
  if (FEEDBACK_SENSITIVE_PATTERN.test(combined) || /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/.test(combined)) {
    reject("反馈不能包含密钥、令牌、支付信息或本机文件路径", 400, "feedback_sensitive_data");
  }
  return result;
}

export function validateAdminFeedbackInput(payload) {
  const allowed = new Set(["feedback_id", "action", "status", "admin_note", "merged_into_id"]);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    reject("反馈操作格式无效", 400, "feedback_admin_invalid");
  }
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    reject("反馈操作包含不允许的字段", 400, "feedback_admin_fields_forbidden");
  }
  const feedbackId = feedbackField(payload.feedback_id, "反馈 ID", 64, { required: true, singleLine: true });
  const action = String(payload.action || "update").trim();
  if (!["update", "merge", "delete_spam"].includes(action)) {
    reject("反馈操作无效", 400, "feedback_action_invalid");
  }
  const status = String(payload.status || "").trim();
  if (status && !FEEDBACK_STATUSES.has(status)) reject("反馈状态无效", 400, "feedback_status_invalid");
  const adminNote = feedbackField(payload.admin_note, "管理员备注", 1000);
  if (FEEDBACK_SENSITIVE_PATTERN.test(adminNote)) {
    reject("管理员备注不能包含密钥、令牌或本机路径", 400, "feedback_sensitive_data");
  }
  return {
    feedback_id: feedbackId,
    action,
    status,
    admin_note: adminNote,
    merged_into_id: feedbackField(payload.merged_into_id, "合并目标", 64, { singleLine: true }),
  };
}

export function feedbackPayload(row, { includeContent = true, includeAdmin = false, ownVote = null } = {}) {
  const payload = {
    id: String(row?.id || ""),
    type: String(row?.feedback_type || ""),
    title: String(row?.title || ""),
    status: String(row?.status || "pending"),
    merged_into_id: String(row?.merged_into_id || ""),
    vote_count: Number(row?.vote_count || 0),
    voted: Boolean(ownVote === null ? row?.own_vote : ownVote),
    created_at: String(row?.created_at || ""),
    updated_at: String(row?.updated_at || ""),
  };
  if (includeContent) {
    Object.assign(payload, {
      content: String(row?.content || ""),
      route: String(row?.route || ""),
      tool_id: String(row?.tool_id || ""),
      app_version: String(row?.app_version || ""),
      browser_info: String(row?.browser_info || ""),
      error_code: String(row?.error_code || ""),
    });
  }
  if (includeAdmin) {
    Object.assign(payload, {
      user_id: String(row?.user_id || ""),
      username: String(row?.username || ""),
      admin_note: String(row?.admin_note || ""),
    });
  }
  return payload;
}

export function feedbackAuditSnapshot(row) {
  return {
    id: String(row?.id || ""),
    type: String(row?.feedback_type || row?.type || ""),
    status: String(row?.status || ""),
    merged_into_id: String(row?.merged_into_id || ""),
    admin_note: String(row?.admin_note || ""),
  };
}

function validateSyncValue(value, depth = 0) {
  if (depth > 8) reject("学习数据嵌套层级过深", 400, "learning_sync_payload_invalid");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject("学习数据包含无效数字", 400, "learning_sync_payload_invalid");
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 120000) reject("单项学习数据文本过长", 413, "learning_sync_record_too_large");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 2000) reject("单项学习数据列表过长", 413, "learning_sync_record_too_large");
    return value.map((item) => validateSyncValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > 300) reject("单项学习数据字段过多", 413, "learning_sync_record_too_large");
    return Object.fromEntries(entries.map(([key, item]) => {
      if (!key || key.length > 100) reject("学习数据字段名称无效", 400, "learning_sync_payload_invalid");
      return [key, validateSyncValue(item, depth + 1)];
    }));
  }
  reject("学习数据包含不支持的类型", 400, "learning_sync_payload_invalid");
}

function normalizedTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds > Date.now() + 5 * 60 * 1000) return "";
  return new Date(milliseconds).toISOString().replace(".000Z", "Z");
}

export function validateLearningSyncRequest(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    reject("同步请求格式无效", 400, "learning_sync_request_invalid");
  }
  const allowed = new Set(["schema_version", "client_id", "client_version", "since_version", "changes"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    reject("同步请求包含不允许的字段", 400, "learning_sync_fields_forbidden");
  }
  if (payload.schema_version !== LEARNING_SYNC_SCHEMA_VERSION) {
    reject("学习数据版本不受支持", 409, "learning_sync_schema_unsupported");
  }
  const clientId = String(payload.client_id || "").trim();
  if (!CLIENT_PATTERN.test(clientId)) reject("同步客户端标识无效", 400, "learning_sync_client_invalid");
  const clientVersion = String(payload.client_version || "").trim();
  if (!clientVersion || clientVersion.length > 80) {
    reject("客户端版本无效", 400, "learning_sync_client_version_invalid");
  }
  const sinceVersion = payload.since_version ?? 0;
  if (!Number.isSafeInteger(sinceVersion) || sinceVersion < 0) {
    reject("服务器同步版本无效", 400, "learning_sync_version_invalid");
  }
  const changes = payload.changes ?? [];
  if (!Array.isArray(changes) || changes.length > LEARNING_SYNC_MAX_CHANGES) {
    reject("单次同步记录数量超出限制", 413, "learning_sync_changes_limit");
  }
  const identities = new Set();
  const cleanedChanges = changes.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      reject("同步记录格式无效", 400, "learning_sync_change_invalid");
    }
    const allowedChange = new Set([
      "data_type", "record_id", "payload", "updated_at", "deleted", "base_server_version",
    ]);
    if (Object.keys(raw).some((key) => !allowedChange.has(key))) {
      reject("同步记录包含不允许的字段", 400, "learning_sync_change_fields_forbidden");
    }
    const dataType = String(raw.data_type || "").trim();
    if (!LEARNING_SYNC_TYPES.has(dataType)) reject("学习数据类型无效", 400, "learning_sync_type_invalid");
    const recordId = String(raw.record_id || "").trim();
    if (recordId.length > LEARNING_SYNC_MAX_RECORD_ID || !RECORD_PATTERN.test(recordId)) {
      reject("学习记录标识无效", 400, "learning_sync_record_id_invalid");
    }
    const identity = `${dataType}\u0000${recordId}`;
    if (identities.has(identity)) reject("单次请求包含重复学习记录", 400, "learning_sync_duplicate_change");
    identities.add(identity);
    const updatedAt = normalizedTimestamp(raw.updated_at);
    if (!updatedAt) reject("学习记录更新时间无效", 400, "learning_sync_updated_at_invalid");
    if (typeof raw.deleted !== "boolean") reject("学习记录删除状态无效", 400, "learning_sync_deleted_invalid");
    if (dataType === "achievement" && raw.deleted) {
      reject("成就记录只能增加", 400, "learning_sync_achievement_monotonic");
    }
    const baseVersion = raw.base_server_version ?? 0;
    if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) {
      reject("学习记录基础版本无效", 400, "learning_sync_base_version_invalid");
    }
    if (!raw.payload || typeof raw.payload !== "object" || Array.isArray(raw.payload)) {
      reject("学习记录内容必须是对象", 400, "learning_sync_payload_invalid");
    }
    const recordPayload = raw.deleted ? {} : validateSyncValue(raw.payload);
    if (encoder.encode(stableStringify(recordPayload)).length > LEARNING_SYNC_MAX_PAYLOAD_BYTES) {
      reject("单项学习数据超出大小限制", 413, "learning_sync_record_too_large");
    }
    return {
      data_type: dataType,
      record_id: recordId,
      payload: recordPayload,
      updated_at: updatedAt,
      deleted: raw.deleted,
      base_server_version: baseVersion,
      client_id: clientId,
      client_version: clientVersion,
    };
  });
  return {
    schema_version: LEARNING_SYNC_SCHEMA_VERSION,
    client_id: clientId,
    client_version: clientVersion,
    since_version: sinceVersion,
    changes: cleanedChanges,
  };
}

export function safeJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

export function learningRecordPayload(row) {
  const version = row?.user_version ?? row?.server_version ?? 0;
  return {
    data_type: String(row?.data_type || ""),
    record_id: String(row?.record_id || ""),
    payload: Number(row?.deleted || 0) ? {} : safeJsonObject(row?.payload_json),
    updated_at: String(row?.updated_at || ""),
    deleted: Boolean(Number(row?.deleted || 0)),
    client_id: String(row?.client_id || ""),
    client_version: String(row?.client_version || ""),
    server_version: Number(version),
    server_updated_at: String(row?.user_version !== undefined ? row?.created_at : row?.server_updated_at || ""),
  };
}

function mergeMonotonicValue(current, incoming) {
  if (typeof current === "boolean" && typeof incoming === "boolean") return current || incoming;
  if (typeof current === "number" && typeof incoming === "number") return Math.max(current, incoming);
  if (current && incoming && typeof current === "object" && typeof incoming === "object" && !Array.isArray(current) && !Array.isArray(incoming)) {
    const merged = { ...current };
    Object.entries(incoming).forEach(([key, value]) => {
      merged[key] = Object.hasOwn(merged, key) ? mergeMonotonicValue(merged[key], value) : value;
    });
    return merged;
  }
  if (Array.isArray(current) && Array.isArray(incoming)) {
    const values = [];
    const seen = new Set();
    [...current, ...incoming].forEach((item) => {
      const marker = stableStringify(item);
      if (!seen.has(marker)) {
        seen.add(marker);
        values.push(item);
      }
    });
    return values.slice(0, 2000);
  }
  return current !== null && current !== "" && current !== undefined ? current : incoming;
}

function mergeTextList(current, incoming, maximum) {
  const values = [];
  const seen = new Set();
  [...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [])].forEach((item) => {
    const text = String(item || "").trim();
    const marker = text.toLocaleLowerCase();
    if (text && !seen.has(marker)) {
      seen.add(marker);
      values.push(text);
    }
  });
  return values.slice(0, maximum);
}

function mergeWrongPayload(current, incoming, incomingNewer) {
  const merged = incomingNewer ? { ...current, ...incoming } : { ...incoming, ...current };
  merged.wrong_count = Math.max(Number(current.wrong_count || 0), Number(incoming.wrong_count || 0));
  const accepted = mergeTextList(current.accepted, incoming.accepted, 50);
  if (accepted.length) merged.accepted = accepted;
  const currentRubric = safeJsonObject(current.rubric);
  const incomingRubric = safeJsonObject(incoming.rubric);
  if (Object.keys(currentRubric).length || Object.keys(incomingRubric).length) {
    merged.rubric = incomingNewer
      ? { ...currentRubric, ...incomingRubric }
      : { ...incomingRubric, ...currentRubric };
    const rubricAccepted = mergeTextList(currentRubric.accepted, incomingRubric.accepted, 50);
    if (rubricAccepted.length) merged.rubric.accepted = rubricAccepted;
  }
  return merged;
}

function incomingIsNewer(existing, incoming) {
  const existingTime = Date.parse(existing.updated_at || "") || 0;
  const incomingTime = Date.parse(incoming.updated_at || "") || 0;
  if (incomingTime !== existingTime) return incomingTime > existingTime;
  return incoming.client_id > String(existing.client_id || "");
}

export function mergeLearningRecord(existing, incoming) {
  if (!existing) return { canonical: { ...incoming }, changed: true, merged: false };
  const existingPayload = safeJsonObject(existing.payload_json);
  const existingOutput = learningRecordPayload(existing);
  const incomingNewer = incomingIsNewer(existing, incoming);
  const baseIsCurrent = incoming.base_server_version >= Number(existing.server_version || 0);

  if (incoming.deleted) {
    if (!baseIsCurrent) return { canonical: existingOutput, changed: false, merged: true };
    return {
      canonical: { ...incoming, payload: {} },
      changed: !Boolean(Number(existing.deleted || 0)),
      merged: false,
    };
  }
  if (Number(existing.deleted || 0)) {
    if (!baseIsCurrent || !incomingNewer) return { canonical: existingOutput, changed: false, merged: true };
    return { canonical: { ...incoming }, changed: true, merged: false };
  }

  let payload;
  if (incoming.data_type === "achievement") {
    payload = mergeMonotonicValue(existingPayload, incoming.payload);
  } else if (incoming.data_type === "wrong_book") {
    payload = mergeWrongPayload(existingPayload, incoming.payload, incomingNewer);
  } else {
    if (!incomingNewer) {
      return {
        canonical: existingOutput,
        changed: false,
        merged: stableStringify(existingPayload) !== stableStringify(incoming.payload),
      };
    }
    payload = incoming.payload;
  }

  const canonical = { ...incoming, payload };
  if (["achievement", "wrong_book"].includes(incoming.data_type)) {
    const existingTime = Date.parse(existing.updated_at || "") || 0;
    const incomingTime = Date.parse(incoming.updated_at || "") || 0;
    if (existingTime > incomingTime) {
      canonical.updated_at = existing.updated_at;
      canonical.client_id = existing.client_id;
      canonical.client_version = existing.client_version;
    } else if (!incomingNewer && existingTime === incomingTime) {
      canonical.client_id = existing.client_id;
      canonical.client_version = existing.client_version;
    }
  }
  const same = !Number(existing.deleted || 0)
    && stableStringify(existingPayload) === stableStringify(canonical.payload)
    && existing.updated_at === canonical.updated_at
    && existing.client_id === canonical.client_id
    && existing.client_version === canonical.client_version;
  return {
    canonical,
    changed: !same,
    merged: incoming.base_server_version < Number(existing.server_version || 0)
      || stableStringify(canonical.payload) !== stableStringify(incoming.payload),
  };
}

export function validateTelemetryInput(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    reject("统计事件格式无效", 400, "telemetry_invalid");
  }
  const allowed = new Set(["feature_id", "outcome", "latency_ms", "error_code"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    reject("统计事件包含不允许的字段", 400, "telemetry_fields_forbidden");
  }
  const featureId = String(payload.feature_id || "").trim().toLowerCase();
  if (!TELEMETRY_FEATURE_PATTERN.test(featureId)) reject("统计功能 ID 无效", 400, "telemetry_feature_invalid");
  const outcome = String(payload.outcome || "").trim().toLowerCase();
  if (!["success", "failure"].includes(outcome)) reject("统计结果无效", 400, "telemetry_outcome_invalid");
  const errorCode = String(payload.error_code || "").trim();
  if (errorCode && !TELEMETRY_ERROR_PATTERN.test(errorCode)) reject("统计错误代码无效", 400, "telemetry_error_invalid");
  const latency = payload.latency_ms;
  if (latency !== undefined && (!Number.isFinite(latency) || latency < 0 || latency > 600000)) {
    reject("统计耗时无效", 400, "telemetry_latency_invalid");
  }
  const latencyBucket = latency === undefined
    ? "unknown"
    : latency < 100
      ? "lt_100"
      : latency < 500
        ? "100_499"
        : latency < 2000
          ? "500_1999"
          : "gte_2000";
  return { feature_id: featureId, outcome, latency_bucket: latencyBucket, error_code: errorCode };
}

export function parseStringArray(value) {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch (_) { return []; }
  }
  return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 100) : [];
}

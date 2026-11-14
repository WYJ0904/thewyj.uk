import {
  apiError,
  jsonResponse,
  sameOriginResult,
  sha256Hex,
} from "./cloudflare-foundation.mjs";
import { resolveTask12Account } from "./task12-auth.mjs";
import { passwordPepperConfigured, verifySecret } from "./task12-crypto.mjs";
import {
  ALLOWED_REPLY_TO_ADDRESSES,
  ALLOWED_SENDER_ADDRESSES,
  cleanBodyText,
  cleanEmailAddress,
  cleanSingleLineText,
  DEFAULT_FROM_EMAIL,
  DEFAULT_FROM_NAME,
  DEFAULT_REPLY_TO_EMAIL,
  DEFAULT_REPLY_TO_NAME,
  EMAIL_BUILD,
  emailBindingConfigured,
  emailSendingEnabled,
  EmailServiceError,
  escapeHtml,
  maskEmailAddress,
  parseAllowedTestRecipients,
  renderHtmlEnvelope,
  resolveEmailTransport,
  safeSendTransactionalEmail,
  sendSupportReplyEmail,
  sendTransactionalEmail,
  SUPPORT_FROM_EMAIL,
  supportSenderAuthorized,
  upsertUserEmailBinding,
} from "./email-service.mjs";

const MAX_SELECTED_RECIPIENTS = 20;
const MAX_ALL_VERIFIED_RECIPIENTS = 50;
const DEFAULT_BULK_COOLDOWN_SECONDS = 3600;
const ADMIN_SEND_WINDOW_SECONDS = 600;
const ADMIN_SEND_MAX_RECIPIENTS = 30;
const PREVIEW_TTL_MINUTES = 15;
const ALL_VERIFIED_CONFIRM_PHRASE = "CONFIRM-ALL-VERIFIED";

const RESTRICTED_ADMIN_KINDS = new Set([
  "verification_code",
  "email_bind_verification",
  "login_mfa_code",
  "password_reset_notice",
  "password_changed_notice",
  "mfa_changed_notice",
]);

const ROUTES = new Map([
  ["GET /api/admin/email/status", { auth: "admin", body: 0 }],
  ["POST /api/admin/email/test-send", { auth: "super_admin", body: 16 * 1024 }],
  ["GET /api/admin/email/overview", { auth: "admin", body: 0 }],
  ["GET /api/admin/email/recipients", { auth: "admin", body: 0 }],
  ["GET /api/admin/email/drafts", { auth: "admin", body: 0 }],
  ["POST /api/admin/email/drafts", { auth: "admin", body: 32 * 1024 }],
  ["POST /api/admin/email/preview", { auth: "admin", body: 32 * 1024 }],
  ["POST /api/admin/email/send", { auth: "admin", body: 32 * 1024 }],
  ["GET /api/admin/email/deliveries", { auth: "admin", body: 0 }],
  ["POST /api/admin/email/deliveries/retry", { auth: "admin", body: 4 * 1024 }],
  ["GET /api/admin/email/inbound", { auth: "admin", body: 0 }],
  ["POST /api/admin/email/inbound/reply", { auth: "admin", body: 32 * 1024 }],
  ["POST /api/admin/email/inbound/status", { auth: "admin", body: 4 * 1024 }],
  ["GET /api/admin/email/templates", { auth: "admin", body: 0 }],
  ["POST /api/admin/email/templates", { auth: "super_admin", body: 32 * 1024 }],
  ["POST /api/admin/email/user-binding", { auth: "super_admin", body: 4 * 1024 }],
]);

const METHODS_BY_PATH = new Map();
for (const key of ROUTES.keys()) {
  const splitAt = key.indexOf(" ");
  const method = key.slice(0, splitAt);
  const path = key.slice(splitAt + 1);
  if (!METHODS_BY_PATH.has(path)) METHODS_BY_PATH.set(path, []);
  METHODS_BY_PATH.get(path).push(method);
}

function requestId(context) {
  return String(context?.data?.requestId || "");
}

function nowIso() {
  return new Date().toISOString();
}

function generateId(prefix) {
  if (typeof crypto?.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function readJson(request, maxBytes = 16 * 1024) {
  const text = await request.text();
  if (!text) return {};
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new EmailServiceError("email_payload_too_large", "请求体超出允许大小限制", 413);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EmailServiceError("email_invalid_json", "请求 JSON 格式无效", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new EmailServiceError("email_invalid_json", "请求体必须是 JSON 对象", 400);
  }
  return parsed;
}

async function tableExists(db, tableName) {
  if (!db) return false;
  try {
    const row = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .bind(tableName)
      .first();
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

async function requireEmailSchema(db) {
  const ok = await tableExists(db, "email_center_deliveries");
  if (!ok) {
    throw new EmailServiceError("email_schema_not_ready", "邮件中心数据库结构尚未完成迁移（0036）", 503, {
      retryable: true,
    });
  }
}

function resolveRequestedSender(payload, env, account) {
  const senderKind = String(payload.sender_kind || "noreply").trim().toLowerCase();
  const fromEmail =
    senderKind === "support" || String(payload.from_email || "").trim().toLowerCase() === SUPPORT_FROM_EMAIL
      ? SUPPORT_FROM_EMAIL
      : DEFAULT_FROM_EMAIL;

  if (fromEmail === SUPPORT_FROM_EMAIL) {
    if (!account?.is_super_admin) {
      throw new EmailServiceError(
        "email_sender_requires_super_admin",
        "直接以 support@thewyj.uk 名义群发/外发仅限超级管理员且须已启用域名授权",
        403
      );
    }
    if (!supportSenderAuthorized(env)) {
      throw new EmailServiceError(
        "email_sender_unauthorized",
        "Cloudflare 尚未启用 support@thewyj.uk 发件身份授权（EMAIL_SUPPORT_SENDER_AUTHORIZED=true），请先使用 noreply@thewyj.uk",
        403
      );
    }
  }
  const replyTo = fromEmail === SUPPORT_FROM_EMAIL ? SUPPORT_FROM_EMAIL : DEFAULT_REPLY_TO_EMAIL;
  return { fromEmail, replyTo };
}

function statusResponsePayload(env, account) {
  const allowedTests = parseAllowedTestRecipients(env);
  return {
    ok: true,
    build: EMAIL_BUILD,
    email_sending_enabled: emailSendingEnabled(env),
    support_sender_authorized: supportSenderAuthorized(env),
    transport: resolveEmailTransport(env),
    binding_configured: emailBindingConfigured(env),
    rest_configured: Boolean(
      String(env?.EMAIL_SEND_API_TOKEN || "").trim() &&
      String(env?.EMAIL_CLOUDFLARE_ACCOUNT_ID || "").trim()
    ),
    default_from: DEFAULT_FROM_EMAIL,
    default_reply_to: DEFAULT_REPLY_TO_EMAIL,
    allowed_senders: ALLOWED_SENDER_ADDRESSES.filter(
      (addr) => addr !== SUPPORT_FROM_EMAIL || supportSenderAuthorized(env)
    ),
    allowed_reply_to: ALLOWED_REPLY_TO_ADDRESSES,
    inbound_forwarding_configured: Boolean(String(env?.EMAIL_FORWARD_TO_ADDRESS || "").trim()),
    inbound_auto_ack_enabled: String(env?.EMAIL_INBOUND_AUTO_ACK_ENABLED || "").trim().toLowerCase() === "true",
    test_recipients: allowedTests,
    test_recipients_restricted: allowedTests.length > 0,
    actor: {
      user_id: account.id,
      username: account.username,
      is_super_admin: Boolean(account.is_super_admin),
      is_admin: Boolean(account.is_admin),
    },
  };
}

async function resolvePreviewRecipients(db, account, targetMode, rawUserIds) {
  const mode = String(targetMode || "single").trim().toLowerCase();
  if (!["single", "multiple", "all_verified"].includes(mode)) {
    throw new EmailServiceError("email_invalid_target_mode", "收件范围类型无效，必须为 single / multiple / all_verified", 400);
  }
  if (mode === "all_verified" && !account.is_super_admin) {
    throw new EmailServiceError(
      "email_all_verified_requires_super_admin",
      "全站已验证用户投递属于高风险操作，仅限超级管理员执行",
      403
    );
  }

  const excluded = [];
  const effective = [];
  const seenEmails = new Set();

  if (mode === "all_verified") {
    const rows = (
      await db
        .prepare(
          `SELECT u.id, u.username, u.role, u.banned, u.deleted, b.email, b.verified
           FROM task12_users AS u
           INNER JOIN email_center_bindings AS b ON b.user_id = u.id
           WHERE u.deleted = 0 AND u.banned = 0 AND b.verified = 1
           ORDER BY u.created_at ASC
           LIMIT ?`
        )
        .bind(MAX_ALL_VERIFIED_RECIPIENTS + 1)
        .all()
    ).results || [];

    if (rows.length > MAX_ALL_VERIFIED_RECIPIENTS) {
      throw new EmailServiceError(
        "email_batch_limit_exceeded",
        `单次全站投递上限为 ${MAX_ALL_VERIFIED_RECIPIENTS} 名有效收件人，超出限制已拦截`,
        400
      );
    }

    for (const row of rows) {
      let cleanedEmail = null;
      try {
        cleanedEmail = cleanEmailAddress(row.email, "email");
      } catch {
        excluded.push({ user_id: row.id, username: row.username, reason: "invalid_email" });
        continue;
      }
      if (seenEmails.has(cleanedEmail)) {
        excluded.push({ user_id: row.id, username: row.username, reason: "duplicate_email" });
        continue;
      }
      seenEmails.add(cleanedEmail);
      effective.push({
        user_id: row.id,
        username: row.username,
        email: cleanedEmail,
        email_masked: maskEmailAddress(cleanedEmail),
      });
    }

    return {
      mode,
      requestedCount: rows.length,
      effective,
      excluded,
    };
  }

  const rawList = Array.isArray(rawUserIds) ? rawUserIds : [];
  const uniqueIds = [];
  const seenIds = new Set();
  for (const id of rawList) {
    const cleanId = String(id || "").trim();
    if (!cleanId) continue;
    if (seenIds.has(cleanId)) {
      excluded.push({ user_id: cleanId, reason: "duplicate_user_id" });
      continue;
    }
    seenIds.add(cleanId);
    uniqueIds.push(cleanId);
  }

  if (mode === "single" && uniqueIds.length !== 1) {
    throw new EmailServiceError("email_single_recipient_required", "单人发送模式必须恰好选择 1 名收件用户", 400);
  }
  if (uniqueIds.length === 0) {
    throw new EmailServiceError("email_recipients_required", "请至少选择 1 名站内用户作为收件人", 400);
  }
  if (uniqueIds.length > MAX_SELECTED_RECIPIENTS) {
    throw new EmailServiceError(
      "email_batch_limit_exceeded",
      `单次多选发送最多支持 ${MAX_SELECTED_RECIPIENTS} 名收件人`,
      400
    );
  }

  const placeholders = uniqueIds.map(() => "?").join(", ");
  const userRows = (
    await db
      .prepare(
        `SELECT u.id, u.username, u.role, u.banned, u.deleted, b.email, b.verified
         FROM task12_users AS u
         LEFT JOIN email_center_bindings AS b ON b.user_id = u.id
         WHERE u.id IN (${placeholders})`
      )
      .bind(...uniqueIds)
      .all()
  ).results || [];

  const rowMap = new Map(userRows.map((r) => [r.id, r]));
  for (const uid of uniqueIds) {
    const row = rowMap.get(uid);
    if (!row) {
      excluded.push({ user_id: uid, reason: "user_not_found" });
      continue;
    }
    if (Number(row.deleted) === 1) {
      excluded.push({ user_id: row.id, username: row.username, reason: "deleted" });
      continue;
    }
    if (Number(row.banned) === 1) {
      excluded.push({ user_id: row.id, username: row.username, reason: "banned" });
      continue;
    }
    if (!row.email) {
      excluded.push({ user_id: row.id, username: row.username, reason: "unbound" });
      continue;
    }
    if (Number(row.verified) !== 1) {
      excluded.push({ user_id: row.id, username: row.username, reason: "unverified" });
      continue;
    }
    let cleanedEmail = null;
    try {
      cleanedEmail = cleanEmailAddress(row.email, "email");
    } catch {
      excluded.push({ user_id: row.id, username: row.username, reason: "invalid_email" });
      continue;
    }
    if (seenEmails.has(cleanedEmail)) {
      excluded.push({ user_id: row.id, username: row.username, reason: "duplicate_email" });
      continue;
    }
    seenEmails.add(cleanedEmail);
    effective.push({
      user_id: row.id,
      username: row.username,
      email: cleanedEmail,
      email_masked: maskEmailAddress(cleanedEmail),
    });
  }

  return {
    mode,
    requestedCount: uniqueIds.length,
    effective,
    excluded,
  };
}

async function computePreviewHash({ createdBy, targetMode, fromEmail, subject, body, userIds }) {
  const canonical = JSON.stringify({
    createdBy,
    targetMode,
    fromEmail,
    subject,
    body,
    userIds: [...userIds].sort(),
  });
  return sha256Hex(canonical);
}

async function enforceAdminRateLimits(db, account, targetMode, count, env) {
  const since = new Date(Date.now() - ADMIN_SEND_WINDOW_SECONDS * 1000).toISOString();
  const recentRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM email_center_deliveries
       WHERE actor_user_id = ? AND channel = 'admin_manual' AND created_at >= ?`
    )
    .bind(account.id, since)
    .first();
  const recentCount = Number(recentRow?.cnt || 0);
  if (recentCount + count > ADMIN_SEND_MAX_RECIPIENTS) {
    throw new EmailServiceError(
      "email_admin_rate_limited",
      `10 分钟内管理员手动发信上限为 ${ADMIN_SEND_MAX_RECIPIENTS} 封（当前已发送 ${recentCount} 封），请稍后再试`,
      429,
      { retryable: true }
    );
  }

  if (targetMode === "all_verified") {
    const cooldownSeconds = Math.max(60, Number(env?.EMAIL_BULK_COOLDOWN_SECONDS || DEFAULT_BULK_COOLDOWN_SECONDS) || DEFAULT_BULK_COOLDOWN_SECONDS);
    const cooldownSince = new Date(Date.now() - cooldownSeconds * 1000).toISOString();
    const recentBulk = await db
      .prepare(
        `SELECT delivery_id FROM email_center_deliveries
         WHERE trigger_source = 'admin_all_verified' AND created_at >= ? LIMIT 1`
      )
      .bind(cooldownSince)
      .first();
    if (recentBulk?.delivery_id) {
      throw new EmailServiceError(
        "email_bulk_cooldown_active",
        `全站已验证用户批量投递触发冷却保护（每 ${Math.round(cooldownSeconds / 60)} 分钟限 1 次），请稍后再试`,
        429,
        { retryable: true }
      );
    }
  }
}

async function verifySuperAdminPassword(db, account, rawPassword, env) {
  const password = String(rawPassword || "");
  if (!password) {
    throw new EmailServiceError("email_password_confirm_required", "全站投递必须再次验证超级管理员登录密码", 403);
  }
  const pepper = String(env?.WYJ_TASK12_PASSWORD_PEPPER || "");
  if (!passwordPepperConfigured(pepper)) {
    throw new EmailServiceError("email_password_pepper_missing", "环境缺少密码保护 Secret，无法执行高风险密码复核", 503);
  }
  const userRow = await db
    .prepare("SELECT password_hash FROM task12_users WHERE id = ? LIMIT 1")
    .bind(account.id)
    .first();
  const verified = await verifySecret(password, userRow?.password_hash, pepper);
  if (!verified?.valid) {
    throw new EmailServiceError("email_password_confirm_failed", "超级管理员密码复核未通过", 403);
  }
}

export async function handleEmailRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/admin/email")) return null;

  const reqId = requestId(context);
  const method = context.request.method.toUpperCase();
  const allowedMethods = METHODS_BY_PATH.get(path);
  if (!allowedMethods) {
    return apiError("email_route_not_found", "邮件管理接口不存在", 404, reqId);
  }
  if (!allowedMethods.includes(method)) {
    return apiError("method_not_allowed", "不支持的 HTTP 请求方法", 405, reqId, {
      headers: { Allow: allowedMethods.join(", ") },
    });
  }

  const descriptor = ROUTES.get(`${method} ${path}`);
  if (method !== "GET" && method !== "HEAD") {
    const origin = sameOriginResult(context.request);
    if (!origin.allowed) {
      return apiError(origin.reason || "cross_origin_forbidden", "禁止跨源提交管理写操作", 403, reqId);
    }
  }

  let auth;
  try {
    auth = await resolveTask12Account(context, { touch: true });
  } catch (err) {
    return apiError(err?.code || "auth_error", err?.message || "身份校验异常", err?.status || 500, reqId);
  }
  if (!auth.authenticated) {
    return apiError(auth.code || "authentication_required", "请先登录后再访问邮件管理模块", auth.status || 401, reqId);
  }

  const account = auth.account;
  if (!account.is_admin) {
    return apiError("forbidden", "仅管理员可访问邮件中心", 403, reqId);
  }
  if (descriptor.auth === "super_admin" && !account.is_super_admin) {
    return apiError("forbidden", "此操作仅限超级管理员执行", 403, reqId);
  }

  const db = context.env?.WYJ_DB || null;
  const env = context.env || {};

  try {
    if (path === "/api/admin/email/status") {
      return jsonResponse(statusResponsePayload(env, account), 200, reqId);
    }

    if (path === "/api/admin/email/test-send") {
      const payload = await readJson(context.request, descriptor.body);
      const allowedRecipients = parseAllowedTestRecipients(env);
      const recipient = cleanEmailAddress(payload.recipient || payload.to || "", "recipient");
      if (allowedRecipients.length > 0 && !allowedRecipients.includes(recipient)) {
        throw new EmailServiceError(
          "email_test_recipient_not_allowed",
          "测试发信仅允许发送到 EMAIL_TEST_RECIPIENTS 白名单中的授权地址",
          403
        );
      }
      const kind = payload.kind ? String(payload.kind).trim() : "test_email";
      const result = await sendTransactionalEmail(env, {
        to: recipient,
        kind,
        subject: payload.subject || "Aeris Cloudflare Email 发送测试",
        body: payload.body || payload.detail || "这是一封来自 Aeris Email Center 的受控测试邮件。",
        detail: payload.detail,
        username: payload.username || account.username,
        code: payload.code,
        channel: "admin_manual",
        triggerSource: "admin_test_send",
        actorUserId: account.id,
        actorRole: "super_admin",
      });
      return jsonResponse({ ok: result.ok, result }, result.ok ? 200 : 422, reqId);
    }

    await requireEmailSchema(db);

    if (path === "/api/admin/email/overview") {
      const whereClause = account.is_super_admin
        ? "1=1"
        : "(actor_user_id = ? OR channel = 'support_reply') AND kind NOT IN ('verification_code','email_bind_verification','login_mfa_code','password_reset_notice','password_changed_notice','mfa_changed_notice')";
      const bindArgs = account.is_super_admin ? [] : [account.id];

      const totals = await db
        .prepare(
          `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
            SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status IN ('rejected','suppressed') THEN 1 ELSE 0 END) AS rejected
          FROM email_center_deliveries
          WHERE ${whereClause}`
        )
        .bind(...bindArgs)
        .first();

      const inboundStats = await db
        .prepare(
          `SELECT
            COUNT(*) AS total_threads,
            SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_threads,
            SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied_threads
          FROM email_center_inbound_threads`
        )
        .first();

      const verifiedUsers = account.is_super_admin
        ? await db.prepare("SELECT COUNT(*) AS cnt FROM email_center_bindings WHERE verified = 1").first()
        : null;

      return jsonResponse(
        {
          ok: true,
          status: statusResponsePayload(env, account),
          stats: {
            deliveries_total: Number(totals?.total || 0),
            delivered: Number(totals?.delivered || 0),
            queued: Number(totals?.queued || 0),
            failed: Number(totals?.failed || 0),
            rejected: Number(totals?.rejected || 0),
            inbound_threads_total: Number(inboundStats?.total_threads || 0),
            inbound_open_threads: Number(inboundStats?.open_threads || 0),
            inbound_replied_threads: Number(inboundStats?.replied_threads || 0),
            verified_bindings_count: account.is_super_admin ? Number(verifiedUsers?.cnt || 0) : null,
          },
        },
        200,
        { reqId }
      );
    }

    if (path === "/api/admin/email/recipients") {
      const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const verifiedFilter = String(url.searchParams.get("verified") || "all").trim().toLowerCase();
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 40) || 40));

      const conditions = ["u.deleted = 0"];
      const params = [];
      if (q) {
        if (account.is_super_admin) {
          conditions.push("(LOWER(u.username) LIKE ? OR LOWER(COALESCE(b.email, '')) LIKE ?)");
          params.push(`%${q}%`, `%${q}%`);
        } else {
          conditions.push("LOWER(u.username) LIKE ?");
          params.push(`%${q}%`);
        }
      }
      if (verifiedFilter === "verified") {
        conditions.push("b.verified = 1");
      } else if (verifiedFilter === "unverified") {
        conditions.push("b.email IS NOT NULL AND COALESCE(b.verified, 0) = 0");
      } else if (verifiedFilter === "unbound") {
        conditions.push("b.email IS NULL");
      }

      const hasRoleTable = await tableExists(db, "task18_admin_roles");
      const rows = (
        await db
          .prepare(
            hasRoleTable
              ? `SELECT u.id, u.username, COALESCE(r.role, u.role) AS role, u.banned, b.email, b.verified, b.verified_at
                 FROM task12_users AS u
                 LEFT JOIN task18_admin_roles AS r ON r.user_id = u.id
                 LEFT JOIN email_center_bindings AS b ON b.user_id = u.id
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY u.created_at DESC
                 LIMIT ?`
              : `SELECT u.id, u.username, u.role, u.banned, b.email, b.verified, b.verified_at
                 FROM task12_users AS u
                 LEFT JOIN email_center_bindings AS b ON b.user_id = u.id
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY u.created_at DESC
                 LIMIT ?`
          )
          .bind(...params, limit)
          .all()
      ).results || [];

      const recipients = rows.map((row) => ({
        user_id: row.id,
        username: row.username,
        role: row.role,
        banned: Number(row.banned) === 1,
        has_email: Boolean(row.email),
        verified: Number(row.verified) === 1,
        verified_at: row.verified_at || null,
        email_masked: row.email ? maskEmailAddress(row.email) : "",
        email: account.is_super_admin ? row.email || null : null,
      }));

      return jsonResponse({ ok: true, recipients, total: recipients.length }, 200, reqId);
    }

    if (path === "/api/admin/email/drafts" && method === "GET") {
      const sql = account.is_super_admin
        ? "SELECT * FROM email_center_drafts ORDER BY updated_at DESC LIMIT 30"
        : "SELECT * FROM email_center_drafts WHERE created_by = ? ORDER BY updated_at DESC LIMIT 30";
      const rows = (
        await (account.is_super_admin ? db.prepare(sql) : db.prepare(sql).bind(account.id)).all()
      ).results || [];
      return jsonResponse({ ok: true, drafts: rows }, 200, reqId);
    }

    if (path === "/api/admin/email/drafts" && method === "POST") {
      const payload = await readJson(context.request, descriptor.body);
      const draftId = payload.draft_id
        ? cleanSingleLineText(String(payload.draft_id), { maxLength: 80, field: "draft_id" })
        : generateId("drf");
      const targetMode = String(payload.target_mode || "single").trim().toLowerCase();
      if (!["single", "multiple", "all_verified"].includes(targetMode)) {
        throw new EmailServiceError("email_invalid_target_mode", "收件范围类型无效", 400);
      }
      if (targetMode === "all_verified" && !account.is_super_admin) {
        throw new EmailServiceError("forbidden", "仅超级管理员可创建全站已验证用户草稿", 403);
      }
      const recipientIds = Array.isArray(payload.recipient_user_ids)
        ? payload.recipient_user_ids.map((x) => String(x || "").trim()).filter(Boolean).slice(0, MAX_SELECTED_RECIPIENTS)
        : [];
      const subject = cleanSingleLineText(String(payload.subject || "草稿邮件"), { maxLength: 180, field: "subject", required: false, allowEmpty: true });
      const body = cleanBodyText(String(payload.body || ""), { maxLength: 20000, field: "body", required: false });
      const templateKey = payload.template_key ? cleanSingleLineText(String(payload.template_key), { maxLength: 80, field: "template_key" }) : null;
      const senderKind = String(payload.sender_kind || "noreply").trim().toLowerCase() === "support" ? "support" : "noreply";
      const ts = nowIso();

      await db
        .prepare(
          `INSERT INTO email_center_drafts (
            draft_id, created_by, created_by_username, target_mode, recipient_user_ids_json,
            template_key, subject, body, sender_kind, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
          ON CONFLICT(draft_id) DO UPDATE SET
            target_mode = excluded.target_mode,
            recipient_user_ids_json = excluded.recipient_user_ids_json,
            template_key = excluded.template_key,
            subject = excluded.subject,
            body = excluded.body,
            sender_kind = excluded.sender_kind,
            updated_at = excluded.updated_at`
        )
        .bind(
          draftId,
          account.id,
          account.username,
          targetMode,
          JSON.stringify(recipientIds),
          templateKey,
          subject,
          body,
          senderKind,
          ts,
          ts
        )
        .run();

      return jsonResponse({ ok: true, draft_id: draftId, updated_at: ts }, 200, reqId);
    }

    if (path === "/api/admin/email/preview") {
      const payload = await readJson(context.request, descriptor.body);
      if (payload.recipient_emails !== undefined || payload.recipients_raw !== undefined) {
        throw new EmailServiceError(
          "email_raw_recipients_forbidden",
          "后台发信必须通过站内用户 ID 选择已验证收件人，禁止提交任意外部邮箱列表",
          400
        );
      }

      const subject = cleanSingleLineText(String(payload.subject || ""), { maxLength: 180, field: "subject" });
      const body = cleanBodyText(String(payload.body || ""), { maxLength: 20000, field: "body" });
      const { fromEmail, replyTo } = resolveRequestedSender(payload, env, account);
      const resolution = await resolvePreviewRecipients(db, account, payload.target_mode, payload.recipient_user_ids);

      if (resolution.effective.length === 0) {
        throw new EmailServiceError(
          "email_no_valid_verified_recipients",
          "所选对象中没有符合条件的已验证绑定邮箱收件人，已阻止发信",
          400,
          { excluded_recipients: resolution.excluded }
        );
      }

      const previewToken = generateId("prv");
      const effectiveIds = resolution.effective.map((item) => item.user_id);
      const contentHash = await computePreviewHash({
        createdBy: account.id,
        targetMode: resolution.mode,
        fromEmail,
        subject,
        body,
        userIds: effectiveIds,
      });

      const ts = nowIso();
      const expiresAt = new Date(Date.now() + PREVIEW_TTL_MINUTES * 60 * 1000).toISOString();
      await db
        .prepare(
          `INSERT INTO email_center_previews (
            preview_token, draft_id, created_by, target_mode, from_email, reply_to,
            subject, body, resolved_recipients_json, recipient_count, content_hash,
            confirm_required, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .bind(
          previewToken,
          payload.draft_id ? String(payload.draft_id).slice(0, 80) : null,
          account.id,
          resolution.mode,
          fromEmail,
          replyTo,
          subject,
          body,
          JSON.stringify(resolution.effective),
          resolution.effective.length,
          contentHash,
          expiresAt,
          ts
        )
        .run();

      const htmlPreview = renderHtmlEnvelope({
        title: subject,
        eyebrow: resolution.mode === "all_verified" ? "Aeris System Service Notice" : "Aeris Service Notice",
        subject,
        paragraphs: body.split("\n"),
        footer: `Aeris 系统通知 · 回复联系 ${DEFAULT_REPLY_TO_EMAIL}`,
      });

      return jsonResponse(
        {
          ok: true,
          preview_token: previewToken,
          target_mode: resolution.mode,
          from_email: fromEmail,
          from_name: fromEmail === SUPPORT_FROM_EMAIL ? "Aeris Support" : DEFAULT_FROM_NAME,
          reply_to: replyTo,
          subject,
          body,
          html_preview: htmlPreview,
          effective_recipient_count: resolution.effective.length,
          requested_count: resolution.requestedCount,
          excluded_count: resolution.excluded.length,
          excluded_recipients: resolution.excluded,
          recipients_preview: resolution.effective.map((item) => ({
            user_id: item.user_id,
            username: item.username,
            email_masked: item.email_masked,
          })),
          high_risk_all_verified: resolution.mode === "all_verified",
          confirm_phrase_required: resolution.mode === "all_verified" ? ALL_VERIFIED_CONFIRM_PHRASE : null,
          expires_at: expiresAt,
        },
        200,
        { reqId }
      );
    }

    if (path === "/api/admin/email/send") {
      const payload = await readJson(context.request, descriptor.body);
      const previewToken = cleanSingleLineText(String(payload.preview_token || ""), {
        maxLength: 80,
        field: "preview_token",
      });
      if (payload.confirmed !== true) {
        throw new EmailServiceError("email_confirmation_required", "发送前必须完成预览与二次确认（confirmed=true）", 400);
      }

      const preview = await db
        .prepare("SELECT * FROM email_center_previews WHERE preview_token = ? LIMIT 1")
        .bind(previewToken)
        .first();
      if (!preview) {
        throw new EmailServiceError("email_preview_not_found", "预览令牌不存在，请重新生成预览后再发送", 404);
      }
      if (preview.created_by !== account.id) {
        throw new EmailServiceError("forbidden", "禁止使用其他管理员生成的发信预览令牌", 403);
      }
      if (preview.used_at) {
        throw new EmailServiceError("email_preview_already_used", "该预览确认令牌已使用过，已防止重复投递", 409);
      }
      if (preview.expires_at <= nowIso()) {
        throw new EmailServiceError("email_preview_expired", "发信预览已过期，请重新预览核对内容与人数", 410);
      }

      let resolvedRecipients = [];
      try {
        resolvedRecipients = JSON.parse(preview.resolved_recipients_json || "[]");
      } catch {
        resolvedRecipients = [];
      }
      if (!Array.isArray(resolvedRecipients) || resolvedRecipients.length === 0) {
        throw new EmailServiceError("email_no_valid_verified_recipients", "无有效收件人可执行发送", 400);
      }

      const expectedHash = await computePreviewHash({
        createdBy: preview.created_by,
        targetMode: preview.target_mode,
        fromEmail: preview.from_email,
        subject: preview.subject,
        body: preview.body,
        userIds: resolvedRecipients.map((r) => r.user_id),
      });
      if (expectedHash !== preview.content_hash) {
        throw new EmailServiceError("email_preview_tampered", "预览摘要校验失败，已终止发送", 409);
      }

      if (payload.subject !== undefined && String(payload.subject) !== preview.subject) {
        throw new EmailServiceError("email_preview_mismatch", "提交主题与已确认预览不一致，请重新预览", 409);
      }
      if (payload.body !== undefined && String(payload.body).replace(/\r\n?/g, "\n").trim() !== preview.body) {
        throw new EmailServiceError("email_preview_mismatch", "提交正文与已确认预览不一致，请重新预览", 409);
      }

      if (preview.target_mode === "all_verified") {
        if (!account.is_super_admin) {
          throw new EmailServiceError("forbidden", "仅超级管理员可执行全站已验证用户批量发送", 403);
        }
        if (String(payload.confirm_phrase || "").trim() !== ALL_VERIFIED_CONFIRM_PHRASE) {
          throw new EmailServiceError(
            "email_confirm_phrase_invalid",
            `请输入精确的高风险确认口令 ${ALL_VERIFIED_CONFIRM_PHRASE}`,
            400
          );
        }
        await verifySuperAdminPassword(db, account, payload.admin_password || payload.password, env);
      }

      await enforceAdminRateLimits(db, account, preview.target_mode, resolvedRecipients.length, env);

      const usedTs = nowIso();
      const claimRes = await db
        .prepare("UPDATE email_center_previews SET used_at = ? WHERE preview_token = ? AND used_at IS NULL")
        .bind(usedTs, previewToken)
        .run();
      if (Number(claimRes?.meta?.changes || 0) !== 1) {
        throw new EmailServiceError("email_preview_already_used", "该预览已被并发消费，已拦截重复发送", 409);
      }

      const batchId = generateId("bat");
      const results = [];
      const summary = {
        total: resolvedRecipients.length,
        delivered: 0,
        queued: 0,
        rejected: 0,
        suppressed: 0,
        failed: 0,
      };

      const kind = preview.target_mode === "all_verified" ? "system_maintenance_notice" : "admin_service_notice";
      const triggerSource = preview.target_mode === "all_verified" ? "admin_all_verified" : "admin_manual_send";

      for (const rcpt of resolvedRecipients) {
        const res = await safeSendTransactionalEmail(env, {
          to: rcpt.email,
          userId: rcpt.user_id,
          username: rcpt.username,
          kind,
          from: preview.from_email,
          fromName: preview.from_email === SUPPORT_FROM_EMAIL ? "Aeris Support" : DEFAULT_FROM_NAME,
          replyTo: preview.reply_to,
          replyToName: DEFAULT_REPLY_TO_NAME,
          subject: preview.subject,
          body: preview.body,
          channel: "admin_manual",
          triggerSource,
          actorUserId: account.id,
          actorRole: account.is_super_admin ? "super_admin" : "admin",
          batchId,
          idempotencyKey: `admin_batch:${previewToken}:${rcpt.user_id}`,
          enforceRateLimit: false,
          requireVerifiedEmail: true,
        });

        const st = String(res.delivery_status || "failed");
        if (st === "delivered") summary.delivered += 1;
        else if (st === "queued") summary.queued += 1;
        else if (st === "rejected") summary.rejected += 1;
        else if (st === "suppressed") summary.suppressed += 1;
        else summary.failed += 1;

        results.push({
          user_id: rcpt.user_id,
          username: rcpt.username,
          recipient_masked: rcpt.email_masked,
          delivery_id: res.delivery_id || null,
          delivery_status: st,
          inbox_delivery_confirmed: Boolean(res.inbox_delivery_confirmed),
          message_id: res.message_id || null,
          error_code: res.error_code || null,
          error_message: res.error_message || null,
          retryable: Boolean(res.retryable),
        });
      }

      if (preview.draft_id) {
        await db
          .prepare("UPDATE email_center_drafts SET status = 'sent', updated_at = ? WHERE draft_id = ?")
          .bind(nowIso(), preview.draft_id)
          .run();
      }

      return jsonResponse(
        {
          ok: summary.delivered + summary.queued > 0,
          batch_id: batchId,
          target_mode: preview.target_mode,
          from_email: preview.from_email,
          reply_to: preview.reply_to,
          summary,
          results,
        },
        summary.delivered + summary.queued > 0 ? 200 : 502,
        { reqId }
      );
    }

    if (path === "/api/admin/email/deliveries") {
      const statusFilter = String(url.searchParams.get("status") || "").trim().toLowerCase();
      const channelFilter = String(url.searchParams.get("channel") || "").trim().toLowerCase();
      const kindFilter = String(url.searchParams.get("kind") || "").trim().toLowerCase();
      const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 40) || 40));

      const conditions = [];
      const params = [];
      if (!account.is_super_admin) {
        conditions.push(
          "(actor_user_id = ? OR channel = 'support_reply') AND kind NOT IN ('verification_code','email_bind_verification','login_mfa_code','password_reset_notice','password_changed_notice','mfa_changed_notice')"
        );
        params.push(account.id);
      }
      if (statusFilter) {
        conditions.push("status = ?");
        params.push(statusFilter);
      }
      if (channelFilter) {
        conditions.push("channel = ?");
        params.push(channelFilter);
      }
      if (kindFilter) {
        conditions.push("kind = ?");
        params.push(kindFilter);
      }
      if (q) {
        if (account.is_super_admin) {
          conditions.push("(LOWER(subject) LIKE ? OR LOWER(recipient_email) LIKE ? OR LOWER(COALESCE(delivery_id, '')) LIKE ?)");
          params.push(`%${q}%`, `%${q}%`, `%${q}%`);
        } else {
          conditions.push("(LOWER(subject) LIKE ? OR LOWER(COALESCE(delivery_id, '')) LIKE ?)");
          params.push(`%${q}%`, `%${q}%`);
        }
      }

      const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = (
        await db
          .prepare(`SELECT * FROM email_center_deliveries ${whereSql} ORDER BY created_at DESC LIMIT ?`)
          .bind(...params, limit)
          .all()
      ).results || [];

      const deliveries = rows.map((row) => ({
        delivery_id: row.delivery_id,
        kind: row.kind,
        channel: row.channel,
        trigger_source: row.trigger_source,
        actor_user_id: row.actor_user_id,
        target_user_id: row.target_user_id,
        recipient_masked: maskEmailAddress(row.recipient_email),
        recipient_email: account.is_super_admin ? row.recipient_email : null,
        from_email: row.from_email,
        reply_to: row.reply_to,
        subject: row.subject,
        body_preview: row.body_preview,
        body_redacted: Number(row.body_redacted) === 1,
        delivery_status: row.status,
        inbox_delivery_confirmed: row.status === "delivered",
        transport: row.transport,
        provider_message_id: row.provider_message_id,
        error_code: row.error_code,
        error_message: row.error_message,
        retryable: Number(row.retryable) === 1 && row.status === "failed" && Number(row.retry_count) < Number(row.max_retries || 3),
        retry_count: Number(row.retry_count || 0),
        max_retries: Number(row.max_retries || 3),
        parent_delivery_id: row.parent_delivery_id,
        batch_id: row.batch_id,
        thread_id: row.thread_id,
        sent_at: row.sent_at,
        created_at: row.created_at,
      }));

      return jsonResponse({ ok: true, deliveries, total: deliveries.length }, 200, reqId);
    }

    if (path === "/api/admin/email/deliveries/retry") {
      const payload = await readJson(context.request, descriptor.body);
      const deliveryId = cleanSingleLineText(String(payload.delivery_id || ""), { maxLength: 80, field: "delivery_id" });
      const original = await db
        .prepare("SELECT * FROM email_center_deliveries WHERE delivery_id = ? LIMIT 1")
        .bind(deliveryId)
        .first();
      if (!original) {
        throw new EmailServiceError("email_delivery_not_found", "找不到对应的发信记录", 404);
      }
      if (!account.is_super_admin) {
        const permitted =
          original.actor_user_id === account.id &&
          ["admin_manual", "support_reply"].includes(String(original.channel || "")) &&
          !RESTRICTED_ADMIN_KINDS.has(String(original.kind || ""));
        if (!permitted) {
          throw new EmailServiceError("forbidden", "无权重试此发信记录", 403);
        }
      }
      if (RESTRICTED_ADMIN_KINDS.has(String(original.kind || "")) || Number(original.body_redacted) === 1) {
        throw new EmailServiceError("email_otp_retry_forbidden", "安全验证码与脱敏凭据邮件禁止通过后台直接重发，请由用户在原业务流程重新申请", 400);
      }
      if (original.status !== "failed") {
        throw new EmailServiceError(
          "email_retry_not_applicable",
          `当前记录状态为 ${original.status}，仅 failed 且可重试的记录允许重试（永久拒收/已排队/已投递禁止重发）`,
          409
        );
      }
      if (Number(original.retryable) !== 1) {
        throw new EmailServiceError("email_retry_not_allowed", "该失败原因不可重试（例如格式校验失败或策略拒绝）", 400);
      }
      const nextRetryCount = Number(original.retry_count || 0) + 1;
      const maxRetries = Number(original.max_retries || 3);
      if (nextRetryCount > maxRetries) {
        throw new EmailServiceError("email_retry_limit_reached", `已达到最大重试次数（${maxRetries} 次）`, 429);
      }

      const retryUpdate = await db
        .prepare(
          `UPDATE email_center_deliveries
           SET retry_count = retry_count + 1, updated_at = ?
           WHERE delivery_id = ? AND status = 'failed' AND retry_count < max_retries`
        )
        .bind(nowIso(), deliveryId)
        .run();
      if (Number(retryUpdate?.meta?.changes || 0) !== 1) {
        throw new EmailServiceError("email_retry_conflict", "并发重试拦截，请刷新发送记录状态", 409);
      }

      const retried = await safeSendTransactionalEmail(env, {
        to: original.recipient_email,
        userId: original.target_user_id || undefined,
        kind: original.kind,
        from: original.from_email,
        replyTo: original.reply_to || DEFAULT_REPLY_TO_EMAIL,
        subject: original.subject,
        body: original.body_preview || original.subject,
        channel: original.channel,
        triggerSource: `retry:${original.trigger_source}`,
        actorUserId: account.id,
        actorRole: account.is_super_admin ? "super_admin" : "admin",
        parentDeliveryId: original.delivery_id,
        batchId: original.batch_id || undefined,
        threadId: original.thread_id || undefined,
        retryCount: nextRetryCount,
      });

      return jsonResponse({ ok: retried.ok, original_delivery_id: deliveryId, retry_result: retried }, retried.ok ? 200 : 502, reqId);
    }

    if (path === "/api/admin/email/inbound" && method === "GET") {
      const threadId = String(url.searchParams.get("thread_id") || "").trim();
      if (threadId) {
        const thread = await db
          .prepare("SELECT * FROM email_center_inbound_threads WHERE thread_id = ? LIMIT 1")
          .bind(threadId)
          .first();
        if (!thread) {
          throw new EmailServiceError("email_thread_not_found", "客服邮件会话不存在", 404);
        }
        const inboundMessages = (
          await db
            .prepare("SELECT * FROM email_center_inbound_messages WHERE thread_id = ? ORDER BY received_at ASC")
            .bind(threadId)
            .all()
        ).results || [];
        const outboundReplies = (
          await db
            .prepare(
              `SELECT delivery_id, from_email, reply_to, subject, body_preview, status, transport, provider_message_id, actor_user_id, error_code, error_message, sent_at, created_at
               FROM email_center_deliveries WHERE thread_id = ? ORDER BY created_at ASC`
            )
            .bind(threadId)
            .all()
        ).results || [];

        const matchedUser = thread.matched_user_id
          ? await db
            .prepare("SELECT id, username, role FROM task12_users WHERE id = ? LIMIT 1")
            .bind(thread.matched_user_id)
            .first()
          : null;

        return jsonResponse(
          {
            ok: true,
            thread: {
              ...thread,
              matched_username: matchedUser?.username || null,
              sender_masked: maskEmailAddress(thread.sender_email),
            },
            inbound_messages: inboundMessages.map((msg) => ({
              inbound_id: msg.inbound_id,
              thread_id: msg.thread_id,
              rfc_message_id: msg.rfc_message_id,
              in_reply_to: msg.in_reply_to,
              sender_email: msg.sender_email,
              sender_name: msg.sender_name,
              recipient_email: msg.recipient_email,
              subject: msg.subject,
              text_excerpt: msg.text_excerpt,
              security_status: msg.security_status,
              sanitize_flags: (() => { try { return JSON.parse(msg.sanitize_flags_json || "[]"); } catch { return []; } })(),
              raw_size_bytes: Number(msg.raw_size_bytes || 0),
              forward_status: msg.forward_status,
              forward_error: msg.forward_error,
              auto_ack_status: msg.auto_ack_status,
              received_at: msg.received_at,
            })),
            outbound_replies: outboundReplies,
          },
          200,
          { reqId }
        );
      }

      const status = String(url.searchParams.get("status") || "").trim().toLowerCase();
      const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const limit = Math.max(1, Math.min(80, Number(url.searchParams.get("limit") || 40) || 40));

      const conditions = [];
      const params = [];
      if (status) {
        conditions.push("t.status = ?");
        params.push(status);
      }
      if (q) {
        conditions.push("(LOWER(t.original_subject) LIKE ? OR LOWER(t.sender_email) LIKE ? OR LOWER(t.thread_id) LIKE ?)");
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = (
        await db
          .prepare(
            `SELECT t.*, u.username AS matched_username
             FROM email_center_inbound_threads AS t
             LEFT JOIN task12_users AS u ON u.id = t.matched_user_id
             ${whereSql}
             ORDER BY t.last_message_at DESC
             LIMIT ?`
          )
          .bind(...params, limit)
          .all()
      ).results || [];

      return jsonResponse({ ok: true, threads: rows, total: rows.length }, 200, reqId);
    }

    if (path === "/api/admin/email/inbound/reply") {
      const payload = await readJson(context.request, descriptor.body);
      if (payload.confirmed !== true) {
        throw new EmailServiceError("email_confirmation_required", "回复客服邮件前请先预览并确认发送", 400);
      }
      const threadId = cleanSingleLineText(String(payload.thread_id || ""), { maxLength: 80, field: "thread_id" });
      const body = cleanBodyText(String(payload.body || ""), { maxLength: 20000, field: "body" });

      const thread = await db
        .prepare("SELECT * FROM email_center_inbound_threads WHERE thread_id = ? LIMIT 1")
        .bind(threadId)
        .first();
      if (!thread) {
        throw new EmailServiceError("email_thread_not_found", "找不到对应的客服邮件会话", 404);
      }

      const latestInbound = await db
        .prepare(
          `SELECT inbound_id, rfc_message_id, references_header, security_status
           FROM email_center_inbound_messages WHERE thread_id = ? ORDER BY received_at DESC LIMIT 1`
        )
        .bind(threadId)
        .first();

      if (latestInbound?.security_status === "auto_submitted" || latestInbound?.security_status === "rejected_invalid") {
        throw new EmailServiceError(
          "email_reply_to_auto_message_blocked",
          "该入站邮件属于系统自动回复/退信或无效发件人，禁止向其发送客服回复以防止邮件循环",
          400
        );
      }

      const fromMode = String(payload.from_mode || "auto").trim().toLowerCase();
      let fromAddress = undefined;
      if (fromMode === "support") {
        fromAddress = SUPPORT_FROM_EMAIL;
      } else if (fromMode === "noreply") {
        fromAddress = DEFAULT_FROM_EMAIL;
      }

      const subject = payload.subject
        ? cleanSingleLineText(String(payload.subject), { maxLength: 180, field: "subject" })
        : `Re: ${thread.normalized_subject}`;

      const referencesChain = [latestInbound?.references_header, latestInbound?.rfc_message_id]
        .filter(Boolean)
        .join(" ")
        .trim()
        .slice(0, 380);

      const replyRes = await sendSupportReplyEmail(env, {
        to: thread.sender_email,
        userId: thread.matched_user_id || undefined,
        from: fromAddress,
        subject,
        body,
        threadId,
        inboundMessageId: latestInbound?.inbound_id || undefined,
        inReplyTo: latestInbound?.rfc_message_id || undefined,
        references: referencesChain || undefined,
        actorUserId: account.id,
        actorRole: account.is_super_admin ? "super_admin" : "admin",
        enforceRateLimit: true,
      });

      const ts = nowIso();
      if (replyRes.ok) {
        await db
          .prepare(
            `UPDATE email_center_inbound_threads
             SET status = 'replied', last_reply_at = ?, last_reply_by = ?, updated_at = ?
             WHERE thread_id = ?`
          )
          .bind(ts, account.username, ts, threadId)
          .run();
      }

      return jsonResponse(
        {
          ok: replyRes.ok,
          thread_id: threadId,
          delivery: replyRes,
        },
        replyRes.ok ? 200 : 502,
        { reqId }
      );
    }

    if (path === "/api/admin/email/inbound/status") {
      const payload = await readJson(context.request, descriptor.body);
      const threadId = cleanSingleLineText(String(payload.thread_id || ""), { maxLength: 80, field: "thread_id" });
      const action = String(payload.action || payload.status || "").trim().toLowerCase();
      if (action === "delete") {
        if (!account.is_super_admin) {
          throw new EmailServiceError("forbidden", "彻底删除客服邮件记录仅限超级管理员", 403);
        }
        await db.batch([
          db.prepare("DELETE FROM email_center_inbound_messages WHERE thread_id = ?").bind(threadId),
          db.prepare("DELETE FROM email_center_inbound_threads WHERE thread_id = ?").bind(threadId),
        ]);
        return jsonResponse({ ok: true, deleted: true, thread_id: threadId }, 200, reqId);
      }
      if (!["open", "replied", "pending", "closed", "archived"].includes(action)) {
        throw new EmailServiceError("email_invalid_status", "无效的工单状态值", 400);
      }
      const res = await db
        .prepare("UPDATE email_center_inbound_threads SET status = ?, updated_at = ? WHERE thread_id = ?")
        .bind(action, nowIso(), threadId)
        .run();
      if (Number(res?.meta?.changes || 0) === 0) {
        throw new EmailServiceError("email_thread_not_found", "客服邮件会话不存在", 404);
      }
      return jsonResponse({ ok: true, thread_id: threadId, status: action }, 200, reqId);
    }

    if (path === "/api/admin/email/templates" && method === "GET") {
      const rows = (
        await db.prepare("SELECT * FROM email_center_templates ORDER BY is_system DESC, template_key ASC").all()
      ).results || [];
      return jsonResponse({ ok: true, templates: rows }, 200, reqId);
    }

    if (path === "/api/admin/email/templates" && method === "POST") {
      const payload = await readJson(context.request, descriptor.body);
      const templateKey = cleanSingleLineText(String(payload.template_key || ""), { maxLength: 80, field: "template_key" });
      if (!/^[a-z0-9_]{3,64}$/.test(templateKey)) {
        throw new EmailServiceError("email_invalid_template_key", "模板键只能包含小写字母、数字和下划线", 400);
      }
      const title = cleanSingleLineText(String(payload.title || templateKey), { maxLength: 100, field: "title" });
      const category = cleanSingleLineText(String(payload.category || "admin_service"), { maxLength: 60, field: "category" });
      const subjectTemplate = cleanSingleLineText(String(payload.subject_template || ""), { maxLength: 180, field: "subject_template" });
      const bodyTemplate = cleanBodyText(String(payload.body_template || ""), { maxLength: 20000, field: "body_template" });
      const enabled = payload.enabled === false ? 0 : 1;
      const ts = nowIso();

      await db
        .prepare(
          `INSERT INTO email_center_templates (
            template_id, template_key, title, category, subject_template, body_template,
            is_system, enabled, updated_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
          ON CONFLICT(template_key) DO UPDATE SET
            title = excluded.title,
            category = CASE WHEN email_center_templates.is_system = 1 THEN email_center_templates.category ELSE excluded.category END,
            subject_template = excluded.subject_template,
            body_template = excluded.body_template,
            enabled = excluded.enabled,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`
        )
        .bind(
          `tpl_${templateKey}`,
          templateKey,
          title,
          category,
          subjectTemplate,
          bodyTemplate,
          enabled,
          account.username,
          ts,
          ts
        )
        .run();

      const updated = await db
        .prepare("SELECT * FROM email_center_templates WHERE template_key = ? LIMIT 1")
        .bind(templateKey)
        .first();
      return jsonResponse({ ok: true, template: updated }, 200, reqId);
    }

    if (path === "/api/admin/email/user-binding") {
      const payload = await readJson(context.request, descriptor.body);
      const userId = cleanSingleLineText(String(payload.user_id || ""), { maxLength: 80, field: "user_id" });
      const userRow = await db.prepare("SELECT id, username, deleted FROM task12_users WHERE id = ? LIMIT 1").bind(userId).first();
      if (!userRow || Number(userRow.deleted) === 1) {
        throw new EmailServiceError("email_user_not_found", "找不到目标站内用户", 404);
      }
      const binding = await upsertUserEmailBinding(db, {
        userId: userRow.id,
        email: payload.email,
        verified: Boolean(payload.verified),
        actorUserId: account.id,
      });
      return jsonResponse({ ok: true, user_id: userRow.id, username: userRow.username, binding }, 200, reqId);
    }

    return apiError("email_route_not_found", "邮件接口未实现", 404, reqId);
  } catch (error) {
    if (error instanceof EmailServiceError) {
      return apiError(error.code, error.message, error.status || 400, reqId, {
        retryable: Boolean(error.retryable),
        details: error.details,
      });
    }
    return apiError("email_internal_error", error?.message || "邮件管理服务异常", 500, reqId, { retryable: true });
  }
}

export const __testing = {
  ALL_VERIFIED_CONFIRM_PHRASE,
  MAX_ALL_VERIFIED_RECIPIENTS,
  MAX_SELECTED_RECIPIENTS,
  METHODS_BY_PATH,
  ROUTES,
};

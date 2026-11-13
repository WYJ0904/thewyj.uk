import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { cloudMiddleware } from "../functions/_lib/cloudflare-foundation.mjs";
import {
  DEFAULT_FROM_EMAIL,
  DEFAULT_REPLY_TO_EMAIL,
  EmailServiceError,
  buildEmailMessage,
  cleanEmailAddress,
  sendAccountSecurityNotice,
  sendOrderStatusNotice,
  sendTransactionalEmail,
} from "../functions/_lib/email-service.mjs";
import { sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";
import { onRequest as dispatchApi } from "../functions/api/[[path]].js";

const ROOT = path.resolve(import.meta.dirname, "..");

const ENVIRONMENT = Object.freeze({
  CLOUD_FOUNDATION_ENABLED: "true",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK18_ADMIN_MESSAGES_ENABLED: "true",
  D1_RATE_LIMIT_ENABLED: "false",
  LEGACY_API_FALLBACK_ENABLED: "false",
  EMAIL_SENDING_ENABLED: "true",
  EMAIL_TEST_RECIPIENTS: "wyj20090904@gmail.com,support@thewyj.uk",
  WYJ_ENVIRONMENT: "preview",
});

const USERS = Object.freeze({
  owner: { id: "email-owner", username: "email-owner", role: "super_admin", token: "email-owner-token" },
  admin: { id: "email-admin", username: "email-admin", role: "user", delegatedAdmin: true, token: "email-admin-token" },
  user: { id: "email-user", username: "email-user", role: "user", token: "email-user-token" },
});

async function seedUser(db, user) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  await db.prepare(`INSERT INTO task12_users (
    id, username, username_normalized, password_hash, password_scheme,
    password_iterations, role, registered_at, created_at, updated_at, source_updated_at
  ) VALUES (?1, ?2, ?3, '', 'reset_required', 0, ?4, ?5, ?5, ?5, ?5)`)
    .bind(user.id, user.username, user.username.toLowerCase(), user.role, now).run();
  if (user.delegatedAdmin) {
    await db.prepare(`INSERT INTO task18_admin_roles (
      user_id, role, granted_by_user_id, granted_by_username, granted_at, updated_at
    ) VALUES (?1, 'admin', ?2, ?3, ?4, ?4)`)
      .bind(user.id, USERS.owner.id, USERS.owner.username, now).run();
  }
  await db.prepare(`INSERT INTO task12_sessions (
    token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind
  ) VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')`)
    .bind(await sessionStorageKey(user.token), user.id, now, expires).run();
}

async function applyMigrations(db) {
  const dir = path.join(ROOT, "cloudflare", "migrations");
  const files = (await readdir(dir)).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
  for (const name of files) {
    const sql = await readFile(path.join(dir, name), "utf8");
    await db.exec(sql.replace(/\r?\n/g, " "));
  }
}

async function callApi(db, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const waits = [];
  const env = { ...ENVIRONMENT, WYJ_DB: db, ...(options.env || {}) };
  const request = new Request(`https://preview.thewyj.uk${route}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const context = {
    env,
    data: { requestId: crypto.randomUUID() },
    request,
    waitUntil: (promise) => waits.push(promise),
    next: () => dispatchApi({ env, data: context.data, request, waitUntil: context.waitUntil }),
  };
  const response = await cloudMiddleware(context);
  await Promise.all(waits);
  const body = await response.json();
  return { status: response.status, headers: response.headers, body };
}

let tempDir = "";
let mf = null;
let passed = 0;
function check(label) {
  passed += 1;
  console.log(`  ok - ${label}`);
}

try {
  // 1. Strict address, header injection, sender, reply-to, bulk/XSS validation
  assert.equal(cleanEmailAddress("  WYJ20090904@Gmail.COM "), "wyj20090904@gmail.com");
  for (const bad of ["", "bad\r\nBcc: x@y.com", "a,b@c.com", "Aeris <a@b.com>", "no-at-sign", "..a@b.com"]) {
    assert.throws(() => cleanEmailAddress(bad), EmailServiceError);
  }
  assert.throws(
    () => buildEmailMessage({ kind: "owner_ops_test", to: "wyj20090904@gmail.com", from: "evil@attacker.test" }),
    (err) => err.code === "email_sender_forbidden",
  );
  assert.throws(
    () => buildEmailMessage({ kind: "owner_ops_test", to: "wyj20090904@gmail.com", replyTo: "evil@attacker.test" }),
    (err) => err.code === "email_reply_to_forbidden",
  );
  assert.throws(
    () => buildEmailMessage({ kind: "owner_ops_test", to: ["a@b.com"] }),
    (err) => err.code === "email_bulk_recipients_forbidden",
  );
  assert.throws(
    () => buildEmailMessage({ kind: "owner_ops_test", to: "wyj20090904@gmail.com", cc: "other@b.com" }),
    (err) => err.code === "email_bulk_recipients_forbidden",
  );
  assert.throws(
    () => buildEmailMessage({ kind: "owner_ops_test", to: "wyj20090904@gmail.com", subject: "ok\r\nBcc: pwn@evil.com" }),
    (err) => err.code === "email_header_injection_rejected",
  );
  const rendered = buildEmailMessage({
    kind: "account_security_notice",
    to: "wyj20090904@gmail.com",
    eventSummary: "<script>alert(1)</script> 新设备登录",
    occurredAt: "2026-11-13T04:00:00Z",
  });
  assert.equal(rendered.payload.from.email, DEFAULT_FROM_EMAIL);
  assert.equal(rendered.payload.replyTo.email, DEFAULT_REPLY_TO_EMAIL);
  assert.ok(rendered.payload.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!rendered.payload.html.includes("<script>"));
  check("address normalization, header-injection, sender/reply-to lock, bulk ban, and HTML escaping");

  // 2. Service-level transactional notices & fail-closed checks
  await assert.rejects(
    () => sendAccountSecurityNotice({ EMAIL_SENDING_ENABLED: "false", EMAIL: { send: async () => ({ messageId: "x" }) } }, {
      to: "wyj20090904@gmail.com",
      eventSummary: "登录密钥已更新",
    }),
    (err) => err.code === "email_sending_disabled" && err.status === 503,
  );
  await assert.rejects(
    () => sendOrderStatusNotice({ EMAIL_SENDING_ENABLED: "true" }, {
      to: "wyj20090904@gmail.com",
      orderId: "ORD-001",
      statusLabel: "已激活",
    }),
    (err) => err.code === "email_binding_unavailable" && err.status === 503,
  );
  const internalCaptured = [];
  const fakeEnv = {
    EMAIL_SENDING_ENABLED: "true",
    EMAIL: {
      send: async (msg) => {
        internalCaptured.push(msg);
        return { messageId: "msg-internal-1" };
      },
    },
  };
  const orderRes = await sendOrderStatusNotice(fakeEnv, {
    to: "support@thewyj.uk",
    orderId: "ORD-100",
    statusLabel: "已确认",
    amountSummary: "CNY 19.00",
  });
  assert.equal(orderRes.ok, true);
  assert.equal(orderRes.from, "noreply@thewyj.uk");
  assert.equal(orderRes.reply_to, "support@thewyj.uk");
  assert.equal(internalCaptured[0].replyTo.email, "support@thewyj.uk");

  // Secret/raw-error sanitization on provider errors
  await assert.rejects(
    () => sendTransactionalEmail({
      EMAIL_SENDING_ENABLED: "true",
      EMAIL: { send: async () => { throw new Error("upstream 429 rate limit token=secret123"); } },
    }, { kind: "owner_ops_test", to: "wyj20090904@gmail.com" }),
    (err) => err.code === "email_rate_limited" && err.status === 429 && !err.message.includes("secret123"),
  );
  await assert.rejects(
    () => sendTransactionalEmail({
      EMAIL_SENDING_ENABLED: "true",
      EMAIL: { send: async () => { throw new Error("recipient suppressed by domain bounce list"); } },
    }, { kind: "owner_ops_test", to: "wyj20090904@gmail.com" }),
    (err) => err.code === "email_rejected" && err.status === 400,
  );
  check("server transactional helpers, fail-closed gating, and sanitized provider error classification");

  // 3. Isolated D1 + API auth, anti-relay, cross-origin, rate limit, and audit checks
  tempDir = await mkdtemp(path.join(os.tmpdir(), "wyj-email-test-"));
  mf = new Miniflare({
    modules: true,
    script: "export default { async fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-08-06",
    d1Databases: ["WYJ_DB"],
    d1Persist: tempDir,
  });
  const db = await mf.getD1Database("WYJ_DB");
  await applyMigrations(db);
  await seedUser(db, USERS.owner);
  await seedUser(db, USERS.admin);
  await seedUser(db, USERS.user);

  const sentMessages = [];
  const emailBinding = {
    send: async (msg) => {
      sentMessages.push(msg);
      return { messageId: `cf-msg-${sentMessages.length}` };
    },
  };

  // Anonymous requests fail closed (401, no open relay)
  const anonStatus = await callApi(db, "/api/admin/email/status", { env: { EMAIL: emailBinding } });
  assert.equal(anonStatus.status, 401);
  const anonSend = await callApi(db, "/api/admin/email/test-send", {
    method: "POST",
    body: { recipient: "wyj20090904@gmail.com" },
    env: { EMAIL: emailBinding },
  });
  assert.equal(anonSend.status, 401);

  // Regular user & non-owner admin rejected (403)
  for (const actor of [USERS.user, USERS.admin]) {
    const res = await callApi(db, "/api/admin/email/test-send", {
      method: "POST",
      token: actor.token,
      body: { recipient: "wyj20090904@gmail.com" },
      env: { EMAIL: emailBinding },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, "owner_required");
  }

  // Cross-origin blocked by middleware
  const xOrigin = await callApi(db, "/api/admin/email/test-send", {
    method: "POST",
    token: USERS.owner.token,
    headers: { Origin: "https://attacker.invalid" },
    body: { recipient: "wyj20090904@gmail.com" },
    env: { EMAIL: emailBinding },
  });
  assert.equal(xOrigin.status, 403);

  // Non-allowlisted recipient rejected even with owner token (fail closed)
  const unallowed = await callApi(db, "/api/admin/email/test-send", {
    method: "POST",
    token: USERS.owner.token,
    body: { recipient: "stranger@example.com" },
    env: { EMAIL: emailBinding },
  });
  assert.equal(unallowed.status, 403);
  assert.equal(unallowed.body.code, "email_recipient_not_allowlisted");

  // Empty allowlist also fails closed
  const emptyAllowlist = await callApi(db, "/api/admin/email/test-send", {
    method: "POST",
    token: USERS.owner.token,
    body: { recipient: "wyj20090904@gmail.com" },
    env: { EMAIL: emailBinding, EMAIL_TEST_RECIPIENTS: "" },
  });
  assert.equal(emptyAllowlist.status, 403);

  // Unknown fields rejected (anti-payload-injection)
  const extraField = await callApi(db, "/api/admin/email/test-send", {
    method: "POST",
    token: USERS.owner.token,
    body: { recipient: "wyj20090904@gmail.com", html: "<script>bad</script>" },
    env: { EMAIL: emailBinding },
  });
  assert.equal(extraField.status, 400);
  assert.equal(extraField.body.code, "email_fields_forbidden");
  assert.equal(sentMessages.length, 0);
  check("anonymous, non-owner, cross-origin, unallowlisted recipient, and extra-field guards block open relay");

  // Production defaults fail-closed (EMAIL_SENDING_ENABLED=false)
  const prodDisabled = await callApi(db, "/api/admin/email/test-send", {
    method: "POST",
    token: USERS.owner.token,
    body: { recipient: "wyj20090904@gmail.com" },
    env: { EMAIL: emailBinding, EMAIL_SENDING_ENABLED: "false", WYJ_ENVIRONMENT: "production" },
  });
  assert.equal(prodDisabled.status, 503);
  assert.equal(prodDisabled.body.code, "email_sending_disabled");

  // Owner status & allowlisted test-send succeed with audit & D1 rate limit
  const statusOk = await callApi(db, "/api/admin/email/status", {
    token: USERS.owner.token,
    env: { EMAIL: emailBinding },
  });
  assert.equal(statusOk.status, 200);
  assert.equal(statusOk.body.enabled, true);
  assert.equal(statusOk.body.binding_configured, true);
  assert.deepEqual(statusOk.body.allowed_senders, ["noreply@thewyj.uk"]);
  assert.equal(statusOk.body.default_reply_to, "support@thewyj.uk");
  assert.equal(statusOk.body.test_recipient_count, 2);

  for (let i = 0; i < 5; i += 1) {
    const target = i % 2 === 0 ? "wyj20090904@gmail.com" : "support@thewyj.uk";
    const ok = await callApi(db, "/api/admin/email/test-send", {
      method: "POST",
      token: USERS.owner.token,
      body: { recipient: target, kind: "owner_ops_test", note: `Test #${i + 1}` },
      env: { EMAIL: emailBinding, D1_RATE_LIMIT_ENABLED: "true" },
    });
    assert.equal(ok.status, 200, `expected 200 on send ${i + 1}, got ${ok.status} ${JSON.stringify(ok.body)}`);
    assert.equal(ok.body.from, "noreply@thewyj.uk");
    assert.equal(ok.body.reply_to, "support@thewyj.uk");
  }
  assert.equal(sentMessages.length, 5);

  const limited = await callApi(db, "/api/admin/email/test-send", {
    method: "POST",
    token: USERS.owner.token,
    body: { recipient: "wyj20090904@gmail.com", kind: "owner_ops_test" },
    env: { EMAIL: emailBinding, D1_RATE_LIMIT_ENABLED: "true" },
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "email_rate_limited");
  assert.ok(Number(limited.headers.get("Retry-After")) > 0);

  const auditCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM task18_admin_action_audit WHERE action = 'email_test_send' AND success = 1",
  ).first();
  assert.equal(Number(auditCount.count), 5);
  check("owner status, allowlisted sending, D1 rate limiting (429), and admin audit trail");

  console.log(`Cloudflare Email Sending tests passed: ${passed} suites`);
} finally {
  if (mf) await mf.dispose();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
}

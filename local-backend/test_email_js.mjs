import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { cloudMiddleware } from "../functions/_lib/cloudflare-foundation.mjs";
import {
  ALLOWED_TRANSACTIONAL_KINDS,
  buildCloudflareRestPayload,
  buildEmailMessage,
  buildWorkersBindingPayload,
  cleanBodyText,
  cleanEmailAddress,
  cleanSingleLineText,
  DEFAULT_FROM_EMAIL,
  DEFAULT_REPLY_TO_EMAIL,
  EMAIL_BUILD,
  emailBindingConfigured,
  emailNativeBindingConfigured,
  EmailServiceError,
  escapeHtml,
  getEmailDeliveryStatus,
  getUserEmailBinding,
  parseAllowedTestRecipients,
  renderTransactionalEmail,
  resolveEmailTransport,
  resolveVerifiedUserEmail,
  sendAccountSecurityNotice,
  sendEmailBindingCode,
  sendLoginMfaCode,
  sendMfaChangedNotice,
  sendOrderStatusNotice,
  sendPasswordChangedNotice,
  sendPasswordResetNotice,
  sendSessionSecurityNotice,
  sendSupportReplyEmail,
  sendTransactionalEmail,
  sendVerificationCode,
  SUPPORT_FROM_EMAIL,
  upsertUserEmailBinding,
} from "../functions/_lib/email-service.mjs";
import { handleInboundSupportEmail } from "../functions/_lib/email-inbound.mjs";
import supportInboundWorker from "../cloudflare/email-worker/support-inbound-worker.mjs";
import { hashSecret, sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";
import { onRequest as dispatchApi } from "../functions/api/[[path]].js";

const REPO_ROOT = process.cwd();
const TEST_PEPPER = "TestTask27EmailCenterPepper1234567890!";
const OWNER_TEST_EMAIL = "owner-test@thewyj.uk";
const SUPPORT_TEST_EMAIL = "support@thewyj.uk";
const FORBIDDEN_PERSONAL_EMAIL_RE = new RegExp("wyj20090904" + "@" + "gmail\\.com", "i");
const FORBIDDEN_GMAIL_RE = new RegExp("@gmail" + "\\.com", "i");

let passedSuites = 0;

async function suite(name, fn) {
  await fn();
  passedSuites += 1;
  process.stdout.write(`[email-test] PASS ${name}\n`);
}

function makeEnv(db, overrides = {}) {
  return {
    WYJ_DB: db,
    WYJ_TASK12_PASSWORD_PEPPER: TEST_PEPPER,
    CLOUD_FOUNDATION_ENABLED: "true",
    TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
    TASK13_CLOUD_READS_ENABLED: "true",
    TASK13_CLOUD_WRITES_ENABLED: "true",
    TASK13_PAYMENT_PRIMARY_ENABLED: "true",
    TASK18_ADMIN_ROLES_ENABLED: "true",
    TASK18_SITE_MESSAGES_ENABLED: "true",
    D1_RATE_LIMIT_ENABLED: "true",
    LEGACY_API_FALLBACK_ENABLED: "false",
    WYJ_ENVIRONMENT: "preview",
    EMAIL_SENDING_ENABLED: "true",
    EMAIL_CLOUDFLARE_ACCOUNT_ID: "acc_test_1234567890",
    EMAIL_SEND_API_TOKEN: "tok_test_1234567890",
    EMAIL_TEST_RECIPIENTS: `${OWNER_TEST_EMAIL},${SUPPORT_TEST_EMAIL},user1@thewyj.uk,user2@thewyj.uk,user3@thewyj.uk,external@example.org`,
    EMAIL_SUPPORT_SENDER_AUTHORIZED: "false",
    ...overrides,
  };
}

async function applyAllMigrations(db) {
  const migrationsDir = path.join(REPO_ROOT, "cloudflare", "migrations");
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const rawSql = await readFile(path.join(migrationsDir, file), "utf8");
    await db.exec(rawSql.replace(/\r?\n/g, " "));
  }
}

async function seedAccount(db, { id, username, role = "user", password = "UserSecret-2026!", grantedBy = null, banned = 0, deleted = 0 }) {
  const now = new Date().toISOString();
  const hashed = await hashSecret(password, TEST_PEPPER);
  const parts = hashed.split("$");
  const scheme = "pbkdf2_sha256";
  const iterations = Number.parseInt(parts[1], 10) || 310000;
  await db
    .prepare(
      `INSERT INTO task12_users (
        id, username, username_normalized, password_hash, password_scheme, password_iterations,
        role, banned, permanent_ban, ban_reason, deleted, session_version,
        registered_at, last_login_at, created_at, updated_at, source_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?, 1, ?, '', ?, ?, ?)`
    )
    .bind(
      id,
      username,
      username.toLowerCase(),
      hashed,
      scheme,
      iterations,
      role === "super_admin" ? "super_admin" : "user",
      banned,
      deleted,
      now,
      now,
      now,
      now
    )
    .run();

  if (role === "admin" && grantedBy) {
    await db
      .prepare(
        `INSERT INTO task18_admin_roles (user_id, role, granted_by_user_id, granted_by_username, granted_at, updated_at)
         VALUES (?, 'admin', ?, 'super_owner', ?, ?)`
      )
      .bind(id, grantedBy, now, now)
      .run();
  }

  const rawToken = `tok_${id}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const digest = await sessionStorageKey(rawToken);
  const expiresAt = new Date(Date.now() + 86400_000).toISOString();
  await db
    .prepare(
      `INSERT INTO task12_sessions (token_digest, user_id, session_version, created_at, last_seen_at, expires_at, revoked, revoked_at, client_kind)
       VALUES (?, ?, 1, ?, ?, ?, 0, '', 'test')`
    )
    .bind(digest, id, now, now, expiresAt)
    .run();

  return { id, username, role, password, token: rawToken };
}

async function callApi(env, pathname, { method = "GET", body = null, token = "", headers = {}, ip = "127.0.0.1" } = {}) {
  const reqHeaders = new Headers({
    Origin: "https://thewyj.uk",
    "CF-Connecting-IP": ip,
    ...headers,
  });
  if (token) reqHeaders.set("X-Session-Token", token);
  if (body !== null) reqHeaders.set("Content-Type", "application/json");
  const request = new Request(`https://thewyj.uk${pathname}`, {
    method,
    headers: reqHeaders,
    body: body === null ? undefined : JSON.stringify(body),
  });
  let handlerCalled = false;
  let capturedRes = null;
  const context = {
    request,
    env,
    data: {},
    waitUntil() {},
    next: async () => {
      handlerCalled = true;
      return dispatchApi(context);
    },
  };
  capturedRes = await cloudMiddleware(context);
  if (!handlerCalled && capturedRes.status === 404) {
    capturedRes = await dispatchApi(context);
  }
  const data = await capturedRes.json().catch(() => ({}));
  return { status: capturedRes.status, headers: capturedRes.headers, data };
}

async function issueStepup(env, token, password, scope, ip = "127.0.0.1") {
  const res = await callApi(env, "/api/security/stepup", {
    method: "POST",
    token,
    ip,
    body: { password, scope },
  });
  assert.equal(res.status, 200, `Step-up grant failed for scope=${scope}: ${JSON.stringify(res.data)}`);
  assert.ok(res.data?.grant, `Missing step-up grant for scope=${scope}`);
  return res.data.grant;
}

function mockCloudflareRestFetch(modeOrHandler = "delivered") {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: String(url), method: init?.method || "GET", headers: init?.headers, body: parsedBody });
    const recipient = parsedBody?.to?.[0] || "unknown@thewyj.uk";
    const resolved = typeof modeOrHandler === "function" ? await modeOrHandler(parsedBody, calls.length) : { mode: modeOrHandler };
    const mode = resolved.mode || "delivered";

    if (mode === "network_error") {
      throw new Error("Simulated network timeout");
    }
    if (mode === "http_401") {
      return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (mode === "http_429") {
      return new Response(JSON.stringify({ success: false, errors: [{ code: "E_RATE_LIMITED", message: "Too many requests" }] }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (mode === "http_503") {
      return new Response(JSON.stringify({ success: false, errors: [{ code: 5003, message: "Service temporarily unavailable" }] }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (mode === "rejected") {
      return new Response(
        JSON.stringify({
          success: true,
          result: { message_id: `<msg-rej-${calls.length}@thewyj.uk>`, delivered: [], queued: [], permanent_bounces: [recipient] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (mode === "queued") {
      return new Response(
        JSON.stringify({
          success: true,
          result: { message_id: `<msg-q-${calls.length}@thewyj.uk>`, delivered: [], queued: [recipient], permanent_bounces: [] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({
        success: true,
        result: { message_id: `<msg-ok-${calls.length}@thewyj.uk>`, delivered: [recipient], queued: [], permanent_bounces: [] },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

async function run() {
  await suite("1. Privacy & production flag safety scan across repository", async () => {
    const wranglerText = await readFile(path.join(REPO_ROOT, "wrangler.jsonc"), "utf8");
    assert.equal(FORBIDDEN_PERSONAL_EMAIL_RE.test(wranglerText), false, "wrangler.jsonc must not contain personal Gmail");
    assert.equal(FORBIDDEN_GMAIL_RE.test(wranglerText), false, "wrangler.jsonc must not contain any gmail address");
    assert.match(wranglerText, /"production"\s*:\s*\{[\s\S]*"TASK27_SECURITY_ENABLED"\s*:\s*"true"/);
    assert.match(wranglerText, /"production"\s*:\s*\{[\s\S]*"EMAIL_SENDING_ENABLED"\s*:\s*"true"/);
    assert.doesNotMatch(wranglerText, /"production"\s*:\s*\{[\s\S]*"EMAIL_TEST_RECIPIENTS"/);

    const filesToScan = [
      "index.html",
      "app.js",
      "js/admin/formatters.js",
      "functions/_lib/email-service.mjs",
      "functions/_lib/email-inbound.mjs",
      "functions/_lib/email-api.mjs",
      "cloudflare/email-worker/support-inbound-worker.mjs",
      "docs/TASK27_EMAIL_CONTRACT.md",
      "qa/email/browser.mjs",
    ];
    for (const rel of filesToScan) {
      const content = await readFile(path.join(REPO_ROOT, rel), "utf8");
      assert.equal(FORBIDDEN_PERSONAL_EMAIL_RE.test(content), false, `${rel} leaked private personal email`);
    }
  });

  await suite("2. Core Email Service contracts, header safety, sender auth & REST/Binding payloads", async () => {
    assert.ok(EMAIL_BUILD);
    assert.equal(DEFAULT_FROM_EMAIL, "noreply@thewyj.uk");
    assert.equal(DEFAULT_REPLY_TO_EMAIL, "support@thewyj.uk");
    assert.ok(ALLOWED_TRANSACTIONAL_KINDS.includes("verification_code"));
    assert.ok(ALLOWED_TRANSACTIONAL_KINDS.includes("login_mfa_code"));
    assert.ok(ALLOWED_TRANSACTIONAL_KINDS.includes("password_changed_notice"));
    assert.ok(ALLOWED_TRANSACTIONAL_KINDS.includes("support_reply"));

    assert.equal(cleanEmailAddress("  User@TheWyj.UK "), "user@thewyj.uk");
    assert.throws(() => cleanEmailAddress("evil@thewyj.uk\r\nBcc: victim@x.com"), (e) => e.code === "email_header_injection_rejected");
    assert.throws(() => cleanEmailAddress("Name <user@thewyj.uk>"), (e) => e.code === "email_header_injection_rejected");

    const msg = buildEmailMessage(
      {
        to: OWNER_TEST_EMAIL,
        kind: "verification_code",
        code: "654321",
        purpose: "login_mfa",
        threadId: "thr_123",
        headers: { "X-Custom-Trace": "trace-abc" },
      },
      {}
    );
    const restPayload = buildCloudflareRestPayload(msg);
    assert.deepEqual(restPayload.from, { address: "noreply@thewyj.uk", name: "Aeris" });
    assert.deepEqual(restPayload.to, [OWNER_TEST_EMAIL]);
    assert.deepEqual(restPayload.reply_to, { address: "support@thewyj.uk", name: "Aeris Support" });
    assert.equal(restPayload.headers["X-Aeris-Thread"], "thr_123");
    assert.equal(restPayload.headers["X-Custom-Trace"], "trace-abc");
    assert.equal("Message-ID" in restPayload.headers, false);

    const bindingPayload = buildWorkersBindingPayload(msg);
    assert.deepEqual(bindingPayload.from, { email: "noreply@thewyj.uk", name: "Aeris" });
    assert.deepEqual(bindingPayload.to, [{ email: OWNER_TEST_EMAIL }]);

    assert.throws(
      () => buildEmailMessage({ to: OWNER_TEST_EMAIL, kind: "admin_service_notice", subject: "Hi", body: "Body", headers: { "Message-ID": "<bad@thewyj.uk>" } }, {}),
      (e) => e.code === "email_header_not_allowed"
    );
    assert.throws(
      () => buildEmailMessage({ to: OWNER_TEST_EMAIL, kind: "support_reply", from: SUPPORT_FROM_EMAIL, subject: "Re: Hi", body: "Hello" }, { EMAIL_SUPPORT_SENDER_AUTHORIZED: "false" }),
      (e) => e.code === "email_sender_unauthorized"
    );

    const xssRendered = renderTransactionalEmail({ kind: "admin_service_notice", subject: "Notice", body: '<script>alert(1)</script>' });
    assert.equal(xssRendered.html.includes("<script>"), false);
    assert.ok(xssRendered.html.includes(escapeHtml("<script>alert(1)</script>")));
  });

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "aeris-email-test-"));
  const mf = new Miniflare({
    modules: true,
    script: "export default { async fetch() { return new Response('ok'); } }",
    d1Databases: { WYJ_DB: "wyj-test-db" },
    d1Persist: tmpDir,
  });

  try {
    const db = await mf.getD1Database("WYJ_DB");
    await applyAllMigrations(db);

    const superAdmin = await seedAccount(db, { id: "u_super", username: "super_owner", role: "super_admin", password: "SuperPassword-2026!" });
    const regularAdmin = await seedAccount(db, { id: "u_admin", username: "ops_admin", role: "admin", grantedBy: superAdmin.id });
    const verifiedUser = await seedAccount(db, { id: "u_v1", username: "verified_alice", role: "user", password: "AlicePassword-2026!" });
    const verifiedUser2 = await seedAccount(db, { id: "u_v2", username: "verified_bob", role: "user" });
    const unverifiedUser = await seedAccount(db, { id: "u_unv", username: "unverified_carol", role: "user" });
    const bannedUser = await seedAccount(db, { id: "u_ban", username: "banned_dave", role: "user", banned: 1 });

    await upsertUserEmailBinding(db, { userId: superAdmin.id, email: OWNER_TEST_EMAIL, verified: true, actorUserId: superAdmin.id });
    await upsertUserEmailBinding(db, { userId: verifiedUser.id, email: "user1@thewyj.uk", verified: true, actorUserId: superAdmin.id });
    await upsertUserEmailBinding(db, { userId: verifiedUser2.id, email: "user2@thewyj.uk", verified: true, actorUserId: superAdmin.id });
    await upsertUserEmailBinding(db, { userId: unverifiedUser.id, email: "user3@thewyj.uk", verified: false, actorUserId: superAdmin.id });
    await upsertUserEmailBinding(db, { userId: bannedUser.id, email: "banned@thewyj.uk", verified: true, actorUserId: superAdmin.id });

    await suite("3. Task27 transactional contracts: delivered/queued/rejected/errors, OTP redaction, idempotency & rate limit", async () => {
      const env = makeEnv(db);
      const mockRest = mockCloudflareRestFetch((body, count) => {
        if (count === 1) return { mode: "delivered" };
        if (count === 2) return { mode: "queued" };
        if (count === 3) return { mode: "rejected" };
        if (count === 4) return { mode: "http_429" };
        if (count === 5) return { mode: "http_401" };
        return { mode: "delivered" };
      });

      try {
        // Call 1: Login MFA code -> verified user delivered, OTP redacted in D1!
        const mfaRes = await sendLoginMfaCode(env, {
          to: "user1@thewyj.uk",
          userId: verifiedUser.id,
          username: verifiedUser.username,
          code: "739201",
          idempotencyKey: "t27:mfa:req-001",
        });
        assert.equal(mfaRes.ok, true);
        assert.equal(mfaRes.delivery_status, "delivered");
        assert.equal(mfaRes.delivery_stage, "provider_reported_delivered");
        assert.equal(mfaRes.provider_accepted, true);
        assert.equal(mfaRes.provider_reported_delivered, true);
        assert.equal(mfaRes.inbox_delivery_confirmed, false, "Cloudflare REST delivered telemetry MUST NOT claim confirmed user inbox receipt");
        assert.equal(mockRest.calls.length, 1);

        // Idempotent replay does NOT call Cloudflare REST a second time!
        const mfaReplay = await sendLoginMfaCode(env, {
          to: "user1@thewyj.uk",
          userId: verifiedUser.id,
          code: "739201",
          idempotencyKey: "t27:mfa:req-001",
        });
        assert.equal(mfaReplay.idempotent_reused, true);
        assert.equal(mfaReplay.inbox_delivery_confirmed, false);
        assert.equal(mockRest.calls.length, 1);

        const dlvRow = await db.prepare("SELECT * FROM email_center_deliveries WHERE delivery_id = ?").bind(mfaRes.delivery_id).first();
        assert.equal(dlvRow.body_redacted, 1);
        assert.equal(dlvRow.body_preview.includes("739201"), false, "Raw OTP MUST NOT enter delivery preview log");
        assert.ok(dlvRow.body_preview.includes("[REDACTED_OTP_CODE]"));

        // Safe status query helper for Task27
        const statusInfo = await getEmailDeliveryStatus(db, { idempotencyKey: "t27:mfa:req-001" });
        assert.equal(statusInfo.delivery_status, "delivered");
        assert.equal(statusInfo.delivery_stage, "provider_reported_delivered");
        assert.equal(statusInfo.inbox_delivery_confirmed, false);

        // Login MFA rejected for unverified user!
        const unvMfa = await sendLoginMfaCode(env, {
          to: "user3@thewyj.uk",
          userId: unverifiedUser.id,
          code: "112233",
        });
        assert.equal(unvMfa.ok, false);
        assert.equal(unvMfa.error_code, "email_recipient_not_verified");

        // Call 2: Bind code queued -> inbox_delivery_confirmed MUST be false!
        const bindQueued = await sendVerificationCode(env, {
          to: "user3@thewyj.uk",
          userId: unverifiedUser.id,
          purpose: "bind",
          code: "884422",
        });
        assert.equal(bindQueued.ok, true);
        assert.equal(bindQueued.delivery_status, "queued");
        assert.equal(bindQueued.inbox_delivery_confirmed, false, "queued MUST NOT claim inbox delivery");

        // Call 3: Permanent bounce rejected
        const bounced = await sendTransactionalEmail(env, {
          to: "user2@thewyj.uk",
          userId: verifiedUser2.id,
          kind: "security_notice",
          detail: "Test permanent bounce",
        });
        assert.equal(bounced.ok, false);
        assert.equal(bounced.delivery_status, "rejected");

        // Call 4: Provider 429 retryable
        const rlErr = await sendLoginMfaCode(env, { to: OWNER_TEST_EMAIL, userId: superAdmin.id, code: "246810" });
        assert.equal(rlErr.ok, false);
        assert.equal(rlErr.error_code, "email_provider_rate_limited");
        assert.equal(rlErr.retryable, true);

        // Call 5: Provider 401 non-retryable auth error
        const authErr = await sendPasswordChangedNotice(env, { to: OWNER_TEST_EMAIL, userId: superAdmin.id, username: "super_owner" })
          .then(() => null, (e) => e);
        assert.equal(authErr?.code, "email_provider_auth_failed");
        assert.equal(authErr?.retryable, false);

        // Calls 6..10+: OTP D1 rate limiting kicks in after max 5 successful/queued OTPs in window
        const limitedEnv = makeEnv(db, { EMAIL_OTP_RATE_LIMIT_MAX: "2" });
        await sendEmailBindingCode(limitedEnv, { to: "external@example.org", code: "100001" });
        await sendEmailBindingCode(limitedEnv, { to: "external@example.org", code: "100002" });
        const blockedOtp = await sendEmailBindingCode(limitedEnv, { to: "external@example.org", code: "100003" });
        assert.equal(blockedOtp.ok, false);
        assert.equal(blockedOtp.error_code, "email_rate_limited");

        // Recovery OTP uses its own kind bucket ('verification_code') so bind/login MFA bursts do not block password reset
        const recoveryOtp = await sendVerificationCode(limitedEnv, {
          to: "external@example.org",
          code: "100004",
          purpose: "recovery",
          requireVerifiedEmail: false,
        });
        assert.equal(recoveryOtp.ok, true);
        const recoveryRow = await db
          .prepare("SELECT kind, trigger_source FROM email_center_deliveries WHERE delivery_id = ?")
          .bind(recoveryOtp.delivery_id)
          .first();
        assert.equal(recoveryRow?.kind, "verification_code");
        assert.equal(recoveryRow?.trigger_source, "task27_password_reset");

        // Workers Binding transport works too
        let bindingCalled = 0;
        const bindingEnv = makeEnv(db, {
          EMAIL: {
            async send(payload) {
              bindingCalled += 1;
              assert.equal(payload.from.email, "noreply@thewyj.uk");
              return { messageId: "<bind-ok@thewyj.uk>", delivered: [payload.to[0].email], queued: [] };
            },
          },
        });
        assert.equal(resolveEmailTransport(bindingEnv), "workers_binding");
        const bindRes = await sendMfaChangedNotice(bindingEnv, { to: "user1@thewyj.uk", userId: verifiedUser.id, detail: "TOTP enabled" });
        assert.equal(bindRes.transport, "workers_binding");
        assert.equal(bindingCalled, 1);
      } finally {
        mockRest.restore();
      }
    });

    await suite("4. Automatic non-blocking business emails in Task12, Task13 & Task27 Step-up APIs", async () => {
      // Case A: Mail disabled / provider network down MUST NOT break password change under Task27 Step-up contract!
      const failingMailEnv = makeEnv(db, { EMAIL_SENDING_ENABLED: "false" });

      // Missing step-up grant MUST be rejected (never bypass Task27 step-up)
      const pwWithoutStepup = await callApi(failingMailEnv, "/api/account/secret", {
        method: "POST",
        token: verifiedUser.token,
        body: {
          new_secret: "AliceNewSecret-2026!",
          confirm_secret: "AliceNewSecret-2026!",
        },
      });
      assert.ok([400, 403].includes(pwWithoutStepup.status), `Expected 400/403 without Task27 stepup, got ${pwWithoutStepup.status}`);

      const pwGrant = await issueStepup(failingMailEnv, verifiedUser.token, verifiedUser.password, "password_change");
      const pwRes = await callApi(failingMailEnv, "/api/account/secret", {
        method: "POST",
        token: verifiedUser.token,
        body: {
          grant: pwGrant,
          new_secret: "AliceNewSecret-2026!",
          confirm_secret: "AliceNewSecret-2026!",
        },
      });
      assert.equal(pwRes.status, 200, "Account password change MUST succeed even when mail is disabled");
      assert.equal(pwRes.data.session_invalidated, true);

      // Re-login verifiedUser with new password to get fresh session
      const loginOk = await callApi(failingMailEnv, "/api/login", {
        method: "POST",
        body: { username: verifiedUser.username, secret: "AliceNewSecret-2026!" },
      });
      assert.equal(loginOk.status, 200);
      verifiedUser.token = loginOk.data.session;
      verifiedUser.password = "AliceNewSecret-2026!";

      // Case B: Enable sending + mock REST, verify automatic security & billing emails fire and record under Task27 contracts
      const env = makeEnv(db);
      const mockRest = mockCloudflareRestFetch("queued");
      try {
        await callApi(env, "/api/account/logout-all", { method: "POST", token: verifiedUser.token });

        // Admin secret reset rejects caller-supplied secret and requires single-use admin_reset:<user_id> step-up grant
        const adminResetGrant = await issueStepup(env, superAdmin.token, superAdmin.password, `admin_reset:${verifiedUser.id}`);
        const adminResetRes = await callApi(env, "/api/admin/secret", {
          method: "POST",
          token: superAdmin.token,
          body: { user_id: verifiedUser.id, grant: adminResetGrant },
        });
        assert.equal(adminResetRes.status, 200);
        assert.equal(adminResetRes.data.display_once, true);
        const resetSecRow = await db.prepare("SELECT must_change_password FROM task27_security WHERE user_id = ?").bind(verifiedUser.id).first();
        assert.equal(Number(resetSecRow?.must_change_password), 1);
        assert.ok(String(adminResetRes.data.temporary_password || "").length >= 9);

        // Complete mandatory password change after temporary reset so verifiedUser keeps a valid session for later suites
        const tempLogin = await callApi(env, "/api/login", {
          method: "POST",
          body: { username: verifiedUser.username, secret: adminResetRes.data.temporary_password },
        });
        assert.equal(tempLogin.status, 200);
        assert.equal(tempLogin.data.password_change_required, true);
        assert.equal(tempLogin.data.session, undefined);
        assert.ok(tempLogin.data.password_change_token);
        const completeReset = await callApi(env, "/api/security/password/complete", {
          method: "POST",
          body: {
            challenge: tempLogin.data.password_change_token,
            new_secret: "AliceRecovered-2026!",
            confirm_secret: "AliceRecovered-2026!",
          },
        });
        assert.equal(completeReset.status, 200);
        verifiedUser.password = "AliceRecovered-2026!";
        const reLoginAfterReset = await callApi(env, "/api/login", {
          method: "POST",
          body: { username: verifiedUser.username, secret: verifiedUser.password },
        });
        assert.equal(reLoginAfterReset.status, 200);
        verifiedUser.token = reLoginAfterReset.data.session;

        const logoutGrant = await issueStepup(env, superAdmin.token, superAdmin.password, "admin_account");
        const logoutUserRes = await callApi(env, "/api/admin/logout-user", {
          method: "POST",
          token: superAdmin.token,
          headers: { "X-Aeris-Stepup": logoutGrant },
          body: { user_id: verifiedUser2.id },
        });
        assert.equal(logoutUserRes.status, 200);

        // Login rate-limit triggers automatic session_security_notice
        for (let i = 0; i < 9; i += 1) {
          await callApi(env, "/api/login", {
            method: "POST",
            ip: "198.51.100.77",
            body: { username: verifiedUser2.username, secret: "WrongPassword123!" },
          });
        }

        // Admin membership manage fires membership_change_notice under Task27 admin_entitlements step-up
        const entGrant = await issueStepup(env, superAdmin.token, superAdmin.password, "admin_entitlements");
        const memRes = await callApi(env, "/api/admin/membership/manage", {
          method: "POST",
          token: superAdmin.token,
          headers: { "X-Aeris-Stepup": entGrant },
          body: { user_id: verifiedUser.id, action: "grant", plan_code: "dual_language_monthly" },
        });
        assert.equal(memRes.status, 200);

        const autoRows = (
          await db
            .prepare("SELECT kind, subject FROM email_center_deliveries WHERE target_user_id IN (?, ?) AND status IN ('delivered', 'queued')")
            .bind(verifiedUser.id, verifiedUser2.id)
            .all()
        ).results || [];
        const autoKinds = autoRows.map((r) => r.kind);

        assert.ok(autoKinds.includes("account_security_notice"), `Expected Task27 security event notice, got ${JSON.stringify(autoKinds)}`);
        assert.ok(autoKinds.includes("session_security_notice"));
        assert.ok(autoKinds.includes("membership_change_notice"));
      } finally {
        mockRest.restore();
      }
    });

    await suite("5. Admin Console RBAC, preview/confirm integrity, all_verified high-risk guardrails & retry", async () => {
      const env = makeEnv(db);
      const mockRest = mockCloudflareRestFetch("delivered");
      try {
        // Anon (401) & active normal user (403) denied on all admin email endpoints
        const anonRes = await callApi(env, "/api/admin/email/overview");
        assert.equal(anonRes.status, 401);
        const userRes = await callApi(env, "/api/admin/email/overview", { token: unverifiedUser.token });
        assert.equal(userRes.status, 403);

        // Regular admin denied on super_admin endpoints & all_verified
        const adminTestGrant = await issueStepup(env, regularAdmin.token, regularAdmin.password, "email_center:test");
        const adminTestSend = await callApi(env, "/api/admin/email/test-send", {
          method: "POST",
          token: regularAdmin.token,
          headers: { "X-Aeris-Stepup": adminTestGrant },
          body: { recipient: OWNER_TEST_EMAIL },
        });
        assert.equal(adminTestSend.status, 403);

        const adminAllPreview = await callApi(env, "/api/admin/email/preview", {
          method: "POST",
          token: regularAdmin.token,
          body: { target_mode: "all_verified", subject: "All", body: "Notice" },
        });
        assert.equal(adminAllPreview.status, 403);

        // Raw external email list rejected cleanly
        const rawAttempt = await callApi(env, "/api/admin/email/preview", {
          method: "POST",
          token: regularAdmin.token,
          body: { target_mode: "multiple", recipient_emails: ["spam@evil.com"], subject: "Hi", body: "Body" },
        });
        assert.equal(rawAttempt.status, 400);
        assert.equal(rawAttempt.data.error?.code || rawAttempt.data.code, "email_raw_recipients_forbidden");

        // Regular admin multi-select deduplicates + excludes unverified/banned users cleanly
        const multiPreview = await callApi(env, "/api/admin/email/preview", {
          method: "POST",
          token: regularAdmin.token,
          body: {
            target_mode: "multiple",
            recipient_user_ids: [verifiedUser.id, verifiedUser.id, unverifiedUser.id, bannedUser.id, verifiedUser2.id],
            subject: "系统公告测试",
            body: "这是正式站内业务服务公告。",
          },
        });
        assert.equal(multiPreview.status, 200);
        assert.equal(multiPreview.data.effective_recipient_count, 2);
        assert.equal(multiPreview.data.excluded_count, 3);

        // Tampering body after preview fails!
        const tamperSendGrant = await issueStepup(env, regularAdmin.token, regularAdmin.password, "email_center:send");
        const tamperedSend = await callApi(env, "/api/admin/email/send", {
          method: "POST",
          token: regularAdmin.token,
          headers: { "X-Aeris-Stepup": tamperSendGrant },
          body: {
            preview_token: multiPreview.data.preview_token,
            confirmed: true,
            subject: "系统公告测试",
            body: "篡改后的内容",
          },
        });
        assert.equal(tamperedSend.status, 409);

        // Valid confirmed send succeeds once; replay blocked (409)!
        const validSendGrant = await issueStepup(env, regularAdmin.token, regularAdmin.password, "email_center:send");
        const validSend = await callApi(env, "/api/admin/email/send", {
          method: "POST",
          token: regularAdmin.token,
          headers: { "X-Aeris-Stepup": validSendGrant },
          body: {
            preview_token: multiPreview.data.preview_token,
            confirmed: true,
            subject: "系统公告测试",
            body: "这是正式站内业务服务公告。",
          },
        });
        assert.equal(validSend.status, 200);
        assert.equal(validSend.data.summary.delivered, 2);
        assert.equal(validSend.data.results[0].inbox_delivery_confirmed, false);
        assert.equal(validSend.data.results[0].delivery_stage, "provider_reported_delivered");

        const replaySendGrant = await issueStepup(env, regularAdmin.token, regularAdmin.password, "email_center:send");
        const replaySend = await callApi(env, "/api/admin/email/send", {
          method: "POST",
          token: regularAdmin.token,
          headers: { "X-Aeris-Stepup": replaySendGrant },
          body: { preview_token: multiPreview.data.preview_token, confirmed: true },
        });
        assert.equal(replaySend.status, 409);

        // Regular admin deliveries view CANNOT see superAdmin's OTP / security records or raw unmasked emails!
        const adminDlvs = await callApi(env, "/api/admin/email/deliveries", { token: regularAdmin.token });
        assert.equal(adminDlvs.status, 200);
        assert.equal(
          adminDlvs.data.deliveries.some((d) => ["verification_code", "login_mfa_code", "password_changed_notice"].includes(d.kind)),
          false,
          "Regular admin must NOT view user OTP or security password records"
        );
        assert.equal(adminDlvs.data.deliveries.every((d) => d.recipient_email === null), true);

        // Super admin all_verified requires phrase + password re-verification, and prevents unauthorized super_admin bypass
        const allPreview = await callApi(env, "/api/admin/email/preview", {
          method: "POST",
          token: superAdmin.token,
          body: {
            target_mode: "all_verified",
            subject: "重要系统维护通知",
            body: "将于本周日凌晨 02:00 进行例行数据库维护。",
          },
        });
        assert.equal(allPreview.status, 200);
        assert.equal(allPreview.data.high_risk_all_verified, true);

        const wrongPhraseGrant = await issueStepup(env, superAdmin.token, superAdmin.password, "email_center:send");
        const wrongPhrase = await callApi(env, "/api/admin/email/send", {
          method: "POST",
          token: superAdmin.token,
          headers: { "X-Aeris-Stepup": wrongPhraseGrant },
          body: {
            preview_token: allPreview.data.preview_token,
            confirmed: true,
            confirm_phrase: "WRONG",
            admin_password: superAdmin.password,
          },
        });
        assert.equal(wrongPhrase.status, 400);

        const wrongPassGrant = await issueStepup(env, superAdmin.token, superAdmin.password, "email_center:send");
        const wrongPass = await callApi(env, "/api/admin/email/send", {
          method: "POST",
          token: superAdmin.token,
          headers: { "X-Aeris-Stepup": wrongPassGrant },
          body: {
            preview_token: allPreview.data.preview_token,
            confirmed: true,
            confirm_phrase: "CONFIRM-ALL-VERIFIED",
            admin_password: "WrongAdminPassword!",
          },
        });
        assert.equal(wrongPass.status, 403);

        const okBulkGrant = await issueStepup(env, superAdmin.token, superAdmin.password, "email_center:send");
        const okBulk = await callApi(env, "/api/admin/email/send", {
          method: "POST",
          token: superAdmin.token,
          headers: { "X-Aeris-Stepup": okBulkGrant },
          body: {
            preview_token: allPreview.data.preview_token,
            confirmed: true,
            confirm_phrase: "CONFIRM-ALL-VERIFIED",
            admin_password: superAdmin.password,
          },
        });
        assert.equal(okBulk.status, 200);
        assert.equal(okBulk.data.summary.total, 3, "Only non-banned verified active users (super_owner, alice, bob)");

        // Cooldown blocks second immediate all_verified broadcast
        const allPreview2 = await callApi(env, "/api/admin/email/preview", {
          method: "POST",
          token: superAdmin.token,
          body: { target_mode: "all_verified", subject: "Duplicate bulk", body: "Again" },
        });
        const cooldownGrant = await issueStepup(env, superAdmin.token, superAdmin.password, "email_center:send");
        const cooldownRes = await callApi(env, "/api/admin/email/send", {
          method: "POST",
          token: superAdmin.token,
          headers: { "X-Aeris-Stepup": cooldownGrant },
          body: {
            preview_token: allPreview2.data.preview_token,
            confirmed: true,
            confirm_phrase: "CONFIRM-ALL-VERIFIED",
            admin_password: superAdmin.password,
          },
        });
        assert.equal(cooldownRes.status, 429);

        // Retry behavior: create a retryable failure via failed mock then retry cleanly once recovered
        mockRest.restore();
        const failThenRecover = mockCloudflareRestFetch((_, count) => (count === 1 ? { mode: "http_503" } : { mode: "delivered" }));
        try {
          const singlePrev = await callApi(env, "/api/admin/email/preview", {
            method: "POST",
            token: regularAdmin.token,
            body: { target_mode: "single", recipient_user_ids: [verifiedUser.id], subject: "Retryable Mail", body: "Check status" },
          });
          const failSendGrant = await issueStepup(env, regularAdmin.token, regularAdmin.password, "email_center:send");
          const failSend = await callApi(env, "/api/admin/email/send", {
            method: "POST",
            token: regularAdmin.token,
            headers: { "X-Aeris-Stepup": failSendGrant },
            body: { preview_token: singlePrev.data.preview_token, confirmed: true },
          });
          assert.equal(failSend.status, 502);
          const failedId = failSend.data.results[0].delivery_id;

          const retryGrant = await issueStepup(env, regularAdmin.token, regularAdmin.password, "email_center:retry");
          const retryRes = await callApi(env, "/api/admin/email/deliveries/retry", {
            method: "POST",
            token: regularAdmin.token,
            headers: { "X-Aeris-Stepup": retryGrant },
            body: { delivery_id: failedId },
          });
          assert.equal(retryRes.status, 200);
          assert.equal(retryRes.data.retry_result.delivery_status, "delivered");
          assert.equal(retryRes.data.retry_result.inbox_delivery_confirmed, false);
        } finally {
          failThenRecover.restore();
        }
      } finally {
        mockRest.restore();
      }
    });

    await suite("6. Inbound support@thewyj.uk Worker: Gmail forwarding preserved, fallback, XSS/loop/oversize defense & official reply", async () => {
      const mockRest = mockCloudflareRestFetch("delivered");
      const mockForwardTarget = "private-operator-stub.invalid";
      const env = makeEnv(db, {
        EMAIL_FORWARD_TO_ADDRESS: mockForwardTarget,
        EMAIL_INBOUND_AUTO_ACK_ENABLED: "true",
      });

      try {
        // 6a. Normal inbound message from verified user -> forwards to Gmail target, matches user_id, creates thread, sends rate-limited auto-ack
        const forwardedCalls = [];
        const rawCustomerMail = [
          "From: Alice <user1@thewyj.uk>",
          "To: support@thewyj.uk",
          "Subject: Billing Question #2026",
          "Message-ID: <cust-msg-1@example.net>",
          "Content-Type: text/plain; charset=utf-8",
          "",
          "Hello support team, my order needs manual check.",
        ].join("\r\n");

        const in1 = await handleInboundSupportEmail(
          {
            from: "user1@thewyj.uk",
            to: "support@thewyj.uk",
            rawSize: rawCustomerMail.length,
            raw: rawCustomerMail,
            headers: new Headers({
              from: "Alice <user1@thewyj.uk>",
              to: "support@thewyj.uk",
              subject: "Billing Question #2026",
              "message-id": "<cust-msg-1@example.net>",
            }),
            async forward(rcpt) {
              forwardedCalls.push(rcpt);
            },
          },
          env
        );
        assert.equal(in1.ok, true);
        assert.equal(in1.forward_status, "forwarded");
        assert.deepEqual(forwardedCalls, [mockForwardTarget]);
        assert.equal(in1.matched_user_id, verifiedUser.id);
        assert.equal(in1.security_status, "ok");
        assert.equal(in1.auto_ack_status, "sent");

        // Second email in same thread correlates to same thread_id and triggers 24h auto-ack cooldown
        const rawFollowup = [
          "From: user1@thewyj.uk",
          "To: support@thewyj.uk",
          "Subject: Re: Billing Question #2026",
          "Message-ID: <cust-msg-2@example.net>",
          "In-Reply-To: <cust-msg-1@example.net>",
          "",
          "Attaching follow-up details.",
        ].join("\r\n");

        const in2 = await handleInboundSupportEmail(
          {
            from: "user1@thewyj.uk",
            to: "support@thewyj.uk",
            rawSize: rawFollowup.length,
            raw: rawFollowup,
            headers: new Headers({
              from: "user1@thewyj.uk",
              to: "support@thewyj.uk",
              subject: "Re: Billing Question #2026",
              "message-id": "<cust-msg-2@example.net>",
              "in-reply-to": "<cust-msg-1@example.net>",
            }),
            async forward() {},
          },
          env
        );
        assert.equal(in2.thread_id, in1.thread_id, "Follow-up reply MUST map into same thread");
        assert.equal(in2.auto_ack_status, "cooldown_skipped");

        // 6b. Forward failure degrades safely to D1 without leaking forwarding address!
        const inFailFwd = await handleInboundSupportEmail(
          {
            from: "external@example.org",
            to: "support@thewyj.uk",
            rawSize: 120,
            raw: "From: external@example.org\r\nSubject: Cannot forward check\r\n\r\nUrgent support request",
            headers: new Headers({ from: "external@example.org", subject: "Cannot forward check" }),
            async forward() {
              throw new Error(`Temporary error forwarding to ${mockForwardTarget}`);
            },
          },
          env
        );
        assert.equal(inFailFwd.ok, true);
        assert.equal(inFailFwd.forward_status, "forward_failed");
        assert.equal(inFailFwd.forward_error.includes(mockForwardTarget), false, "Forward target MUST be redacted in D1 error");

        // 6c. Spam / XSS HTML payload gets quarantined & script stripped, zero auto-ack
        const xssRaw = [
          "From: attacker@example.org",
          "Subject: XSS Probe",
          "Content-Type: text/html; charset=utf-8",
          "",
          '<p>Click me</p><script>fetch("https://evil.test")</script><img src=x onerror="alert(1)">',
        ].join("\r\n");
        const inXss = await handleInboundSupportEmail(
          {
            from: "attacker@example.org",
            to: "support@thewyj.uk",
            rawSize: xssRaw.length,
            raw: xssRaw,
            headers: new Headers({ from: "attacker@example.org", subject: "XSS Probe" }),
            async forward() {},
          },
          env
        );
        assert.equal(inXss.security_status, "quarantined");
        assert.equal(inXss.auto_ack_status, "blocked_by_security_policy");

        // 6d. Auto-submitted / mailer-daemon loop prevention
        const inLoop = await handleInboundSupportEmail(
          {
            from: "mailer-daemon@example.net",
            to: "support@thewyj.uk",
            rawSize: 80,
            raw: "From: mailer-daemon@example.net\r\nAuto-Submitted: auto-replied\r\nSubject: Delivery Status\r\n\r\nBounced",
            headers: new Headers({
              from: "mailer-daemon@example.net",
              "auto-submitted": "auto-replied",
              subject: "Delivery Status",
            }),
            async forward() {
              throw new Error("Should not matter");
            },
          },
          env
        );
        assert.equal(inLoop.security_status, "auto_submitted");

        // 6e. Oversize rejected
        let rejectedReason = "";
        const inBig = await handleInboundSupportEmail(
          {
            from: "external@example.org",
            to: "support@thewyj.uk",
            rawSize: 12 * 1024 * 1024,
            setReject(reason) {
              rejectedReason = reason;
            },
          },
          env
        );
        assert.equal(inBig.security_status, "oversize_rejected");
        assert.ok(rejectedReason.length > 0);

        // 6f. Admin panel reply uses official domain (noreply + Reply-To when unauthorized, support@ when authorized!)
        const replyGrant1 = await issueStepup(env, regularAdmin.token, regularAdmin.password, "email_center:reply");
        const replyUnauthorized = await callApi(env, "/api/admin/email/inbound/reply", {
          method: "POST",
          token: regularAdmin.token,
          headers: { "X-Aeris-Stepup": replyGrant1 },
          body: {
            thread_id: in1.thread_id,
            from_mode: "support",
            body: "Attempt direct support sender before domain auth",
            confirmed: true,
          },
        });
        assert.equal(replyUnauthorized.status, 403);

        const replyGrant2 = await issueStepup(env, regularAdmin.token, regularAdmin.password, "email_center:reply");
        const replyAuto = await callApi(env, "/api/admin/email/inbound/reply", {
          method: "POST",
          token: regularAdmin.token,
          headers: { "X-Aeris-Stepup": replyGrant2 },
          body: {
            thread_id: in1.thread_id,
            from_mode: "auto",
            body: "We have verified your payment receipt and updated your account.",
            confirmed: true,
          },
        });
        assert.equal(replyAuto.status, 200);
        assert.equal(replyAuto.data.delivery.from, "noreply@thewyj.uk");
        assert.equal(replyAuto.data.delivery.reply_to, "support@thewyj.uk");

        const authEnv = makeEnv(db, { EMAIL_SUPPORT_SENDER_AUTHORIZED: "true" });
        const replyOfficial = await sendSupportReplyEmail(authEnv, {
          to: "user1@thewyj.uk",
          subject: "Billing Question #2026",
          body: "Confirmed from support@thewyj.uk.",
          threadId: in1.thread_id,
          inReplyTo: "<cust-msg-2@example.net>",
        });
        assert.equal(replyOfficial.from, "support@thewyj.uk");
        assert.equal(replyOfficial.reply_to, "support@thewyj.uk");

        // Thread detail shows timeline cleanly and replying to auto_submitted is blocked
        const threadDetail = await callApi(env, `/api/admin/email/inbound?thread_id=${encodeURIComponent(in1.thread_id)}`, {
          token: regularAdmin.token,
        });
        assert.equal(threadDetail.status, 200);
        assert.equal(threadDetail.data.thread.status, "replied");
        assert.equal(threadDetail.data.inbound_messages.length, 2);
        assert.ok(threadDetail.data.outbound_replies.length >= 1);

        const replyGrant3 = await issueStepup(env, regularAdmin.token, regularAdmin.password, "email_center:reply");
        const replyLoopBlocked = await callApi(env, "/api/admin/email/inbound/reply", {
          method: "POST",
          token: regularAdmin.token,
          headers: { "X-Aeris-Stepup": replyGrant3 },
          body: { thread_id: inLoop.thread_id, body: "Should not reply", confirmed: true },
        });
        assert.equal(replyLoopBlocked.status, 400);

        // 6e. Standalone worker wrapper (/health readiness without leaking secrets + email() delegation + safe wrangler flags)
        const healthRes = await supportInboundWorker.fetch(new Request("https://worker.internal/health"), env);
        assert.equal(healthRes.status, 200);
        assert.equal(healthRes.headers.get("Cache-Control"), "no-store");
        assert.equal(healthRes.headers.get("X-Content-Type-Options"), "nosniff");
        const healthBodyText = await healthRes.text();
        assert.equal(healthBodyText.includes(mockForwardTarget), false, "/health must NEVER leak EMAIL_FORWARD_TO_ADDRESS");
        assert.equal(healthBodyText.includes(String(env.EMAIL_SEND_API_TOKEN || "")), false, "/health must NEVER leak EMAIL_SEND_API_TOKEN");
        assert.equal(healthBodyText.includes(String(env.EMAIL_CLOUDFLARE_ACCOUNT_ID || "")), false, "/health must NEVER leak EMAIL_CLOUDFLARE_ACCOUNT_ID");
        const healthData = JSON.parse(healthBodyText);
        assert.equal(healthData.ok, true);
        assert.equal(healthData.service, "thewyj-support-inbound");
        assert.equal(healthData.readiness?.d1_bound, true);
        assert.equal(healthData.readiness?.forward_target_configured, true);
        assert.equal(healthData.readiness?.rest_api_configured, true);
        assert.equal(healthData.readiness?.email_sending_enabled, true);
        assert.equal(healthData.readiness?.auto_ack_enabled, true);

        const healthNotFound = await supportInboundWorker.fetch(new Request("https://worker.internal/other"), env);
        assert.equal(healthNotFound.status, 404);
        const notFoundJson = await healthNotFound.json();
        assert.equal(notFoundJson.ok, false);
        assert.equal(notFoundJson.error, "not_found");

        const entryFwd = [];
        const entryOut = await supportInboundWorker.email(
          {
            from: "user1@thewyj.uk",
            to: "support@thewyj.uk",
            rawSize: 96,
            raw: "From: user1@thewyj.uk\r\nTo: support@thewyj.uk\r\nSubject: Worker Entry Check\r\nMessage-ID: <entry-1@example.net>\r\n\r\nWorker entry delegation check.",
            headers: new Headers({
              from: "user1@thewyj.uk",
              to: "support@thewyj.uk",
              subject: "Worker Entry Check",
              "message-id": "<entry-1@example.net>",
            }),
            async forward(rcpt) {
              entryFwd.push(rcpt);
            },
          },
          env,
          {}
        );
        assert.equal(entryOut.ok, true);
        assert.equal(entryOut.forward_status, "forwarded");
        assert.deepEqual(entryFwd, [mockForwardTarget]);

        const workerCfg = JSON.parse(
          await readFile(path.resolve(process.cwd(), "wrangler.support-inbound.jsonc"), "utf8")
        );
        assert.equal(workerCfg.main, "cloudflare/email-worker/support-inbound-worker.mjs");
        assert.equal(workerCfg.vars?.EMAIL_SENDING_ENABLED, "false");
        assert.equal(workerCfg.vars?.EMAIL_INBOUND_AUTO_ACK_ENABLED, "false");
        assert.equal(workerCfg.env?.preview?.vars?.EMAIL_SENDING_ENABLED, "false");
        assert.equal(workerCfg.env?.production?.vars?.EMAIL_SENDING_ENABLED, "false");
      } finally {
        mockRest.restore();
      }
    });

    await suite("7. Codex Task 27 Security Center (0035 + 0036) & S0 compatibility", async () => {
      // 7a. Dual-signature EmailServiceError & text cleaners & emailBindingConfigured
      const codexErr = new EmailServiceError("邮件发送服务尚未启用", 503, "email_service_disabled", true, {
        delivery_status: "rejected",
      });
      assert.equal(codexErr.message, "邮件发送服务尚未启用");
      assert.equal(codexErr.status, 503);
      assert.equal(codexErr.code, "email_service_disabled");
      assert.equal(codexErr.retryable, true);
      assert.equal(codexErr.details?.delivery_status, "rejected");

      assert.equal(cleanSingleLineText("  安全中心提醒  ", "主题", 120), "安全中心提醒");
      assert.throws(() => cleanSingleLineText("bad\nline", "主题", 120), EmailServiceError);
      assert.equal(cleanBodyText("第一行\r\n第二行", "正文", 4000), "第一行\n第二行");

      assert.equal(emailBindingConfigured({}), false);
      assert.equal(emailNativeBindingConfigured({}), false);
      assert.equal(
        emailBindingConfigured({ EMAIL_CLOUDFLARE_ACCOUNT_ID: "acc_1", EMAIL_SEND_API_TOKEN: "tok_1" }),
        true
      );
      assert.equal(
        emailBindingConfigured({ EMAIL: { send: async () => ({ messageId: "m1" }) } }),
        true
      );

      // S0 buildCloudflareRestPayload compat + supressed/bounce coverage
      const restBuilt = buildCloudflareRestPayload({
        fromEmail: DEFAULT_FROM_EMAIL,
        toEmail: "user1@thewyj.uk",
        replyToEmail: DEFAULT_REPLY_TO_EMAIL,
        payload: { subject: "S0 测试", text: "正文", html: "<p>正文</p>" },
      });
      assert.equal(restBuilt.from.address, DEFAULT_FROM_EMAIL);
      assert.deepEqual(restBuilt.to, ["user1@thewyj.uk"]);
      assert.equal(restBuilt.reply_to.address, DEFAULT_REPLY_TO_EMAIL);
      assert.equal(restBuilt.subject, "S0 测试");

      // 7b. Apply Codex 0035 task27_security schema alongside 0036 and test grandfathering + sync
      await db.exec(
        "CREATE TABLE IF NOT EXISTS task27_security (" +
          "user_id TEXT PRIMARY KEY REFERENCES task12_users(id) ON DELETE CASCADE," +
          "verified_email TEXT NOT NULL DEFAULT '' COLLATE NOCASE," +
          "email_verified_at TEXT NOT NULL DEFAULT ''," +
          "mfa_method TEXT NOT NULL DEFAULT 'none'," +
          "password_age_start_at TEXT NOT NULL DEFAULT ''" +
        ");"
      );

      const legacyUser = await seedAccount(db, { id: "u_legacy_compat", username: "legacy_compat" });
      await db
        .prepare("INSERT INTO task27_security (user_id, verified_email, email_verified_at, mfa_method, password_age_start_at) VALUES (?, '', '', 'none', '2026-11-15T00:00:00Z')")
        .bind(legacyUser.id)
        .run();

      // Existing user with empty verified_email in task27_security stays unverified/grandfathered
      assert.equal(await resolveVerifiedUserEmail(db, legacyUser.id), null);

      const t27OnlyUser = await seedAccount(db, { id: "u_t27_only", username: "t27_verified_user" });
      await db
        .prepare("INSERT INTO task27_security (user_id, verified_email, email_verified_at, mfa_method, password_age_start_at) VALUES (?, ?, ?, 'email', ?)")
        .bind(t27OnlyUser.id, "t27user@thewyj.uk", "2026-11-15T01:00:00Z", "2026-11-15T00:00:00Z")
        .run();

      // Automatically recognized via resolveVerifiedUserEmail / getUserEmailBinding & /api/admin/email/recipients
      const bridged = await getUserEmailBinding(db, t27OnlyUser.id);
      assert.equal(bridged?.verified, true);
      assert.equal(bridged?.email, "t27user@thewyj.uk");
      assert.equal(bridged?.source, "task27_security");

      const recRes = await callApi(makeEnv(db), "/api/admin/email/recipients?q=t27_verified_user&verified=verified", {
        token: superAdmin.token,
      });
      assert.equal(recRes.status, 200);
      assert.equal(recRes.data.recipients.length, 1);
      assert.equal(recRes.data.recipients[0].user_id, t27OnlyUser.id);
      assert.equal(recRes.data.recipients[0].verified, true);
      assert.equal(recRes.data.recipients[0].email, "t27user@thewyj.uk");

      // Sync from email_center_bindings back into task27_security when verified=true
      await upsertUserEmailBinding(db, { userId: legacyUser.id, email: "t27legacy@thewyj.uk", verified: true, actorUserId: superAdmin.id });
      const syncedRow = await db.prepare("SELECT verified_email, email_verified_at FROM task27_security WHERE user_id = ? LIMIT 1").bind(legacyUser.id).first();
      assert.equal(syncedRow?.verified_email, "t27legacy@thewyj.uk");
      assert.ok(String(syncedRow?.email_verified_at || "").length > 0);

      // Inbound support email matches task27_security verified_email automatically
      const envT27 = makeEnv(db, {
        EMAIL: {
          send: async (msg) => ({ messageId: `bind_${msg.to[0].email}` }),
        },
        EMAIL_TRANSPORT: "binding",
        EMAIL_TEST_RECIPIENTS: "t27user@thewyj.uk,support@thewyj.uk",
      });
      const inboundFromT27 = await handleInboundSupportEmail(
        {
          from: "T27 User <t27user@thewyj.uk>",
          to: "support@thewyj.uk",
          raw: Buffer.from("From: t27user@thewyj.uk\r\nTo: support@thewyj.uk\r\nSubject: Task27 Sync Inquiry\r\nMessage-ID: <t27-in-1@example.net>\r\n\r\nPlease check my 2FA status."),
        },
        envT27
      );
      assert.equal(inboundFromT27.matched_user_id, t27OnlyUser.id);

      // 7c. Codex's exact transactional call forms (Chinese purpose + account_security_notice)
      const codexOtp = await sendTransactionalEmail(envT27, {
        kind: "verification_code",
        to: "t27user@thewyj.uk",
        code: "839201",
        purpose: "登录验证",
        userId: t27OnlyUser.id,
        idempotencyKey: "codex:compat:otp:1",
      });
      assert.equal(codexOtp.ok, true);
      assert.equal(codexOtp.kind, "verification_code");

      const codexNotice = await sendAccountSecurityNotice(envT27, {
        to: "t27user@thewyj.uk",
        eventSummary: "您已开启邮箱双重验证（2FA）。",
        occurredAt: "2026-11-15T02:00:00Z",
        userId: t27OnlyUser.id,
        idempotencyKey: "codex:compat:sec:1",
      });
      assert.equal(codexNotice.ok, true);
      assert.equal(codexNotice.kind, "account_security_notice");

      // 7d. Timestamp precedence (newer task27_security email overrides older email_center_bindings),
      // recipients `id` field compatibility, and Workers Binding error classification
      await db
        .prepare("UPDATE email_center_bindings SET verified_at = ?, updated_at = ? WHERE user_id = ?")
        .bind("2026-11-15T01:00:00.000Z", "2026-11-15T01:00:00.000Z", legacyUser.id)
        .run();
      await db
        .prepare("UPDATE task27_security SET verified_email = ?, email_verified_at = ? WHERE user_id = ?")
        .bind("t27newer@thewyj.uk", "2026-11-15T06:00:00.000Z", legacyUser.id)
        .run();
      const resolvedNewer = await resolveVerifiedUserEmail(db, legacyUser.id);
      assert.equal(resolvedNewer?.email, "t27newer@thewyj.uk");
      assert.equal(resolvedNewer?.source, "task27_security");

      const recNewer = await callApi(envT27, `/api/admin/email/recipients?q=${encodeURIComponent(legacyUser.username)}&verified=verified`, { token: superAdmin.token });
      assert.equal(recNewer.status, 200);
      assert.equal(recNewer.data.recipients[0].id, legacyUser.id);
      assert.equal(recNewer.data.recipients[0].email, "t27newer@thewyj.uk");

      const rateLimitBindingEnv = makeEnv(db, {
        EMAIL: {
          send: async () => {
            throw new Error("429 Too Many Requests: rate limit exceeded");
          },
        },
        EMAIL_TRANSPORT: "binding",
        EMAIL_TEST_RECIPIENTS: "t27user@thewyj.uk",
      });
      const bindingRateErr = await sendAccountSecurityNotice(rateLimitBindingEnv, {
        to: "t27user@thewyj.uk",
        userId: t27OnlyUser.id,
        eventSummary: "Rate limit classification check",
        idempotencyKey: "codex:compat:rl:1",
      }).then(() => null, (e) => e);
      assert.equal(bindingRateErr?.code, "email_provider_rate_limited");
      assert.equal(bindingRateErr?.status, 429);
      assert.equal(bindingRateErr?.retryable, true);
    });

    await suite("8. P0-1/P0-2/P0-3 regressions: atomic email binding, idempotency concurrency, unknown status & delivery stage semantics", async () => {
      // P0-1: Atomic dual-table write + explicit conflict rejection + version untouched on rollback + concurrent claim
      const bindOwner = await seedAccount(db, { id: "u_p01_owner", username: "p01_owner", role: "user" });
      const bindChallenger = await seedAccount(db, { id: "u_p01_chal", username: "p01_chal", role: "user" });
      const bindRace1 = await seedAccount(db, { id: "u_p01_r1", username: "p01_r1", role: "user" });
      const bindRace2 = await seedAccount(db, { id: "u_p01_r2", username: "p01_r2", role: "user" });

      await db.prepare("INSERT INTO task27_security (user_id, verified_email, email_verified_at, password_age_start_at, version) VALUES (?, 'p01-initial@thewyj.uk', '2026-11-15T00:00:00.000Z', '2026-11-15T00:00:00.000Z', 1)").bind(bindOwner.id).run();
      await db.prepare("INSERT INTO task27_security (user_id, verified_email, email_verified_at, password_age_start_at, version) VALUES (?, 'p01-chal@thewyj.uk', '2026-11-15T00:00:00.000Z', '2026-11-15T00:00:00.000Z', 3)").bind(bindChallenger.id).run();
      await upsertUserEmailBinding(db, { userId: bindChallenger.id, email: "p01-chal@thewyj.uk", verified: true, actorUserId: superAdmin.id });

      // Valid update bumps task27_security.version atomically across both tables
      await upsertUserEmailBinding(db, { userId: bindOwner.id, email: "p01-shared@thewyj.uk", verified: true, actorUserId: bindOwner.id });
      const ownerSec = await db.prepare("SELECT verified_email, version FROM task27_security WHERE user_id = ?").bind(bindOwner.id).first();
      const ownerBind = await db.prepare("SELECT email, verified FROM email_center_bindings WHERE user_id = ?").bind(bindOwner.id).first();
      assert.equal(ownerSec?.verified_email, "p01-shared@thewyj.uk");
      assert.equal(ownerSec?.version, 2);
      assert.equal(ownerBind?.email, "p01-shared@thewyj.uk");
      assert.equal(ownerBind?.verified, 1);

      // Unique conflict MUST reject explicitly AND leave email_center_bindings + task27_security + version untouched
      await assert.rejects(
        () => upsertUserEmailBinding(db, { userId: bindChallenger.id, email: "p01-shared@thewyj.uk", verified: true, actorUserId: superAdmin.id }),
        (err) => err?.code === "email_binding_conflict" && err?.status === 409
      );
      const chalSecAfter = await db.prepare("SELECT verified_email, version FROM task27_security WHERE user_id = ?").bind(bindChallenger.id).first();
      const chalBindAfter = await db.prepare("SELECT email, verified FROM email_center_bindings WHERE user_id = ?").bind(bindChallenger.id).first();
      assert.equal(chalSecAfter?.verified_email, "p01-chal@thewyj.uk");
      assert.equal(chalSecAfter?.version, 3, "Version must not drift on conflict rollback");
      assert.equal(chalBindAfter?.email, "p01-chal@thewyj.uk", "Center table must roll back atomically on unique conflict");

      // Concurrent binding race for the same email: at most one succeeds, the other fails cleanly with conflict
      const raceBindResults = await Promise.allSettled([
        upsertUserEmailBinding(db, { userId: bindRace1.id, email: "p01-race@thewyj.uk", verified: true, actorUserId: superAdmin.id }),
        upsertUserEmailBinding(db, { userId: bindRace2.id, email: "p01-race@thewyj.uk", verified: true, actorUserId: superAdmin.id }),
      ]);
      assert.equal(raceBindResults.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(raceBindResults.filter((r) => r.status === "rejected" && r.reason?.code === "email_binding_conflict").length, 1);

      // Admin binding endpoint remains hard-blocked when task27_security exists (even with direct bypass attempt)
      const adminBindBlock = await callApi(makeEnv(db), "/api/admin/email/user-binding", {
        method: "POST",
        token: superAdmin.token,
        body: { user_id: bindRace1.id, email: "bypass@thewyj.uk", verified: true },
      });
      assert.equal(adminBindBlock.status, 403);
      assert.equal(adminBindBlock.data?.code, "email_binding_security_center_required");

      // P0-2: Atomic idempotency claim prevents concurrent duplicate sends while distinct keys send independently
      let parallelProviderCalls = 0;
      let releaseBarrier;
      const barrier = new Promise((resolve) => {
        releaseBarrier = resolve;
      });
      let enteredSend;
      const sendStarted = new Promise((resolve) => {
        enteredSend = resolve;
      });
      const safetyTimer = setTimeout(() => {
        enteredSend?.();
        releaseBarrier?.();
      }, 5000);
      const concurrentEnv = makeEnv(db, {
        EMAIL_TEST_RECIPIENTS: "p01-shared@thewyj.uk",
        EMAIL: {
          async send(msg) {
            parallelProviderCalls += 1;
            enteredSend();
            await barrier;
            return { messageId: `conc-${parallelProviderCalls}`, delivered: [msg.to[0].email], queued: [] };
          },
        },
      });
      const concPromises = [1, 2, 3].map(() =>
        sendTransactionalEmail(concurrentEnv, {
          kind: "account_security_notice",
          to: "p01-shared@thewyj.uk",
          userId: bindOwner.id,
          requireVerifiedEmail: true,
          idempotencyKey: "p02:concurrent:same-key",
          eventSummary: "Concurrent idempotency protection check",
        }).then(
          (value) => ({ status: "fulfilled", value }),
          (reason) => ({ status: "rejected", reason })
        )
      );
      // Wait until the winning caller has atomically claimed status='sending' in D1 and entered provider send()
      await sendStarted;
      await new Promise((resolve) => setTimeout(resolve, 150));
      const inFlightRow = await db.prepare("SELECT status FROM email_center_deliveries WHERE idempotency_key = ?").bind("p02:concurrent:same-key").first();
      assert.equal(inFlightRow?.status, "sending");
      releaseBarrier();
      clearTimeout(safetyTimer);
      const concOutcomes = await Promise.all(concPromises);
      assert.equal(parallelProviderCalls, 1, "Provider MUST be invoked strictly once for concurrent identical idempotency key");
      assert.equal(concOutcomes.filter((x) => x.status === "fulfilled" && x.value?.delivery_status === "delivered").length, 1);
      assert.equal(concOutcomes.filter((x) => x.status === "rejected" && x.reason?.code === "email_idempotency_in_flight").length, 2);

      // Distinct idempotency keys still send independently!
      const distinctA = await sendTransactionalEmail(concurrentEnv, {
        kind: "account_security_notice",
        to: "p01-shared@thewyj.uk",
        userId: bindOwner.id,
        requireVerifiedEmail: true,
        idempotencyKey: "p02:distinct:key-a",
        eventSummary: "Distinct key A",
      });
      const distinctB = await sendTransactionalEmail(concurrentEnv, {
        kind: "account_security_notice",
        to: "p01-shared@thewyj.uk",
        userId: bindOwner.id,
        requireVerifiedEmail: true,
        idempotencyKey: "p02:distinct:key-b",
        eventSummary: "Distinct key B",
      });
      assert.equal(distinctA.delivery_status, "delivered");
      assert.equal(distinctB.delivery_status, "delivered");
      assert.notEqual(distinctA.delivery_id, distinctB.delivery_id);
      assert.equal(parallelProviderCalls, 3);

      // Ambiguous network timeout -> status='unknown', retryable=false, auto-replay blocked, admin manual retry blocked!
      let unknownProviderCalls = 0;
      const unknownEnv = makeEnv(db, {
        EMAIL_TEST_RECIPIENTS: "p01-shared@thewyj.uk",
        EMAIL: {
          async send() {
            unknownProviderCalls += 1;
            const err = new Error("socket hang up during transmit");
            err.name = "AbortError";
            throw err;
          },
        },
      });
      const unknownErr = await sendTransactionalEmail(unknownEnv, {
        kind: "admin_service_notice",
        to: "p01-shared@thewyj.uk",
        userId: bindOwner.id,
        actorUserId: superAdmin.id,
        actorRole: "super_admin",
        channel: "admin_manual",
        subject: "Timeout unknown probe",
        body: "Network aborted after POST",
        idempotencyKey: "p02:unknown:timeout-1",
      }).then(() => null, (e) => e);
      assert.equal(unknownErr?.code, "email_delivery_status_unknown");
      assert.equal(unknownErr?.retryable, false);
      assert.equal(unknownErr?.details?.delivery_status, "unknown");
      assert.equal(unknownErr?.details?.inbox_delivery_confirmed, false);
      assert.equal(unknownProviderCalls, 1);

      const unknownStatus = await getEmailDeliveryStatus(db, { idempotencyKey: "p02:unknown:timeout-1" });
      assert.equal(unknownStatus?.delivery_status, "unknown");
      assert.equal(unknownStatus?.delivery_stage, "outcome_unknown");
      assert.equal(unknownStatus?.retryable, false);
      assert.equal(unknownStatus?.inbox_delivery_confirmed, false);

      // Replaying same idempotencyKey after 'unknown' MUST NOT call provider again!
      const unknownReplayErr = await sendTransactionalEmail(unknownEnv, {
        kind: "admin_service_notice",
        to: "p01-shared@thewyj.uk",
        userId: bindOwner.id,
        actorUserId: superAdmin.id,
        subject: "Timeout unknown probe",
        body: "Network aborted after POST",
        idempotencyKey: "p02:unknown:timeout-1",
      }).then(() => null, (e) => e);
      assert.equal(unknownReplayErr?.code, "email_delivery_status_unknown");
      assert.equal(unknownProviderCalls, 1, "Unknown delivery outcome MUST NEVER be auto-retried");

      // Admin retry endpoint MUST reject status='unknown'
      const unknownRetryGrant = await issueStepup(unknownEnv, superAdmin.token, superAdmin.password, "email_center:retry");
      const unknownRetryRes = await callApi(unknownEnv, "/api/admin/email/deliveries/retry", {
        method: "POST",
        token: superAdmin.token,
        headers: { "X-Aeris-Stepup": unknownRetryGrant },
        body: { delivery_id: unknownStatus.delivery_id },
      });
      assert.equal(unknownRetryRes.status, 409);

      // P0-3: Verify /api/admin/email/deliveries exposes distinct stages and NEVER sets inbox_delivery_confirmed=true
      const deliveriesList = await callApi(makeEnv(db), "/api/admin/email/deliveries?limit=20", { token: superAdmin.token });
      assert.equal(deliveriesList.status, 200);
      assert.equal(
        deliveriesList.data.deliveries.some((d) => d.inbox_delivery_confirmed === true),
        false,
        "No delivery record may assert inbox_delivery_confirmed=true without real inbox receipt proof"
      );
      const deliveredItem = deliveriesList.data.deliveries.find((d) => d.delivery_status === "delivered");
      assert.ok(deliveredItem);
      assert.equal(deliveredItem.delivery_stage, "provider_reported_delivered");
      assert.equal(deliveredItem.provider_reported_delivered, true);
      assert.equal(deliveredItem.inbox_delivery_confirmed, false);
    });

    await suite("9. BUG-09 regressions: template newline hygiene, category isolation, placeholder validation & unified preview/send", async () => {
      // 9a. 0037 cleaned seeded system templates without overwriting custom non-system templates
      const sysSupportTpl = await db
        .prepare("SELECT subject_template, body_template, category, updated_by FROM email_center_templates WHERE template_key = 'support_reply'")
        .first();
      assert.equal(sysSupportTpl?.category, "support_reply");
      assert.equal(sysSupportTpl?.updated_by, "system");
      assert.equal(sysSupportTpl.body_template.includes("\\n"), false, "0037 must replace literal \\n escapes in seeded system templates");
      assert.equal(sysSupportTpl.body_template.includes("\n"), true);

      const sysMaintTpl = await db
        .prepare("SELECT subject_template, body_template, category FROM email_center_templates WHERE template_key = 'system_maintenance_notice'")
        .first();
      assert.equal(sysMaintTpl?.category, "admin_service");
      assert.equal(sysMaintTpl.body_template.includes("\\n"), false);
      assert.equal(sysMaintTpl.body_template.includes("\n"), true);

      const tsCustom = new Date().toISOString();
      await db
        .prepare(
          `INSERT INTO email_center_templates (
            template_id, template_key, title, category, subject_template, body_template,
            is_system, enabled, updated_by, created_at, updated_at
          ) VALUES ('tpl_custom_preserve', 'custom_preserve_check', 'Custom Preserve', 'admin_service', 'Custom Subject', 'Keep custom \\n escape', 0, 1, 'custom_owner', ?, ?)`
        )
        .bind(tsCustom, tsCustom)
        .run();
      const migration0037Sql = await readFile(path.join(REPO_ROOT, "cloudflare", "migrations", "0037_task27_email_template_newlines.sql"), "utf8");
      await db.exec(migration0037Sql.replace(/\r?\n/g, " "));
      const customAfter = await db
        .prepare("SELECT body_template FROM email_center_templates WHERE template_key = 'custom_preserve_check'")
        .first();
      assert.equal(customAfter?.body_template, "Keep custom \\n escape", "0037 must NEVER overwrite custom user-edited templates");

      // 9b. Block support-only template & placeholders in general /preview and /send
      const previewSupportBlock = await callApi(makeEnv(db), "/api/admin/email/preview", {
        method: "POST",
        token: superAdmin.token,
        body: {
          template_key: "support_reply",
          target_mode: "single",
          recipient_user_ids: ["u_p01_owner"],
          subject: "Re: {{subject}}",
          body: "联系 {{support_email}} 会话 {{thread_id}} 正文 {{body}}",
        },
      });
      assert.equal(previewSupportBlock.status, 400);
      assert.equal(previewSupportBlock.data?.code, "email_support_template_context_required");

      const previewSupportVarBlock = await callApi(makeEnv(db), "/api/admin/email/preview", {
        method: "POST",
        token: superAdmin.token,
        body: {
          target_mode: "single",
          recipient_user_ids: ["u_p01_owner"],
          subject: "Re: Test",
          body: "未经会话上下文的 {{thread_id}}",
        },
      });
      assert.equal(previewSupportVarBlock.status, 400);
      assert.equal(previewSupportVarBlock.data?.code, "email_support_template_context_required");

      // 9c. Reject unresolved {{...}} placeholders in general /preview and in renderTransactionalEmail defense-in-depth
      const unresolvedPreview = await callApi(makeEnv(db), "/api/admin/email/preview", {
        method: "POST",
        token: superAdmin.token,
        body: {
          template_key: "system_maintenance_notice",
          target_mode: "single",
          recipient_user_ids: ["u_p01_owner"],
          subject: sysMaintTpl.subject_template,
          body: sysMaintTpl.body_template,
        },
      });
      assert.equal(unresolvedPreview.status, 400);
      assert.equal(unresolvedPreview.data?.code, "email_unresolved_template_variables");
      assert.ok(unresolvedPreview.data?.details?.unresolved_variables?.includes("body"));

      assert.throws(
        () =>
          renderTransactionalEmail({
            kind: "admin_service_notice",
            subject: "Notice {{missing_var}}",
            body: "Hello {{body}}",
          }),
        (err) => err instanceof EmailServiceError && err.code === "email_unresolved_template_variables"
      );

      // 9d. Valid template interpolation, XSS HTML escaping, newline rendering & preview-to-send parity
      const capturedEmails = [];
      const renderEnv = makeEnv(db, {
        EMAIL_TRANSPORT: "binding",
        EMAIL_TEST_RECIPIENTS: "p01-shared@thewyj.uk",
        EMAIL: {
          async send(msg) {
            capturedEmails.push(msg);
            return { messageId: `bug09-${capturedEmails.length}`, delivered: [msg.to[0].email], queued: [] };
          },
        },
      });

      const validPreview = await callApi(renderEnv, "/api/admin/email/preview", {
        method: "POST",
        token: superAdmin.token,
        body: {
          template_key: "system_maintenance_notice",
          target_mode: "single",
          recipient_user_ids: ["u_p01_owner"],
          subject: sysMaintTpl.subject_template,
          body: sysMaintTpl.body_template,
          variables: {
            body: "维护时间：今晚 23:00\\n影响模块：<script>alert(1)</script>",
          },
        },
      });
      assert.equal(validPreview.status, 200);
      assert.equal(/\{\{[^}]+\}\}/.test(validPreview.data.subject), false);
      assert.equal(/\{\{[^}]+\}\}/.test(validPreview.data.body), false);
      assert.equal(validPreview.data.body.includes("\\n"), false);
      assert.equal(validPreview.data.body.includes("support@thewyj.uk"), true);
      assert.equal(validPreview.data.html_preview.includes("<script>"), false);
      assert.equal(validPreview.data.html_preview.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), true);
      assert.equal(validPreview.data.text_preview.includes("\\n"), false);

      const sendStepup = await issueStepup(renderEnv, superAdmin.token, superAdmin.password, "email_center:send");
      const validSend = await callApi(renderEnv, "/api/admin/email/send", {
        method: "POST",
        token: superAdmin.token,
        headers: { "X-Aeris-Stepup": sendStepup },
        body: {
          preview_token: validPreview.data.preview_token,
          template_key: "system_maintenance_notice",
          confirmed: true,
          subject: validPreview.data.subject,
          body: validPreview.data.body,
        },
      });
      assert.equal(validSend.status, 200);
      assert.equal(capturedEmails.length, 1);
      assert.equal(/\{\{[^}]+\}\}/.test(capturedEmails[0].html), false);
      assert.equal(/\{\{[^}]+\}\}/.test(capturedEmails[0].text), false);
      assert.equal(capturedEmails[0].text.includes("\\n"), false);
      assert.equal(capturedEmails[0].html.includes("<script>"), false);
      assert.equal(capturedEmails[0].html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), true);
      assert.equal(capturedEmails[0].text, validPreview.data.text_preview);
    });

    await suite("10. BUG-10 & BUG-11 regressions: Pages vs Worker overview status, nested multipart MIME & external unregistered threading", async () => {
      // 10a. Before inbound emails arrive and without Worker env EMAIL_FORWARD_TO_ADDRESS on Pages, overview MUST report 'unverified', NOT false/待配置
      const cleanInboundDb = await mf.getD1Database("WYJ_DB");
      assert.equal(cleanInboundDb, db);
      const ovEnvBefore = makeEnv(db, {
        EMAIL_FORWARD_TO_ADDRESS: undefined,
      });
      const ovBefore = await callApi(ovEnvBefore, "/api/admin/email/overview", { token: superAdmin.token });
      assert.equal(ovBefore.status, 200);
      // Clear pre-existing synthetic inbound records check: inspect exact state fields based on current DB telemetry
      assert.equal("inbound_forwarding_state" in ovBefore.data.status, true);
      assert.equal("inbound_routing_state" in ovBefore.data.status, true);
      assert.equal("inbound_forwarding_summary" in ovBefore.data.status, true);

      // Simulate isolated Pages env with empty inbound tables to guarantee exact unverified semantics
      const forwardedTargets = [];
      const nestedMixedRaw = [
        'From: "External Customer" <unregistered-guest@example.org>',
        "To: support@thewyj.uk",
        "Subject: Nested MIME Help Needed",
        "Message-ID: <nested-mime-001@example.org>",
        'Content-Type: multipart/mixed; boundary="outer_b"',
        "",
        "--outer_b",
        'Content-Type: multipart/alternative; boundary="inner_b"',
        "",
        "--inner_b",
        'Content-Type: text/plain; charset="utf-8"',
        "",
        "First line from unregistered external user.",
        "Second paragraph in nested multipart/mixed.",
        "--inner_b",
        'Content-Type: text/html; charset="utf-8"',
        "",
        "<p>First line from unregistered external user.</p><script>alert(1)</script>",
        "--inner_b--",
        "--outer_b",
        'Content-Type: application/octet-stream; name="report.pdf"',
        'Content-Disposition: attachment; filename="report.pdf"',
        "",
        "JVBERi0xLjQK",
        "--outer_b--",
      ].join("\r\n");

      const inboundWorkerEnv = makeEnv(db, {
        EMAIL_FORWARD_TO_ADDRESS: "private-qa-forward.invalid",
      });
      await supportInboundWorker.email(
        {
          from: "unregistered-guest@example.org",
          to: "support@thewyj.uk",
          rawSize: Buffer.byteLength(nestedMixedRaw, "utf8"),
          raw: nestedMixedRaw,
          headers: new Headers({
            from: '"External Customer" <unregistered-guest@example.org>',
            subject: "Nested MIME Help Needed",
            "message-id": "<nested-mime-001@example.org>",
          }),
          async forward(target) {
            forwardedTargets.push(target);
          },
        },
        inboundWorkerEnv
      );
      assert.deepEqual(forwardedTargets, ["private-qa-forward.invalid"]);

      const ovAfter = await callApi(ovEnvBefore, "/api/admin/email/overview", { token: superAdmin.token });
      assert.equal(ovAfter.status, 200);
      assert.equal(ovAfter.data.status.inbound_worker_state, "verified_via_db");
      assert.equal(ovAfter.data.status.inbound_routing_state, "verified_via_db");
      assert.equal(ovAfter.data.status.inbound_forwarding_state, "observed_forwarded");
      assert.equal(ovAfter.data.status.inbound_forwarding_configured, true);
      assert.match(ovAfter.data.status.inbound_forwarding_summary, /^已验证（已转发 \d+ 封）$/);

      // Verify clean DB with 0 inbound messages reports 'unverified' (NEVER 'false' / '待配置')
      const mfZero = new Miniflare({
        modules: true,
        script: "export default { async fetch() { return new Response('ok'); } }",
        d1Databases: { WYJ_DB: "wyj-zero-inbound-test" },
      });
      try {
        const zeroDb = await mfZero.getD1Database("WYJ_DB");
        await applyAllMigrations(zeroDb);
        const zeroAdmin = await seedAccount(zeroDb, { id: "u_zero_sa", username: "zero_sa", role: "super_admin", password: "ZeroSuperPass-2026!" });
        const zeroOv = await callApi(makeEnv(zeroDb, { EMAIL_FORWARD_TO_ADDRESS: undefined }), "/api/admin/email/overview", { token: zeroAdmin.token });
        assert.equal(zeroOv.status, 200);
        assert.equal(zeroOv.data.status.inbound_worker_state, "unverified");
        assert.equal(zeroOv.data.status.inbound_routing_state, "unverified");
        assert.equal(zeroOv.data.status.inbound_forwarding_state, "unverified");
        assert.equal(zeroOv.data.status.inbound_forwarding_configured, null);
        assert.equal(zeroOv.data.status.inbound_forwarding_summary, "未验证（独立 Worker 托管）");
      } finally {
        await mfZero.dispose().catch(() => {});
      }

      const threadRow = await db
        .prepare("SELECT * FROM email_center_inbound_threads WHERE sender_email = 'unregistered-guest@example.org' ORDER BY created_at DESC LIMIT 1")
        .first();
      assert.ok(threadRow, "Unregistered external sender MUST still create inbound support thread");
      assert.equal(threadRow.matched_user_id, null);

      const inboundDetail = await callApi(
        ovEnvBefore,
        `/api/admin/email/inbound?thread_id=${encodeURIComponent(threadRow.thread_id)}`,
        { token: superAdmin.token }
      );
      assert.equal(inboundDetail.status, 200);
      assert.equal(inboundDetail.data.inbound_messages[0].text_excerpt.includes("Second paragraph in nested multipart/mixed."), true);
      assert.equal(inboundDetail.data.inbound_messages[0].sanitize_flags.includes("attachment_stripped"), true);
      assert.equal(inboundDetail.data.inbound_messages[0].sanitize_flags.includes("active_html_stripped"), true);

      // 10b. Admin reply using support_reply resolves thread_id, support_email & sets In-Reply-To
      const replyCaptures = [];
      const replyEnv = makeEnv(db, {
        EMAIL_TRANSPORT: "binding",
        EMAIL_TEST_RECIPIENTS: "unregistered-guest@example.org",
        EMAIL: {
          async send(msg) {
            replyCaptures.push(msg);
            return { messageId: "outbound-reply-id-999", delivered: [msg.to[0].email], queued: [] };
          },
        },
      });
      const replyGrant = await issueStepup(replyEnv, superAdmin.token, superAdmin.password, "email_center:reply");
      const replyRes = await callApi(replyEnv, "/api/admin/email/inbound/reply", {
        method: "POST",
        token: superAdmin.token,
        headers: { "X-Aeris-Stepup": replyGrant },
        body: {
          thread_id: threadRow.thread_id,
          template_key: "support_reply",
          body: "We verified your nested attachment report and resolved the issue.",
          confirmed: true,
        },
      });
      assert.equal(replyRes.status, 200);
      assert.equal(replyCaptures.length, 1);
      assert.equal(/\{\{[^}]+\}\}/.test(replyCaptures[0].text), false);
      assert.equal(replyCaptures[0].text.includes(threadRow.thread_id), true);
      assert.equal(replyCaptures[0].text.includes("support@thewyj.uk"), true);
      assert.equal(replyCaptures[0].headers["In-Reply-To"], "<nested-mime-001@example.org>");

      // 10c. Subsequent reply matching bare provider_message_id (with angle brackets added by mail client) attaches to SAME thread!
      const followUpRaw = [
        "From: unregistered-guest@example.org",
        "To: support@thewyj.uk",
        "Subject: Re: Completely Different Followup Subject",
        "Message-ID: <followup-002@example.org>",
        "In-Reply-To: <outbound-reply-id-999>",
        "",
        "Thank you, follow-up verified!",
      ].join("\r\n");

      await supportInboundWorker.email(
        {
          from: "unregistered-guest@example.org",
          to: "support@thewyj.uk",
          rawSize: Buffer.byteLength(followUpRaw, "utf8"),
          raw: followUpRaw,
          headers: new Headers({
            from: "unregistered-guest@example.org",
            subject: "Re: Completely Different Followup Subject",
            "message-id": "<followup-002@example.org>",
            "in-reply-to": "<outbound-reply-id-999>",
          }),
          async forward() {},
        },
        inboundWorkerEnv
      );

      const followMsgs = (
        await db
          .prepare("SELECT rfc_message_id FROM email_center_inbound_messages WHERE thread_id = ? ORDER BY received_at ASC")
          .bind(threadRow.thread_id)
          .all()
      ).results;
      assert.equal(followMsgs.length, 2, "Follow-up referencing <outbound-reply-id-999> must attach to existing thread");
      assert.equal(followMsgs[1].rfc_message_id, "<followup-002@example.org>");
    });

    process.stdout.write(`Cloudflare Email Center tests passed: ${passedSuites} suites\n`);
  } finally {
    await mf.dispose();
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

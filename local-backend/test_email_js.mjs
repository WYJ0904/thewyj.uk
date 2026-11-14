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
  cleanEmailAddress,
  DEFAULT_FROM_EMAIL,
  DEFAULT_REPLY_TO_EMAIL,
  EMAIL_BUILD,
  EmailServiceError,
  escapeHtml,
  getEmailDeliveryStatus,
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
    assert.match(wranglerText, /"production"\s*:\s*\{[\s\S]*"EMAIL_SENDING_ENABLED"\s*:\s*"false"/);

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
        assert.equal(mfaRes.inbox_delivery_confirmed, true);
        assert.equal(mockRest.calls.length, 1);

        // Idempotent replay does NOT call Cloudflare REST a second time!
        const mfaReplay = await sendLoginMfaCode(env, {
          to: "user1@thewyj.uk",
          userId: verifiedUser.id,
          code: "739201",
          idempotencyKey: "t27:mfa:req-001",
        });
        assert.equal(mfaReplay.idempotent_reused, true);
        assert.equal(mockRest.calls.length, 1);

        const dlvRow = await db.prepare("SELECT * FROM email_center_deliveries WHERE delivery_id = ?").bind(mfaRes.delivery_id).first();
        assert.equal(dlvRow.body_redacted, 1);
        assert.equal(dlvRow.body_preview.includes("739201"), false, "Raw OTP MUST NOT enter delivery preview log");
        assert.ok(dlvRow.body_preview.includes("[REDACTED_OTP_CODE]"));

        // Safe status query helper for Task27
        const statusInfo = await getEmailDeliveryStatus(db, { idempotencyKey: "t27:mfa:req-001" });
        assert.equal(statusInfo.delivery_status, "delivered");
        assert.equal(statusInfo.inbox_delivery_confirmed, true);

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

    await suite("4. Automatic non-blocking business emails in Task12 & Task13 APIs", async () => {
      // Case A: Mail disabled / provider network down MUST NOT break password change!
      const failingMailEnv = makeEnv(db, { EMAIL_SENDING_ENABLED: "false" });
      const pwRes = await callApi(failingMailEnv, "/api/account/secret", {
        method: "POST",
        token: verifiedUser.token,
        body: {
          current_secret: verifiedUser.password,
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

      // Case B: Enable sending + mock REST, verify automatic security & billing emails fire and record
      const env = makeEnv(db);
      const mockRest = mockCloudflareRestFetch("queued");
      try {
        await callApi(env, "/api/account/logout-all", { method: "POST", token: verifiedUser.token });
        await callApi(env, "/api/admin/secret", {
          method: "POST",
          token: superAdmin.token,
          body: { user_id: verifiedUser.id, secret: "AliceAdminReset-2026!" },
        });
        await callApi(env, "/api/admin/logout-user", {
          method: "POST",
          token: superAdmin.token,
          body: { user_id: verifiedUser2.id },
        });

        // Login rate-limit triggers automatic session_security_notice
        for (let i = 0; i < 9; i += 1) {
          await callApi(env, "/api/login", {
            method: "POST",
            ip: "198.51.100.77",
            body: { username: verifiedUser2.username, secret: "WrongPassword123!" },
          });
        }

        // Admin membership manage fires membership_change_notice
        const memRes = await callApi(env, "/api/admin/membership/manage", {
          method: "POST",
          token: superAdmin.token,
          body: { user_id: verifiedUser.id, action: "grant", plan_code: "dual_language_monthly" },
        });
        assert.equal(memRes.status, 200);

        const autoKinds = (
          await db
            .prepare("SELECT DISTINCT kind FROM email_center_deliveries WHERE target_user_id IN (?, ?)")
            .bind(verifiedUser.id, verifiedUser2.id)
            .all()
        ).results.map((r) => r.kind);

        assert.ok(autoKinds.includes("password_changed_notice"));
        assert.ok(autoKinds.includes("password_reset_notice"));
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
        const adminTestSend = await callApi(env, "/api/admin/email/test-send", {
          method: "POST",
          token: regularAdmin.token,
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
        const tamperedSend = await callApi(env, "/api/admin/email/send", {
          method: "POST",
          token: regularAdmin.token,
          body: {
            preview_token: multiPreview.data.preview_token,
            confirmed: true,
            subject: "系统公告测试",
            body: "篡改后的内容",
          },
        });
        assert.equal(tamperedSend.status, 409);

        // Valid confirmed send succeeds once; replay blocked (409)!
        const validSend = await callApi(env, "/api/admin/email/send", {
          method: "POST",
          token: regularAdmin.token,
          body: {
            preview_token: multiPreview.data.preview_token,
            confirmed: true,
            subject: "系统公告测试",
            body: "这是正式站内业务服务公告。",
          },
        });
        assert.equal(validSend.status, 200);
        assert.equal(validSend.data.summary.delivered, 2);

        const replaySend = await callApi(env, "/api/admin/email/send", {
          method: "POST",
          token: regularAdmin.token,
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

        const wrongPhrase = await callApi(env, "/api/admin/email/send", {
          method: "POST",
          token: superAdmin.token,
          body: {
            preview_token: allPreview.data.preview_token,
            confirmed: true,
            confirm_phrase: "WRONG",
            admin_password: superAdmin.password,
          },
        });
        assert.equal(wrongPhrase.status, 400);

        const wrongPass = await callApi(env, "/api/admin/email/send", {
          method: "POST",
          token: superAdmin.token,
          body: {
            preview_token: allPreview.data.preview_token,
            confirmed: true,
            confirm_phrase: "CONFIRM-ALL-VERIFIED",
            admin_password: "WrongAdminPassword!",
          },
        });
        assert.equal(wrongPass.status, 403);

        const okBulk = await callApi(env, "/api/admin/email/send", {
          method: "POST",
          token: superAdmin.token,
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
        const cooldownRes = await callApi(env, "/api/admin/email/send", {
          method: "POST",
          token: superAdmin.token,
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
          const failSend = await callApi(env, "/api/admin/email/send", {
            method: "POST",
            token: regularAdmin.token,
            body: { preview_token: singlePrev.data.preview_token, confirmed: true },
          });
          assert.equal(failSend.status, 502);
          const failedId = failSend.data.results[0].delivery_id;

          const retryRes = await callApi(env, "/api/admin/email/deliveries/retry", {
            method: "POST",
            token: regularAdmin.token,
            body: { delivery_id: failedId },
          });
          assert.equal(retryRes.status, 200);
          assert.equal(retryRes.data.retry_result.delivery_status, "delivered");
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
        const replyUnauthorized = await callApi(env, "/api/admin/email/inbound/reply", {
          method: "POST",
          token: regularAdmin.token,
          body: {
            thread_id: in1.thread_id,
            from_mode: "support",
            body: "Attempt direct support sender before domain auth",
            confirmed: true,
          },
        });
        assert.equal(replyUnauthorized.status, 403);

        const replyAuto = await callApi(env, "/api/admin/email/inbound/reply", {
          method: "POST",
          token: regularAdmin.token,
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

        const replyLoopBlocked = await callApi(env, "/api/admin/email/inbound/reply", {
          method: "POST",
          token: regularAdmin.token,
          body: { thread_id: inLoop.thread_id, body: "Should not reply", confirmed: true },
        });
        assert.equal(replyLoopBlocked.status, 400);
      } finally {
        mockRest.restore();
      }
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

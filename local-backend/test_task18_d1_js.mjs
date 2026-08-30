import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { onRequest as dispatchApi } from "../functions/api/[[path]].js";
import { handleTask12Request } from "../functions/_lib/task12-api.mjs";
import { sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";
import { handleTask18Request } from "../functions/_lib/task18-api.mjs";
import { isAdmin as isClientAdmin, isSuperAdmin as isClientOwner } from "../js/membership/account.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENVIRONMENT = Object.freeze({
  CLOUD_FOUNDATION_ENABLED: "true",
  TASK11_CLOUD_READS_ENABLED: "true",
  TASK11_CLOUD_WRITES_ENABLED: "true",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK13_CLOUD_READS_ENABLED: "true",
  TASK13_CLOUD_WRITES_ENABLED: "true",
  TASK13_PAYMENT_PRIMARY_ENABLED: "true",
  TASK14_CLOUD_READS_ENABLED: "true",
  TASK14_CLOUD_WRITES_ENABLED: "true",
  TASK15_CLOUD_PRIMARY_ENABLED: "true",
  TASK16_CLOUD_READS_ENABLED: "true",
  TASK16_CLOUD_WRITES_ENABLED: "true",
  TASK18_ADMIN_MESSAGES_ENABLED: "true",
  D1_RATE_LIMIT_ENABLED: "false",
  LEGACY_API_FALLBACK_ENABLED: "false",
  WYJ_ENVIRONMENT: "preview",
});

const USERS = Object.freeze({
  owner: { id: "task18-owner", username: "task18-owner", role: "super_admin", token: "task18-owner-token" },
  adminOne: { id: "task18-admin-one", username: "task18-admin-one", role: "user", token: "task18-admin-one-token" },
  adminTwo: { id: "task18-admin-two", username: "task18-admin-two", role: "user", token: "task18-admin-two-token" },
  one: { id: "task18-user-one", username: "task18-user-one", role: "user", token: "task18-user-one-token" },
  two: { id: "task18-user-two", username: "task18-user-two", role: "user", token: "task18-user-two-token" },
  three: { id: "task18-user-three", username: "task18-user-three", role: "user", token: "task18-user-three-token" },
  managed: { id: "task18-managed", username: "task18-managed", role: "user", token: "task18-managed-token" },
});

async function insertAccountAndSession(db, user) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  await db.prepare(`INSERT INTO task12_users (
    id, username, username_normalized, password_hash, password_scheme,
    password_iterations, role, registered_at, created_at, updated_at, source_updated_at
  ) VALUES (?1, ?2, ?3, '', 'reset_required', 0, ?4, ?5, ?5, ?5, ?5)`)
    .bind(user.id, user.username, user.username.toLowerCase(), user.role, now).run();
  await db.prepare(`INSERT INTO task12_sessions (
    token_digest, user_id, session_version, created_at, last_seen_at, expires_at, client_kind
  ) VALUES (?1, ?2, 1, ?3, ?3, ?4, 'browser')`)
    .bind(await sessionStorageKey(user.token), user.id, now, expires).run();
}

async function apiRequest(handler, db, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const waits = [];
  const context = {
    env: { ...ENVIRONMENT, WYJ_DB: db, ...(options.env || {}) },
    data: { requestId: options.requestId || crypto.randomUUID() },
    request: new Request(`https://preview.thewyj.uk${route}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    waitUntil(promise) { waits.push(promise); },
  };
  const response = await handler(context);
  await Promise.all(waits);
  assert.ok(response instanceof Response, `${route} did not return a Response`);
  const contentType = response.headers.get("Content-Type") || "";
  return {
    response,
    payload: contentType.includes("application/json") ? await response.json() : null,
    requestId: context.data.requestId,
  };
}

async function task18(db, route, options = {}) {
  return await apiRequest(handleTask18Request, db, route, options);
}

async function sendMessage(db, actor, input, requestId = crypto.randomUUID()) {
  return await task18(db, "/api/admin/messages", {
    method: "POST",
    token: actor.token,
    requestId,
    body: {
      title: input.title,
      body: input.body || "Task 18 isolated message body",
      message_type: input.message_type || "normal",
      target_scope: input.target_scope,
      target_user_ids: input.target_user_ids || [],
      expires_at: input.expires_at || "",
      requires_confirmation: Boolean(input.requires_confirmation),
      confirm_bulk_send: input.target_scope !== "single",
      idempotency_key: input.idempotency_key || `task18-message:${crypto.randomUUID()}`,
    },
  });
}

async function pendingMessages(db, user) {
  const result = await task18(db, "/api/messages/pending", { token: user.token });
  assert.equal(result.response.status, 200, JSON.stringify(result.payload));
  return result.payload.messages;
}

async function receipt(db, user, messageId, action) {
  return await task18(db, "/api/messages/receipt", {
    method: "POST",
    token: user.token,
    body: { message_id: messageId, action },
  });
}

const runtime = await mkdtemp(path.join(os.tmpdir(), "wyj-task18-d1-"));
const mf = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } }",
  compatibilityDate: "2026-08-06",
  d1Databases: ["WYJ_DB"],
  d1Persist: runtime,
});

let completed = 0;

try {
  const db = await mf.getD1Database("WYJ_DB");
  const migrations = (await readdir(path.join(ROOT, "cloudflare", "migrations")))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
  for (const filename of migrations) {
    const sql = await readFile(path.join(ROOT, "cloudflare", "migrations", filename), "utf8");
    await db.exec(sql.replace(/\r?\n/g, " "));
  }
  for (const user of Object.values(USERS)) await insertAccountAndSession(db, user);

  const task18Migration = await readFile(path.join(ROOT, "cloudflare", "migrations", "0014_admin_roles_messages.sql"), "utf8");
  await db.exec(task18Migration.replace(/\r?\n/g, " "));
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM task18_metadata WHERE key = 'schema_version'").first()).count, 1);
  await assert.rejects(
    db.prepare(`INSERT INTO task12_users (
      id, username, username_normalized, password_hash, password_scheme,
      password_iterations, role, registered_at, created_at, updated_at, source_updated_at
    ) VALUES ('task18-second-owner', 'second-owner', 'second-owner', '', 'reset_required', 0,
      'super_admin', '2026-08-29T00:00:00Z', '2026-08-29T00:00:00Z',
      '2026-08-29T00:00:00Z', '2026-08-29T00:00:00Z')`).run(),
    /task18_single_owner_required/,
  );
  await assert.rejects(
    db.prepare("UPDATE task12_users SET role = 'user' WHERE id = ?1").bind(USERS.owner.id).run(),
    /task18_owner_role_protected/,
  );
  await assert.rejects(
    db.prepare("UPDATE task12_users SET banned = 1 WHERE id = ?1").bind(USERS.owner.id).run(),
    /task18_owner_state_protected/,
  );
  await assert.rejects(
    db.prepare("DELETE FROM task12_users WHERE id = ?1").bind(USERS.owner.id).run(),
    /task18_owner_delete_protected/,
  );
  completed += 1;

  for (const candidate of [USERS.adminOne, USERS.adminTwo]) {
    const granted = await task18(db, "/api/admin/roles", {
      method: "POST",
      token: USERS.owner.token,
      requestId: `task18-grant-${candidate.id}`,
      body: { user_id: candidate.id, role: "admin", note: "Task 18 isolated role test" },
    });
    assert.equal(granted.response.status, 200, JSON.stringify(granted.payload));
    assert.equal(granted.payload.changed, true);
    assert.equal(granted.payload.user.role, "admin");
  }
  const adminSession = await apiRequest(handleTask12Request, db, "/api/me", { token: USERS.adminOne.token });
  assert.equal(adminSession.payload.account.role, "admin");
  assert.equal(adminSession.payload.account.is_admin, true);
  assert.equal(adminSession.payload.account.is_super_admin, false);
  await assert.rejects(
    db.prepare("DELETE FROM task12_users WHERE id = ?1").bind(USERS.adminTwo.id).run(),
    /task18_admin_role_must_be_revoked/,
  );
  assert.equal(isClientAdmin(adminSession.payload.account), true);
  assert.equal(isClientOwner(adminSession.payload.account), false);
  assert.equal(isClientOwner({ ...adminSession.payload.account, username: "not-hardcoded", role: "super_admin", is_super_admin: true }), true);
  const directAdminUsers = await apiRequest(handleTask12Request, db, "/api/admin/users", { token: USERS.adminOne.token });
  assert.equal(directAdminUsers.response.status, 200, JSON.stringify(directAdminUsers.payload));

  const forgedGrant = await task18(db, "/api/admin/roles", {
    method: "POST",
    token: USERS.adminOne.token,
    requestId: "task18-forged-role-request",
    body: { user_id: USERS.one.id, role: "admin", note: "forged" },
  });
  assert.equal(forgedGrant.response.status, 403);
  assert.equal(forgedGrant.payload.code, "owner_required");
  const ownerTarget = await apiRequest(dispatchApi, db, "/api/admin/ban", {
    method: "POST", token: USERS.adminOne.token, requestId: "task18-owner-ban-attempt",
    body: { user_id: USERS.owner.id, banned: true },
  });
  assert.equal(ownerTarget.response.status, 403);
  assert.equal(ownerTarget.payload.code, "owner_protected");
  const selfTarget = await apiRequest(dispatchApi, db, "/api/admin/ban", {
    method: "POST", token: USERS.adminOne.token, requestId: "task18-self-ban-attempt",
    body: { user_id: USERS.adminOne.id, banned: true },
  });
  assert.equal(selfTarget.response.status, 403);
  assert.equal(selfTarget.payload.code, "admin_target_protected");
  const peerTarget = await apiRequest(dispatchApi, db, "/api/admin/ban", {
    method: "POST", token: USERS.adminOne.token, requestId: "task18-peer-ban-attempt",
    body: { user_id: USERS.adminTwo.id, banned: true },
  });
  assert.equal(peerTarget.response.status, 403);
  assert.equal(peerTarget.payload.code, "admin_target_protected");
  const ownerAdminTarget = await apiRequest(dispatchApi, db, "/api/admin/ban", {
    method: "POST", token: USERS.owner.token,
    body: { user_id: USERS.adminTwo.id, banned: true },
  });
  assert.equal(ownerAdminTarget.response.status, 409);
  assert.equal(ownerAdminTarget.payload.code, "admin_role_must_be_revoked");
  const dailyManagement = await apiRequest(dispatchApi, db, "/api/admin/membership/manage", {
    method: "POST", token: USERS.adminOne.token, requestId: "task18-membership-manage",
    body: {
      user_id: USERS.one.id,
      action: "grant",
      plan_code: "finance_monthly",
      membership_start: "",
      membership_expires: "",
      note: "Task 18 ordinary admin daily operation",
      preserve_japanese: false,
      trial_language: "",
    },
  });
  assert.equal(dailyManagement.response.status, 200, JSON.stringify(dailyManagement.payload));
  completed += 1;

  const xssBody = '<img src=x onerror="globalThis.task18Xss=1"><script>globalThis.task18Xss=2</script>';
  const single = await sendMessage(db, USERS.adminOne, {
    title: "Single recipient",
    body: xssBody,
    target_scope: "single",
    target_user_ids: [USERS.one.id],
    idempotency_key: "task18-single-message-0001",
  }, "task18-single-send");
  assert.equal(single.response.status, 201, JSON.stringify(single.payload));
  assert.equal(single.payload.message.body, xssBody);
  assert.equal(single.payload.message.sender_label, "thewyj 管理员通知");
  assert.equal((await pendingMessages(db, USERS.one)).some((item) => item.id === single.payload.message.id), true);
  assert.equal((await pendingMessages(db, USERS.two)).some((item) => item.id === single.payload.message.id), false);
  const dismissedSingle = await receipt(db, USERS.one, single.payload.message.id, "dismiss");
  assert.equal(dismissedSingle.payload.receipt.will_repeat, false);
  assert.equal((await pendingMessages(db, USERS.one)).some((item) => item.id === single.payload.message.id), false);

  const missingBulkConfirmation = await task18(db, "/api/admin/messages", {
    method: "POST", token: USERS.adminOne.token,
    body: {
      title: "Missing confirmation", body: "must fail", message_type: "normal",
      target_scope: "multiple", target_user_ids: [USERS.one.id, USERS.two.id],
      expires_at: "", requires_confirmation: false,
      idempotency_key: "task18-missing-confirmation-01",
    },
  });
  assert.equal(missingBulkConfirmation.response.status, 400);
  assert.equal(missingBulkConfirmation.payload.code, "message_bulk_confirmation_required");

  const multiple = await sendMessage(db, USERS.adminOne, {
    title: "Required multi-user message",
    target_scope: "multiple",
    target_user_ids: [USERS.one.id, USERS.two.id],
    requires_confirmation: true,
    message_type: "important",
  });
  assert.equal(multiple.response.status, 201);
  const multipleId = multiple.payload.message.id;
  assert.equal((await pendingMessages(db, USERS.one)).some((item) => item.id === multipleId), true);
  assert.equal((await pendingMessages(db, USERS.two)).some((item) => item.id === multipleId), true);
  assert.equal((await pendingMessages(db, USERS.three)).some((item) => item.id === multipleId), false);
  const dismissedRequired = await receipt(db, USERS.one, multipleId, "dismiss");
  assert.equal(dismissedRequired.payload.receipt.will_repeat, true);
  assert.equal((await pendingMessages(db, USERS.one)).some((item) => item.id === multipleId), true);
  const acknowledged = await receipt(db, USERS.one, multipleId, "acknowledge");
  assert.equal(acknowledged.payload.receipt.acknowledged, true);
  assert.equal((await pendingMessages(db, USERS.one)).some((item) => item.id === multipleId), false);
  const acknowledgementReceipt = await db.prepare(`SELECT dismissed_at, acknowledged_at
    FROM admin_message_receipts WHERE message_id = ?1 AND user_id = ?2`)
    .bind(multipleId, USERS.one.id).first();
  assert.equal(acknowledgementReceipt.dismissed_at.length > 0, true, "the earlier explicit dismiss is retained");
  assert.equal(acknowledgementReceipt.acknowledged_at.length > 0, true);
  const acknowledgedWithoutDismiss = await receipt(db, USERS.two, multipleId, "acknowledge");
  assert.equal(acknowledgedWithoutDismiss.payload.receipt.acknowledged, true);
  const directAcknowledgementReceipt = await db.prepare(`SELECT dismissed_at, acknowledged_at
    FROM admin_message_receipts WHERE message_id = ?1 AND user_id = ?2`)
    .bind(multipleId, USERS.two.id).first();
  assert.equal(directAcknowledgementReceipt.dismissed_at, "", "acknowledge must not be counted as dismiss");
  assert.equal(directAcknowledgementReceipt.acknowledged_at.length > 0, true);
  const acknowledgedAgain = await receipt(db, USERS.one, multipleId, "acknowledge");
  assert.equal(acknowledgedAgain.response.status, 200);
  completed += 1;

  const globalMessage = await sendMessage(db, USERS.adminOne, {
    title: "Global message",
    target_scope: "all",
    message_type: "maintenance",
  });
  assert.equal(globalMessage.response.status, 201);
  for (const user of [USERS.one, USERS.two, USERS.three]) {
    assert.equal((await pendingMessages(db, user)).some((item) => item.id === globalMessage.payload.message.id), true);
  }
  const lateUser = {
    id: `task18-late-${crypto.randomUUID()}`,
    username: `task18-late-${crypto.randomUUID().slice(0, 8)}`,
    role: "user",
    token: `task18-late-token-${crypto.randomUUID()}`,
  };
  await insertAccountAndSession(db, lateUser);
  assert.equal(
    (await pendingMessages(db, lateUser)).some((item) => item.id === globalMessage.payload.message.id),
    false,
    "an all-users message is scoped to accounts that existed when it was sent",
  );
  const offlineMessage = await sendMessage(db, USERS.adminOne, {
    title: "Offline for three days",
    target_scope: "single",
    target_user_ids: [USERS.three.id],
  });
  await db.prepare("UPDATE admin_messages SET created_at = ?2, updated_at = ?2 WHERE id = ?1")
    .bind(offlineMessage.payload.message.id, new Date(Date.now() - 3 * 86_400_000).toISOString()).run();
  assert.equal((await pendingMessages(db, USERS.three)).some((item) => item.id === offlineMessage.payload.message.id), true);

  const expired = await sendMessage(db, USERS.adminOne, {
    title: "Expired message",
    target_scope: "single",
    target_user_ids: [USERS.one.id],
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  });
  await db.prepare("UPDATE admin_messages SET expires_at = ?2 WHERE id = ?1")
    .bind(expired.payload.message.id, new Date(Date.now() - 60_000).toISOString()).run();
  assert.equal((await pendingMessages(db, USERS.one)).some((item) => item.id === expired.payload.message.id), false);
  assert.equal((await db.prepare("SELECT status FROM admin_messages WHERE id = ?1").bind(expired.payload.message.id).first()).status, "expired");

  const revoked = await sendMessage(db, USERS.adminOne, {
    title: "Revoked message",
    target_scope: "single",
    target_user_ids: [USERS.two.id],
  });
  const peerRevoke = await task18(db, "/api/admin/messages/revoke", {
    method: "POST", token: USERS.adminTwo.token,
    body: { message_id: revoked.payload.message.id },
  });
  assert.equal(peerRevoke.response.status, 403);
  assert.equal(peerRevoke.payload.code, "message_sender_protected");
  const revokedResult = await task18(db, "/api/admin/messages/revoke", {
    method: "POST", token: USERS.adminOne.token, requestId: "task18-revoke-message",
    body: { message_id: revoked.payload.message.id },
  });
  assert.equal(revokedResult.response.status, 200);
  assert.equal(revokedResult.payload.changed, true);
  const repeatedRevoke = await task18(db, "/api/admin/messages/revoke", {
    method: "POST", token: USERS.adminOne.token,
    body: { message_id: revoked.payload.message.id },
  });
  assert.equal(repeatedRevoke.payload.changed, false);
  assert.equal((await pendingMessages(db, USERS.two)).some((item) => item.id === revoked.payload.message.id), false);
  assert.equal(Number((await db.prepare(`SELECT COUNT(*) AS count FROM task18_admin_action_audit
    WHERE action = 'message_revoke' AND target_id = ?1 AND success = 1`).bind(revoked.payload.message.id).first()).count), 1);
  completed += 1;

  const replayInput = {
    title: "Idempotent message",
    body: "same body",
    target_scope: "single",
    target_user_ids: [USERS.two.id],
    idempotency_key: "task18-idempotency-message-01",
  };
  const firstReplay = await sendMessage(db, USERS.adminOne, replayInput);
  const secondReplay = await sendMessage(db, USERS.adminOne, replayInput);
  assert.equal(firstReplay.response.status, 201);
  assert.equal(secondReplay.response.status, 200);
  assert.equal(secondReplay.payload.replayed, true);
  assert.equal(secondReplay.payload.message.id, firstReplay.payload.message.id);
  const conflictReplay = await sendMessage(db, USERS.adminOne, { ...replayInput, title: "Conflicting replay" });
  assert.equal(conflictReplay.response.status, 409);
  assert.equal(conflictReplay.payload.code, "message_idempotency_conflict");
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS count FROM admin_messages WHERE sender_user_id = ?1 AND idempotency_key = ?2")
    .bind(USERS.adminOne.id, replayInput.idempotency_key).first()).count), 1);
  const concurrentInput = {
    ...replayInput,
    title: "Concurrent idempotent message",
    idempotency_key: "task18-idempotency-concurrent-01",
  };
  const concurrentResults = await Promise.all([
    sendMessage(db, USERS.adminOne, concurrentInput),
    sendMessage(db, USERS.adminOne, concurrentInput),
  ]);
  assert.deepEqual(concurrentResults.map((item) => item.response.status).sort(), [200, 201]);
  assert.equal(concurrentResults[0].payload.message.id, concurrentResults[1].payload.message.id);
  assert.equal(Number((await db.prepare("SELECT COUNT(*) AS count FROM admin_messages WHERE sender_user_id = ?1 AND idempotency_key = ?2")
    .bind(USERS.adminOne.id, concurrentInput.idempotency_key).first()).count), 1);
  completed += 1;

  const source = await readFile(path.join(ROOT, "app.js"), "utf8");
  assert.match(source, /\$\("siteMessageBody"\)\.textContent = next\.body/);
  assert.doesNotMatch(source, /siteMessageBody"\)\.innerHTML\s*=/);
  assert.match(source, /dismissActiveSiteMessage/);
  assert.match(source, /acknowledgeActiveSiteMessage/);

  const actionAudits = await db.prepare(`SELECT actor_role, action, success, request_id
    FROM task18_admin_action_audit ORDER BY created_at, id`).all();
  assert.equal(actionAudits.results.some((item) => item.actor_role === "admin" && item.action === "message_send" && item.success === 1), true);
  assert.equal(actionAudits.results.some((item) => item.action === "admin_role_change" && item.success === 0 && item.request_id === "task18-forged-role-request"), true);
  assert.equal(actionAudits.results.some((item) => item.action === "membership_manage" && item.success === 1 && item.request_id === "task18-membership-manage"), true);
  assert.equal(actionAudits.results.some((item) => item.action === "user_ban_state" && item.success === 0 && item.request_id === "task18-owner-ban-attempt"), true);
  const roleAudits = await db.prepare("SELECT action, request_id FROM task18_admin_role_audit ORDER BY created_at, id").all();
  assert.equal(roleAudits.results.filter((item) => item.action === "admin_grant").length, 2);
  completed += 1;

  const revokedRole = await task18(db, "/api/admin/roles", {
    method: "POST", token: USERS.owner.token, requestId: "task18-revoke-admin-one",
    body: { user_id: USERS.adminOne.id, role: "user", note: "Task 18 immediate role revocation" },
  });
  assert.equal(revokedRole.response.status, 200);
  assert.equal(revokedRole.payload.user.role, "user");
  const formerAdmin = await task18(db, "/api/admin/messages", { token: USERS.adminOne.token });
  assert.equal(formerAdmin.response.status, 403);
  assert.equal(formerAdmin.payload.code, "forbidden");
  const stillLoggedIn = await apiRequest(handleTask12Request, db, "/api/me", { token: USERS.adminOne.token });
  assert.equal(stillLoggedIn.response.status, 200);
  assert.equal(stillLoggedIn.payload.account.role, "user");
  const ownerRoleList = await task18(db, "/api/admin/roles", { token: USERS.owner.token });
  assert.equal(ownerRoleList.response.status, 200);
  assert.equal(ownerRoleList.payload.admins.some((item) => item.id === USERS.adminOne.id), false);
  assert.equal(ownerRoleList.payload.admins.some((item) => item.id === USERS.adminTwo.id), true);
  completed += 1;

  const disabled = await task18(db, "/api/messages/pending", {
    token: USERS.one.token,
    env: { TASK18_ADMIN_MESSAGES_ENABLED: "false" },
  });
  assert.equal(disabled.response.status, 503);
  assert.equal(disabled.payload.code, "task18_disabled");
  const readiness = await task18(db, "/api/admin/task18/status", { token: USERS.owner.token });
  assert.equal(readiness.response.status, 200);
  assert.deepEqual({ owners: readiness.payload.counts.owners, admins: readiness.payload.counts.admins }, { owners: 1, admins: 1 });
  completed += 1;

  console.log(`Task 18 D1 tests passed (${completed} groups: owner constraints, admin boundaries, messages, receipts, expiry/revocation, idempotency, XSS, audit, immediate revocation).`);
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}

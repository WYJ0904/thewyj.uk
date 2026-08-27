import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Miniflare } from "miniflare";

import { handleTask16Request } from "../functions/_lib/task16-api.mjs";
import { sha256Hex } from "../functions/_lib/cloudflare-foundation.mjs";
import { sessionStorageKey } from "../functions/_lib/task12-crypto.mjs";
import { accountMembershipState } from "../functions/_lib/task13-service.mjs";
import { __testing as importTesting } from "../functions/_lib/task16-import.mjs";
import {
  classifyFinanceText,
  normalizeRawEvent,
  reconciliationScore,
  stableJson,
} from "../functions/_lib/task16-model.mjs";
import {
  financeBootstrap,
  financeChanges,
  listFinanceTransactions,
  mergeFinanceTransactions,
  splitFinanceTransaction,
  syncFinance,
} from "../functions/_lib/task16-service.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENVIRONMENT = Object.freeze({
  CLOUD_FOUNDATION_ENABLED: "true",
  TASK12_CLOUD_ACCOUNTS_ENABLED: "true",
  TASK13_CLOUD_READS_ENABLED: "true",
  TASK16_CLOUD_READS_ENABLED: "true",
  TASK16_CLOUD_WRITES_ENABLED: "true",
  TASK16_IMPORT_ENABLED: "true",
  TASK16_PRODUCTION_IMPORT_ENABLED: "false",
  D1_RATE_LIMIT_ENABLED: "false",
  WYJ_ENVIRONMENT: "preview",
});
const USERS = Object.freeze({
  admin: { id: "task16-admin", username: "task16-admin", role: "super_admin", token: "task16-admin-token" },
  finance: { id: "task16-finance-user", username: "task16-finance", role: "user", token: "task16-finance-token" },
  allAccess: { id: "task16-all-user", username: "task16-all", role: "user", token: "task16-all-token" },
  free: { id: "task16-free-user", username: "task16-free", role: "user", token: "task16-free-token" },
  other: { id: "task16-other-user", username: "task16-other", role: "user", token: "task16-other-token" },
});

function baseAccount(user, entitlements = []) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    is_super_admin: user.role === "super_admin",
    banned: false,
    deleted: false,
    entitlements,
  };
}

async function insertAccountAndSession(db, user) {
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
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

async function grantMembership(db, userId, planCode, metadata = {}) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO task13_user_memberships (
    id, user_id, plan_code, starts_at, expires_at, is_lifetime, status,
    source, source_ref, created_by, metadata_json, created_at, updated_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, 0, 'active', ?6, ?7, 'fixture', ?8, ?4, ?4)`)
    .bind(
      `membership:${userId}:${planCode}`, userId, planCode, now,
      new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString(),
      metadata.source || "admin", `fixture:${planCode}`, JSON.stringify(metadata.value || {}),
    ).run();
}

async function requestTask16(db, route, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.token) headers.set("X-Session-Token", options.token);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const context = {
    env: { ...ENVIRONMENT, WYJ_DB: db, ...(options.env || {}) },
    data: { requestId: options.requestId || crypto.randomUUID() },
    request: new Request(`https://thewyj.uk${route}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  };
  const response = await handleTask16Request(context);
  return { response, payload: await response.json() };
}

function eventPayload(overrides = {}) {
  const reference = overrides.provider_reference ?? `ref-${crypto.randomUUID()}`;
  return {
    source_type: "notification",
    source_event_id: `event-${crypto.randomUUID()}`,
    source_provider: "wechat",
    provider_reference: reference,
    text: "微信支付成功 28.00 元",
    direction: "expense",
    amount_minor: 2800,
    currency: "CNY",
    merchant: "测试商户",
    counterparty: "",
    account_last4: "1234",
    occurred_at_ms: 1_760_000_000_000,
    captured_at_ms: 1_760_000_000_500,
    metadata: { source_time_precision_ms: 1000, payment_channel: "wechat" },
    ...overrides,
  };
}

function syncPayload(deviceId, operations, sinceVersion = 0, platform = "android") {
  return {
    schema_version: 1,
    device_id: deviceId,
    platform,
    device_label: "Task 16 fixture",
    client_version: "task16-test",
    since_version: sinceVersion,
    operations,
  };
}

function rawOperation(index, payload) {
  return { operation_id: `operation:raw:${index}`, type: "raw_event.ingest", payload };
}

async function tableCount(db, table, where = "", values = []) {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).bind(...values).first();
  return Number(row?.count || 0);
}

const runtime = await mkdtemp(path.join(os.tmpdir(), "wyj-task16-d1-"));
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
  for (const filename of [
    "0001_foundation.sql", "0002_low_risk_cloud_services.sql", "0003_accounts_sessions.sql",
    "0004_session_limit_trigger.sql", "0005_session_limit_ordering.sql", "0006_memberships_payments.sql",
    "0007_temporary_sharing.sql", "0008_task14_user_storage_trigger.sql", "0009_task14_global_storage_trigger.sql",
    "0010_task15_cloud_only.sql", "0011_task15_import_trigger_order.sql", "0012_finance_core.sql",
  ]) {
    const sql = await readFile(path.join(ROOT, "cloudflare", "migrations", filename), "utf8");
    await db.exec(sql.replace(/\r?\n/g, " "));
  }
  for (const user of Object.values(USERS)) await insertAccountAndSession(db, user);
  await grantMembership(db, USERS.finance.id, "finance_monthly");
  await grantMembership(db, USERS.other.id, "finance_monthly");
  await grantMembership(db, USERS.allAccess.id, "all_access_monthly", {
    source: "payment",
    value: { entitlements_snapshot: [
      "language_all_access", "tools_access", "all_features_access",
    ] },
  });

  const financeState = await accountMembershipState(db, baseAccount(USERS.finance));
  const allState = await accountMembershipState(db, baseAccount(USERS.allAccess));
  const financePlan = await db.prepare(`SELECT price_cents, currency, duration_months, purchasable
    FROM task13_membership_plans WHERE code = 'finance_monthly'`).first();
  assert.deepEqual(financePlan, { price_cents: 800, currency: "CNY", duration_months: 1, purchasable: 0 });
  assert.equal(financeState.entitlements.includes("finance_access"), true);
  assert.equal(allState.entitlements.includes("finance_access"), true, "old all-access payment snapshots gain finance access");
  assert.equal((await accountMembershipState(db, baseAccount(USERS.free))).entitlements.includes("finance_access"), false);
  completed += 1;

  assert.deepEqual(classifyFinanceText("恭喜获得最高 50 万元信用额度，点击领取"), {
    classification: "rejected", reason: "marketing_or_credit_offer", direction: "unknown", amount_minor: 0,
  });
  assert.equal(classifyFinanceText("商品原价 500 元，优惠券立减 50 元").classification, "rejected");
  assert.deepEqual(classifyFinanceText("支付宝退款成功 28.00 元"), {
    classification: "accepted", reason: "transaction_completed", direction: "refund", amount_minor: 2800,
  });
  assert.throws(() => normalizeRawEvent(eventPayload({ text: "" })), /可验证的交易文本/u);
  const sameSourceScore = reconciliationScore(
    eventPayload({ provider_reference: "", source_event_id: "event-score-new" }),
    { direction: "expense", amount_minor: 2800, currency: "CNY", merchant: "测试商户", occurred_at_ms: 1_760_000_000_000 },
    [eventPayload({ provider_reference: "", source_event_id: "event-score-old" })],
  );
  assert.ok(sameSourceScore.score < 0.75);
  assert.equal(sameSourceScore.automatic, false);
  completed += 1;

  const financeAccount = { ...baseAccount(USERS.finance), ...financeState };
  const deviceA = "device:android:a";

  // 1. Same notification replayed ten times stays one raw event and one canonical transaction.
  const notification = eventPayload({ source_event_id: "notification:stable:1", provider_reference: "wechat-order-1" });
  for (let index = 0; index < 10; index += 1) {
    const result = await syncFinance(db, financeAccount, syncPayload(deviceA, [rawOperation(`notify:${index}`, notification)]));
    if (index) assert.equal(result.operation_results[0].duplicate, true);
  }
  assert.equal(await tableCount(db, "task16_finance_raw_events", "WHERE user_id = ?1", [financeAccount.id]), 1);
  assert.equal(await tableCount(db, "task16_finance_transactions", "WHERE user_id = ?1", [financeAccount.id]), 1);
  completed += 1;

  // 2. Same SMS replayed ten times remains one raw event.
  const smsReplay = eventPayload({
    source_type: "sms", source_event_id: "sms:stable:1", source_provider: "bank-sms",
    provider_reference: "bank-order-2", text: "银行卡消费成功 18.00 元", amount_minor: 1800,
    occurred_at_ms: 1_760_000_100_000,
  });
  for (let index = 0; index < 10; index += 1) {
    await syncFinance(db, financeAccount, syncPayload(deviceA, [rawOperation(`sms:${index}`, smsReplay)]));
  }
  assert.equal(await tableCount(db, "task16_finance_raw_events", "WHERE source_event_id = 'sms:stable:1'"), 1);
  completed += 1;

  // 3 and 8. Independent sources with the same strong reference fuse, including a two-minute delay.
  const ref = "shared-reference-28";
  const firstStrong = eventPayload({
    source_event_id: "wechat:strong:1", provider_reference: ref,
    occurred_at_ms: 1_760_001_000_000,
  });
  const secondStrong = eventPayload({
    source_type: "sms", source_event_id: "bank:strong:1", source_provider: "bank-sms",
    provider_reference: ref, text: "银行卡消费成功 28.00 元", occurred_at_ms: 1_760_001_120_000,
  });
  const firstStrongResult = await syncFinance(db, financeAccount, syncPayload(deviceA, [rawOperation("strong:1", firstStrong)]));
  const secondStrongResult = await syncFinance(db, financeAccount, syncPayload(deviceA, [rawOperation("strong:2", secondStrong)]));
  assert.equal(secondStrongResult.operation_results[0].transaction_id, firstStrongResult.operation_results[0].transaction_id);
  assert.equal(await tableCount(db, "task16_finance_transaction_events", "WHERE transaction_id = ?1", [firstStrongResult.operation_results[0].transaction_id]), 2);
  completed += 1;

  // 4. Same merchant and amount with different references remains two transactions.
  const distinctOne = eventPayload({ source_event_id: "same:merchant:1", provider_reference: "distinct-ref-1", occurred_at_ms: 1_760_002_000_000 });
  const distinctTwo = eventPayload({ source_event_id: "same:merchant:2", provider_reference: "distinct-ref-2", occurred_at_ms: 1_760_002_020_000 });
  const distinctOneResult = await syncFinance(db, financeAccount, syncPayload(deviceA, [rawOperation("distinct:1", distinctOne)]));
  const distinctTwoResult = await syncFinance(db, financeAccount, syncPayload(deviceA, [rawOperation("distinct:2", distinctTwo)]));
  assert.notEqual(distinctOneResult.operation_results[0].transaction_id, distinctTwoResult.operation_results[0].transaction_id);

  // 5. Same source without transaction IDs also remains two.
  const noRefOne = eventPayload({ source_event_id: "no-ref:1", provider_reference: "", occurred_at_ms: 1_760_003_000_000 });
  const noRefTwo = eventPayload({ source_event_id: "no-ref:2", provider_reference: "", occurred_at_ms: 1_760_003_020_000 });
  const noRefOneResult = await syncFinance(db, financeAccount, syncPayload(deviceA, [rawOperation("noref:1", noRefOne)]));
  const noRefTwoResult = await syncFinance(db, financeAccount, syncPayload(deviceA, [rawOperation("noref:2", noRefTwo)]));
  assert.notEqual(noRefOneResult.operation_results[0].transaction_id, noRefTwoResult.operation_results[0].transaction_id);

  // 6. Different merchants at the same time remain separate.
  const merchantOne = eventPayload({ source_event_id: "merchant:1", provider_reference: "merchant-ref-1", merchant: "甲商户", occurred_at_ms: 1_760_004_000_000, amount_minor: 5000, text: "支付成功 50.00 元" });
  const merchantTwo = eventPayload({ source_type: "sms", source_event_id: "merchant:2", source_provider: "bank-sms", provider_reference: "merchant-ref-2", merchant: "乙商户", occurred_at_ms: 1_760_004_000_000, amount_minor: 5000, text: "银行卡消费成功 50.00 元" });
  const merchantOneResult = await syncFinance(db, financeAccount, syncPayload(deviceA, [rawOperation("merchant:1", merchantOne)]));
  const merchantTwoResult = await syncFinance(db, financeAccount, syncPayload(deviceA, [rawOperation("merchant:2", merchantTwo)]));
  assert.notEqual(merchantOneResult.operation_results[0].transaction_id, merchantTwoResult.operation_results[0].transaction_id);

  // 7. Different account last-four digits remain separate.
  const cardOne = eventPayload({ source_event_id: "card:1", provider_reference: "card-ref-1", account_last4: "1111", occurred_at_ms: 1_760_005_000_000 });
  const cardTwo = eventPayload({ source_type: "sms", source_event_id: "card:2", source_provider: "bank-sms", provider_reference: "card-ref-2", account_last4: "2222", occurred_at_ms: 1_760_005_001_000, text: "银行卡消费成功 28.00 元" });
  const cardOneResult = await syncFinance(db, financeAccount, syncPayload(deviceA, [rawOperation("card:1", cardOne)]));
  const cardTwoResult = await syncFinance(db, financeAccount, syncPayload(deviceA, [rawOperation("card:2", cardTwo)]));
  assert.notEqual(cardOneResult.operation_results[0].transaction_id, cardTwoResult.operation_results[0].transaction_id);
  completed += 1;

  // 9 and 10. Manual merge and split retain all raw evidence and write audit logs.
  const mergeResult = await mergeFinanceTransactions(db, financeAccount, {
    operation_id: "operation:merge:one",
    device_id: deviceA,
    target_transaction_id: noRefOneResult.operation_results[0].transaction_id,
    source_transaction_ids: [noRefTwoResult.operation_results[0].transaction_id],
    base_revisions: {
      [noRefOneResult.operation_results[0].transaction_id]: 1,
      [noRefTwoResult.operation_results[0].transaction_id]: 1,
    },
  });
  assert.equal(mergeResult.source_transaction_ids.length, 1);
  assert.equal(mergeResult.target_transaction.revision, 2);
  assert.equal(mergeResult.target_transaction.reconciliation_state, "confirmed");
  assert.equal(mergeResult.source_transactions[0].status, "deleted");
  const mergeReplay = await mergeFinanceTransactions(db, financeAccount, {
    operation_id: "operation:merge:one",
    device_id: deviceA,
    target_transaction_id: noRefOneResult.operation_results[0].transaction_id,
    source_transaction_ids: [noRefTwoResult.operation_results[0].transaction_id],
    base_revisions: {
      [noRefOneResult.operation_results[0].transaction_id]: 1,
      [noRefTwoResult.operation_results[0].transaction_id]: 1,
    },
  });
  assert.equal(mergeReplay.idempotent_replay, true);
  assert.equal(await tableCount(db, "task16_finance_transaction_events", "WHERE transaction_id = ?1", [noRefOneResult.operation_results[0].transaction_id]), 2);
  const rawToSplit = await db.prepare(`SELECT raw_event_id FROM task16_finance_transaction_events
    WHERE transaction_id = ?1 ORDER BY raw_event_id LIMIT 1`).bind(noRefOneResult.operation_results[0].transaction_id).first();
  const splitResult = await splitFinanceTransaction(db, financeAccount, {
    operation_id: "operation:split:one",
    device_id: deviceA,
    transaction_id: noRefOneResult.operation_results[0].transaction_id,
    new_transaction_id: "transaction:split:new",
    raw_event_ids: [rawToSplit.raw_event_id],
    base_revision: 2,
  });
  assert.equal(splitResult.new_transaction_id, "transaction:split:new");
  assert.equal(splitResult.transaction.revision, 3);
  assert.equal(splitResult.new_transaction.revision, 1);
  assert.equal(splitResult.new_transaction.sync_version, splitResult.server_version);
  const splitReplay = await splitFinanceTransaction(db, financeAccount, {
    operation_id: "operation:split:one",
    device_id: deviceA,
    transaction_id: noRefOneResult.operation_results[0].transaction_id,
    new_transaction_id: "transaction:split:new",
    raw_event_ids: [rawToSplit.raw_event_id],
    base_revision: 2,
  });
  assert.equal(splitReplay.idempotent_replay, true);
  assert.equal(await tableCount(db, "task16_finance_raw_events", "WHERE id = ?1", [rawToSplit.raw_event_id]), 1);
  assert.ok(await tableCount(db, "task16_finance_audit_logs", "WHERE action IN ('transaction_merge','transaction_split')") >= 2);
  completed += 1;

  // 11 and 12. Replays across app restart semantics and two devices are idempotent.
  const crossDevice = eventPayload({ source_event_id: "cross-device:source", provider_reference: "cross-device-provider-ref", occurred_at_ms: 1_760_006_000_000 });
  const deviceOneResult = await syncFinance(db, financeAccount, syncPayload("device:android:one", [rawOperation("cross:1", crossDevice)]));
  const deviceTwoResult = await syncFinance(db, financeAccount, syncPayload("device:android:two", [rawOperation("cross:2", { ...crossDevice, source_event_id: "cross-device:second" })]));
  assert.equal(deviceTwoResult.operation_results[0].duplicate, true);
  assert.equal(deviceOneResult.operation_results[0].raw_event.id, deviceTwoResult.operation_results[0].raw_event.id);
  const replay = await syncFinance(db, financeAccount, syncPayload("device:android:one", [rawOperation("cross:1", crossDevice)]));
  assert.equal(replay.operation_results[0].idempotent_replay, true);
  const concurrentEvent = eventPayload({
    source_event_id: "concurrent:first", provider_reference: "concurrent-provider-ref",
    occurred_at_ms: 1_760_006_100_000,
  });
  const concurrent = await Promise.all([
    syncFinance(db, financeAccount, syncPayload("device:android:three", [rawOperation("concurrent:1", concurrentEvent)])),
    syncFinance(db, financeAccount, syncPayload("device:android:four", [rawOperation("concurrent:2", {
      ...concurrentEvent, source_event_id: "concurrent:second",
    })])),
  ]);
  assert.equal(new Set(concurrent.map((item) => item.operation_results[0].raw_event.id)).size, 1);
  assert.equal(concurrent.some((item) => item.operation_results[0].duplicate), true);
  assert.equal(await tableCount(db, "task16_finance_raw_events", "WHERE provider_reference = 'concurrent-provider-ref'"), 1);
  completed += 1;

  // 13. Promotion messages may be retained as rejected raw evidence but never create a canonical transaction.
  const transactionCountBeforePromo = await tableCount(db, "task16_finance_transactions", "WHERE user_id = ?1", [financeAccount.id]);
  const promo = await syncFinance(db, financeAccount, syncPayload(deviceA, [rawOperation("promo:1", eventPayload({
    source_type: "sms", source_event_id: "promo:credit:1", source_provider: "loan-sms",
    provider_reference: "", text: "最高 50 万元信用额度，立即申请", direction: "expense", amount_minor: 50_000_000,
    occurred_at_ms: 1_760_007_000_000,
  }))]));
  assert.equal(promo.operation_results[0].raw_event.classification, "rejected");
  assert.equal(promo.operation_results[0].transaction, null);
  assert.equal(await tableCount(db, "task16_finance_transactions", "WHERE user_id = ?1", [financeAccount.id]), transactionCountBeforePromo);
  completed += 1;

  // Manual CRUD, category, budget, tombstone, undo, conflicts, and incremental sync.
  const manualCreate = await syncFinance(db, financeAccount, syncPayload("device:web:one", [{
    operation_id: "operation:category:create", type: "category.upsert", entity_id: "category:food",
    base_revision: 0, payload: { name: "餐饮", applies_to: "expense", color: "#3366FF" },
  }, {
    operation_id: "operation:budget:create", type: "budget.upsert", entity_id: "budget:food:monthly",
    base_revision: 0, payload: { category_id: "category:food", period_type: "monthly", amount_minor: 100000, currency: "CNY", starts_on: "", ends_on: "" },
  }, {
    operation_id: "operation:transaction:create", type: "transaction.upsert", entity_id: "transaction:manual:1",
    base_revision: 0, payload: { direction: "expense", amount_minor: 3200, currency: "CNY", category_id: "category:food", merchant: "餐厅", counterparty: "", note: "午餐", occurred_at_ms: 1_760_008_000_000 },
  }]));
  assert.equal(manualCreate.operation_results.length, 3);
  await assert.rejects(() => syncFinance(db, financeAccount, syncPayload("device:web:one", [{
    operation_id: "operation:budget:invalid-date", type: "budget.upsert", entity_id: "budget:invalid:date",
    base_revision: 0, payload: { category_id: "category:food", period_type: "custom", amount_minor: 1000, currency: "CNY", starts_on: "2026-02-30", ends_on: "2026-03-02" },
  }])), /预算开始日期无效/u);
  const manualEdit = await syncFinance(db, financeAccount, syncPayload("device:web:one", [{
    operation_id: "operation:transaction:edit", type: "transaction.upsert", entity_id: "transaction:manual:1",
    base_revision: 1, payload: { direction: "expense", amount_minor: 3300, currency: "CNY", category_id: "category:food", merchant: "餐厅", counterparty: "", note: "午餐修正", occurred_at_ms: 1_760_008_000_000 },
  }]));
  assert.equal(manualEdit.operation_results[0].transaction.revision, 2);
  const concurrentEdits = await Promise.allSettled([
    syncFinance(db, financeAccount, syncPayload("device:web:one", [{
      operation_id: "operation:transaction:concurrent:a", type: "transaction.upsert", entity_id: "transaction:manual:1",
      base_revision: 2, payload: { direction: "expense", amount_minor: 3500, currency: "CNY", category_id: "category:food", merchant: "餐厅", counterparty: "", note: "并发 A", occurred_at_ms: 1_760_008_000_000 },
    }])),
    syncFinance(db, financeAccount, syncPayload("device:web:two", [{
      operation_id: "operation:transaction:concurrent:b", type: "transaction.upsert", entity_id: "transaction:manual:1",
      base_revision: 2, payload: { direction: "expense", amount_minor: 3600, currency: "CNY", category_id: "category:food", merchant: "餐厅", counterparty: "", note: "并发 B", occurred_at_ms: 1_760_008_000_000 },
    }])),
  ]);
  assert.equal(concurrentEdits.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(concurrentEdits.filter((item) => item.status === "rejected").length, 1);
  const concurrentRow = await db.prepare("SELECT revision, amount_minor FROM task16_finance_transactions WHERE id = 'transaction:manual:1'").first();
  assert.equal(Number(concurrentRow.revision), 3);
  assert.equal([3500, 3600].includes(Number(concurrentRow.amount_minor)), true);
  assert.equal(await tableCount(db, "task16_finance_sync_operations", "WHERE operation_id IN ('operation:transaction:concurrent:a','operation:transaction:concurrent:b')"), 1);
  await assert.rejects(() => syncFinance(db, financeAccount, syncPayload("device:web:two", [{
    operation_id: "operation:transaction:stale", type: "transaction.upsert", entity_id: "transaction:manual:1",
    base_revision: 1, payload: { direction: "expense", amount_minor: 3400, currency: "CNY", category_id: "category:food", merchant: "餐厅", counterparty: "", note: "stale", occurred_at_ms: 1_760_008_000_000 },
  }])), /另一设备/u);
  const deleted = await syncFinance(db, financeAccount, syncPayload("device:web:one", [{
    operation_id: "operation:transaction:delete", type: "transaction.delete", entity_id: "transaction:manual:1", base_revision: 3,
  }]));
  assert.equal(deleted.operation_results[0].transaction.status, "deleted");
  const restored = await syncFinance(db, financeAccount, syncPayload("device:web:two", [{
    operation_id: "operation:transaction:restore", type: "transaction.restore", entity_id: "transaction:manual:1", base_revision: 4,
  }]));
  assert.equal(restored.operation_results[0].transaction.status, "active");
  const changes = await financeChanges(db, financeAccount, 0, 250);
  assert.ok(changes.changes.some((item) => item.operation === "delete"));
  assert.ok(changes.changes.some((item) => item.operation === "restore"));
  const mergeChange = changes.changes.find((item) => item.operation === "merge");
  const splitChange = changes.changes.find((item) => item.operation === "split");
  assert.equal(mergeChange.payload.source_transactions[0].status, "deleted");
  assert.equal(splitChange.payload.new_transaction.id, "transaction:split:new");
  assert.equal((await financeBootstrap(db, financeAccount)).finance_access, true);
  assert.ok((await listFinanceTransactions(db, financeAccount)).transactions.length > 0);

  const pageTime = 4_000_000_000_000;
  await syncFinance(db, financeAccount, syncPayload("device:web:page", ["a", "b", "c"].map((suffix) => ({
    operation_id: `operation:page:${suffix}`, type: "transaction.upsert", entity_id: `transaction:page:${suffix}`,
    base_revision: 0, payload: { direction: "expense", amount_minor: 100, currency: "CNY", category_id: "", merchant: "分页", counterparty: "", note: suffix, occurred_at_ms: pageTime },
  }))));
  const firstPage = await listFinanceTransactions(db, financeAccount, { limit: 2 });
  const secondPage = await listFinanceTransactions(db, financeAccount, {
    limit: 2, before: firstPage.next_before, before_id: firstPage.next_before_id,
  });
  assert.deepEqual(firstPage.transactions.map((item) => item.id), ["transaction:page:c", "transaction:page:b"]);
  assert.equal(secondPage.transactions[0].id, "transaction:page:a");
  assert.equal(firstPage.transactions.some((item) => secondPage.transactions.some((other) => other.id === item.id)), false);
  completed += 1;

  // API authentication, entitlement, ownership, feature flags, and migration/rollback.
  const freeAccess = await requestTask16(db, "/api/finance/bootstrap", { token: USERS.free.token });
  assert.equal(freeAccess.response.status, 403);
  assert.equal(freeAccess.payload.code, "finance_membership_required");
  const financeAccess = await requestTask16(db, "/api/finance/bootstrap", { token: USERS.finance.token });
  assert.equal(financeAccess.response.status, 200);
  const allAccessApi = await requestTask16(db, "/api/finance/bootstrap", { token: USERS.allAccess.token });
  assert.equal(allAccessApi.response.status, 200);
  const disabled = await requestTask16(db, "/api/finance/bootstrap", {
    token: USERS.finance.token,
    env: { TASK16_CLOUD_READS_ENABLED: "false" },
  });
  assert.equal(disabled.response.status, 503);
  assert.equal(disabled.payload.code, "task16_cloud_not_enabled");
  const otherAccountState = await accountMembershipState(db, baseAccount(USERS.other));
  const otherAccount = { ...baseAccount(USERS.other), ...otherAccountState };
  const otherTransactions = await listFinanceTransactions(db, otherAccount);
  assert.equal(otherTransactions.transactions.some((item) => item.id === "transaction:manual:1"), false);

  const fixtureNow = new Date().toISOString();
  await db.prepare(`INSERT INTO task16_finance_user_versions (user_id, server_version, updated_at)
    VALUES (?1, 251, ?2)`).bind(USERS.other.id, fixtureNow).run();
  for (let start = 1; start <= 251; start += 100) {
    const statements = [];
    for (let version = start; version < Math.min(start + 100, 252); version += 1) {
      statements.push(db.prepare(`INSERT INTO task16_finance_changes (
        user_id, version, entity_type, entity_id, operation, revision, payload_json, created_at
      ) VALUES (?1, ?2, 'fixture', ?3, 'upsert', 1, '{}', ?4)`)
        .bind(USERS.other.id, version, `fixture:${String(version).padStart(4, "0")}`, fixtureNow));
    }
    await db.batch(statements);
  }
  const pagedSync = await syncFinance(db, otherAccount, syncPayload("device:other:paged", [], 0));
  assert.equal(pagedSync.changes.length, 250);
  assert.equal(pagedSync.has_more, true);
  assert.equal(pagedSync.next_since, 250);
  const pagedDevice = await db.prepare(`SELECT last_sync_version FROM task16_finance_devices
    WHERE user_id = ?1 AND device_id = 'device:other:paged'`).bind(USERS.other.id).first();
  assert.equal(Number(pagedDevice.last_sync_version), 250, "device cursor only advances through returned changes");
  await assert.rejects(() => financeChanges(db, otherAccount, 252, 10), /同步游标超出/u);

  const importRecords = [{
    id: "legacy:1761000000000", user_id: USERS.other.id, direction: "expense",
    amount_minor: 1200, currency: "CNY", merchant: "", counterparty: "", note: "",
    occurred_at_ms: 1_761_000_000_000, source: "DailyPayGuard",
    legacy_timestamp: 1_761_000_000_000, legacy_type: "消费",
  }];
  const importPayload = {
    source_key: "task16-import-source",
    user_id: USERS.other.id,
    source_count: 1,
    canonical_sha256: await sha256Hex(stableJson(importRecords)),
    batch_key: "task16-import-batch",
    complete: true,
    records: importRecords,
  };
  const imported = await requestTask16(db, "/api/admin/task16/import", {
    method: "POST", token: USERS.admin.token, body: importPayload,
  });
  assert.equal(imported.response.status, 200, JSON.stringify(imported.payload));
  assert.equal(imported.payload.applied, 1);
  assert.equal(await tableCount(db, "task16_import_record_receipts", "WHERE source_key = ?1", [importPayload.source_key]), 1);
  assert.equal(await tableCount(db, "task16_finance_raw_events", "WHERE id = ?1", [`raw:${importPayload.records[0].id}`]), 1);

  const resumeRecords = [
    { id: "legacy:1761000000100", user_id: USERS.other.id, direction: "income", amount_minor: 1300, currency: "CNY", merchant: "", counterparty: "", note: "", occurred_at_ms: 1_761_000_000_100, source: "DailyPayGuard", legacy_timestamp: 1_761_000_000_100, legacy_type: "收款" },
    { id: "legacy:1761000000200", user_id: USERS.other.id, direction: "refund", amount_minor: 1400, currency: "CNY", merchant: "", counterparty: "", note: "", occurred_at_ms: 1_761_000_000_200, source: "DailyPayGuard", legacy_timestamp: 1_761_000_000_200, legacy_type: "退款" },
  ];
  const resumeSource = "task16-resume-source";
  const resumeDigest = await sha256Hex(stableJson(resumeRecords));
  await db.prepare(`INSERT INTO task16_import_batches (
    source_key, user_id, source_count, received_count, applied_count, complete,
    status, canonical_sha256, created_at, updated_at, rolled_back_at
  ) VALUES (?1, ?2, 2, 0, 0, 0, 'started', ?3, ?4, ?4, '')`)
    .bind(resumeSource, USERS.other.id, resumeDigest, fixtureNow).run();
  assert.equal((await importTesting.importOne(db, resumeSource, resumeRecords[0])).applied, true);
  const resumedImport = await requestTask16(db, "/api/admin/task16/import", {
    method: "POST", token: USERS.admin.token, body: {
      source_key: resumeSource, user_id: USERS.other.id, source_count: 2,
      canonical_sha256: resumeDigest, batch_key: "task16-resume-batch", records: resumeRecords, complete: true,
    },
  });
  assert.equal(resumedImport.response.status, 200, JSON.stringify(resumedImport.payload));
  assert.equal(resumedImport.payload.applied, 1);
  assert.equal(resumedImport.payload.resumed, 1);
  assert.equal(await tableCount(db, "task16_import_record_receipts", "WHERE source_key = ?1", [resumeSource]), 2);
  const resumeStatus = await requestTask16(db, `/api/admin/task16/import/status?source_key=${resumeSource}`, { token: USERS.admin.token });
  assert.equal(resumeStatus.payload.imports[0].received_count, 2);
  assert.equal(resumeStatus.payload.imports[0].applied_count, 2);
  assert.equal(await tableCount(db, "task16_finance_transaction_events", "WHERE transaction_id = ?1", [importPayload.records[0].id]), 1);
  const repeated = await requestTask16(db, "/api/admin/task16/import", {
    method: "POST", token: USERS.admin.token, body: importPayload,
  });
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.payload.idempotent_replay, true);
  const rolledBack = await requestTask16(db, "/api/admin/task16/import/rollback", {
    method: "POST", token: USERS.admin.token, body: { source_key: importPayload.source_key },
  });
  assert.equal(rolledBack.response.status, 200, JSON.stringify(rolledBack.payload));
  assert.equal(rolledBack.payload.rollback.rolled_back, 1);
  const tombstone = await db.prepare("SELECT status FROM task16_finance_transactions WHERE id = ?1")
    .bind(importPayload.records[0].id).first();
  assert.equal(tombstone.status, "deleted");
  assert.equal(await tableCount(db, "task16_finance_raw_events", "WHERE id = ?1", [`raw:${importPayload.records[0].id}`]), 1);
  const forbiddenImport = await requestTask16(db, "/api/admin/task16/import/status", { token: USERS.finance.token });
  assert.equal(forbiddenImport.response.status, 403);
  const productionImport = await requestTask16(db, "/api/admin/task16/import/status", {
    token: USERS.admin.token,
    env: { WYJ_ENVIRONMENT: "production", TASK16_PRODUCTION_IMPORT_ENABLED: "false" },
  });
  assert.equal(productionImport.response.status, 403);
  assert.equal(productionImport.payload.code, "task16_production_import_confirmation_required");
  completed += 1;

  assert.ok(await tableCount(db, "task16_finance_audit_logs") > 0);
  assert.ok(await tableCount(db, "task16_finance_changes") > 0);
  assert.ok(await tableCount(db, "task16_finance_sync_operations") > 0);
  console.log(`Task 16 Miniflare/D1 checks passed: ${completed}`);
} finally {
  await mf.dispose();
  await rm(runtime, { recursive: true, force: true });
}

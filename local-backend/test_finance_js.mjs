import assert from "node:assert/strict";

import {
  amountTextToMinor,
  applyFinanceChange,
  calculateFinanceSummary,
  filterFinanceTransactions,
  formatFinanceMoney,
} from "../js/finance/app.js";

const january = new Date(2026, 0, 15, 12, 0, 0).getTime();
const february = new Date(2026, 1, 1, 12, 0, 0).getTime();
const records = [
  { id: "txn:income:1", direction: "income", amount_minor: 100000, currency: "CNY", category_id: "cat:salary", merchant: "", counterparty: "公司", note: "一月工资", occurred_at_ms: january, status: "active", revision: 1 },
  { id: "txn:expense:1", direction: "expense", amount_minor: 2599, currency: "CNY", category_id: "cat:food", merchant: "便利店", counterparty: "", note: "午餐", occurred_at_ms: january + 1000, status: "active", revision: 1 },
  { id: "txn:refund:1", direction: "refund", amount_minor: 500, currency: "CNY", category_id: "cat:food", merchant: "便利店", counterparty: "", note: "退款", occurred_at_ms: january + 2000, status: "active", revision: 1 },
  { id: "txn:deleted:1", direction: "expense", amount_minor: 888, currency: "CNY", category_id: "", merchant: "旧记录", counterparty: "", note: "", occurred_at_ms: january + 3000, status: "deleted", revision: 2 },
  { id: "txn:february:1", direction: "expense", amount_minor: 3000, currency: "CNY", category_id: "cat:food", merchant: "二月商户", counterparty: "", note: "", occurred_at_ms: february, status: "active", revision: 1 },
];

assert.equal(amountTextToMinor("12.34"), 1234);
assert.equal(amountTextToMinor("8"), 800);
assert.equal(amountTextToMinor("0"), 0);
assert.equal(amountTextToMinor("1.234"), 0);
assert.match(formatFinanceMoney(1234), /12\.34/u);

const summary = calculateFinanceSummary(records, { month: "2026-01" });
assert.deepEqual(summary, {
  income_minor: 100000,
  expense_minor: 2599,
  refund_minor: 500,
  balance_minor: 97901,
  count: 3,
});
assert.deepEqual(filterFinanceTransactions(records, { month: "2026-01", direction: "expense", status: "active" }).map((item) => item.id), ["txn:expense:1"]);
assert.deepEqual(filterFinanceTransactions(records, { query: "工资", month: "2026-01", status: "active" }).map((item) => item.id), ["txn:income:1"]);
assert.deepEqual(filterFinanceTransactions(records, { status: "deleted" }).map((item) => item.id), ["txn:deleted:1"]);

const store = { transactions: {}, categories: {}, budgets: {}, server_version: 0 };
assert.equal(applyFinanceChange(store, {
  version: 4,
  entity_type: "transaction",
  payload: { transaction: records[0] },
}), true);
assert.equal(store.transactions["txn:income:1"].amount_minor, 100000);
assert.equal(store.server_version, 4);
assert.equal(applyFinanceChange(store, {
  version: 5,
  entity_type: "transaction",
  payload: { transaction: { ...records[0], amount_minor: 1, revision: 0 } },
}), true);
assert.equal(store.transactions["txn:income:1"].amount_minor, 100000, "older revisions cannot overwrite newer local state");

console.log("Finance Web model tests passed (money, summary, filters, tombstones, revision merge).");

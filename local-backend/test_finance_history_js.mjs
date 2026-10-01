import assert from "node:assert/strict";
import { financeLedgerMonths, filterFinanceTransactions, calculateFinanceSummary } from "../js/finance/app.js";

// An October first visit must keep September and older ledger identities
// reachable. Selecting all ledger months must not broaden monthly statistics.
const at = (month, day) => new Date(2026, month - 1, day, 12).getTime();
const rows = [
  { id: "old-august", status: "active", direction: "expense", amount_minor: 500, occurred_at_ms: at(8, 20) },
  { id: "old-september", status: "active", direction: "income", amount_minor: 900, occurred_at_ms: at(9, 30) },
  { id: "october-one", status: "active", direction: "expense", amount_minor: 1, occurred_at_ms: at(10, 1) },
  { id: "october-two", status: "active", direction: "income", amount_minor: 200, occurred_at_ms: at(10, 1) },
  { id: "old-deleted", status: "deleted", direction: "expense", amount_minor: 700, occurred_at_ms: at(9, 2) },
];
const before = JSON.stringify(rows);
assert.deepEqual(financeLedgerMonths(rows), [
  { month: "2026-10", count: 2 }, { month: "2026-09", count: 1 }, { month: "2026-08", count: 1 },
]);
assert.deepEqual(financeLedgerMonths(rows, "all").map(r => r.count), [2, 2, 1]);
assert.deepEqual(filterFinanceTransactions(rows, {month: "2026-10"}).map(r => r.id).sort(), ["october-one", "october-two"]);
assert.deepEqual(filterFinanceTransactions(rows, {month: ""}).map(r => r.id).sort(), ["october-one", "october-two", "old-august", "old-september"]);
assert.deepEqual(filterFinanceTransactions(rows, {month: "2026-09"}).map(r => r.id), ["old-september"]);
assert.equal(calculateFinanceSummary(rows, {month: "2026-10"}).expense_minor, 1);
assert.equal(calculateFinanceSummary(rows, {month: "2026-10"}).income_minor, 200);
assert.equal(JSON.stringify(rows), before, "history exploration must not mutate ledger entities or tombstones");
console.log("Finance history checks passed: October, September/older, all months, tombstones, monthly statistics, no mutation.");

import assert from "node:assert/strict";

import { candidateNeedsEditor, candidatePresentation, canonicalPendingCandidates, createFinanceCandidatesController } from "../js/finance/candidates.js";

const canonical = canonicalPendingCandidates(
  { records: [
    { kind: "hint", id: "hint-live", event_id: "event-live", state: "pending" },
    { kind: "candidate", id: "candidate-live", event_id: "event-other", state: "pending" },
    { kind: "hint", id: "hint-terminal", event_id: "event-terminal", state: "confirmed" },
  ] },
  [{ id: "hint-live", hint: true, event_id: "event-live" },
    { id: "hint-terminal", hint: true, event_id: "event-terminal" }],
  [{ id: "candidate-live", event_id: "event-other" },
    { id: "candidate-stale", event_id: "event-stale" }],
);
assert.deepEqual(canonical.map((row) => row.event_id), ["event-live", "event-other"],
  "Finance must render precisely the same pending identity set as the canonical summary");
assert.equal(canonical.length, 2);
assert.deepEqual(canonicalPendingCandidates({ records: [] },
  [{ id: "stale-hint", hint: true }], [{ id: "stale-candidate" }]), [],
"A terminal cloud observation must remove stale detail rows on Finance");
assert.deepEqual(canonicalPendingCandidates({ records: [{
  kind: "hint", id: "cloud-hint", event_id: "same-identity", state: "pending",
}] }, [], []).map((row) => row.event_id), ["same-identity"],
"A canonical pending identity remains visible even when its detail endpoint lags");
assert.equal(canonicalPendingCandidates({ records: [{
  kind: "hint", id: "cloud-hint", event_id: "canonical-event", state: "pending",
}] }, [{ id: "cloud-hint", hint: true, event_id: "stale-event" }], [])[0].event_id,
"canonical-event", "Native verification must receive the summary's canonical event identity");

// Task 24.4 Production regression (2026-09-12, ¥104.49 / 招商银行):
// the pending hint carried an amount but no direction, so the server correctly
// rejected the one-click confirm with `hint_direction_required`. The Finance UI
// still offered「确认记账」and the record stayed pending forever - the user saw
// "confirmed" behaviour with the item still in 通知待确认.
assert.equal(
  candidateNeedsEditor({ amount_minor: 10449, direction: "", merchant: "" }),
  true,
  "an amount-only hint must open the editor instead of sending a confirm the server rejects",
);
assert.equal(
  candidateNeedsEditor({ amount_minor: 10449, direction: "expense", merchant: "" }),
  false,
  "amount + direction is enough for a one-click confirm (merchant may stay empty)",
);
assert.equal(
  candidateNeedsEditor({ amount_minor: 0, direction: "expense" }),
  true,
  "a missing amount always requires the editor",
);
assert.equal(
  candidateNeedsEditor({ amount_minor: 10449, direction: "UNKNOWN" }),
  true,
  "an unknown direction is not a user choice and must block confirm",
);

const unknown = candidatePresentation({ amount_minor: 0, direction: "", merchant: "" });
assert.equal(unknown.direction, "unknown");
assert.equal(unknown.directionLabel, "方向待核实");
assert.equal(unknown.merchantLabel, "商户未知（可选）");
assert.deepEqual(unknown.missing, ["金额", "收支方向"]);
assert.equal(unknown.primaryAction, "补全并确认");

const alipay = candidatePresentation({ amount_minor: 280, direction: "expense", merchant: "" });
assert.equal(alipay.directionLabel, "支出");
assert.equal(alipay.merchantLabel, "商户未知（可选）");
assert.deepEqual(alipay.missing, [], "merchant is optional and must not block booking");
assert.equal(alipay.primaryAction, "确认记账");
assert.equal(
  candidateNeedsEditor({ amount_minor: 10449, direction: "   " }),
  true,
  "whitespace is not a direction",
);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeFinanceDocument() {
  const attributes = new Map();
  const section = {
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { attributes.set(name, value); },
    addEventListener() {},
  };
  const list = {
    innerHTML: "",
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  globalThis.document = {
    activeElement: null,
    getElementById(id) { return id === "financeCandidatesSection" ? section : id === "financeCandidateList" ? list : null; },
    addEventListener() {},
  };
  return { list, section, attributes };
}

const priorDocument = globalThis.document;
const priorNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const priorWindow = globalThis.window;
try {
  const { list } = fakeFinanceDocument();
  const staleSummary = deferred();
  const complete = { id: "candidate-one", event_id: "event-one", amount_minor: 100, direction: "expense" };
  let summaryReads = 0;
  let candidateReads = 0;
  const controller = createFinanceCandidatesController({
    apiGet(path) {
      if (path === "/api/notification/pending-summary") {
        summaryReads += 1;
        if (summaryReads === 2) return staleSummary.promise;
        return Promise.resolve({ records: summaryReads === 1
          ? [{ kind: "candidate", id: complete.id, event_id: complete.event_id, state: "pending" }]
          : [] });
      }
      if (path.startsWith("/api/notification/candidates?")) {
        candidateReads += 1;
        return Promise.resolve({ candidates: [complete] });
      }
      if (path.startsWith("/api/notification/hints?")) return Promise.resolve({ hints: [] });
      throw new Error(`Unexpected GET ${path}`);
    },
    api: async () => ({ transaction_id: "transaction-one" }),
    storage: { getItem: () => "web:abcdefgh", setItem() {} },
    account: () => ({ id: "account-one" }),
    hasEntitlement: () => true,
    isSuperAdmin: () => false,
  });
  await controller.show();
  assert.match(list.innerHTML, /candidate-one/);
  const oldRefresh = controller.reload({ force: true });
  await Promise.resolve();
  controller.handleClick({ target: {
    closest(selector) { return selector === "[data-finance-candidate-confirm]"
      ? { dataset: { financeCandidateConfirm: complete.id } } : null; },
  } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotMatch(list.innerHTML, /data-finance-candidate="candidate-one"/,
    "Successful confirm must remove the candidate immediately");
  staleSummary.resolve({ records: [{
    kind: "candidate", id: complete.id, event_id: complete.event_id, state: "pending",
  }] });
  await oldRefresh;
  assert.doesNotMatch(list.innerHTML, /data-finance-candidate="candidate-one"/,
    "A response started before confirm must never revive its row");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(summaryReads, 3, "Confirm must read a fresh canonical summary after the old request");
  assert.equal(candidateReads, 3);
  assert.doesNotMatch(list.innerHTML, /data-finance-candidate="candidate-one"/);

  // A transient summary failure must preserve the last canonical view instead
  // of painting a possibly divergent hint/candidate union.
  const priorHtml = list.innerHTML;
  const failing = createFinanceCandidatesController({
    apiGet: async (path) => {
      if (path === "/api/notification/pending-summary") throw Object.assign(new Error("temporary"), { status: 503 });
      throw new Error(`Unexpected fallback GET ${path}`);
    },
    api: async () => ({}),
    storage: { getItem: () => "web:abcdefgh", setItem() {} },
    account: () => ({ id: "account-one" }),
    hasEntitlement: () => true,
    isSuperAdmin: () => false,
  });
  await failing.show();
  assert.match(list.innerHTML, /暂时无法加载/);
  assert.equal(candidateReads, 3, "A 503 summary response must not query independent detail lists");
  assert.ok(priorHtml.includes("暂无待处理") || priorHtml.includes("正在同步"));

  const verifyView = fakeFinanceDocument();
  const incomplete = { id: "hint-verify", event_id: "event:verify", amount_minor: 0, direction: "unknown", hint: true };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "thewyj-android/1.3.15" } });
  globalThis.window = { location: { href: "https://thewyj.uk/finance" } };
  const verification = createFinanceCandidatesController({
    apiGet: async (path) => path === "/api/notification/pending-summary"
      ? { records: [{ kind: "hint", id: incomplete.id, event_id: incomplete.event_id, state: "pending" }] }
      : path.startsWith("/api/notification/hints?") ? { hints: [{
        id: incomplete.id, source_event_id: incomplete.event_id, amount_minor: 0, direction: "unknown",
      }] } : { candidates: [] },
    api: async () => ({}),
    storage: { getItem: () => "web:abcdefgh", setItem() {} },
    account: () => ({ id: "account-one" }),
    hasEntitlement: () => true,
    isSuperAdmin: () => false,
  });
  await verification.show();
  assert.match(verifyView.list.innerHTML, /data-finance-candidate-verify="hint-verify"/);
  verification.handleClick({ target: {
    closest(selector) { return selector === "[data-finance-candidate-verify]"
      ? { dataset: { financeCandidateVerify: incomplete.id } } : null; },
  } });
  assert.equal(globalThis.window.location.href, "thewyj://payment/verify?event_id=event%3Averify",
    "Verify action must pass the same source identity to the native ticket flow");
} finally {
  if (priorDocument === undefined) delete globalThis.document;
  else globalThis.document = priorDocument;
  if (priorNavigator) Object.defineProperty(globalThis, "navigator", priorNavigator);
  else delete globalThis.navigator;
  if (priorWindow === undefined) delete globalThis.window;
  else globalThis.window = priorWindow;
}

console.log("Finance canonical identities, terminal refresh, native verification, and confirm eligibility checks passed.");

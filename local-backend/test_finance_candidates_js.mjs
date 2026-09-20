import assert from "node:assert/strict";

import { candidateNeedsEditor, candidatePresentation } from "../js/finance/candidates.js";

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

console.log("Finance candidate confirm eligibility checks passed (direction-aware editor routing).");

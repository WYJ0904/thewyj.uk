import assert from "node:assert/strict";

import { candidateNeedsEditor } from "../js/finance/candidates.js";

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
  false,
  "a normalized direction value is a real choice; only empty values block confirm",
);
assert.equal(
  candidateNeedsEditor({ amount_minor: 10449, direction: "   " }),
  true,
  "whitespace is not a direction",
);

console.log("Finance candidate confirm eligibility checks passed (direction-aware editor routing).");

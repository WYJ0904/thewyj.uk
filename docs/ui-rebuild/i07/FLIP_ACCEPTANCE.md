# I07 FLIP, Drag Sort & Keyed DOM Reconciliation Acceptance

## 1. Verification Scope

Covers bidirectional FLIP transitions (`js/core/motion-flip.js`), pointer/touch + keyboard reordering (`createDragSortController`), layout density changes (2-col <-> 1-col), rapid mid-flight cancellation/reversal, and keyed table reconciliation (`js/core/keyed-list.js`).

## 2. Automated Unit Evidence (`local-backend/test_i07_motion_engine.mjs`)

- `bidirectional FLIP animates both upward and downward moves and interrupts mid-flight` — **PASS**
- `reconcileKeyedRows with flip preserves exact DOM node identity when rows reorder` — **PASS**

## 3. Real Headless Chrome Evidence (`qa/i07/browser-acceptance.mjs`)

- **Scenario 3 (`flip-bidirectional-reversal-density-keyboard`) — PASS**
  - Initial layout (`flip-seq-1-initial.png`) -> Rapid reorder captured mid-flight downward (`flip-seq-2-mid-down.png`, computed `transform: matrix(1, 0, 0, 1, -164.278, 0)`) -> Mid-flight reversal upward (`flip-seq-3-mid-up.png`, computed `transform: matrix(1, 0, 0, 1, -186.723, 63.6209)`) -> 2-col to 1-col grid density change (`flip-seq-4-single-col.png`).
  - Telemetry confirmed DOM reference identity `flipIdentity: "4 / 4"`.
  - Keyboard reordering (`ArrowDown` / `ArrowUp`), hide-all empty state fallback, and one-click reset verified without focus loss.
- **Scenario 4 (`pointer-drag-sort-and-cancel`) — PASS**
  - Lifted first card via pointer drag (`drag-seq-1-lifting.png`), dropped onto slot 2 yielding `[card-2, card-1, card-3, card-4]` (`drag-seq-2-settled.png`).
  - Document-level pointer listeners avoid `lostpointercapture` cancellation bugs when `insertBefore` moves live DOM nodes during drag.
  - Initiated second drag and pressed `Escape`: order cleanly rolled back to `[card-2, card-1, card-3, card-4]`.
- **Scenario 5 (`keyed-table-node-identity-and-kill-switch`) — PASS**
  - Focused row toggle inside fixture keyed table, reversed row order, verified `sameRef === true` and `rowRebuilds === 0` (`tbody.innerHTML` never cleared).
  - Verified Kill Switch state lock disabled interactive row controls while preserving visible state text.

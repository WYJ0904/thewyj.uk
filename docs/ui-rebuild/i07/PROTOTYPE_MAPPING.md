# I07 Prototype Mapping & Defect Resolution Record

## 1. Authoritative Reference Sources Actually Read

Per repository rules and actual local filesystem verification:

- Read in full: `Aeris_I_series_UI_refactor_execution_baseline_v1.1_2026-11-17.txt` (from Owner's workspace directory; V1.1 execution order `I01 -> I02 -> I07 -> I03...`, visual tokens, platform sheet differentiation rules, and known prototype pitfalls).
- Verified absent locally: `Aeris_I_series_UI_interactive_prototype_2026-11-17.html` (same status documented earlier in `docs/ui-rebuild/i02/PROTOTYPE_MAPPING.md`). Zero unverified prototype code lines were fabricated.
- Known architectural targets from Owner specification & `I02` handoff implemented faithfully in I07:

## 2. Structural Component Mapping

| Prototype / Baseline Concept | I07 Production Implementation | File(s) | Notes |
| :--- | :--- | :--- | :--- |
| `.seg-indicator` sliding tab capsule | Dynamic ResizeObserver + computed geometry positioning with `prefers-reduced-motion` instant snap | `design-system.css`, `js/core/motion.js` | Discovers static and lazy modal/admin `[role="tablist"]` via `MutationObserver` |
| `.gesture-sheet` + `.sheet-backdrop` | Responsive `isMobileSheetViewport(768px)` switcher (`drawer` on mobile vs `modal` on desktop) | `js/core/motion-sheet.js`, `design-system.css` | Protects `[role="alertdialog"]` & `[data-confirm-only]` as centered non-swipeable modal on all viewports |
| `.app-scale-wrap` background micro-scale | CSS `--ds-bg-scale` & `--ds-backdrop-alpha` driven on `#v3AppFrame` / `.app-scale-wrap` during overlay open/swipe | `js/core/motion-sheet.js`, `design-system.css` | Skips workspace sections marked `dataset.sheetWorkspace = "true"` (`#accountModal`, `#membershipModal`) |
| Dual-slot Toast queue strategy | Max-`2` visible slots (`.ds-toast-region`), bounded overflow queue (`maxQueue: 12`), error-eviction protection, hover/focus pause | `js/core/motion-toast.js`, `design-system.css` | Prevents low-priority info/success bursts from burying urgent errors |
| Scroll-driven `translate3d` / `rotateX` / `scale` | Normalized viewport entry progress `computeScrollProgress`, `computeCenteredParallax`, single-rAF batch write | `js/core/motion-scroll.js` | Bi-directionally reversible when scrolling back up; flattens cleanly under Reduced Motion |
| `.apple-bento-wall` + `.tile-inner` | Outer `.bento-tile` locked `transform: none` with `overflow: hidden`; inner `.tile-inner` carries hardware parallax | `design-system.css`, `js/core/motion-scroll.js` | Measured `maxSeamDriftPx === 0` in Chrome telemetry |

## 3. Explicit Fixes for Known Prototype Defects (Never Copied Verbatim)

1. **Defect #1 — Asymmetric FLIP only animated downward moves**:
   - *Fix in `js/core/motion-flip.js`*: `captureFlipSnapshot` records bounding rects across all keyed children regardless of reorder direction. `playFlipSnapshot` stores initial/prior `transform` before calling double-`rAF`, flags elements with `data-flip-moving="true"`, and animates delta `(prev.left - next.left, prev.top - next.top)` identically for both upward and downward swaps as well as single-/two-column grid density changes.
   - *Verification*: Fixture Scenario 3 captured mid-flight upward (`matrix(1, 0, 0, 1, -186.723, 63.6209)`) and downward (`matrix(1, 0, 0, 1, -164.278, 0)`) active transforms and `4 / 4` DOM identity retention.
2. **Defect #2 — Admin table updates destroyed DOM state via `tbody.innerHTML`**:
   - *Fix in `js/core/keyed-list.js`*: `reconcileKeyedRows` now supports `{ flip: true }` opt-in, reconciling existing `<tr>` DOM nodes in-place by key (`insertBefore`) and compositing FLIP deltas without detaching inputs, focus, or toggle states.
   - *Verification*: Scenario 5 confirms `sameRef === true` and `rowRebuilds === 0` across reorders with active focus preserved inside the row switch.
3. **Defect #3 — Identical centered sheet on PC and mobile**:
   - *Fix in `js/core/motion-sheet.js`*: Desktop (`>768px`) renders spring-eased centered dialogs; mobile (`<=768px`) converts dismissible `.modal-layer` sheets (such as `#feedbackModal` and `.fixtureSheetModal`) to bottom-docked swipe drawers with `.ds-sheet-handle`, `1:1` touch tracking, upward rubber-band damping, and velocity/distance dismiss thresholds, while explicitly keeping destructive confirms (`#deleteAccountModal`, `role="alertdialog"`) locked as non-swipeable centered modals.

## 4. Isolation Guarantee

No synthetic financial amounts, fake audit entries, dummy permissions, or mock login states from prototype concepts were introduced into any production script (`app.js`, `functions/`, `js/core/`). Synthetic test data lives strictly in `qa/i07/` Miniflare fixture harness code.

# I07 Interaction Coverage Matrix

## 1. Audited Inventory Summary (`index.html` + Shared Controllers)

Static baseline extracted directly from `index.html` and wired controllers:

- `<a>` links (`49`) & `<button>` controls (`268`): Covered via delegated pointer/keyboard press feedback (`[data-press="true"]`), `:focus-visible` outlines, and `setControlFeedbackState` (`idle` / `pending` / `success` / `error` with `aria-busy` & disabled-button guard against false success).
- `<details>` disclosures (`12` + dynamic): Smooth measured height reveal/collapse in `installMotionSystem`.
- `<form>` (`16`), `<select>` (`41`), `<textarea>` (`10`), `<input>` (`86`, including `14` checkboxes): Form validation error cue via delegated `invalid` + `[aria-invalid="true"]`; checkbox/switch CSS tokens from `design-system.css`; async switch rollback semantics verified on fixture & shared adapters.
- `[role="tablist"]` (`5` static + dynamic modal/admin tablists) / `[role="tab"]` (`24`): Dynamic `.seg-indicator` sliding capsule + `createTabSkeletonSwitcher` (`140ms` cancellable skeleton preview, stale switches resolve cleanly with `false`).
- `.modal-layer` (`10` in `index.html` plus dynamic dialogs): Wired in `app.js` `openModal()` / `closeModal()` / `hidePrimaryScreens()` to `attachSheetAdapter` + reference-counted `syncModalScrollLock`. Workspace `<section>` routes (`#membershipModal`, `#accountModal`) explicitly flagged `dataset.sheetWorkspace = "true"` so they do not mis-trigger bottom-sheet drag or scroll lock.
- File Dropzone (`#transferDropZone`, `1`): Wired in `js/transfer/app.js` via `attachFileDropFeedback` (`data-drop-state="idle|dragover|valid|invalid|uploading"`).
- Notifications (`showAchievementToast` in `app.js`): Delegated to shared `showToast` (`max 2` visible, bounded queue, deduplication, error protection, hover/focus timer pause) when `P07 UI` is enabled.
- Structured Reordering / Bento / Scroll 3D (`js/core/keyed-list.js`, `motion-flip.js`, `motion-scroll.js`): Engines delivered and verified in unit tests and `/__preview/i07-fixture.html`; surface-level adoption across home Bento / workspace cards / table views intentionally deferred to **I03–I09** per Owner phase boundaries.

## 2. Coverage Matrix (Split Metrics — No Conflation)

| Category | Feedback Semantic | Covered Surfaces (I07 Actual) | Status in I07 | Owner Next Phase |
| :--- | :--- | :--- | :--- | :--- |
| Primary / Secondary / Danger Buttons | Instant press scale (`--ds-press-scale`), async `pending`/`success`/`error`, disabled guard | All `<button>` via delegated `installMotionSystem`; `setControlFeedbackState` | **LIVE_IN_APP** (`268` static buttons + dynamic buttons) | I03–I09 domain async bindings |
| Links & Navigation Triggers | Subtle press & active focus ring without bounce | All `<a class="primary">` & nav links (`49` static) | **LIVE_IN_APP** | I03 public nav polish |
| Segmented Tabs & Admin/Modal Tabs | Sliding `.seg-indicator` + `140ms` cancelable skeleton preview | All `5` static + dynamic `[role="tablist"]` (`24+` tabs), modal tabs (`#feedbackModal`, `#adminPanel`) | **LIVE_IN_APP** (indicator) + **ENGINE_AND_FIXTURE** (skeleton) | I03/I04 content panels adopt `createTabSkeletonSwitcher` |
| Disclosures (`<details>`) | Height interpolation, interruptible toggle, no content flash | All `12` static + dynamic `<details>` | **LIVE_IN_APP** | Complete |
| Form Inputs, Switches & Validation | Shake/border pulse on `invalid`, optimistic switch with fail rollback | `16` forms, `86` inputs, `41` selects, `10` textareas (`invalid` listener); async switch verified in fixture | **LIVE_IN_APP** (validation highlight) + **ENGINE_AND_FIXTURE** (async switch) | I04–I08 domain forms & settings switches |
| File Upload / Dropzone | Drag-enter scale & border tint (`valid`/`invalid`), immediate drop settle | `#transferDropZone` (`js/transfer/app.js`) | **LIVE_IN_APP** | I08 transfer UX polish |
| Modals, Drawers & Confirm Dialogs | Desktop spring modal + background `.app-scale-wrap` scale; Mobile swipe drawer (`dy` threshold + rubber-band); `alertdialog`/`[data-confirm-only]` non-swipeable guard | All `10` `.modal-layer` dialogs via `app.js` `openModal`/`closeModal` (`#feedbackModal`, `#deleteAccountModal`, etc.) + `#homeWidgetEditor` excluded appropriately | **LIVE_IN_APP** | I04/I09 per-screen modal refinement |
| Toast Notifications | Max `2` visible stacked cards, bounded FIFO queue, identical message badge dedupe, error eviction shield, hover pause | `app.js` `showAchievementToast` (P07 ON) + shared `window.WYJMotion.showToast` | **LIVE_IN_APP** (`showToast` runtime) + **FIXTURE_VERIFIED** (5-burst/queue) | I04–I09 adopt structured `showToast` tones |
| FLIP Layout, Pointer Drag & Keyed Rows | Symmetric bidirectional FLIP, mid-flight reversal, drag ghost & cancel rollback, DOM node identity preservation (`0` row rebuilds) | `motion-flip.js` (`captureFlipSnapshot`, `playFlipSnapshot`, `createDragSortController`) + `keyed-list.js` (`{ flip }`) | **ENGINE_AND_FIXTURE** (fixture verified + unit tested; zero legacy module churn) | I04 workspace cards & I09 admin tables |
| Scroll-Driven 3D & Bento Parallax | Viewport progress `rotateX`/`scale`/`translateY`, scroll-up reversibility, `.apple-bento-wall` locked outer seam + `.tile-inner` parallax | `motion-scroll.js` (`createScrollProgressController`) | **ENGINE_AND_FIXTURE** | I03 public showcase & I04 dashboard Bento |

## 3. Honest Coverage Percentages

Per Owner instruction, I07 distinguishes **shared baseline controls hooked now** vs **domain modules delegated to I03–I09**:

- **Shared Public Interactive Primitives Coverage (`LIVE_IN_APP` delegated/wired globally on `index.html`)**: `100%` of base press/focus primitives (`49` links, `268` buttons), `100%` of static/dynamic `<details>` (`12+`), `100%` of `[role="tablist"]` (`5+`), `100%` of `.modal-layer` dialogs (`10`), `100%` of `<form>` invalid cues (`16`), and `1/1` upload dropzone (`#transferDropZone`).
- **Domain/Feature-Specific Interaction Engines (`ENGINE_AND_FIXTURE`, awaiting I03–I09 business surfaces per scope boundary)**: Bidirectional card FLIP, pointer/keyboard drag sort, keyed table FLIP adoption across admin/finance renderers, async switch rollback bindings, and public landing 3D Bento showcase — intentionally NOT wired into legacy I03/I04 pages during I07 to avoid unauthorized architectural rewrites.
- **Unmodified / Deferred by Design**: Canvas/SVG game timers in `js/tools/` and external Task54 AI workflows (`0%` motion interference; left untouched).

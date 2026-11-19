# I07 -> I03 / I04 / I05–I09 Integration Handoff Guide

## 1. Ready-to-Consume Engine Entrypoints

All modules live under `js/core/` and are exposed both via ES module imports (`?release=20261119-aeris-i07-preview` or active `ASSET_RELEASE`) and via `window.WYJMotion` after `installMotionGlobal()`:

- **Press, Disclosure, Form Validation & Tabs (`js/core/motion.js`)**:
  - `installMotionSystem(root)` automatically handles all buttons/links press cues, `<details>` height animation, `<form>` `invalid` cues, and `.seg-indicator` across static and dynamically inserted `[role="tablist"]` nodes (`MutationObserver` watches DOM additions).
  - `createTabSkeletonSwitcher({ duration: MOTION.skeleton, view })`: Use in I03 public showcase tabs & I04 workspace views to avoid stale async panel renders overwriting newer user clicks (`switchTo(...)` resolves `false` if superseded).
  - `setControlFeedbackState(el, state, options)`: Use on all domain async submit/save buttons (`"idle" | "pending" | "success" | "error"`). Never flip disabled controls to `"success"`.
  - `attachFileDropFeedback(zoneEl, { validate, onFiles, doc })`: Use on upcoming file upload/import dropzones (already wired on `#transferDropZone`).
- **Bidirectional FLIP, Drag Sort & Keyed Tables (`js/core/motion.js`, `js/core/keyed-list.js`)**:
  - Use `reconcileKeyedRows(tbody, items, { getKey, createRow, updateRow, flip: true })` instead of clearing `tbody.innerHTML` when updating finance ledgers (I05/I06), wrong-question lists (I05), or admin user/flag tables (I09).
  - Use `captureFlipSnapshot` + `playFlipSnapshot` (or `flipLayout`) when reordering I04 workspace cards, filtering tool cards, or changing grid column density.
  - Use `createDragSortController` for sortable cards/lists — already handles pointer events on `document` and `ArrowUp`/`ArrowDown`/`Escape` keyboard cancellation cleanly.
- **Desktop Modal vs Mobile Drawer (`js/core/motion.js`)**:
  - Wire new overlays through `openModal`/`closeModal` in `app.js` (which calls `attachSheetAdapter` + reference-counted `syncModalScrollLock`).
  - Set `role="alertdialog"` or `data-confirm-only="true"` (or `dismissible: false`) on any destructive confirmation dialog so mobile viewports keep it centered and non-swipeable.
  - Mark full-screen workspace `<section>` routes outside modal overlays with `dataset.sheetWorkspace = "true"` so they never trigger `#v3AppFrame` scaling or scroll lock.
- **Toast Queue (`js/core/motion.js`)**:
  - Call `showToast({ tone: "success"|"info"|"warning"|"error", message, duration })` instead of custom floating banners so all product surfaces honor the global max-2-visible stack, deduplication, and error protection rules.
- **Scroll-Driven 3D & Bento Parallax (`js/core/motion.js`)**:
  - Attach `createScrollProgressController({ root, doc, view })` in I03 landing showcase and I04 Bento sections containing `.scroll-preview-wrap` or `.apple-bento-wall > .bento-tile > .tile-inner`.
  - Never apply CSS transforms directly to outer `.bento-tile` grid cells; always animate `.tile-inner` inside `overflow: hidden` so adjacent seams remain locked at `0px` drift.

## 2. Responsibilities Reserved for I03–I09 & I10

1. **I03 Public Home & Onboarding**: Wire `.scroll-preview-wrap` / `.apple-bento-wall` hero sections to `createScrollProgressController`; attach `createTabSkeletonSwitcher` where public showcase segments swap heavy content.
2. **I04 Personal Workspace & Dashboard**: Wire Bento widgets and sortable workspace cards to `js/core/motion.js` (`captureFlipSnapshot`/`playFlipSnapshot`/`createDragSortController`); apply semantic `setControlFeedbackState` + optimistic switch rollback to workspace preferences.
3. **I05–I09 Domain Modules (Finance, Language, Tools, Transfer, Admin)**: Migrate legacy `tbody.innerHTML` rebuilds to `reconcileKeyedRows(..., { flip: true })`; replace ad-hoc notifications with structured `showToast` tones.
4. **I10 Full-Site Motion Audit**: Verify `LIVE_IN_APP` interaction coverage across all newly rebuilt I03–I09 views cleanly reaches target site-wide thresholds.

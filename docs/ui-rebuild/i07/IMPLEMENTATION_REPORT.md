# I07 Implementation Report — Shared Motion & Interaction System

## 1. Executive Summary & Git Metadata

- **Task**: `Aeris V6.3 — I07｜共享动效引擎与全站交互系统`
- **Base Branch / SHA**: `hydrogen/i02-css-component-foundation` @ `1e1d2d21c143be36268e7d1192f6399cd4e2f782`
- **Development Branch**: `hydrogen/i07-motion-interaction-engine`
- **Worktree**: `motion_interaction_engine` (`aeris_i07_motion_interaction_engine` isolated checkout)
- **Release Identifier (`ASSET_RELEASE`)**: `20261119-aeris-i07-preview`
- **Hosted Preview (`thewyj-p07-ui-rc`)**: Alias `https://i07-motion-engine.thewyj-p07-ui-rc.pages.dev` · Immutable `https://ce253791.thewyj-p07-ui-rc.pages.dev` (code commit `e1e5057d13668c8a9434da2cd9e7cc0acf80ddf8`, non-Production D1 `a3e6253b-689f-49f3-998b-7c5828ea255a`)
- **Stacked Draft PR**: `#164` (`https://github.com/WYJ0904/thewyj.uk/pull/164`) opened against `--base hydrogen/i02-css-component-foundation` (`hydrogen/i07-motion-interaction-engine`, do not merge PR #162/#163/#164)

## 2. Architecture & Code Changes Implemented

### Consolidated Shared Motion Engine (`js/core/motion.js` inside `CORE_SHELL`)
Per strict Service Worker publication governance (`qa/aeris/p5-pwa-browser.mjs` and `qa/p07-release/sw-install.test.mjs`, which enforce exact 81-entry `CORE_SHELL` and 89-entry `REQUIRED_SHELL` with zero unallowlisted boot files in `PUBLICATION_CACHE`), the 6 decoupled I07 subsystems are structured inside `js/core/motion.js`:
1. **Tokens, Reduced-Motion Guard & Lifecycle Scope**: `MOTION`, `pressedReleaseDelay`, `prefersReducedMotion`, `motionDuration`, and `createMotionScope`.
2. **Bidirectional FLIP & Drag Sort**: `captureFlipSnapshot`, `playFlipSnapshot`, `flipLayout`, and pointer/keyboard `createDragSortController` (uses document-level pointer listeners so `insertBefore` never drops capture).
3. **Bounded Toast Queue**: `createToastManager`, `getSharedToastManager`, `showToast`, `dismissToast` with max-`2` visible cap, overflow queue (`maxQueue: 12`), deduplication badge counter, `error` eviction shield, hover/focus pause, and `aria-live` routing.
4. **Platform-Adaptive Modal & Mobile Gesture Drawer**: `isMobileSheetViewport`, `syncModalScrollLock`, `getScrollLockCount`, `attachSheetAdapter` differentiating desktop spring modals (`>760px`, background `.app-scale-wrap`/`#v3AppFrame` scaling) from mobile bottom swipe drawers (`<=760px`, 1:1 drag + rubber-band damping + threshold dismiss) while locking `[role="alertdialog"]`/`[data-confirm-only]` as non-swipeable centered modals and skipping `[data-sheet-workspace="true"]` views.
5. **Scroll-Driven 3D & Locked-Frame Bento Parallax**: `clamp01`, `lerp`, `computeScrollProgress`, `computeCenteredParallax`, `createScrollProgressController` (`IntersectionObserver`-gated, single-`rAF` batched read/write) driving reversible `.scroll-preview-wrap` 3D transforms and outer-seam-locked `.tile-inner` parallax.
6. **Delegated Controls, Tab Indicator & Skeleton Switcher Orchestrator**: Extended `installMotionSystem` (press, `<details>` disclosure, `MutationObserver` dynamic `[role="tablist"]` discovery + `.seg-indicator`, delegated `invalid` form validation highlighting), `setControlFeedbackState`, `createTabSkeletonSwitcher`, `attachFileDropFeedback`, and `installMotionGlobal()` (`window.WYJMotion`).

### Extended Core Modules & Shared Controls
- `js/core/keyed-list.js`: Extended `reconcileKeyedRows` with opt-in `{ flip }` importing cleanly from `./motion.js` while preserving DOM node references and active input focus.
- `design-system.css`: Added I07 motion tokens (`--ds-duration-sheet: 280ms`, `--ds-duration-page: 220ms`, `--ds-duration-container: 420ms`), `:root` fallback custom properties (`--ds-bg-scale`, `--ds-backdrop-alpha`, `--ds-scroll-*`, `--ds-parallax-y`), `.seg-indicator`, `[data-skeleton-loading]`, `[data-feedback-state]`, `[data-drop-state]`, `.ds-sheet-handle`, `.app-scale-wrap`, mobile confirm modal protection, `.ds-toast-region`/`.ds-toast*`, `.scroll-preview-wrap`, `.apple-bento-wall`/`.bento-tile`/`.tile-inner`, and Reduced Motion resets (`0` new `!important` rules; zero `opacity` in `dsModalPanelIn/Out`; `dsModalPanelIn` completes in `220ms` so mobile `44px` touch targets settle deterministically).
- `app.js` & `js/transfer/app.js`: Wired `openModal`/`closeModal`/`hidePrimaryScreens` to `attachSheetAdapter` + `syncModalScrollLock` (flagging `#membershipModal`/`#accountModal` as `dataset.sheetWorkspace = "true"`), wired `showAchievementToast` P07 ON delegation to `showToast`, and wired `#transferDropZone` to `attachFileDropFeedback`.
- `sw.js` & `ASSET_RELEASE`: Bumped release stamp uniformly across 29 files (`20261119-aeris-i07-preview`), kept exact RC5 `CORE_SHELL` (`81`) and `REQUIRED_SHELL` (`89` = `INSTALL_SHELL`), and recomputed Task27 publication hashes.

### Isolated Preview Fixture & Verification Harnesses
- `qa/i07/fixture.html`, `qa/i07/fixture.css`, `qa/i07/fixture.js`: CSP-compliant isolated exercise harness exercising all I07 motion engines via `js/core/motion.js` + `design-system.css`, Light/Dark themes, Reduced Motion toggle, Offline toggle, and live performance/seam telemetry (`window.__i07FixtureTelemetry()`). Excluded from Production staging by `scripts/stage_pages_deploy.mjs`.
- `local-backend/test_i07_motion_engine.mjs`, `qa/i07/browser-acceptance.mjs`, `qa/i07/stage-preview.mjs`, `qa/i07/verify-preview.mjs`: Full unit, Miniflare + Chrome CDP acceptance, preview staging, and live preview verification scripts.

## 3. Documentation & Evidence Index (`docs/ui-rebuild/i07/`)

- [EXTERNAL_INTERACTION_REFERENCES.md](./EXTERNAL_INTERACTION_REFERENCES.md) — Evaluated OSS interaction architectures & licenses (Vaul, Sonner, Auto-Animate/FLIP, Radix Primitives, native Web APIs)
- [MOTION_ARCHITECTURE.md](./MOTION_ARCHITECTURE.md) — Module graph, delegation model, lifecycle safety, SW invariants
- [INTERACTION_COVERAGE_MATRIX.md](./INTERACTION_COVERAGE_MATRIX.md) — Audited counts & honest split between shared hooks (`LIVE_IN_APP`) and engine/fixture coverage (`ENGINE_AND_FIXTURE`)
- [PROTOTYPE_MAPPING.md](./PROTOTYPE_MAPPING.md) — Baseline mapping & explicit resolution of the 3 known prototype defects
- [FLIP_ACCEPTANCE.md](./FLIP_ACCEPTANCE.md) — Bidirectional FLIP, drag sort, keyboard reordering, keyed table node identity
- [MODAL_DRAWER_ACCEPTANCE.md](./MODAL_DRAWER_ACCEPTANCE.md) — Desktop spring modal vs mobile swipe drawer & confirm guard
- [TOAST_ACCEPTANCE.md](./TOAST_ACCEPTANCE.md) — Max-2 visible queue, dedupe, error protection, hover pause
- [SCROLL_3D_ACCEPTANCE.md](./SCROLL_3D_ACCEPTANCE.md) — Reversible scroll 3D & zero-drift Bento seam telemetry
- [INTERACTION_ACCEPTANCE.md](./INTERACTION_ACCEPTANCE.md) — Semantic states, optimistic switch rollback, Reduced Motion & P07 OFF fallback
- [PERFORMANCE_AND_A11Y.md](./PERFORMANCE_AND_A11Y.md) — `5` `axe-core` `0`-violation scans, `4`-width `0px` overflow matrix, telemetry
- [VISUAL_EVIDENCE.md](./VISUAL_EVIDENCE.md) — `20` local sequential/responsive/app screenshots & hosted preview screenshots
- [REGRESSION.md](./REGRESSION.md) — Complete local unit, static, Python, Miniflare, browser, build determinism, Hosted Preview & CI summary
- [RISKS_AND_ROLLBACK.md](./RISKS_AND_ROLLBACK.md) — Mitigations, scope boundaries & instant/branch rollback plans
- [I03_I04_HANDOFF.md](./I03_I04_HANDOFF.md) — Concrete API & migration guide for I03–I10

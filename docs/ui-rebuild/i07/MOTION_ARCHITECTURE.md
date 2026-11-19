# I07 Motion Architecture — Shared Motion & Interaction System

## 1. Design Goals & Architectural Principles

- **Zero-framework, layered extension of existing `js/core/motion.js`**: Preserves all I01/I02 CSS tokens, component contracts, CSP (`script-src 'self'; style-src 'self'`), ES module graph rules (`js/core/*.js` may only import sibling `./*.js` with zero cycles), and Service Worker RC5 atomic publication invariants.
- **Transform & opacity compositing first**: No continuous keyframe loops, no layout thrashing in scroll listeners, and strict separation between motion presentation (`data-press`, `data-feedback-state`, `data-drop-state`, `data-sheet-mode`) and authoritative business state.
- **Cancelable, reversible, and interruptible by default**: Every async UI state (tab skeleton switch, FLIP reorder, pointer drag sort, swipe drawer, toast auto-dismiss) carries a lifecycle controller or cancellation token so rapid repeat interactions never corrupt state or leave orphaned timers/listeners.
- **Reduced Motion Parity**: When `prefers-reduced-motion: reduce` is active, spatial displacement/spring/3D tilt collapses cleanly, while semantic status feedback (active ring, spinner/text badge, error alert, toast arrival, focus indicator) remains completely intact.
- **Feature-Flag Kill Switch (`p07_accessibility` OFF)**: When `document.documentElement.dataset.p07Ui === "disabled"`, enhanced choreography (springs, FLIP motion, 3D tilt, toast queue stacking) degrades safely while core controls, navigation, forms, and dialogs remain 100% functional.

## 2. Internal Subsystem Decomposition & Module Graph

All motion runtime subsystems reside inside `js/core/motion.js` (with `js/core/keyed-list.js` importing `captureFlipSnapshot` / `playFlipSnapshot` cleanly and acyclically, verified by `node scripts/check_js_module_graph.mjs`: `67` files, `111` imports, `0` cycles):

```text
js/core/motion.js (6 Decoupled Subsystems inside CORE_SHELL)
  ├── §1 Tokens, Reduced-Motion Guard & Lifecycle Scope (createMotionScope)
  ├── §2 Bidirectional FLIP & Pointer/Keyboard Drag Sort
  ├── §3 Bounded Toast Queue Manager
  ├── §4 Platform-Adaptive Modal & Mobile Gesture Drawer Adapter
  ├── §5 Scroll-Driven 3D Progress & Locked-Frame Bento Parallax
  └── §6 Delegated Controls, Tab Indicator & Skeleton Switcher Orchestrator
        ↑ imported acyclically by js/core/keyed-list.js (reconcileKeyedRows { flip })
```

### Public Exports (`js/core/motion.js` & `js/core/keyed-list.js`)

- **Tokens & Scope**: `MOTION`, `pressedReleaseDelay`, `prefersReducedMotion`, `motionDuration`, `createMotionScope`
- **FLIP & Drag Sort**: `captureFlipSnapshot`, `playFlipSnapshot`, `flipLayout`, `createDragSortController`
- **Toast Queue**: `createToastManager`, `getSharedToastManager`, `showToast`, `dismissToast`
- **Modal / Drawer Sheet Adapter**: `isMobileSheetViewport`, `syncModalScrollLock`, `getScrollLockCount`, `attachSheetAdapter`
- **Scroll 3D & Parallax**: `clamp01`, `lerp`, `computeScrollProgress`, `computeCenteredParallax`, `createScrollProgressController`
- **Delegated Controls & Globals**: `setControlFeedbackState`, `createTabSkeletonSwitcher`, `attachFileDropFeedback`, `installMotionGlobal`, `installMotionSystem`
- **`js/core/keyed-list.js`**: `reconcileKeyedRows` (accepts `{ flip }` options)

## 3. Event Delegation, Lifecycle & Memory Safety

- `installMotionSystem(root)` is idempotent via `WeakSet` (`installedRoots`) and returns a cleanup handle.
- Uses **single delegated listeners** on `root` (`pointerdown/up/cancel`, `keydown/keyup`, `click`, `invalid`, `toggle`) rather than per-element event listeners across 268+ buttons or dynamic lists.
- Uses **two scoped `MutationObserver`s** (`<details>` disclosure sync and dynamic `[role="tablist"]` discovery for `.seg-indicator`), preserving exact observer ordering expected by existing `local-backend/test_motion_js.mjs`.
- `createMotionScope()` centralizes `setTimeout`, Web Animations (`Animation.cancel()`), and listener cleanup so route navigation or modal closure aborts in-flight animations without post-unmount callbacks.

## 4. Service Worker & Release Pinning Compatibility

- Existing RC5 `CORE_SHELL` (`81` assets) and `REQUIRED_SHELL` (`89` assets) remain unmodified (`INSTALL_SHELL = REQUIRED_SHELL`), because `qa/aeris/p5-pwa-browser.mjs` and `qa/p07-release/sw-install.test.mjs` strictly forbid adding extra startup ES module URLs into offline `PUBLICATION_CACHE`. Consolidating the 6 decoupled subsystems inside `js/core/motion.js` (already in `CORE_SHELL`) guarantees 100% offline boot and zero extra network requests.
- `ASSET_RELEASE` bumped uniformly to `20261119-aeris-i07-preview` with recalculated Task27 integrity publication manifest (`npm run task27:publication`), verified by `node qa/p07-release/sw-install.test.mjs` (`20/20 PASS`).

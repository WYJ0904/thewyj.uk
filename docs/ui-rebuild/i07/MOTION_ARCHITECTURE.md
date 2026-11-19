# I07 Motion Architecture — Shared Motion & Interaction System

## 1. Design Goals & Architectural Principles

- **Zero-framework, layered extension of existing `js/core/motion.js`**: Preserves all I01/I02 CSS tokens, component contracts, CSP (`script-src 'self'; style-src 'self'`), ES module graph rules (`js/core/*.js` may only import sibling `./*.js` with zero cycles), and Service Worker RC5 atomic publication invariants.
- **Transform & opacity compositing first**: No continuous keyframe loops, no layout thrashing in scroll listeners, and strict separation between motion presentation (`data-press`, `data-feedback-state`, `data-drop-state`, `data-sheet-mode`) and authoritative business state.
- **Cancelable, reversible, and interruptible by default**: Every async UI state (tab skeleton switch, FLIP reorder, pointer drag sort, swipe drawer, toast auto-dismiss) carries a lifecycle controller or cancellation token so rapid repeat interactions never corrupt state or leave orphaned timers/listeners.
- **Reduced Motion Parity**: When `prefers-reduced-motion: reduce` is active, spatial displacement/spring/3D tilt collapses cleanly, while semantic status feedback (active ring, spinner/text badge, error alert, toast arrival, focus indicator) remains completely intact.
- **Feature-Flag Kill Switch (`p07_accessibility` OFF)**: When `document.documentElement.dataset.p07Ui === "disabled"`, enhanced choreography (springs, FLIP motion, 3D tilt, toast queue stacking) degrades safely while core controls, navigation, forms, and dialogs remain 100% functional.

## 2. Module Decomposition & Dependency Graph

All modules reside under `js/core/` with strictly acyclic imports verified by `node scripts/check_js_module_graph.mjs`:

```text
js/core/motion-tokens.js  (Leaf: tokens, timings, Reduced Motion helpers, createMotionScope)
   ├── js/core/motion-flip.js    (Bidirectional FLIP snapshot/playback + pointer/keyboard drag sort)
   ├── js/core/motion-toast.js   (Max-2 visible bounded Toast queue, dedupe, error protection, hover pause)
   ├── js/core/motion-sheet.js   (Desktop Spring Modal vs Mobile Gesture Drawer + scroll-lock counter)
   ├── js/core/motion-scroll.js  (IntersectionObserver + single-rAF scroll progress & centered parallax)
   └── js/core/motion.js         (Orchestrator: installMotionSystem, global press/disclosure/tablists/switch/form/dropzone, window.WYJMotion)
         └── js/core/keyed-list.js (reconcileKeyedRows with optional { flip } preserving DOM node identity)
```

### Public Exports by Module

- **`js/core/motion-tokens.js`**: `MOTION`, `pressedReleaseDelay`, `prefersReducedMotion`, `motionDuration`, `createMotionScope`
- **`js/core/motion-flip.js`**: `captureFlipSnapshot`, `playFlipSnapshot`, `flipLayout`, `createDragSortController`
- **`js/core/motion-toast.js`**: `createToastManager`, `getSharedToastManager`, `showToast`, `dismissToast`
- **`js/core/motion-sheet.js`**: `isMobileSheetViewport`, `syncModalScrollLock`, `getScrollLockCount`, `attachSheetAdapter`
- **`js/core/motion-scroll.js`**: `clamp01`, `lerp`, `computeScrollProgress`, `computeCenteredParallax`, `createScrollProgressController`
- **`js/core/motion.js`**: Re-exports all sub-module APIs plus `setControlFeedbackState`, `createTabSkeletonSwitcher`, `attachFileDropFeedback`, `installMotionGlobal`, `installMotionSystem`
- **`js/core/keyed-list.js`**: `reconcileKeyedRows` (accepts `{ flip, doc, view }` options)

## 3. Event Delegation, Lifecycle & Memory Safety

- `installMotionSystem(root)` is idempotent via `WeakSet` (`installedRoots`) and returns a cleanup handle.
- Uses **single delegated listeners** on `root` (`pointerdown/up/cancel`, `keydown/keyup`, `click`, `invalid`, `toggle`) rather than per-element event listeners across 268+ buttons or dynamic lists.
- Uses **two scoped `MutationObserver`s** (`<details>` disclosure sync and dynamic `[role="tablist"]` discovery for `.seg-indicator`), preserving exact observer ordering expected by existing `local-backend/test_motion_js.mjs`.
- `createMotionScope()` centralizes `setTimeout`, Web Animations (`Animation.cancel()`), and listener cleanup so route navigation or modal closure aborts in-flight animations without post-unmount callbacks.

## 4. Service Worker & Release Pinning Compatibility

- Existing RC5 `CORE_SHELL` (`81` assets) and `REQUIRED_SHELL` (`89` assets) remain unmodified in order/contents, while the 5 new modular runtime files (`motion-tokens.js`, `motion-flip.js`, `motion-toast.js`, `motion-sheet.js`, `motion-scroll.js`) are declared in `I07_MOTION_SHELL` and atomically installed via `INSTALL_SHELL = [...REQUIRED_SHELL, ...I07_MOTION_SHELL]`.
- `ASSET_RELEASE` bumped uniformly to `20261119-aeris-i07-preview` with recalculated Task27 integrity publication manifest (`npm run task27:publication`), verified by `node qa/p07-release/sw-install.test.mjs` (`20/20 PASS`).

# I07 Interactive Semantics & Reduced Motion Acceptance

## 1. Owner Interaction Rules Verification

| Requirement | Mechanism Verified | Evidence |
| :--- | :--- | :--- |
| Instant press feedback without hindering fast taps | Delegated `[data-press="true"]` on pointer/keyboard press with timed release via `pressedReleaseDelay` | `test_motion_js.mjs` + Scenario 1 |
| Semantic separation (hover, press, pending, success, error, disabled) | `setControlFeedbackState(el, state)` sets `data-feedback-state`, manages `aria-busy`, and blocks `success` transition on disabled controls | `test_i07_motion_engine.mjs` + Scenario 1 |
| Async switch failure rollback + offline guard | Switch enters `pending`, waits async outcome; failure rolls back `aria-checked` and emits error toast without lying about persistence | Scenario 1 (`failSwitchState: { checked: false, text: "保存失败，已回滚至：关闭" }`) |
| Form validation & double-submit protection | Delegated `invalid` + `aria-invalid="true"` pulse, submit `pending` lock, offline error preservation | Scenario 1 |
| Drag-over & file validation cue | `attachFileDropFeedback` drives `data-drop-state="idle\|dragover\|valid\|invalid\|uploading"`, wired live to `#transferDropZone` in `js/transfer/app.js` | Fixture Scenario 1 + `js/transfer/app.js` integration |
| Rapid tab cancellation & skeleton fallback | `createTabSkeletonSwitcher` (`MOTION.skeleton = 140ms`) cancels superseded switches cleanly (resolving `false`), zero dangling Promises | Scenario 2 (`staleDroppedCount: 2`, active panel `"文件传输 · 140ms 骨架预览"`) |
| Reduced Motion state parity | Displaces `0px`, skips springs & 3D tilt, while keeping `[data-feedback-state]`, status text, focus rings, and alert banners intact | `fixture-mobile-375-dark-reduced.png` + `motion-scroll.js` unit test |

## 2. Live Aeris App Route & Fallback Verification (Scenario 10)

- **`/` & `document.documentElement.dataset.aerisMotionReady`**: Confirmed `"true"` on real app boot (`0` runtime errors, `0` API 5xx errors).
- **`/login` -> Authenticated Shell**: Synthetic `i07admin` and `i07member` authenticated against Miniflare D1 cleanly.
- **`#feedbackModal` tabs & Escape close**: Dynamic `[role="tablist"]` discovered inside modal; `#feedbackVotingTab` shifted `.seg-indicator` (`real-app-feedback-modal-tabs.png`); Escape closed modal cleanly.
- **`/admin` -> `#adminFeatureFlagsTab` & `/finance`**: Both routes rendered cleanly (`real-app-admin-flags.png`, `/finance` workspace verified visible).
- **`P07 OFF` (`p07_accessibility = 0`) degradation**: `data-p07-ui === "disabled"`, clicks and modals (`#feedbackBtn` -> `#feedbackModal` + Escape) remained 100% operable with `overflowX === 0`.

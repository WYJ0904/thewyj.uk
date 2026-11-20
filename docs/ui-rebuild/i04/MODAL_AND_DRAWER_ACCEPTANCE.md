# I04 Desktop Centered Spring Modal & Mobile Bottom Drawer Acceptance

## 1. Platform-Adaptive Sheet Implementation
- `#workspaceDetailModal` in `index.html` delegates lifecycle to `app.js` `openModal()` / `closeModal()` and I07 `attachSheetAdapter()` (`js/core/motion.js`).
- **Fixes Applied Beyond Prototype**:
  - Prototype (`Aeris_I_series_UI_interactive_prototype_2026-11-17.html`) used identical centered modal styling on both PC and mobile. I04 differentiates `[data-sheet-mode="modal"]` (> `760px`) from docked bottom `[data-sheet-mode="drawer"]` (<= `760px`) in `workspace-experience.css`.
  - Fixed a real touch-swipe race discovered during I04 Chrome testing in `js/core/motion.js` (`attachSheetAdapter`): removed mid-move `panelEl.setPointerCapture()` swap onto the moving panel (which caused Chromium touch pointers to emit `lostpointercapture` and abort dragging prematurely) and bound `pointermove` / `pointerup` / `pointercancel` on `document` plus `blur` snap-back.
  - Raised specificity of `.modal-layer[data-sheet-mode="drawer"] .modal-panel[data-sheet-dragging="true"] { animation: none; transition: none; }` and set `overflow: hidden` on outer drawer `.modal-panel` while `.workspace-detail-body` holds `overflow-y: auto; overscroll-behavior: contain` for safe inner scrolling.
  - Added trigger-focus retention in `js/core/dashboard.js` `openWorkspaceDetailModal(moduleId, triggerEl)` so `modalReturnFocus` restores keyboard focus to the opening card preview button reliably.

## 2. Observed Real-Chrome Results (`Chrome/157.0.8103.79`)
- **Desktop (`1440×900`, `data-sheet-mode="modal"`)**:
  - `panelWidth: 540px`, `centered: true`, `title: "学习进度与错题复习"`, `document.documentElement.dataset.modalScrollLocked: true` (`syncModalScrollLock`), `#v3AppFrame` subtle scale transition, `.ds-sheet-handle` hidden.
  - `Tab` cycled 10 consecutive presses without focus ever leaving `#workspaceDetailModal`.
  - `Escape` closed `#workspaceDetailModal` and restored `document.activeElement` to `[data-workspace-preview="learning"]`.
  - `axe-core` scan (`desktop-authenticated-modal-light`): `0` serious/critical violations (`33` passes).
  - Evidence screenshot: `docs/ui-rebuild/i04/evidence/i04-1440-desktop-modal.png`.
- **Mobile (`390×844`, `data-sheet-mode="drawer"`)**:
  - Docked flush at bottom edge (`width: 390`, `bottom: 844`, `innerHeight: 844`, `dockedBottom: true`) with `.ds-sheet-handle` pill and bottom safe-area inset padding.
  - Slow small downward drag (`+36px`): snapped back open cleanly (`modal.classList.contains('hidden') === false`).
  - Down-then-reverse drag (`+95px -> +10px`): snapped back open cleanly (`hidden === false`).
  - Fast downward swipe past threshold (`+220px`): smoothly dismissed (`hidden === true`).
  - Safety confirm modals (`data-confirm-only`, `role="alertdialog"`, `#deleteAccountModal`, `#confirmModal`, `#rejudgeResultModal`) disable swipe dismissal cleanly.
  - Evidence screenshot: `docs/ui-rebuild/i04/evidence/i04-390-mobile-drawer.png`.

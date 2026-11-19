# I07 Desktop Spring Modal & Mobile Gesture Drawer Acceptance

## 1. Platform Differentiation Contract

| Viewport / Dialog Type | Presentation Mode (`data-sheet-mode`) | Swipe Dismiss | Backdrop / Frame Behavior |
| :--- | :--- | :--- | :--- |
| Desktop (`>768px`) regular `.modal-layer` | `modal` (Spring enter/exit) | Disabled | `.app-scale-wrap` / `#v3AppFrame` subtle scale (`--ds-bg-scale`) & `--ds-backdrop-alpha` |
| Mobile (`<=768px`) dismissible `.modal-layer` | `drawer` (Bottom-docked + `.ds-sheet-handle`) | Enabled (1:1 `translateY`, upward rubber-band, velocity/distance threshold) | Backdrop opacity tracks drag ratio; snap-back preserves unsaved input |
| Mobile (`<=768px`) `[role="alertdialog"]` or `[data-confirm-only]` | `modal` (Centered confirm guard) | **Disabled** (prevent accidental destructive swipe) | Blurred scrim; requires explicit button confirm/cancel |
| Workspace routes (`#accountModal`, `#membershipModal`) | `dataset.sheetWorkspace = "true"` | N/A (Full section view) | Excluded from overlay scroll-lock & `#v3AppFrame` dim |

## 2. Unit & Real Browser Verification Results

- **Unit (`local-backend/test_i07_motion_engine.mjs`) — PASS**: `sheet viewport and scroll lock helpers clean up properly` validates stacked modal scroll-lock reference counting (`getScrollLockCount()`) and viewport threshold breakpoints.
- **Fixture Scenario 8 (`desktop-modal-and-mobile-gesture-drawer`) — PASS**:
  - **Desktop (`1440x900`)**: Spring modal opens (`desktop-modal-open.png`), closes cleanly via `Escape`, releases `body.modal-open`.
  - **Mobile (`375x844`)**: Drawer docks at bottom with handle (`mobile-drawer-seq-1-open.png`). User enters `"保留不丢失的输入"`, drags handle down `42px` (under threshold, captured mid-drag in `mobile-drawer-seq-2-dragging.png`), releases -> **snaps back open with input value intact**.
  - **Mobile Swipe Dismiss**: Drags handle down `240px` -> smoothly exits, hides dialog, releases `modal-open` scroll lock. Re-opening confirms form input value preserved (`"保留不丢失的输入"`).
- **Real App Scenario 10 (`real-app-routes-modal-tabs-p07off`) — PASS**:
  - On desktop `1440px`: `#feedbackModal` opens with sliding tab indicator (`real-app-feedback-modal-tabs.png`) and closes cleanly via `Escape`.
  - On mobile `390px`: `#feedbackModal` dynamically switches to `feedbackMobileMode === "drawer"`; destructive confirmation `#deleteAccountModal` (tested with non-admin member `i07member` on `/account`) strictly enforces `deleteMode === "modal"` (`real-app-mobile-delete-confirm.png`) without bottom-drawer swipe affordances.

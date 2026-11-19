# I07 Visual & Sequential Motion Evidence

All evidence artifacts were captured in real headless Chrome (`Chrome/157.0.8103.79`) against isolated Miniflare D1/R2 by `node qa/i07/browser-acceptance.mjs` and visually inspected under `docs/ui-rebuild/i07/evidence/`.

## 1. Local Real-Browser Screenshots (`20` Captures)

| Scenario / Sequence | Artifact Path | What It Proves Visually |
| :--- | :--- | :--- |
| Fixture Desktop Light (`1440px`) | `docs/ui-rebuild/i07/evidence/fixture-desktop-1440-light.png` | Baseline I07 fixture layout, crisp typography, 0 overflow, 0 axe violations |
| Fixture Desktop Dark (`1440px`) | `docs/ui-rebuild/i07/evidence/fixture-desktop-1440-dark.png` | Full semantic token inversion in dark theme (`[data-theme="dark"]`), 0 axe violations |
| Fixture Mobile Light (`375px`) | `docs/ui-rebuild/i07/evidence/fixture-mobile-375-light.png` | Single-column mobile layout, zero horizontal clipping |
| Fixture Mobile Dark + Reduced (`375px`) | `docs/ui-rebuild/i07/evidence/fixture-mobile-375-dark-reduced.png` | Reduced Motion disables motion/tilt while keeping focus & status badges intact |
| FLIP Sequence 1 (Initial) | `docs/ui-rebuild/i07/evidence/flip-seq-1-initial.png` | Initial 2-col card order `[1, 2, 3, 4]` |
| FLIP Sequence 2 (Mid-flight Down) | `docs/ui-rebuild/i07/evidence/flip-seq-2-mid-down.png` | Active compositor offset (`matrix(1, 0, 0, 1, -164.278, 0)`) during reorder |
| FLIP Sequence 3 (Mid-flight Up Reversal) | `docs/ui-rebuild/i07/evidence/flip-seq-3-mid-up.png` | Immediate symmetric upward FLIP reversal (`matrix(1, 0, 0, 1, -186.723, 63.6209)`) |
| FLIP Sequence 4 (Single-Column Density) | `docs/ui-rebuild/i07/evidence/flip-seq-4-single-col.png` | Seamless 2-col -> 1-col layout reflow |
| Drag Sequence 1 (Lifting Card) | `docs/ui-rebuild/i07/evidence/drag-seq-1-lifting.png` | Elevated drag card with pointer tracking |
| Drag Sequence 2 (Settled Drop) | `docs/ui-rebuild/i07/evidence/drag-seq-2-settled.png` | Settled `[card-2, card-1, card-3, card-4]` order without stale ghost |
| Toast Sequence 1 (5-Burst Cap) | `docs/ui-rebuild/i07/evidence/toast-seq-1-burst.png` | Strictly `2` visible stacked cards (`Error` + `Info`) with `3` more queued |
| Scroll 3D Sequence 1 (Entry Tilt) | `docs/ui-rebuild/i07/evidence/scroll-seq-1-entry.png` | Entry perspective `rotateX`/`scale`/`translate3d` |
| Scroll 3D Sequence 2 (Flattened) | `docs/ui-rebuild/i07/evidence/scroll-seq-2-flattened.png` | Center viewport `matrix3d` settled flat + aligned Bento tiles (`0px` seam drift) |
| Scroll 3D Sequence 3 (Reversed Up) | `docs/ui-rebuild/i07/evidence/scroll-seq-3-reversed.png` | Identical entry matrix restored when scrolling back up |
| Desktop Spring Modal (`1440px`) | `docs/ui-rebuild/i07/evidence/desktop-modal-open.png` | Centered spring modal on desktop without mobile handle |
| Mobile Gesture Drawer Sequence 1 (Open) | `docs/ui-rebuild/i07/evidence/mobile-drawer-seq-1-open.png` | Bottom-docked `375px` mobile sheet with `.ds-sheet-handle` & preserved input |
| Mobile Gesture Drawer Sequence 2 (Mid-Drag) | `docs/ui-rebuild/i07/evidence/mobile-drawer-seq-2-dragging.png` | Real touch drag at `+42px` offset (subsequently snapped back without losing text) |
| Live App Feedback Modal Tabs | `docs/ui-rebuild/i07/evidence/real-app-feedback-modal-tabs.png` | `.seg-indicator` sliding inside real `#feedbackModal` `[role="tablist"]` |
| Live App Admin Feature Flags | `docs/ui-rebuild/i07/evidence/real-app-admin-flags.png` | Clean `/admin` Feature Flags tab rendering (`46` axe passes, `0` violations) |
| Live App Mobile Delete Alertdialog (`390px`) | `docs/ui-rebuild/i07/evidence/real-app-mobile-delete-confirm.png` | `#deleteAccountModal` stays centered non-swipeable `alertdialog` (`deleteMode === "modal"`) |

## 2. Hosted Preview Evidence (`thewyj-p07-ui-rc`)

Verified live via `node qa/i07/verify-preview.mjs` in real headless Chrome against isolated Hosted Preview (`0` failed requests, `0` console errors, `maxSeamDrift === 0`):

- **Branch Alias URL**: `https://i07-motion-engine.thewyj-p07-ui-rc.pages.dev`
- **Immutable Deployment URL**: `https://ce253791.thewyj-p07-ui-rc.pages.dev` (`ce253791-be18-4beb-9767-2c089fdd9ebb`, code commit `e1e5057d13668c8a9434da2cd9e7cc0acf80ddf8`, `20261119-aeris-i07-preview`)
- **Fixture Route**: `/__preview/i07-fixture.html` (excluded from Production staging builds)
- **Verification Report**: `docs/ui-rebuild/i07/evidence/preview/preview-report.json`

| Preview Capture | Artifact Path | What It Proves Live |
| :--- | :--- | :--- |
| Live Public Home (`/`) | `docs/ui-rebuild/i07/evidence/preview/preview-home-desktop.png` | Isolated Preview banner, `motionReady === "true"`, `?release=20261119-aeris-i07-preview` served from Cloudflare CDN |
| Live Fixture Desktop Light (`1440px`) | `docs/ui-rebuild/i07/evidence/preview/preview-fixture-desktop-light.png` | Aligned controls, interactive switches & dropzone on Cloudflare Pages |
| Live Fixture 5-Burst Toast (`1440px`) | `docs/ui-rebuild/i07/evidence/preview/preview-fixture-toast-burst.png` | Strict `2`-visible / `3`-queued stack live on Hosted Preview |
| Live Fixture Scroll 3D & Bento (`1440px`) | `docs/ui-rebuild/i07/evidence/preview/preview-fixture-scroll-bento.png` | Scroll-driven 3D & Bento seam lock (`maxSeamDrift === 0`) live |
| Live Fixture Mobile Dark Drawer (`375px`) | `docs/ui-rebuild/i07/evidence/preview/preview-fixture-mobile-drawer-dark.png` | Dark bottom drawer (`data-sheet-mode="drawer"`) + touch swipe-dismiss live |

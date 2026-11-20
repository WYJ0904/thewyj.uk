# I04 Visual Evidence Gallery

All screenshots below were captured from real Chrome (`Chrome/157.0.8103.79`) against real Pages Functions + Miniflare D1/R2 (or isolated Cloudflare Hosted Preview under `evidence/preview/`).

## Local Acceptance Evidence (`docs/ui-rebuild/i04/evidence/`)
- `i04-1440-comfortable-light.png` — Desktop `1440×900` Light: Authentic Cloudflare/One UI density, 2-column Bento grid, workspace console toolbar, scope & save-status pills, real empty/unread/loading/online tones.
- `i04-1440-editing.png` — Desktop `1440×900` Edit Mode: Dashed card outlines, `44×44px` drag grip + `↑` / `↓` / `隐藏` controls, Save/Reset/Finish controls.
- `i04-1440-compact-light.png` — Desktop `1440×900` Compact Mode: Single-column horizontal high-density strip rows (`avgH: 120px` vs `226px` comfortable).
- `i04-1440-all-hidden.png` — Desktop `1440×900` All-Hidden Empty State: Centered `当前工作台模块已全部隐藏` empty region with per-module restore chips, `恢复全部模块`, and `重置默认布局`, while topbar/sidebar/toolbar remain operational.
- `i04-1440-desktop-modal.png` — Desktop `1440×900` Centered Spring Modal (`[data-sheet-mode="modal"]`): `540px` centered dialog, blurred backdrop, key/value facts, real route actions.
- `i04-390-mobile-drawer.png` — Mobile `390×844` Swipeable Bottom Drawer (`[data-sheet-mode="drawer"]`): Docked flush at bottom edge with `.ds-sheet-handle` pill, scrollable body, and safe-area padding.
- `i04-1440-comfortable-dark.png` & `i04-390-comfortable-dark.png` — Dark theme desktop and mobile (`390×844`) responsive cards with zero horizontal overflow.
- `i04-1440-p07-off.png` — Desktop `1440×900` with `p07_accessibility` OFF: Workspace controls, edit mode, reorder, density toggle, and cards remain fully usable.

## Hosted Preview Evidence (`docs/ui-rebuild/i04/evidence/preview/`)
- `preview-guest-1440.png` — Guest `/` preserves I03 public layout with private workspace hidden.
- `preview-select-1440.png` — Authenticated `/select` on `https://i04-workspace.thewyj-i04-preview.pages.dev`.
- `preview-compact-1440.png` — Compact 1-column strip persisted across Hosted Preview reload.
- `preview-mobile-390.png` — Responsive `390×844` mobile layout on Hosted Preview (`0` serious/critical `axe-core` violations).

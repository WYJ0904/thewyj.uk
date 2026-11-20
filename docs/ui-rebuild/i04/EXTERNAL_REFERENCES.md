# I04 Open-Source & Design References (`EXTERNAL_REFERENCES.md`)

Per Section 16 authorization, the I04 authenticated personal workspace studied mature interaction and accessibility patterns without adding any new frontend framework dependencies or third-party runtime packages (`0` bytes added to bundle dependencies, `CORE_SHELL = 81` / `REQUIRED_SHELL = 89` preserved).

## 1. Visual & Layout Architecture References
- **Cloudflare Dashboard**: Console header/toolbar separation, hairline `1px` bordered modules (`4–8px` radius), operational status badges (`neutral`/`info`/`success`/`warning`/`error`), and true high-density horizontal compact strips rather than stacked marketing hero blocks.
- **Samsung One UI**: Clean section grouping, >= `44px` minimum interactive touch targets (`--ds-touch-min`), and clear single-column mobile hierarchy without shrinking a desktop canvas proportionally.

## 2. Interaction & Accessibility References Studied
- **dnd-kit (`KeyboardSensor` + Accessibility Announcements)**:
  - Dedicated sortable handle focus model (`[data-workspace-drag-handle]`, `aria-roledescription="可排序模块"`) so inner card links/preview buttons remain independently tabbable without triggering accidental drags.
  - Polite `aria-live` milestone announcements (`#workspaceLiveRegion`) on drag start, keyboard Arrow reorder position, drop commit, Escape cancel, hide, restore, and reset/undo.
  - Focus retention across DOM reorder mutations (restoring focus to moved handle or adjacent sibling action button when moving to first/last boundary).
- **Vaul / Radix Dialog Bottom-Sheet Physics**:
  - Separation between desktop centered dialog (`[data-sheet-mode="modal"]`) and mobile bottom sheet (`[data-sheet-mode="drawer"]`).
  - Handle-only vs scrollable-body touch conflict protection (`overflow-y: auto; overscroll-behavior: contain` inside `.workspace-detail-body`), snap-back beneath threshold/velocity, and `data-confirm-only` / `role="alertdialog"` non-dismissible safety guard.
- **All Runtime Execution Remains 100% Native Aeris (`js/core/motion.js` I07)**:
  - Reuses `captureFlipSnapshot`, `playFlipSnapshot`, `flipLayout`, `createDragSortController`, `attachSheetAdapter`, and `syncModalScrollLock`.
  - License/security/CSP impact: zero external CDN scripts, zero unsafe inline handlers, full `Content-Security-Policy` compliance verified.

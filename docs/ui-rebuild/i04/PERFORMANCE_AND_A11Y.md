# I04 Performance, Motion Safety & Accessibility Report

## 1. `axe-core` Accessibility Audit (Zero Serious/Critical Violations)
All scans ran via injected `qa/p07-f/vendor/axe.min.js` on real rendered DOM in `Chrome/157.0.8103.79` (`qa/i04/browser-acceptance.mjs`):

| Scan Label | Viewport & Theme | Violation Count (serious/critical) | Rules Passed |
|---|---|---|---|
| `desktop-authenticated-modal-light` | `1440×900` Light (Modal open) | `0` | `33` |
| `workspace-1440-light` | `1440×900` Light | `0` | `45` |
| `workspace-1440-dark` | `1440×900` Dark | `0` | `45` |
| `workspace-768-light` | `768×900` Light | `0` | `44` |
| `workspace-768-dark` | `768×900` Dark | `0` | `44` |
| `workspace-375-light` | `375×844` Light | `0` | `44` |
| `workspace-375-dark` | `375×844` Dark | `0` | `44` |

## 2. Keyboard, Screen Reader & Touch Ergonomics
- Touch targets for toolbar buttons, card move/hide controls, restore chips, detail preview actions, and close buttons obey `min-height: 44px` (`min-width: 44px` for icon controls).
- `#workspaceLiveRegion` (`aria-live="polite"`, `aria-atomic="true"`) announces drag pickup, arrow sort moves, drops, Escape cancel, hide, restore, density changes, reset, and undo.
- Focus management: desktop modal traps `Tab` cleanly and restores trigger focus on `Escape`/close; ↑/↓/Arrow moves preserve focus inside the moved card.
- Numbers/counts/metrics apply CSS `font-variant-numeric: tabular-nums` (`.tabular-nums`).

## 3. Reduced Motion, P07 OFF & Runtime Performance
- **Reduced Motion ON**: Emulating `prefers-reduced-motion: reduce` disables transitions/animations (`animation: none; transition: none;`) while preserving instant reorder, density switch (`comfortable` <-> `compact`), modal open/close, and zero residual transforms.
- **P07 OFF (`p07_accessibility = 0`)**: Verified in Chrome that `data-p07-ui="disabled"` keeps `#authWorkspaceSection` legible and operable (`down` reorder, `compact` density toggle, zero horizontal overflow).
- **Performance & Memory Hygiene**:
  - FLIP animates compositor `transform` only via WAAPI (`playFlipSnapshot`), avoiding repeated DOM element creation (`grid.innerHTML`).
  - `AbortController` + `dragSort.dispose()` + `hidePrimaryScreens()` cleanly cancel active drags, timers, and window listeners on route switch or disposal.
  - Bundle/PWA impact: `0` new external packages; `CORE_SHELL = 81`, `REQUIRED_SHELL = 89` preserved cleanly.

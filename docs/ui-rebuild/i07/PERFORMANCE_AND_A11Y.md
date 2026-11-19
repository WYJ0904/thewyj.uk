# I07 Performance & Accessibility Acceptance

## 1. Automated Accessibility (`axe-core` Zero-Violation Checks)

Executed real headless Chrome `axe-core` audits across **5** distinct surfaces/themes/viewports (fixture + live Aeris routes):

| Surface / Mode | Result | Passes | Violations |
| :--- | :--- | :---: | :---: |
| Fixture Desktop `1440px` Light (`fixture-desktop-light`) | **PASS** | `46` | `0` |
| Fixture Desktop `1440px` Dark (`fixture-desktop-dark`) | **PASS** | `46` | `0` |
| Fixture Mobile `375px` Dark + Reduced (`fixture-mobile-375-dark`) | **PASS** | `46` | `0` |
| Live App Public Home `/` (`real-app-public-home`) | **PASS** | `39` | `0` |
| Live App Admin Feature Flags `/admin` (`real-app-admin-flags`) | **PASS** | `46` | `0` |

## 2. Viewport Overflow Matrix (`overflowX <= 1px`)

| Viewport Width | Result | Measured Horizontal Overflow |
| :---: | :---: | :---: |
| `1440px` (Desktop) | **PASS** | `0px` |
| `1024px` (Compact Desktop / Tablet) | **PASS** | `0px` |
| `390px` (Mobile Standard) | **PASS** | `0px` |
| `375px` (Compact Mobile) | **PASS** | `0px` |

## 3. Runtime Performance Telemetry & Budgets

Collected via `window.__i07FixtureTelemetry()` (`requestAnimationFrame` delta sampler + `PerformanceObserver({ type: 'longtask' })`) across the full interactive fixture suite:

- **Worst frame delta**: `208.3ms` (single spike during Chrome viewport/axe sweep; GPU `transform`/`opacity` animations did not introduce continuous main-thread blocking loops).
- **Long task count**: `1` (within test initialization/axe execution window).
- **Bento seam drift (`maxSeamDriftPx`)**: `0` (`0px` displacement across both Scene 7 scroll cycle, multi-viewport resize, and live Hosted Preview).
- **Listener discipline**: Single delegated root handlers via `installMotionSystem(root)` + two scoped `MutationObserver`s (`<details>` and `[role="tablist"]`) + one `IntersectionObserver` per `createScrollProgressController`; zero per-button listeners attached across the 268+ buttons in `index.html`.
- **Style & asset overhead**:
  - Added 5 small modular files under `js/core/` (`motion-tokens.js`, `motion-flip.js`, `motion-toast.js`, `motion-sheet.js`, `motion-scroll.js`) with zero external runtime dependencies.
  - Zero `!important` rules added to CSS (`test_i02_css_contracts.mjs` bounded limits preserved).

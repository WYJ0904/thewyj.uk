# I07 Scroll-Driven 3D & Bento Seam Lock Acceptance

## 1. Architecture & Motion Mechanics (`js/core/motion-scroll.js`, `design-system.css`)

- **Observer-gated single-`rAF` scheduling**: `createScrollProgressController` binds an `IntersectionObserver` so only elements within/near the viewport calculate progress ratios during a single batched read-then-write `requestAnimationFrame` pass — zero per-frame layout thrashing when off-screen or idle.
- **Math & Clamping**:
  - `computeScrollProgress` normalizes element viewport traversal into `[0, 1]`, driving reversible CSS custom properties `--ds-scroll-rx`, `--ds-scroll-scale`, and `--ds-scroll-ty` consumed by `.scroll-preview-wrap` GPU `transform` rules (`perspective(...) rotateX(...) scale(...) translate3d(...)`).
  - `computeCenteredParallax` computes symmetric clamped offset `--ds-parallax-y` exclusively on inner `.tile-inner` layers inside `.apple-bento-wall`.
- **Outer Bento Seam Lock**: `.bento-tile` outer wrappers maintain `transform: none` and `overflow: hidden` so internal image/content parallax never creates subpixel gaps or hairline seam drift between adjacent Bento tiles.
- **Reduced Motion**: When `prefers-reduced-motion: reduce` is active, scroll 3D transform flattens to rest state and parallax locks to `0px`.

## 2. Verification Results

- **Unit (`local-backend/test_i07_motion_engine.mjs`) — PASS**: `scroll progress & centered parallax are reversible and respect reduced motion` verifies deterministic reversible math across scroll positions `[entry -> mid -> exit -> back to entry]` and zeroed offsets under Reduced Motion.
- **Fixture Scenario 7 (`scroll-3d-reversible-and-bento-seam-lock`) — PASS**:
  - **Entry (`scroll-seq-1-entry.png`)**: `matrix3d(0.9428, 0, 0, 0, 0, 0.924037, 0.187158, -0.000155965, 0, -0.198513, 0.980098, -0.000816749, 0, 22.89, 0, 1)`
  - **Flattened Center (`scroll-seq-2-flattened.png`)**: `matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -0.000833333, 0, 0, 0, 1)`
  - **Scrolled Back Up Reversed (`scroll-seq-3-reversed.png`)**: Returns identically to `matrix3d(0.9428, 0, 0, 0, 0, 0.924037, 0.187158, -0.000155965, 0, -0.198513, 0.980098, -0.000816749, 0, 22.89, 0, 1)`
  - **Bento Seam Drift Telemetry**: `maxSeamDrift: 0` across full scroll cycle AND responsive viewport matrix (`maxSeamDriftPx: 0`).

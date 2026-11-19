# I07 Risks, Boundaries & Rollback Plan

## 1. Identified Risks & Mitigations

| Risk | Mitigation Implemented | Residual Status |
| :--- | :--- | :--- |
| Service Worker RC5 / P5 publication invariant (`test_static.py`, `sw-install.test.mjs`, `p5-pwa-browser.mjs`) | Preserved exact `81`-entry `CORE_SHELL`, `89`-entry `REQUIRED_SHELL`, and `INSTALL_SHELL = REQUIRED_SHELL`; consolidated all 6 motion engine subsystems cleanly inside `js/core/motion.js` (already in `CORE_SHELL`) so offline `PUBLICATION_CACHE` has `0` unexpected URLs | Mitigated & verified (`20/20` SW tests + `31/31` static tests PASS) |
| Module graph cycle or illegal `js/core/` cross-layer import | `js/core/motion.js` has zero sibling imports; `js/core/keyed-list.js` imports `{ captureFlipSnapshot, playFlipSnapshot }` acyclically from `./motion.js` | Mitigated & verified (`check_js_module_graph.mjs`: `67` files, `111` imports, `0` cycles) |
| Workspace routes (`#accountModal`, `#membershipModal`) treated as mobile drawers | Flagged both `<section class="v3-workspace">` views with `dataset.sheetWorkspace = "true"`; skipped overlay scroll-lock & `#v3AppFrame` scaling | Mitigated & verified in Scenario 10 |
| Accidental swipe dismissal of destructive confirmation dialogs (`#deleteAccountModal`) | `attachSheetAdapter` inspects `dismissible: false`, `[role="alertdialog"]`, `[data-confirm-only]` and forces centered non-swipeable `modal` on mobile | Mitigated & verified (`deleteMode === "modal"` on 390px) |
| Preview-only fixture (`qa/i07/fixture.*`) leaking into Production Pages deploy | Fixture lives under `qa/i07/`, excluded from `scripts/stage_pages_deploy.mjs` allowlist (`isAllowedPagesFile`), mounted only on isolated `/__preview/i07-fixture.html` preview & local test harness | Mitigated & verified |
| Stale cache after release bump (`ASSET_RELEASE`) | Bumped `ASSET_RELEASE` uniformly to `20261119-aeris-i07-preview` across all 29 runtime references and re-ran `npm run task27:publication` | Mitigated & verified |

## 2. Explicit Boundaries Respected

- **No I03 / I04 / I05–I09 premature rewrites**: Legacy domain pages remain structurally intact; advanced FLIP/3D/Bento engines are delivered cleanly and proven in fixture for I03–I09 consumption.
- **No Task54 AI activation or Production DB/R2 mutations**: All Miniflare D1/R2 tests use synthetic ephemeral databases; Production flags, pointers, secrets, and `访问口令.txt` untouched.
- **Android Physical Device**: **NOT_TESTED — NOT REQUIRED FOR I07 WEB ACCEPTANCE**. Must be scheduled only when Android Hotfix closure resumes.

## 3. Clean Rollback Strategy

Because I07 is stacked cleanly on `hydrogen/i02-css-component-foundation` via Draft PR and keeps RC5 SW shell arrays intact:
1. **Runtime Kill Switch (instant, no deploy)**: Toggle `p07_accessibility = 0` via Task25 feature flag controls (`P07 OFF` degrades gracefully to baseline static CSS/DOM behavior, verified in Scenario 10).
2. **Branch / Commit Revert**: Reverting the I07 commits on `hydrogen/i07-motion-interaction-engine` (or closing the Draft PR without merging into `i02`) restores exact `1e1d2d21c143be36268e7d1192f6399cd4e2f782` state with zero D1 schema migrations or R2 data side effects.

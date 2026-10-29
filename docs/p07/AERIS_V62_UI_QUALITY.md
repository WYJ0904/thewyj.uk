# Aeris V6.2: recovered UI quality slice

This is the preserved quality work recovered from main `f144956a6962f0a43c7b4fc603e7cf18aabdf068`, with the independent CI/tooling history inherited. It is a prerequisite to the V6.2 spatial redesign, not completion of P07-01 through P07-15.

## Changes and responsibility

- A minimal public, read-only Task25 UI decision enables the guest login experience only when Stable is enabled for everyone. It exposes no account, bucket, override or private flag snapshot. Missing, expired, offline, killed or failed configuration turns it off; authenticated account decisions remain authoritative.
- Form labels, keyboard tabs, dialog entry/restoration, validation and response states were repaired in the existing application. There is no new account, membership, payment, financial migration, recognition or AI authority.
- Native popover menus are excluded from height/overflow disclosure animations. Actual input testing first reproduced the account menu panel being clipped during its opening animation. The fix preserves immediate native activation and the existing disclosure behavior for normal sections.
- At actual 400% browser zoom, a short landscape viewport retained an obsolete sticky-header scroll offset and obscured the focused login field. The short-viewport override now uses the non-sticky offset. The focus visibility assertion is unchanged.
- Existing system fonts are retained, with an explicit installed Chinese sans-serif fallback. No font download, new runtime dependency or logo replacement is introduced. Asset references and the Service Worker graph use one release identity.
- The local browser fixture serves an immutable, per-attempt snapshot and supports a foreground supervisor. Old process exits and failed attempts remain raw; no restart converts an in-flight failure to PASS.

## Fresh local evidence (2026-10-29)

| Collection | Actual result | Evidence |
| --- | --- | --- |
| Public policy and UI DOM | 40 TAP passes, including one parent container: **39 leaf cases** | `docs/migration-evidence/aeris-p03-p07/ci/v62-policy-dom.log` |
| Component browser, keyboard and responsive checks | 14 PASS, 0 FAIL | `docs/migration-evidence/aeris-p03-p07/ci/ui-quality-browser-1793244854052.json` and its immutable fixture output |
| Actual local registration/login, ordinary/admin access, AX and server UI policy | 12 PASS, 0 FAIL | `docs/migration-evidence/aeris-p03-p07/ui-auth-r4/result.json` |
| Real browser zoom | 100%, 200%, 400%, three roles and two themes | 18 role/theme/zoom captures within `ui-auth-r4` |
| Full toolbox, independent artifact validation | 104 tools, 51 modes, 27 workflow flows, 12 capabilities; PASS | `docs/migration-evidence/aeris-p03-p07/ci/test_tools_browser-1793241688078.log` |
| Motion unit contract | PASS, including immediate popover activation and no overflow clipping | `node local-backend/test_motion_js.mjs` |

The first authenticated run was 10 PASS / 2 FAIL; the next retained clipping and later local-server exit failures; the third was 11 PASS / 1 FAIL at 400% zoom. They are preserved under `ui-auth-actual-2026-10-29T02-44-06-969Z`, `ui-auth-r2`, and `ui-auth-r3`. A later passing run does not erase them.

The complete toolbox had prior infrastructure failures (Pages exit, unresolved Python, then missing validator imports). Explicit use of the already-installed isolated validators corrected that environment; no timeout, product assertion or API rate limit changed.

All accounts, registration, HTTP faults and flag mutations above belong to isolated loopback D1/R2. The test restored the local P07 flag and per-user override. AX-tree inspection is not professional screen-reader acceptance; browser metrics emulation is separate from actual browser zoom. These are not Hosted Preview, Production, field performance or Android WebView acceptance.

## V6.2 design diagnosis and next implementation

The current home has large unused space, similar card treatments and a weak relationship between its brand and useful data. Four CSS layers contain overlapping page/component rules. Dense workspaces still have nested surfaces, while account forms need a calmer hierarchy. The three configurable cards and their storage, source data, drag/navigation exclusion and mobile layout are valuable existing behavior to preserve.

The pinned MIT `redesign-existing-projects` audit is used for diagnosis. Its mandatory font/palette, heading gradients, long animations, external stock images and smooth scrolling are overridden by the owner's V6.2 Aeris constraints and existing tokens. No external runtime library is required for the first spatial milestone. Existing WAAPI/CSS and `js/core/motion.js` remain the motion owner.

The next isolated milestone covers actual before/after home, dense workspace and form samples, a token/selector audit, a positioning-versus-visual layer for all three cards, interrupted motion and reduced motion, and an exact-source Hosted Preview. Remaining P07 pages are reported individually; none are implicitly COMPLETE. Production flags and unreleased financial/AI capabilities remain unchanged.

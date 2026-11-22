# Visual Evidence Index (I03 Public Pages + Phase A I07 Remediation + Hosted Preview)

All screenshots below were captured from real headless Chrome executions and visually inspected against Light/Dark contrast, layout containment, Switch geometry, multi-stage 3D scroll transitions, and responsive reflow.

## 1. Local I03 Public Pages Acceptance (`docs/ui-rebuild/i03/evidence/`)

- Report JSON: [acceptance-report.json](docs/ui-rebuild/i03/evidence/acceptance-report.json)
- Public Home (`/`):
  - [home-desktop-1440-light.png](docs/ui-rebuild/i03/evidence/home-desktop-1440-light.png) — Clean editorial Hero, real Aeris logo, single interactive preview window (P07 ON, Light, `1440x900`)
  - [home-desktop-1440-dark.png](docs/ui-rebuild/i03/evidence/home-desktop-1440-dark.png) — Dark theme token contrast & crisp window elevation (`1440x900`)
  - [home-p07-off-1440-light.png](docs/ui-rebuild/i03/evidence/home-p07-off-1440-light.png) — `P07 OFF` graceful fallback (`1440x900`)
  - [home-authenticated-1440-light.png](docs/ui-rebuild/i03/evidence/home-authenticated-1440-light.png) — Signed-in continuity (`[data-home-personal]`, `#homeV3SummaryGrid`, `#homeProductDetails`)
  - [home-mobile-375-light.png](docs/ui-rebuild/i03/evidence/home-mobile-375-light.png) — Mobile `375x844` zero horizontal overflow
- Preview Window & Scroll Choreography Sequence:
  - [home-preview-tools-tab.png](docs/ui-rebuild/i03/evidence/home-preview-tools-tab.png) — Switched to JSON/text preview tab (`#capabilityToolsBody`) after 140ms skeleton settle
  - [home-scroll-seq-1-top.png](docs/ui-rebuild/i03/evidence/home-scroll-seq-1-top.png) — Initial entry tilt
  - [home-scroll-seq-2-level.png](docs/ui-rebuild/i03/evidence/home-scroll-seq-2-level.png) — Mid-scroll flattened horizontal stage
  - [home-scroll-seq-3-exit-and-bento.png](docs/ui-rebuild/i03/evidence/home-scroll-seq-3-exit-and-bento.png) — Post-level multi-stage exit transition + seamless 12-col Bento wall (`0px` outer gap)
  - [home-scroll-seq-4-reversed.png](docs/ui-rebuild/i03/evidence/home-scroll-seq-4-reversed.png) — Reversible reverse-scroll restoration
- `/trial`, `/download`, `/changelog`, `/login`, `/register`:
  - [trial-desktop-1440-light.png](docs/ui-rebuild/i03/evidence/trial-desktop-1440-light.png) / [trial-desktop-1440-dark.png](docs/ui-rebuild/i03/evidence/trial-desktop-1440-dark.png) — Compact 5-tab segmented bar (`role="tab"`) & active trial workbench
  - [download-desktop-1440-light.png](docs/ui-rebuild/i03/evidence/download-desktop-1440-light.png) / [download-desktop-1440-dark.png](docs/ui-rebuild/i03/evidence/download-desktop-1440-dark.png) / [download-mobile-375-light.png](docs/ui-rebuild/i03/evidence/download-mobile-375-light.png) — Release status badge (`#downloadStatusBadge`), APK CTA hierarchy, wrapped monospace SHA-256
  - [changelog-desktop-1440-light.png](docs/ui-rebuild/i03/evidence/changelog-desktop-1440-light.png) / [changelog-desktop-1440-dark.png](docs/ui-rebuild/i03/evidence/changelog-desktop-1440-dark.png) — Release changelog list opening cleanly at newest release
  - [login-desktop-1440-light.png](docs/ui-rebuild/i03/evidence/login-desktop-1440-light.png) / [login-desktop-1440-dark.png](docs/ui-rebuild/i03/evidence/login-desktop-1440-dark.png) / [login-mobile-375-light.png](docs/ui-rebuild/i03/evidence/login-mobile-375-light.png) / [register-desktop-1440-light.png](docs/ui-rebuild/i03/evidence/register-desktop-1440-light.png) — Clean centered auth surface, legible segmented tab indicator, and consent checkbox geometry

## 2. Live Hosted Preview Screenshots (`docs/ui-rebuild/i03/evidence/preview/`)

- Report JSON: [verify-report.json](docs/ui-rebuild/i03/evidence/preview/verify-report.json)
- Routes & Fixtures Captured Live (`https://i03-public-pages.thewyj-i03-preview.pages.dev`):
  - [hosted-home-1440.png](docs/ui-rebuild/i03/evidence/preview/hosted-home-1440.png) — Live Hosted Home (`P07 ON`, `1440x900`)
  - [hosted-home-375.png](docs/ui-rebuild/i03/evidence/preview/hosted-home-375.png) — Live Hosted Home Mobile (`375x844`)
  - [hosted-p07-off-1440.png](docs/ui-rebuild/i03/evidence/preview/hosted-p07-off-1440.png) — Live Hosted Home Fallback (`P07 OFF`, `1440x900`)
  - [hosted-trial-1440.png](docs/ui-rebuild/i03/evidence/preview/hosted-trial-1440.png)
  - [hosted-download-1440.png](docs/ui-rebuild/i03/evidence/preview/hosted-download-1440.png)
  - [hosted-changelog-1440.png](docs/ui-rebuild/i03/evidence/preview/hosted-changelog-1440.png)
  - [hosted-login-1440.png](docs/ui-rebuild/i03/evidence/preview/hosted-login-1440.png)
  - [hosted-register-1440.png](docs/ui-rebuild/i03/evidence/preview/hosted-register-1440.png)
  - [hosted-i07-fixture-1440.png](docs/ui-rebuild/i03/evidence/preview/hosted-i07-fixture-1440.png) — Live Hosted `/__preview/i07-fixture.html` verifying Switch thumb containment

## 3. Refreshed Phase A I07 Remediation Evidence (`docs/ui-rebuild/i07/evidence/`)

- Report JSON: [acceptance-report.json](docs/ui-rebuild/i07/evidence/acceptance-report.json)
- Switch Containment & Controls: [switch-fixed-desktop-light.png](docs/ui-rebuild/i07/evidence/switch-fixed-desktop-light.png)
- Multi-Stage Scroll 3D & Bento Seam Lock: [scroll-seq-1-entry.png](docs/ui-rebuild/i07/evidence/scroll-seq-1-entry.png), [scroll-seq-2-flattened.png](docs/ui-rebuild/i07/evidence/scroll-seq-2-flattened.png), [scroll-seq-3-exit-stage.png](docs/ui-rebuild/i07/evidence/scroll-seq-3-exit-stage.png), [scroll-seq-4-reversed.png](docs/ui-rebuild/i07/evidence/scroll-seq-4-reversed.png)
- Fixture Matrix, FLIP, Drag Sort, Toast & Real App Routes: [fixture-desktop-1440-light.png](docs/ui-rebuild/i07/evidence/fixture-desktop-1440-light.png), [fixture-desktop-1440-dark.png](docs/ui-rebuild/i07/evidence/fixture-desktop-1440-dark.png), [fixture-mobile-375-light.png](docs/ui-rebuild/i07/evidence/fixture-mobile-375-light.png), [fixture-mobile-375-dark-reduced.png](docs/ui-rebuild/i07/evidence/fixture-mobile-375-dark-reduced.png), [flip-seq-2-mid-down.png](docs/ui-rebuild/i07/evidence/flip-seq-2-mid-down.png), [flip-seq-3-mid-up.png](docs/ui-rebuild/i07/evidence/flip-seq-3-mid-up.png), [flip-seq-4-single-col.png](docs/ui-rebuild/i07/evidence/flip-seq-4-single-col.png), [drag-seq-1-lifting.png](docs/ui-rebuild/i07/evidence/drag-seq-1-lifting.png), [desktop-modal-open.png](docs/ui-rebuild/i07/evidence/desktop-modal-open.png), [mobile-drawer-seq-1-open.png](docs/ui-rebuild/i07/evidence/mobile-drawer-seq-1-open.png), [mobile-drawer-seq-2-dragging.png](docs/ui-rebuild/i07/evidence/mobile-drawer-seq-2-dragging.png), [toast-seq-1-burst.png](docs/ui-rebuild/i07/evidence/toast-seq-1-burst.png), [real-app-admin-flags.png](docs/ui-rebuild/i07/evidence/real-app-admin-flags.png), [real-app-feedback-modal-tabs.png](docs/ui-rebuild/i07/evidence/real-app-feedback-modal-tabs.png)

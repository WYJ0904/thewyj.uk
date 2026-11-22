# Desktop & Mobile Visual Evidence Index (`I05`)

All screenshots below were captured from real headless Chrome rendering against either local Miniflare D1/R2 (`docs/ui-rebuild/i05/evidence/*.png`, `16` images) or the isolated Hosted Preview (`docs/ui-rebuild/i05/evidence/preview/*.png`, `5` images), visually inspected, and confirmed free of password field exposure (`pwVisible: false`).

## 1. Local Miniflare Acceptance Screenshots (`docs/ui-rebuild/i05/evidence/`)
- **All 7 Route Full Views (`1440×900` Light)**:
  - `1440-route-home.png`, `1440-select-light.png` (`/select` personal workspace inside unified sidebar + breadcrumb shell)
  - `1440-route-language.png` (`/language` learning workspace panel unification)
  - `1440-route-tools.png` (`/tools` catalog density & compact header controls)
  - `1440-route-finance.png` (`/finance` toolbar, ledger container & `tabular-nums` alignment)
  - `1440-route-transfer.png` (`/transfer` unified upload queue & hairline spacing)
  - `1440-route-account.png` (`/account` One UI grouped settings rows & detail grid)
  - `1440-route-admin.png` (`/admin` role context, 4-cell KPI strip, dense `.admin-list-head`)
- **Interactive Before/After & Dark Theme (`1440×900`)**:
  - `1440-admin-flags-before.png`, `1440-admin-flags-after.png`, `1440-admin-flags-light.png` (Feature Flag creation + Task 27 step-up + audit log update while preserving DOM node identity)
  - `1440-admin-users-dark.png` (Dark theme high-contrast table, sidebar, KPI strip)
- **Mobile Viewports (`390×844`)**:
  - `390-select-light.png` (`/select` single-column stack & mobile drawer toggle)
  - `390-finance-dark.png` (`/finance` dark mode mobile ledger & filter fit, `0` overflow)
  - `390-account-light.png` (`/account` One UI mobile touch-friendly settings list)
  - `390-admin-flags-dark.png` (`/admin` Feature Flags mobile form fit & audit section)

## 2. Live Hosted Preview Screenshots (`docs/ui-rebuild/i05/evidence/preview/`)
- `preview/preview-1440-select.png` (`https://i05-workspace-density.thewyj-i05-preview.pages.dev/select`, `1440×900` light)
- `preview/preview-1440-account.png` (`/account` showing One UI grouped settings & `#saveReleaseChannelBtn` confirmation)
- `preview/preview-1440-admin-flags.png` (`/admin` Feature Flags saved status after real D1 + Task 27 step-up)
- `preview/preview-390-admin.png` (`/admin` at `390×844` mobile)
- `preview/preview-390-select.png` (`/select` at `390×844` mobile)

## 3. Structural Reports
- [`evidence/i05-acceptance-report.json`](./evidence/i05-acceptance-report.json)
- [`evidence/i05-preview-provision.json`](./evidence/i05-preview-provision.json)
- [`evidence/i05-preview-stage.json`](./evidence/i05-preview-stage.json)
- [`evidence/i05-preview-verify.json`](./evidence/i05-preview-verify.json)

# Responsive Layout & Theme Matrix (`I05`)

## 1. Local Full Matrix (`i_responsive_theme_matrix` in `qa/i05/browser-acceptance.mjs`)
- **Coverage**: `7` authenticated routes (`home`, `language`, `tools`, `finance`, `transfer`, `account`, `admin`) × `5` viewports × `2` themes (`light`, `dark`) = **`70` verified cells**.
- **Result**: **`70 / 70` PASS** (`totalChecks: 70`, duration `37644 ms`).

| Viewport | Layout Expectancy | Observed Overflow (`scrollWidth - innerWidth`) | Sidebar (`#v3Sidebar`) | Breadcrumb (`#workspaceBreadcrumb`) |
|---|---|---|---|---|
| `1440×900` (Desktop Wide) | Persistent left sidebar (`220px`), desktop action bars, multi-column dense grids | `-15` across checked routes (`<= 1px` pass) | Visible (`true`) | Visible (`true`) |
| `1024×768` (Small Desktop / Landscape Tablet) | Persistent left sidebar, compact gutters, full table scannability | `-15` across checked routes (`<= 1px` pass) | Visible (`true`) | Visible (`true`) |
| `768×1024` (Portrait Tablet) | Sidebar collapsed into header toggle drawer, 1–2 col adaptive grid | `-15` across checked routes (`<= 1px` pass) | Collapsed (`false`) | Visible (`true`) |
| `390×844` (Mobile Modern) | Single-column touch-safe settings/cards/forms, mobile drawer trigger | `0` across checked routes (`<= 1px` pass) | Collapsed (`false`) | Visible (`true`) |
| `375×812` (Mobile Compact) | Single-column fit without horizontal scrollbar or clipped buttons | `0` across checked routes (`<= 1px` pass) | Collapsed (`false`) | Visible (`true`) |

## 2. Live Preview Cross-Checks (`i05-preview-verify.json`)
- Desktop `1440×900` across all 7 routes (`home`, `language`, `tools`, `finance`, `transfer`, `account`, `admin`): `overflow: -15`, valid current breadcrumb on every route.
- Mobile `390×844` on `/admin` and `/select`: `overflow <= 1`, `0` axe-core serious/critical violations (`preview-390-admin`: `49` passes; `preview-390-select`: `45` passes).
- Observed minor mobile wrap note: On `preview-390-admin.png`, `#newFeatureFlagBtn` and `#refreshFeatureFlagsBtn` stack vertically inside their inline flex container at 390px without overflowing horizontally; noted in [`RISKS_AND_ROLLBACK.md`](./RISKS_AND_ROLLBACK.md) for optional I06 polish.

# Responsive Layout & Theme Matrix (`I05`)

本轮包含 `/recharge`、`/tools/workflows` 及局部容器。实际视口、根元素宽度、侧栏 `clientWidth/scrollWidth`、导入控件和移动动作检查见 [本轮验收](IMPLEMENTATION_REPORT.md#规范核对后的修复与复验)。

下表保留原 70 项主路由记录。该轮未覆盖两个子页的内部溢出，也未验证旧后台按钮的单行可读性。

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
- `preview-390-admin.png` 属于旧部署。390px 下“新建功能”曾逐字换行，本轮在 I05 内修复并以 375/390px 的真实浏览器测量复核。

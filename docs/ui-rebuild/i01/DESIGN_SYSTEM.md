# Aeris V6.3 — I01 Design System Specification

The single authoritative source of truth for Aeris Web UI tokens lives in [design-system.css](../../../design-system.css) under `:root`, `:root[data-theme="dark"]`, and `html[data-p07-ui="enabled"]`.

## 1. Color & Polarity Tokens

### Light Polarity
| Role | Token | Value | Notes |
|---|---|---|---|
| Canvas | `--ds-workspace-canvas` | `#f6f7f9` | Cool-neutral alabaster stage (enhanced UI) |
| Surface | `--ds-surface` | `#ffffff` | Cards, nav rail, dialogs |
| Surface Subtle / Inset | `--ds-surface-subtle` / `--ds-bg-subtle` | `#f8fafc` / `#f1f4f8` | Nested blocks, table headers, code blocks |
| Hairline / Divider | `--ds-border` / `--ds-divider` | `#dde2ea` / `#eaeef4` | 1px structural framing |
| Control Border | `--ds-border-strong` | `#c2cbd7` | Inputs, secondary buttons |
| Brand Primary | `--ds-brand` / `--ds-brand-hover` | `#2563eb` / `#1d4ed8` | Restrained flat slate-blue actions |
| Semantic Success | `--ds-success` / `--ds-success-soft` | `#0f766e` / `#ecfdf5` | Finance income, sync healthy |
| Semantic Warning | `--ds-warning` / `--ds-warning-soft` | `#a15c07` / `#fffbeb` | Refunds, caution banners |
| Semantic Error | `--ds-error` / `--ds-error-soft` | `#c23333` / `#fef2f2` | Expenses, destructive actions, inline errors |

### Dark Polarity (`[data-theme="dark"]` & `prefers-color-scheme: dark`)
All dark tokens map to layered slate surfaces (`#0b0e14` canvas → `#141922` surface → `#1a212d` raised) with **solid opaque semantic soft surfaces** (`#1b2944` brand, `#132c24` success, `#2e2414` warning, `#2f181c` error, `#1a2844` info) so WCAG AA (`>= 4.5:1`) contrast holds cleanly without alpha compositing issues.

## 2. Three-Tier Density Model
Instead of forcing one padding/spacing scale onto every product surface, [design-system.css](../../../design-system.css) exposes 4 density tokens adapted per context:

| Context | Selector | `--ds-density-pad` | `--ds-density-gap` | `--ds-density-card-pad` |
|---|---|---|---|---|
| Public Home & Docs | `body[data-experience="public"]` | `clamp(20px, 3vw, 40px)` | `32px` | `22px` |
| Feature Workspaces (Learning, Tools, Account) | `body[data-experience="workspace"]` | `clamp(16px, 2.2vw, 28px)` | `20px` | `18px` |
| Dense Workbenches | `#financePage`, `#adminPanel`, `.workflow-workspace`, `.notification-inbox-panel` | `clamp(14px, 1.6vw, 24px)` | `14px` | `14px` |

## 3. Typography, Spacing, Radii & Z-Index
- **Font Stack (`--ds-font-sans`)**: `"Inter", "Segoe UI Variable", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Noto Sans CJK SC", system-ui, -apple-system, sans-serif`.
- **Numeric Precision**: `font-variant-numeric: tabular-nums` enforced on `output`, `.aeris-summary-number`, `.finance-summary-grid strong`, `.finance-transaction strong`, and tables.
- **3-Tier Radius System**: `6px` (`--ds-radius-xs`/`--ds-radius-sm`), `10px` (`--ds-radius-md` controls), `14px` (`--ds-radius-lg`/`--ds-radius-card` cards & dialogs), plus `999px` (`--ds-radius-pill`) for badges.
- **Z-Index Layers**: Sticky tabs `40` → Sidebar `500` → Top Nav `620` → Toast `640` → Nav Popover `820` → Skip link `1000` → Modal Layer `9000`.

## 4. Shared Error, Empty, Table, Code & Motion Rules
- **Non-color-only errors**: `.error:not(:empty)` uses a `3px` left border accent in addition to soft error fill and accessible text color.
- **Theme-switching guard**: `html[data-theme-switching="true"]` disables transitions for 2 animation frames during polarity flips so buttons/inputs never freeze mid-transition in low-contrast gray.
- **Reduced Motion**: Preserves `prefers-reduced-motion: reduce` and `html[data-android-reduced-motion="true"]` while keeping `.hero-scene-card` at `transition: none` (`0s`).

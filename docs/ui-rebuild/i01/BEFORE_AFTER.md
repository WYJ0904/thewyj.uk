# Aeris V6.3 — I01 Before / After Visual & Layout Comparison

Visual captures were executed in headless Chrome (`1440×900`, `1920×1080`, `1024×768`, `768×1024`, `420×900`, `390×844`, `375×667`, `360×800`, light & dark) against isolated local Cloudflare Pages + D1 (`0001..0040`).

## Quantitative Summary (`before-metrics.json` vs `after-metrics.json`, 42 Checks)

| Metric | Before (`origin/main` `7c111ae4`) | After (`I01`) |
|---|---:|---:|
| Horizontal Overflow Checks (`overflowX > 0`) | 0 / 42 | 0 / 42 |
| Touch Targets `< 44px` (`smallTargetsChecks`) | 42 / 42 (`#themeToggleBtn: 38px`) | **0 / 42** |
| Desktop & Tablet Header Wraps (`navWrap`) | 10 / 24 (`1024×768` & `768×1024` wrapped to `101px`) | **0 / 24** (`61px` single row across `768px`, `1024px`, `1440px`, `1920px`) |
| Mobile Header Utility Row Wraps (`360–420px`) | 18 / 18 (unbordered wrap) | 14 / 18 structured hairline sub-bar |
| Console / Page Runtime Errors | 0 | 0 |

## Representative Validation Pages

### 1. Public Home (`/`)
- **Desktop (`1440×900`)**: [Before Light](evidence/before/home-1440x900-light.png) → [After Light](evidence/after/home-1440x900-light.png) | [Before Dark](evidence/before/home-1440x900-dark.png) → [After Dark](evidence/after/home-1440x900-dark.png)
  - Removed decorative hero SVG contour waves and pastel card gradients.
  - Preserved all 3 floating cards (`学习`, `财务`, `工具`) with crisp `3px` module accent strips and unified `14px` card radii.
  - Replaced `"不只是一个网页。而是为你自由排列的数字空间。"` slogan and synced sidebar version (`v2026.11.18.2 · Aeris`).
- **Tablet / Narrow Desktop (`1024×768`)**: [Before](evidence/before/home-1024x768-light.png) → [After](evidence/after/home-1024x768-light.png)
  - Eliminated the `101px` two-row header wrap (`navHeight: 61px`), and refined the `981px–1240px` sidebar/hero split so the 3rd floating card (`JSON 格式化`) renders unclipped inside the viewport.
- **Mobile (`390×844`)**: [Before](evidence/before/home-390x844-light.png) → [After](evidence/after/home-390x844-light.png)
  - Eliminated transient gray toggle buttons and tightened the release utility strip.

### 2. Finance Workbench (`/finance`)
- [Before Light](evidence/before/finance-1440x900-light.png) → [After Light](evidence/after/finance-1440x900-light.png)
- [Before Dark](evidence/before/finance-1440x900-dark.png) → [After Dark](evidence/after/finance-1440x900-dark.png)
- [After Mobile (`390×844`)](evidence/after/finance-390x844-light.png)
  - Switched KPI/trend colors to semantic `--ds-success` / `--ds-error` / `--ds-warning`, tightened summary grid padding & borders for dense readability, and added vertical button padding for wrapped mobile labels.

### 3. Account Center, Security Modal & Login (`/account`, `/login`)
- [Before Account Light](evidence/before/account-1440x900-light.png) → [After Account Light](evidence/after/account-1440x900-light.png)
- [Before Account Dark](evidence/before/account-1440x900-dark.png) → [After Account Dark](evidence/after/account-1440x900-dark.png)
- [Before Security Modal Dark](evidence/before/security-modal-1440x900-dark.png) → [After Security Modal Dark](evidence/after/security-modal-1440x900-dark.png)
- [Before Login Dark](evidence/before/login-1440x900-dark.png) → [After Login Dark](evidence/after/login-1440x900-dark.png)
  - Eliminated mid-transition dark/light gray button and input contrast artifacts (`data-theme-switching` guard), unified dark card/border hierarchy, and verified Security Center buttons & tabs render crisp in both modes.

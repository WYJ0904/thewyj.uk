# Aeris I02 Visual Evidence Index

所有本地视觉证据均由 `qa/i02/browser-acceptance.mjs` 在真实 Chrome (`Chrome/157.0.8103.79`) + 隔离 Miniflare 环境下于所有 CSS 定稿后实拍采集，并已通过人工视觉抽检（`desktop-home-light/dark`、`desktop-login-dark`、`desktop-finance-light/dark`、`desktop-admin-flags-light`、`mobile-home-light`、`mobile-modal-light`、`desktop-p07-off-light`）。

## 1. 本地浏览器截图证据清单（`docs/ui-rebuild/i02/evidence/`）

| 截图文件 | 视口与主题 | 验证重点 |
|---|---|---|
| `evidence/desktop-home-light.png` | 1440×900 · Light | V1.1 `#111113` 白字主 CTA、中性概览卡、去大面积亮蓝、保留 I01 过渡三卡 |
| `evidence/desktop-home-dark.png` | 1440×900 · Dark | 深色 `#F8FAFC` 黑字主 CTA、降饱和深色卡片表面与边框 |
| `evidence/theme-seq-1-light.png` / `2-dark.png` / `3-system.png` | 1440×900 · 切换序列 | 浅色 → 深色 → 跟随系统连续切换一致性 |
| `evidence/desktop-download-light.png` | 1440×900 · Light (`/download`) | `a.primary`（`#downloadPrimary`）与 `button.primary` 同源视觉一致 |
| `evidence/desktop-login-dark.png` | 1440×900 · Dark (`/login`) | 独立卡片表面、输入框聚焦/边框、深色 `#F8FAFC` 登录主按钮、无闪屏残影 |
| `evidence/desktop-finance-light.png` | 1440×900 · Light (`/finance`) | 真实合成金额 `¥12,850.00` / `¥42.50` / `¥12,807.50` (`tabular-nums`)、绿/红状态色、6px 卡片圆角 |
| `evidence/desktop-finance-dark.png` | 1440×900 · Dark (`/finance`) | 深色账本金额高对比可读、浅色主 CTA、0 `axe-core` 违例 |
| `evidence/desktop-admin-flags-light.png` | 1440×900 · Light (`/admin`) | Feature Flags 20×20 未拉伸原生 Checkbox、`#111113` 激活 Tab 下划线、等宽审计日志 |
| `evidence/desktop-account-dark.png` | 1440×900 · Dark (`/account`) | 账户信息卡、密钥表单与危险区深色对比度 |
| `evidence/mobile-home-light.png` | 390×844 · Light (`/`) | 移动端顶栏两行有序排列、主操作与过渡卡片无横向溢出 |
| `evidence/mobile-home-dark.png` | 390×844 · Dark (`/`) | 移动端深色高对比一致性 |
| `evidence/mobile-modal-light.png` | 375×812 · Light (`#deleteAccountModal`) | 弹窗 z-index 严密覆盖顶栏、警告说明与危险按钮清晰分层 |
| `evidence/desktop-p07-off-light.png` | 1440×900 · Light (`P07 OFF`) | `p07_accessibility=0` 时侧栏隐藏，顶栏遗留导航完整回退，零错乱 |

## 2. 隔离 Hosted Preview 视觉验证（已实测 PASS）

- **目标项目**：`thewyj-p07-ui-rc`（隔离 Preview 环境，与 `i01-design-foundation` 与 Production `thewyj-uk` 完全隔离）
- **Alias URL**：`https://i02-css-component-foundation.thewyj-p07-ui-rc.pages.dev`
- **Immutable Deployment URL**：`https://a7cfa4d7.thewyj-p07-ui-rc.pages.dev`
- **验证脚本与报告**：`qa/i02/verify-preview.mjs` → `docs/ui-rebuild/i02/evidence/preview/preview-report.json`
- **线上实测结论**：`p07Ui: "enabled"`，`policy: "enabled"`，`release=20261119-aeris-i02-preview`，`failedRequests: []`，`runtimeErrors: []`，`/download` `#downloadMainBtn` 背景 `rgb(17, 17, 19)`，`/` 与 `/changelog` 在 Light/Dark 零横向溢出。

| 线上 Preview 截图 | 视口 / 路由 / 主题 | 验证重点 |
|---|---|---|
| `evidence/preview/preview-desktop-1440-light.png` | 1440×900 · `/` · Light | 隔离 Preview Banner、`#111113` 主 CTA、零 4xx/5xx |
| `evidence/preview/preview-desktop-1440-dark.png` | 1440×900 · `/` · Dark | `#F8FAFC` 主 CTA、深色卡片与边界对比度 |
| `evidence/preview/preview-mobile-390-light.png` | 390×844 · `/` · Light | 移动两行顶栏、零溢出 |
| `evidence/preview/preview-mobile-390-dark.png` | 390×844 · `/` · Dark | 移动深色一致性 |
| `evidence/preview/preview-login.png` | 1440×900 · `/login` · Light | 登录面板与主按钮样式一致性 |
| `evidence/preview/preview-download.png` | 1440×900 · `/download` · Light | `a.primary` (`#downloadMainBtn`) `rgb(17, 17, 19)` 线上对齐 |

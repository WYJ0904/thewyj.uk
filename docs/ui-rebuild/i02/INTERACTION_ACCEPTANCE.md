# Aeris I02 Interaction & Accessibility Acceptance

## 1. 测试执行环境与范围

- **执行脚本**：`qa/i02/browser-acceptance.mjs`
- **隔离环境**：本地隔离 Miniflare (`WYJ_DB` + `WYJ_STORAGE`) + 真实 Chrome CDP (`Chrome/157.0.8103.79`)，应用全套 CSP `_headers` 与 44 步 D1 SQL 迁移（含 `p07_accessibility` 正式放量配置 `channels_json = ["stable","beta","experimental"]`、`rollout_basis_points = 10000`）。
- **结构化产物**：`docs/ui-rebuild/i02/evidence/i02-acceptance-report.json`
- **控制台与服务端错误**：`runtimeErrors: []`、`apiErrors: []`（全流程 0 运行时 JS 报错、0 服务端 5xx）。

## 2. 核心交互场景验收（9/9 PASS）

| # | 场景标识 | 关键实测动作 | 实测观测结果 | 状态 |
|---|---|---|---|---|
| 1 | `theme-switch-public-and-login` | 点击 `#themeToggleBtn` 在 `system -> light -> dark -> system` 切换 | Light `#publicLoginBtn` `rgb(17, 17, 19)` / `rgb(255, 255, 255)`，Dark `rgb(248, 250, 252)` / `rgb(17, 17, 19)`；2-RAF 护栏无闪烁 | **PASS** |
| 2 | `buttons-and-link-primary-parity` | 访问 `/download` 检验 `a.primary` 与 `button.primary` 一致性及键盘焦点 | `a.primary` `#downloadPrimary` 背景 `rgb(17, 17, 19)`、白字、高 `44px`、圆角 `8px`、`2px solid` `:focus-visible` 描边 | **PASS** |
| 3 | `forms-input-validation-and-login` | Dark `/login` 提交错误凭证 -> 校验可见错误状态 -> Light 真实登录 `i02admin` | `#loginError` 可见文本 `"用户名或登录密钥错误"`（高对比红字 `rgb(255, 148, 148)`），真实登录跳转 `/` | **PASS** |
| 4 | `selection-controls-numerals-and-workbench` | `/transfer` 勾选原生 checkbox、`/finance` 双主题核对财务金额与对齐、`/admin` 展开审计详情 | `#transferOneTime` 与 `#featureFlagEnabled`/`KillSwitch` 均为 `20×20` 未拉伸；Finance 余额 `¥12,807.50` 启用 `tabular-nums`，收入绿/支出红，卡片圆角 `6px`；`#featureFlagAudit` 使用等宽字体 | **PASS** |
| 5 | `modal-focus-trap-and-account-theme` | 切换 `i02user` 在 `/account` 切 Dark、`375×812` 打开 `#deleteAccountModal` | `modalZ (9001) > navZ (620)`；`Tab` × 6 与 `Shift+Tab` 严格约束在弹窗内；`Escape` 关闭后焦点准确恢复至 `#openDeleteAccountBtn`；再次打开并关闭正常 | **PASS** |
| 6 | `routing-and-history-back` | 点击导航进入 `/finance` 后执行 `history.back()` | 正常回退至 `/` 且 `#publicHome` 可见，水平溢出 `<= 0px` | **PASS** |
| 7 | `viewport-matrix-light-and-dark` | 覆盖 `1440 / 1024 / 768 / 390 / 375 / 320` × Light/Dark 共 12 组视口 | **12/12 PASS**：零水平溢出（`overflowX: 0`）、零 `<44px` 触控目标（`smallTargets: []`）、`1440/1024/768` 顶栏单行 `61px` 无异常换行 | **PASS** |
| 8 | `reduced-motion-operability` | 仿真 `prefers-reduced-motion: reduce` 打开/关闭账户弹窗 | `transitionDuration: 1e-06s`，`Escape` 立即完成关闭并维持完整键盘可达性 | **PASS** |
| 9 | `offline-degradation-and-local-tool` | `/language/english` 下 `Network.emulateNetworkConditions({ offline: true })` | 状态点切换离线、`#modelLabel` 更新为 `"离线模式"`，页面维持主题背景可读不崩溃 | **PASS** |
| 10 | `p07-off-fallback-regression` | 将 D1 `p07_accessibility` 设为 `enabled = 0` 重载 `/` 并跳转 `/finance` | `p07: "disabled"`、`#v3Sidebar` `display: "none"`、零横向溢出、顶栏旧导航可见、`/finance` 功能正常 | **PASS** |

## 3. 全文档 `axe-core` 无障碍扫描（8/8 零违例）

| 扫描页面与配置 | 违例数 (`violations`) | 通过规则数 (`passes`) | 状态 |
|---|---:|---:|---|
| `home-1440-light-system` | 0 | 39 | **PASS** |
| `home-1440-dark` | 0 | 39 | **PASS** |
| `download-1440-light` | 0 | 39 | **PASS** |
| `login-1440-dark` | 0 | 42 | **PASS** |
| `finance-1440-light` | 0 | 36 | **PASS** |
| `finance-1440-dark` | 0 | 36 | **PASS** |
| `admin-1440-light` | 0 | 46 | **PASS** |
| `account-1440-dark` | 0 | 48 | **PASS** |

## 4. 明确边界声明

- **Android 真机测试**：`NOT_TESTED — NOT REQUIRED FOR I02 ACCEPTANCE`（本轮按指令在桌面端 headless Chrome 仿真 `390` / `375` / `320` 视口与 `prefers-reduced-motion` 等特性完成 Web 端验证，未构造或宣称真机 APK 测试）。

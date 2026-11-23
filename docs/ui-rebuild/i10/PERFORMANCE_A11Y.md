# Aeris V6.3 — I10｜性能、预加载与无障碍验收报告（Performance & Accessibility）

> **证据隔离声明**：下表严格区分本地隔离 Miniflare/Wrangler 测量值与云端隔离 Preview（`https://i10-interaction-acceptance.thewyj-i10-preview.pages.dev`）实测值；不包含任何推算或伪造的 CPU / 内存占用数字。

---

## 1. 无障碍（WCAG 2.2 AA）与多视口矩阵

### 1.1 `axe-core`（Serious / Critical 0 违规门禁）

| 环境 | 页面 / 场景 | Passes | Serious/Critical Violations | 依据 |
|---|---|---:|---:|---|
| 本地 I10 (`browser-acceptance.mjs`) | `/` 公开首页 (1440px Light) | 45 | **0** | [i10-acceptance-report.json](evidence/i10-acceptance-report.json) |
| 本地 I10 (`browser-acceptance.mjs`) | `/finance` 账本与抽屉 (1440px Light) | 46 | **0** | 同上 |
| 本地 I10 (`browser-acceptance.mjs`) | `/tools` 工具箱 (1440px Light) | 46 | **0** | 同上 |
| 本地 I03/I04 回归 (`qa/i03`, `qa/i04`) | 公开全路由矩阵 (11 scans) + 工作台 (7 scans) | — | **0** | 命令行实时输出 PASS |
| Hosted Preview (`verify-preview.mjs`) | `/` 公开首页 (1440px Light) | 47 | **0** | [i10-preview-verification.json](evidence/hosted/i10-preview-verification.json) |
| Hosted Preview (`verify-preview.mjs`) | `/tools` 工具箱 (1440px Light) | 46 | **0** | 同上 |
| Hosted Preview (`verify-preview.mjs`) | `/finance` 抽屉 + Toast HUD 共存 (1440px Light) | 37 | **0** | 同上 |

### 1.2 计算样式可见文本对比度专项检查（`auditVisibleTextContrast`, `>= 4.5:1`）

- `#toolsPanel` @ 1440px Light (P07 ON)：**0 violations**
- `#toolsPanel` @ 390px Dark (P07 ON)：**0 violations**
- `#toolsPanel` @ 1440px Light (P07 OFF)：**0 violations**
- Hosted Preview `#toolsPanel .tool-search span` (`模糊搜索工具`)：计算前景色 `rgb(71, 85, 105)`（`#475569`），替代历史失败色 `rgb(168, 187, 206)`（`1.84:1`）。
- 另注：测试过程中发现当 `.ds-toast[data-tone="info"]` 正处于 `220ms` 淡入半透明帧并覆盖暗色模态遮罩时，瞬时混合色可低于 4.5:1（稳态 `opacity: 1` 下 `#1d4ed8` / `#eff6ff` 为 `6.62:1` 符合 AA）；`verify-preview.mjs` 统一在 toast `300ms` 稳态落地后执行无障碍审计。

### 1.3 5 视口 × Light/Dark 实测（`375 / 390 / 768 / 1024 / 1440`）

来自 [i10-acceptance-report.json](evidence/i10-acceptance-report.json)：
- Light 模式 `375 / 390 / 768 / 1024 / 1440px`：`overflow` 分别为 `0 / 0 / -15 / -15 / -15`（零正向水平溢出）。
- Dark 模式 `375 / 390 / 768 / 1024 / 1440px`：`overflow` 分别为 `0 / 0 / -15 / -15 / -15`。
- `/tools` 390px Dark（本地）与 390px Light（Hosted Preview）：`overflow = 0`。
- `/finance` Bottom Sheet 375px Light（本地）：`overflow = 0`，`panelTransform = "none"`。

### 1.4 键盘、Reduced Motion 与 P07 OFF 验证

- **Command Palette (`Ctrl+K`)**：`ArrowDown` 更新 `aria-activedescendant = "v3CmdOption_1"`；`Esc` 关闭并恢复焦点到 `#v3CmdTrigger`；跳过 IME 组合输入（`isComposing`）。
- **工具箱与工作流键盘闭环**：卡片回车/点击进入工作台焦点落入工作台；`Esc` 退出并恢复焦点至卡片按钮或 `#toolSearchInput`；关闭工作流恢复 `.tools-header` 与 `#openWorkflowBtn` 焦点。
- **Reduced Motion (`prefers-reduced-motion: reduce`)**：在 Command Palette、`qa/aeris/p3-brand-public-browser.mjs`、以及 `/transfer` 滚动反馈下验证正常；无持续后台动画与滚轮劫持。
- **P07 OFF & 权限隔离**：通过 D1 将 `p07_accessibility` 设为 `enabled = 0` 后，`/tools` 在传统外观下仍保持 **0 contrast violations**；普通用户 `i10user` 登录后 `#v3SidebarAdminLink.hidden === true` 且直接请求 `/api/admin/feature-flags` 返回 `403`。

---

## 2. 性能、布局稳定性与预加载安全审计

### 2.1 实测性能指标

1. **公开主页 Tab 切换响应时间（本地 I10，`finance -> files -> tools -> learning`）**：
   - `tabTimes`: **`[287, 302, 688, 281] ms`**（含 `createTabSkeletonSwitcher` 预设 140ms 骨架屏过渡与 `180ms` 测量停留；公开窗口切换全程零 `scrollY` 跳变）。
   - Hosted Preview (`verify-preview.mjs`)：`yBeforeTab = 0, yAfterTab = 0`（跳变 `0px`）。
2. **公网公开页首屏与重排稳定性（`qa/aeris/p3-brand-public-browser.mjs` @ 本地 Wrangler Pages Dev，390/1366/1920 Light & Dark）**：
   - **`CLS = 0`**，`shifts = []`（全 6 组视口主题均零非预期布局偏移）。
   - 导航耗时 `responseMs` 实测 `26.6–38.9 ms`，`domContentLoadedMs` 实测 `1322.7–1424.5 ms`。
   - 长任务仅出现在冷启动脚本解析阶段（典型 `3` 条：首屏解析 ~189–222 ms 及水合收尾 ~53–99 ms）；未见因交互动画造成的持续长任务阻塞。

### 2.2 静态资源预加载与 Service Worker 安全

- `node --test local-backend/test_v6_ui_contracts.mjs` 验证 `createAssetPrefetcher`：
  - 尊重 `navigator.connection.saveData === true` 与 `2g / slow-2g` 慢网策略（直接跳过预取）；
  - 离线状态（`navigator.onLine === false`）跳过预取；
  - 同路由/同脚本去重；
  - I10 实测主页仅预取公共模块脚本（`/tools.js?release=...`, `/changelog.js?release=...`），严禁预取任何 `/api/*` 私有接口或账户凭据；
  - `js/core/motion.js` 修复增加 `link.crossOrigin = 'anonymous'`，消除 ES Module 预取与后续 `import()` 凭证模式不一致引发的双重下载风险。
- `npm run task27:publication` 通过：`publication_hash = f6f21340064277c936addb559f7b7274201db7501ffe1cf46561ba741dee4034`，保持 20 条核心壳层完整性摘要及已有离线壳层不变量。

---

## 3. 外部交互与无障碍规范对齐说明

- **WCAG 2.2 AA (`>= 4.5:1` / Target Size)**：已消除工具箱搜索提示（1.84:1 -> `#475569`）、加载状态容器透明度降级（3.13:1 -> 无降级）以及移动端（375/390px）溢出错位；`qa/task30` 验证移动端控件点击区域 >=44px。
- **WAI-ARIA APG (Listbox / Combobox / Dialog / Tabs)**：补齐 Command Palette `aria-activedescendant`、Workbench `Esc` 返回与归位焦点、以及模态/抽屉打开与关闭焦点环。
- **web.dev INP / 动画合成最佳实践**：将密度 FLIP 改为纯位移动画（`flipScale: false`），避免形变引发大面积重排与指针命中失效；保留原生 `<select>` 与平滑 2D 变换（终态 `transform: none`）。

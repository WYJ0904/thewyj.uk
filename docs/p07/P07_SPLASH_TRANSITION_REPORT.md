# Aeris P07 — 启动、登录与标签页恢复闪屏定向修复报告

## 摘要

本任务针对 Aeris P07 在隔离环境中出现的约 0.5 秒半成品 UI / 空白页面 / “正在读取界面设置…”闪屏现象进行了定向根因定位与无缝衔接修复。修复覆盖三个目标场景：
1. **首次访问 (Cold Boot)**：启动卡片平滑退出，直达已渲染的正式首页，不再露白或闪现“正在读取界面设置…”。
2. **登录成功 (Login Transition)**：复用 Aeris 官方设计风格的认证过渡卡片，平滑衔接直到新账户权威策略就绪且工作台挂载，不再出现全屏空白。
3. **标签页恢复 (Tab Switching Recovery)**：有效租约在后台安全续期，切回页面时保持原页面可见并平滑刷新，消除无故重新读取和闪屏。

所有修复均在独立工作树分支 `gemini/p07-splash-transition-fix` 完成，基线为 PR #131 (`7e938bdbda734d319053f1e23fe4a96703486ae6`)。

---

## 一、三种闪屏根因分析

通过基于 Chrome DevTools Protocol (CDP) 的连续 `requestAnimationFrame` 连续帧采样取证，准确定位了以下三处根因：

### 1. 场景一：首次访问冷启动闪屏（基线采样：3 帧空白，持续约 100~150ms）
- **根因一（时序脱节）**：旧启动逻辑在固定 450ms 定时器触发后立即移除启动卡片（`entryScreen`），而此时后台 `/api/status` 与 `/api/ui/features` 权威策略仍在网络传输中。
- **根因二（CSS 策略隔离规则）**：当 `data-interface-policy` 为 `'pending'` 时，CSS 规则 `html[data-interface-policy="pending"] #v3AppFrame { display: none; }` 生效，导致主应用框架不可见；同时浮动提示卡片 `#interfacePolicyState` 闪现“正在读取界面设置…”。
- **根因三（DOM 渲染闪烁与可见性突变）**：`.entry-screen.is-exiting` 包含了 `visibility: hidden;`，导致退出动画刚开始就被 Blink 引擎判定为不可见；而底层 `#appShell.app-shell-ready` 又具有 `animation: appProductIn` 从 `opacity: 0` 开始淡入，两者之间出现不可见帧的视觉塌陷。

### 2. 场景二：登录成功过渡闪屏（基线采样：13 帧空白，持续约 200ms）
- **根因一（过渡状态缺失）**：登录表单提交成功后，旧代码立即调用 `applyAccount()` 清空现有特性快照并将策略置为 `'pending'`，随后立即执行 `pushRoute("/", true)`。
- **根因二（网络间隙露白）**：`/api/features` 处于飞行状态（耗时约 150~200ms）。由于原登录界面已被关闭，而新工作台在 `data-interface-policy="pending"` 约束下被 CSS 隐藏，屏幕呈现纯白底色并悬浮“正在读取界面设置…”。

### 3. 场景三：后台标签页切回闪屏（基线采样：8 帧空白，持续约 130ms）
- **根因一（后台续期被阻断）**：特性控制器在后台运行时检测到 `document.hidden` 便无条件中断续期（`if (document.hidden) return;`）。
- **根因二（租约静默过期）**：当用户切至其他标签页（例如 ChatGPT）超过 30 秒特性租约 TTL 时，本地快照失效，策略回退为 `'pending'`。
- **根因三（前台强制重新加载）**：切回 Aeris 时，前台触发重新拉取 `/api/features`，在响应返回前的数十毫秒内触发界面策略重设，重现空白与“正在读取界面设置…”提示。

---

## 二、定向修复方案

### 1. 启动卡片与真实内容就绪联动 (`js/core/startup.js` & `app.js`)
- 在 `completeStartupSplash` 中引入 Promise 协同机制 `whenReady`，同时设置 2500ms 有界超时回退保护，保证在无网络或极端异常下绝不卡死。
- `boot()` 中构建 `whenContentReady`，等待后台健康检查、公开/账户特性策略以及目标路由首次挂载完成（`bootState = 'ready'`）后，启动卡片才开始平滑淡出退出。
- 保持对无 `whenReady` 调用（如极简单元测试和纯同步定时器测试）的 100% 同步兼容。

### 2. 登录认证过渡体验连续化 (`app.js` & `styles.css`)
- 新增 `showAuthTransition("正在验证身份与权限…")` 与 `dismissAuthTransition(overlay)`。
- 复用 Aeris 官方 `.entry-screen` 视觉规范（官方图标、品牌标志与加载进度指示器），以固定遮罩层平滑覆盖。
- 登录成功后，在遮罩保护下等待新账户权威特性策略 `featureController.refresh()` 完成并挂载目标工作台，随后通过 180ms cubic-bezier 曲线平滑淡出，彻底消除裸露的空白中间状态。

### 3. 策略状态提示中性化 (`app.js`)
- 修改 `applyInterfacePolicy()`：将 `#interfacePolicyState` 的显示条件调整为仅在显式 `'error'` 状态下出现，不再在瞬态 `'pending'` 下闪现“正在读取界面设置…”。
- 遇到网络彻底离线或 503 故障时，保留带重试按钮的清晰错误恢复面板（Fail-Closed）。

### 4. 有效租约后台静默续期 (`js/core/feature-flags.js` & `js/core/public-ui-policy.js`)
- 在页面处于后台（`document.hidden`）时，若当前租约仍然有效（`snapshot.expiresAt > Date.now()`），允许正常发起后台续期，防止用户短暂切换标签页导致租约意外过期。
- 若身份已被撤销或服务端返回 401/403，依然严格执行立即清除与会话失效流程，绝不延长无效权限。

### 5. 消除 Blink 退出闪现与图层塌陷 (`styles.css` & `product-ui.css`)
- 移除 `.entry-screen.is-exiting` 中的 `visibility: hidden;`，使退出淡出动画完整呈现。
- 移除 `.app-shell.app-shell-ready` 初始从 `opacity: 0` 开始的二次淡入，使主应用在启动遮罩下方处于完全就绪状态，两层平滑交叉过渡。

---

## 三、安全边界与无障碍保全

### 1. Codex R5 安全边界 100% 保留
- **严格跨账户隔离**：保留 `html[data-interface-policy="pending"] #v3AppFrame { display: none; }`，确保当账户 A 切换至未经服务端验证的账户 B 时，绝不提前或残留渲染任何私有数据。
- **晚到响应防御**：保留账户 Session 与请求 Owner 绑定机制，晚到达的旧账户响应绝不污染新账户。
- **BFCache 私有数据防护**：保留页面恢复时对已撤销会话的强制重验，防止后退/前进缓存泄露私有数据。

### 2. P07-F 无障碍体系 100% 保全
- 完整保留 8 项核心无障碍修复（语义化 H1/H2 结构、ARIA 状态指示、Skip to Content 跳转、模态框 Escape 键焦点恢复与焦点陷阱）。
- 完整保留 3 个主页悬浮卡片交互与官方品牌 Logo 不变性。
- 完整保留浅色/深色主题与 Reduced Motion 减弱动画偏好支持。

---

## 四、验证结果

### 1. CDP 真实连续帧采样取证（修复前后对比）

| 场景 | 基线空白帧数 | 基线空白时长 | 修复后空白帧数 | 修复后空白时长 | 视觉效果改善 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **场景一：首次访问 (Cold Boot)** | 3 帧 | 100~150 ms | **0 帧** | **0 ms** | 启动卡片平滑退出，首页瞬间就绪 |
| **场景二：用户登录成功** | 13 帧 | 200 ms | **0 帧** | **0 ms** | 官方卡片平滑淡出，直接展示工作台 |
| **场景三：后台标签页切回恢复** | 8 帧 | 130 ms | **0 帧** | **0 ms** | 保持原页面立即可见，后台静默重验 |

详细采样数据见：
- `docs/p07/evidence/flicker-investigation/baseline-flicker-investigation.json`
- `docs/p07/evidence/flicker-investigation/after-flicker-investigation.json`

### 2. 自动化测试套件回归结果

| 测试套件 | 测试文件 | 测试用例数 | 通过数 | 失败数 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **启动逻辑单元测试** | `qa/p07-r4c/startup.test.mjs` | 4 | 4 | 0 | **PASS** |
| **P07-F 无障碍预检** | `qa/p07-f/verify-p07-f-preflight.mjs` | 8 大门禁 (axe-core/CWV/Viewports) | 8 | 0 | **PASS** (`P07_F_PREFLIGHT_READY`) |
| **Codex R5 策略隔离测试** | `qa/p07-r5/independent-policy.mjs` | 5 | 5 | 0 | **PASS** |
| **Codex R5 浏览器完整测试** | `qa/p07-r5/independent-browser.mjs` | 13 | 13 | 0 | **PASS** |

---

## 五、修改文件清单

1. `js/core/startup.js`：启动卡片退出流程引入 `whenReady` 协同机制与有界安全定时器。
2. `app.js`：
   - 接入启动就绪协调，等待权威策略与路由挂载完成后退出启动页；
   - 登录流程集成 `showAuthTransition` / `dismissAuthTransition`；
   - 调整策略指示器仅在显式错误时可见；
   - 优化后台刷新与前台页面渲染时序。
3. `js/core/feature-flags.js`：支持有效租约在页面处于后台时的正常续期。
4. `js/core/public-ui-policy.js`：支持有效公开特性租约在后台时的正常续期。
5. `styles.css`：新增认证过渡遮罩样式，维持主应用框架在 pending 状态下的严格隔离。
6. `product-ui.css`：优化退出动画阶段的可见性控制，消除闪现与 Blink 裁剪。
7. `qa/p07-r5/flicker-investigation.mjs`：基于 CDP 的高精度连续帧闪烁分析工具。
8. `qa/p07-r5/run-r5-suites.mjs`：集成化 R5 测试套件运行调度器。

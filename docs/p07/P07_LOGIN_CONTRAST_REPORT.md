# Aeris P07 — 登录与注册页面对比度异常定向修复报告

## 摘要与验收结论

验收状态：**P07_LOGIN_CONTRAST_PASS**

针对 Draft PR #132 回归记录中发现的 LoginPage 4 个颜色对比度（`color-contrast`）违规节点（`#authSubtitle`、`#showLoginBtn`、`#showRegisterBtn`、`#loginSubmitBtn`），完成了真实浏览器 CDP 与 axe-core 深度定位、分类与定向修复。

- **根因确认**：原有 P07-F 的 CSS 设计令牌在稳态下对比度完全合格（均在 5.17:1 ~ 9.68:1 之间，超越 WCAG AA 4.5:1 要求）。异常来源于测试套件 `qa/p07-f/verify-p07-f-preflight.mjs` 在未等待页面入场过渡动画（`accountPageIn` 240ms）完成的情况下过早触发 axe 采样，Blink 引擎在半透明帧（opacity ~0.6-0.7）中将前景色与画布底色（`#f4f6f9`）进行插值混合，导致计算对比度短暂跌落至 2.52:1 ~ 3.54:1。
- **最小化与确定性修复**：
  1. 测试套件采用 Web Animations API 标准 `document.getElementById('authPanel').getAnimations().every(a => a.playState === 'finished' || a.playState === 'idle')` 进行确定性动画完成等待，**不使用固定等待制造通过**，并在 `prefers-reduced-motion: reduce` 下零延迟立即就绪。
  2. 样式层面在 `spatial-experience.css` 中定向补充针对 `.auth-tabs > button` 及 `:is(#loginSubmitBtn, #registerSubmitBtn)` 的 `:hover`、`:focus-visible`、`:disabled` 等完整交互态高对比与焦点轮廓规则，强化视觉保护。
- **验证通过**：全量执行 P07-F 预检 8 大门禁（CWV、全工作台 axe、键盘交互、7 视口响应式、多主题与动画、品牌三卡片、资源体积与综合验收），LoginPage 违规节点数从 4 项降至 0 项，全站 0 findings，状态 `P07_F_PREFLIGHT_READY`。

---

## 1. 固定工程信息与环境隔离

- **代码仓库**：`WYJ0904/thewyj.uk`
- **基线版本**：Draft PR #131（固定 SHA: `7e938bdbda734d319053f1e23fe4a96703486ae6`）
- **问题来源**：Draft PR #132 的 Task25 最终回归记录（`docs/p07/P07_TASK25_D1_CONCURRENCY_REPORT.md`）
- **独立工作树路径**：`.codex/worktrees/gemini-p07-login-contrast-fix/thewyj.uk`
- **独立任务分支**：`gemini/p07-login-contrast-fix`
- **目标分支**：`codex/p07-f-a11y-closeout`（不直接面向 main）
- **分支与环境安全防护**：
  - 未触动 PR #128–#133 的任何现有 HEAD。
  - 主工作区旧有的 `codex/android-accessibility-accounting-hotfix` 分支及其未提交修改 100% 保持只读未改，未执行任何 `git reset`、`clean` 或覆盖操作。
  - 不碰 `app.js`、会话、Feature Flag、Service Worker、启动策略、BFCache 和 Task25 后端。

---

## 2. 四个异常节点的真实浏览器复现与根因

PR #132 保存于 `docs/migration-evidence/p07-task25-d1/task25-final-regression/p07-f-preflight-report.json` 的 LoginPage 记录显示：
```json
"LoginPage": {
  "violationsCount": 1,
  "passesCount": 43,
  "incompleteCount": 0,
  "violations": [{
    "id": "color-contrast",
    "impact": "serious",
    "nodesCount": 4,
    "sampleTargets": ["#authSubtitle", "#showLoginBtn", "#showRegisterBtn"],
    "sampleSummaries": [
      "Element has insufficient color contrast of 3.54 (foreground color: #7d8796, background color: #fcfcfd, font size: 10.5pt (14px), font weight: normal). Expected contrast ratio of 4.5:1",
      "Element has insufficient color contrast of 2.98 (foreground color: #6691ef, background color: #fcfcfd, font size: 10.5pt (14px), font weight: normal). Expected contrast ratio of 4.5:1"
    ]
  }]
}
```

通过真实 Chrome/CDP 及 axe-core 逐帧取证，4 个违规节点完全确认：

| 节点选择器 | 实际文字 | 稳态设计 Token | 过渡帧混合计算值（RED） | 稳态实测对比度（GREEN 亮/暗） |
| :--- | :--- | :--- | :--- | :--- |
| `#authSubtitle` | 使用 Aeris 账户同步词汇进度、账本记录与传输文件。 | 文字：`var(--ds-text-secondary)`<br>底色：`var(--ds-surface)` | 前景：`#7d8796` ~ `#8e97a4`<br>背景：`#fcfcfd` ~ `#fbfbfd`<br>对比度：**2.85:1 ~ 3.54:1** (FAIL) | 亮色：**7.58:1** (PASS)<br>暗色：**9.68:1** (PASS) |
| `#showLoginBtn` | 登录（激活态 Tab） | 文字：`var(--ds-brand)`<br>底色：`var(--ds-surface)` | 前景：`#6691ef` ~ `#7a9ff1`<br>背景：`#fcfcfd` ~ `#fbfbfd`<br>对比度：**2.52:1 ~ 2.98:1** (FAIL) | 亮色：**5.17:1** (PASS)<br>暗色：**6.74:1** (PASS) |
| `#showRegisterBtn` | 注册（未激活 Tab） | 文字：`var(--ds-text-secondary)`<br>底色：`var(--ds-surface-muted)` | 前景：`#7d8796` ~ `#8e97a4`<br>背景：`#f2f5f9`<br>对比度：**2.69:1 ~ 3.54:1** (FAIL) | 亮色：**7.00:1** (PASS)<br>暗色：**8.82:1** (PASS) |
| `#loginSubmitBtn` | 登录（Primary 提交按钮） | 文字：`var(--ds-on-brand)`<br>底色：`var(--ds-brand)` | 前景：`#fbfbfd`<br>背景：`#6691ef` ~ `#7a9ff1`<br>对比度：**2.52:1 ~ 3.06:1** (FAIL) | 亮色：**5.17:1** (PASS)<br>暗色：**7.44:1** (PASS) |

### 混合数学原理核算（RGB 像素完全契合）
- 画布底色：`--ds-workspace-canvas: #f4f6f9`（RGB: 244, 246, 249）
- 卡片底色：`--ds-surface: #ffffff`（RGB: 255, 255, 255）
- 次要文本色：`--ds-text-secondary: #475569`（RGB: 71, 85, 105）
- 品牌蓝色：`--ds-brand: #2563eb`（RGB: 37, 99, 235）
- 当 `accountPageIn` 运行至 t≈100ms（总时长 240ms）时，卡片透明度为 $\alpha \approx 0.70$：
  - 卡片底色混合：$255 \times 0.7 + 244 \times 0.3 = 251.7 \to \mathbf{\#fcfcfd}$。
  - 次要文字混合：$71 \times 0.7 + 252 \times 0.3 = 125.3 \to \mathbf{\#7d8796}$。
  - 品牌文字混合：$37 \times 0.7 + 252 \times 0.3 = 101.5 \to \mathbf{\#6691ef}$。
数值与 axe-core 报告中的颜色误差为 0。

### 2.1 动画过渡期间短暂低对比度的物理客观性与无障碍边界界定

1. **物理客观存在性（明确核实）**：
   - 在正常动效模式（`prefers-reduced-motion: no-preference`）下，`styles.css` 中 `@keyframes accountPageIn` 为 `from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); }`，持续时长为 240ms。
   - 在动画开始至完成的 $t \in (0, 240\text{ms})$ 区间内，面板透明度 $\alpha < 1.0$。Blink 渲染引擎将半透明前景与画布背景混合，计算对比度在 $t \approx 100\text{ms}$ 时为 2.52:1 ~ 3.54:1。
   - **核实结论**：四个节点在正常入场动画期间的短暂低对比度**在物理渲染上客观存在**。稳态测试门禁的通过并没有消除动画过程中的渐变插值，任何基于 opacity 淡入的动效在中间帧均存在低于 4.5:1 的瞬态区间。**严禁仅因稳态 axe 扫描通过就宣称“所有动画帧对比度达标”**。

2. **区分动画采样失真与实际可访问性（Accessibility）**：
   - **自动化测试采样机制与失真原因**：axe-core / Lighthouse 等可访问性扫描器在设计上假定 DOM 与样式处于静态稳态。若在页面入场动画进行中（$t \approx 100\text{ms}$）强行进行静态快照扫描，工具会把 240ms 的瞬态中间帧误当作静态界面，从而产生假阳性违规报警。
   - **真实可访问性标准要求（WCAG 2.1 / 2.2 SC 1.4.3 & SC 2.3.3）**：
     - WCAG 1.4.3（对比度最低标准）约束的是用户阅读和交互的**稳态内容**，非交互性入场过渡动画并不要求 240ms 内的每个瞬态渲染微秒帧均强制达到 4.5:1。
     - **运动减弱（prefers-reduced-motion）保障**：对于视力障碍或对动态效果敏感的用户，系统严格支持 `prefers-reduced-motion: reduce`。在此模式下，`styles.css`（第 2757 行）与 `spatial-experience.css`（第 4302 行）完全禁用动画（`animation: none`，持续时间 0ms），页面在 $t=0$ 即以 100% 不透明度呈现，彻底避免任何短暂低对比度区间。
     - **稳态交互保障**：动画完成（$t \ge 240\text{ms}$）后，稳态实测对比度达 5.17:1 ~ 9.68:1，且新增补强了 `:hover`、`:focus-visible`、`:disabled` 等完整交互态对比度，完全达到并超越 WCAG AA 4.5:1 标准。

3. **剩余风险与演进考量**：
   - 在正常动效下，未开启系统级“减弱动态效果”的用户在加载首个 240ms 内会经历视觉渐变。若后续产品或无障碍规范要求动画全程无任何半透明阶段，可评估将入场动效调整为纯位移（仅 `transform`，固定 `opacity: 1`），但此举属于产品设计视觉变更。按当前保护原则，本次不扩大产品改动，保持既有设计并由 Draft PR 留待后续审阅。

---

## 3. 定向修复方案

### 1. 测试时序确定性收敛 (`qa/p07-f/verify-p07-f-preflight.mjs`)
将原脆弱的纯 DOM 存在判断：
```javascript
await page.waitFor("!document.getElementById('entryScreen') && document.getElementById('authPanel').getClientRects().length > 0", 20_000, "Login panel visible");
```
更新为基于标准 Web Animations API 的物理就绪与完成判定：
```javascript
await page.waitFor(
  "!document.getElementById('entryScreen') && document.getElementById('authPanel').getClientRects().length > 0 && document.getElementById('authPanel').getAnimations().every(a => a.playState === 'finished' || a.playState === 'idle')",
  20_000,
  "Login panel visible and transition settled"
);
```
- **拒绝固定等待**：不使用 `await delay(300)`。
- **全模式兼容**：在 `prefers-reduced-motion: reduce` 下，`getAnimations()` 返回空数组，`every()` 立即为真，无额外等待；在正常动效下，精确在第 240ms 动画完成帧触发 axe 扫描。

### 2. 视觉交互与无障碍样式增强 (`spatial-experience.css`)
保留原字体、字号、间距与按钮尺寸的前提下，定向增强直接相关的交互与状态样式：
```css
/* 选项卡交互态高对比与焦点轮廓 */
html[data-p07-ui="enabled"] .auth-tabs > button:hover:not(.active):not([aria-selected="true"]) {
  color: var(--ds-text);
  background: var(--ds-hover);
}
html[data-p07-ui="enabled"] .auth-tabs > button:focus-visible {
  outline: 2px solid var(--ds-focus);
  outline-offset: 2px;
}

/* 提交按钮焦点轮廓与禁用态高对比保全 */
html[data-p07-ui="enabled"] .auth-panel :is(#loginSubmitBtn, #registerSubmitBtn):focus-visible {
  outline: 2px solid var(--ds-focus);
  outline-offset: 2px;
}
html[data-p07-ui="enabled"] .auth-panel :is(#loginSubmitBtn, #registerSubmitBtn):disabled {
  background: var(--ds-surface-disabled);
  color: var(--ds-text-disabled);
  border-color: var(--ds-border);
  cursor: not-allowed;
}
```

---

## 4. 全矩阵与多视口复验结果

在真实 Headless Chrome/CDP 下执行 20 组环境矩阵校验（包含 375、390、768、1024、1440px 视口，亮/暗主题，普通动画/减弱动画，登录/注册切换，错误提示态）：

| 视口 / 宽度 | 主题模式 | 动效模式 | 登录页面 axe 违规 | 注册页面 axe 违规 | 截图证据 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **375px (Compact Mobile)** | Light | normal | **0** | **0** | `repro-login-375-light.png` / `repro-register-375-light.png` |
| **375px (Compact Mobile)** | Dark | normal | **0** | **0** | `repro-login-375-dark.png` / `repro-register-375-dark.png` |
| **390px (Standard Mobile)**| Light | normal | **0** | **0** | - |
| **390px (Standard Mobile)**| Dark | normal | **0** | **0** | - |
| **768px (Tablet)** | Light | normal | **0** | **0** | - |
| **768px (Tablet)** | Dark | normal | **0** | **0** | - |
| **1024px (Landscape)** | Light | normal | **0** | **0** | - |
| **1024px (Landscape)** | Dark | normal | **0** | **0** | - |
| **1440px (Desktop)** | Light | normal | **0** | **0** | `repro-login-1440-light.png` / `repro-register-1440-light.png` |
| **1440px (Desktop)** | Dark | normal | **0** | **0** | `repro-login-1440-dark.png` / `repro-register-1440-dark.png` |
| **375px ~ 1440px (全量)** | Light/Dark | reduce | **0** | **0** | `p07-f-reduced-motion-1440.png` |
| **错误反馈态 (#loginError)** | Light / Dark | normal | **0** | **0** | `repro-login-error-light.png` / `repro-login-error-dark.png` |

---

## 5. P07-F 八项核心无障碍规则回归检查

| 核心无障碍规则 | 涉及主要元素 | 回归结果 | 说明 |
| :--- | :--- | :--- | :--- |
| `aria-prohibited-attr` | `#statusDot` | **PASS (0)** | 保持 status 角色与实时服务描述关联 |
| `color-contrast` | `#accountSyncBadge` / `.auth-panel` | **PASS (0)** | 全工作台无对比度违规 |
| `label` | `#workflowImportInput` | **PASS (0)** | 保持输入框可见行焦点与按钮标签 |
| `aria-allowed-role` | `#versionNotice`, `#loginTabPanel` | **PASS (0)** | 合法 div/tabpanel 包裹原生 form |
| `landmark-unique` | `#publicHome` | **PASS (0)** | 外层工作区名称唯一性保持 |
| `page-has-heading-one` | `#authTitle` 等 | **PASS (0)** | 登录与注册保持原生语义 H1 |
| `heading-order` | 学习与后台标题层级 | **PASS (0)** | H1/H2/H3 层次有序自然 |
| `landmark-complementary-is-top-level` | 财务说明容器 | **PASS (0)** | 容器语义保持一致 |

---

## 6. 修改文件清单

1. `spatial-experience.css`：为登录与注册面板的选项卡按钮和提交按钮补充 `:hover`、`:focus-visible` 及 `:disabled` 高对比与焦点指示样式。
2. `qa/p07-f/verify-p07-f-preflight.mjs`：收敛 `LoginPage` 门禁就绪判定，引入 Web Animations API 动画完成检测，消除过早抽样。
3. `qa/p07-f/investigate-contrast.mjs`：用于精确复现、矩阵扫描与证据采集的自动化分析脚本。
4. `docs/p07/P07_LOGIN_CONTRAST_REPORT.md`：本报告。
5. `docs/p07/evidence/p07-f/`：
   - `CONTRAST-INVESTIGATION.json`：全矩阵实测数据与色彩分析原件。
   - `p07-f-preflight-report.json`：全量 8 大门禁验证报告原件（0 findings）。
   - 对应多主题、多视口对比度实测截图。

---

## 7. 与 Codex 当前分支的冲突分析与集成提示

- **与 PR #133 (启动闪屏修复 `gemini/p07-splash-transition-fix`)**：
  - PR #133 调整了启动页退场时序与遮罩层（`app.js`、`styles.css` 顶部）。
  - 本分支只修改了 `spatial-experience.css` 中的 `.auth-panel` 局部样式与 `verify-p07-f-preflight.mjs`，两者文件与代码块完全正交，**无任何 Git 合并冲突**。
- **与 Codex P07 最终集成流程**：
  - 本分支提交增量极小，Codex 可直接挑选（cherry-pick）或合并。
  - 本分支未擅自变动站内 Release 串，不影响整站静态资源版本统一封存。

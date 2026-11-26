# Aeris V6.3 Phase 4（P4）— 语言学习模块重构验收报告

> **分支**：`hydrogen/v63-phase4-language-redesign`（基于 `hydrogen/v63-phase3-tools-redesign` `0a94122d3d54febb585473031baaff2d5efbdd3f`）
> **隔离 Preview 地址**：`https://v63-phase4.thewyj-v63-preview.pages.dev`（独立部署：`https://33d4e9ef.thewyj-v63-preview.pages.dev`）
> **任务范围**：语言学习 Web/PWA 模块（`/language`、`/language/english`、`/language/japanese`、`#projectPicker`、`#projectApp`、`#setupView`、`#quizView`、`#wrongView`、`#achievementsView`、`#studyView`、`#roundSummaryModal`、`#rejudgeResultModal`）。未改 Production D1/R2、未改主站/工具箱/账本业务契约、未启动 P5 或 AI/Android Hotfix。

---

## 1. 核心架构与功能保留确认（Task 26 & 全业务契约）

1. **严格保留唯一答题入口与 5 个页签**：`#setupView`（词表）、`#quizView`（答题，未开测禁用）、`#wrongView`（错题）、`#achievementsView`（成就）、`#studyView`（统计）；`#masterySection` 保持不对未授权/词表视图暴露（已在自动化测试中断言 `masteryExposedInSetup === false`）。
2. **核心规则零改动**：英语/日语释义判卷、听写归一化（含日语汉字+假名）、严格/普通/宽松模式、错题原地重判、FSRS 错题排序/降级本地复习、PDF/JSON 导出导入、25 项成就、7 日学习统计、本地草稿与运行态恢复、多账户与多档案隔离、Task 25/26 开关与会员上限均完整保留并通过回归。
3. **SW 壳列表不变量**：`CORE_SHELL` 保持 81 项、规范化 SHA-256 为 `a33d01c43f6f20a6963ab1384fb2305ee3b2447e0e68dc8c1f3015f1a2a6deae`，`REQUIRED_SHELL` 保持 89 项；`PUBLICATION_HASH` 已通过 `npm run task27:publication` 更新为 `588c5f522df7db5ce12e2192542305032fdca915898ff736fd81ed580532890b`。

---

## 2. 本次主要体验与工程改造

- **`index.html`**：
  - `#projectPicker` 为英语/日语测试卡片增加动态真实状态位（`#projectStatusEnglish`、`#projectStatusJapanese`）与引导副标题。
  - `#workspace .tabs` 与 `#wrongView .scope-tabs` 补齐 `role="tablist"`/`role="tab"`、`aria-selected`、roving `tabindex`；`#achievementsView` 筛选按钮补齐 `aria-pressed`。
  - `#setupView` 结构重组为 `.language-setup-layout`（词表主编辑区 + 右侧配置与按需智能选词栏），新增内联状态条 `#setupStatusBanner`。
  - `#resultPanel` 新增 `#resultUserAnswer` 展示「你的作答」，便于与标准答案直接对照；`#wrongView` 优化工具带排版。
- **`app.js`**：
  - 新增 `updateProjectPickerMeta()`、`showSetupStatus()`；将 `#setupView` 开测错误/无效导入 `alert()` 替换为内联横幅。
  - `setView()`、`setWrongScope()` 同步 WAI-ARIA 状态并支持 `ArrowLeft`/`ArrowRight`/`Home`/`End` 键盘漫游（自动跳过禁用的 `#quizViewTab`）。
  - `#answerInput` 与 `.wrong-rejudge-input` 增加 IME 组字态（`compositionstart`/`compositionend`/`isComposing`/`keyCode === 229`）Enter 防误提交。
  - `renderQuestionFeedback()` 激活 `has-feedback` 双栏/稳态反馈布局并记录 `data-quiz-state`；判卷/复习失败移除错误自动消闪（不再调用 `scheduleResultHide()`）；`#nextNowBtn` 就绪态加 `.is-ready` 视觉强调；日语听写占位提示缩短避免 `390px` 截断。
- **`spatial-experience.css`（Phase 4 样式层，0 `!important`）**：
  - 移除 `#quizView:has(.result-panel:not(.hidden))` 失配规则，恢复桌面 `>=1100px` `has-feedback` 稳定分栏与单焦环 `#answerInput`。
  - 修复 `#roundSummaryModal .round-accuracy` 在浅色弹窗上的浅蓝字高对比度缺陷。
  - 修复 `#studyView .study-day-track` 桌面大黑方块为 `28px` 居中柱条。
  - 修复移动端 `390×844` 下词表操作按钮排版（使 `#wordInput`、`#startBtn`、mode 选择与 `#wrongView` 首条错题全部落入首屏）。

---

## 3. 前后实测数据对比（Isolated Local Wrangler D1 + Headless Chrome）

### 3.1 首屏几何与关键修复对比

| 检查项 | 改前基线（Before） | 改后实测（After） |
|---|---|---|
| `390×844` `#startBtn` 底部位置 | `bottom = 909.5px`（**掉出首屏**，`startVisibleInFold = false`） | `bottom = 600.2px`（**完整位于首屏**，`startVisibleInFold = true`） |
| `1440×900` `#wordInput` 位置/高度 | `top = 666.5px`, `height = 120px` | `top = 313.1px`, `height = 248px` |
| `390×844` `#wrongList` 顶部位置 | 被 8 枚堆叠按钮顶出首屏外 | `top = 693.8px`（首条错题直接可见，`smallButtons = []`） |
| `#roundSummaryModal .round-accuracy` | `#bdefff` on light modal（低对比） | `rgb(36, 36, 36)` on `rgb(253, 253, 253)` |
| `#studyView .study-day-track` 宽度 | 撑满网格列宽呈现大黑方块 | `max-width: 28px`（实测 `<= 30px`） |
| `320 / 375 / 390 / 768 / 1440` 横向溢出 | — | 全部 `overflow = 0px` |

### 3.2 关键操作耗时对比（`ms`）

| 指标 | 改前 `p50 / p95 / max`（样本） | 改后 `p50 / p95 / max`（样本） | 变化 |
|---|---|---|---|
| 冷进入 `/language`（n=5） | `3904 / 4268 / 5129` | `3186 / 3873 / 4765` | `-718 ms`（p50） |
| 热切入 `/language`（n=5） | `55 / 66 / 81` | `41 / 42 / 57` | `-14 ms`（p50） |
| 进入语言工作区 `/language/english`（n=5） | `63 / 67 / 86` | `33 / 33 / 38` | `-30 ms`（p50） |
| 答题提交到反馈呈现（n=3） | `261 / 261 / 261` | `258 / 258 / 315` | `-3 ms`（p50，平稳） |

---

## 4. 证据文件索引

- 功能矩阵：[FEATURE_RETENTION_MATRIX.md](./FEATURE_RETENTION_MATRIX.md)
- 规范映射：[REFERENCE_MAPPING.md](./REFERENCE_MAPPING.md)
- 五项检查报告：[FIVE_SKILLS_AUDIT.md](./FIVE_SKILLS_AUDIT.md)
- 1.0x 桌面走查录屏：[walkthrough-desktop-1440.mp4](./evidence/walkthrough-desktop-1440.mp4)
- 1.0x 手机走查录屏：[walkthrough-mobile-390.mp4](./evidence/walkthrough-mobile-390.mp4)
- 改前截图（14 张 + 诊断 JSON）：[before-diagnostics.json](./evidence/before/before-diagnostics.json)
- 改后截图（17 张 + 诊断 JSON）：[after-diagnostics.json](./evidence/after/after-diagnostics.json)

---

## 5. 全量验证与资源清理汇报（Aeris Resource Guard）

### 5.1 静态/单测/工程门禁（全部 PASS，最后一次改动后执行）

- `npm run task27:publication` -> PASS（`integrity_entries: 80, install_shell_total: 89, prior_core_shell_preserved: true`）
- `npm run cf:check` -> PASS（Worker 编译成功）
- `npm run pages:stage` -> PASS（`.wrangler/pages-output`）
- `python local-backend/test_static.py` -> PASS（31/31 tests OK）
- `node local-backend/test_language_js.mjs` -> PASS
- `node local-backend/test_learning_sync_js.mjs` -> PASS
- `npm run test:task26` -> PASS（Task26 引擎 32 组 + D1/Client + Wrong Review 15/13/6 组等 12 个套件全通过）
- `node --test local-backend/test_i05_workspace_shell.mjs local-backend/test_i06_module_experience.mjs` -> PASS（5/5，`zero !important` 保持）
- `python scripts/functional_audit_gate.py` -> PASS（27 routes, 24 app flows, 104 tools）
- `python scripts/repository_audit.py` -> PASS（2508 files checked）

### 5.2 重型浏览器测试与执行并发策略

> 严格执行 **100% 串行调度**（同一时间仅运行一组 Wrangler/Python 服务与无头 Chrome 实例，无任何重叠）：

1. **P4 综合走查与录屏 (`p4_verify.mjs`)**：Wrangler Pages Dev + Chrome -> PASS（Guest 守卫、Free 账户限额提示、VIP 桌面/手机英日释义与听写、IME 组字拦截、双击防重、重判、刷新恢复、APG 键盘导航、浅/深色、动效减弱、`320/375/390/768/1440` 零溢出，`runtimeErrors: []`，`dialogs: []`）。
2. **SW 全新安装与降级演练 (`qa/p07-release/sw-install-browser.mjs --source WORKTREE`)**：Chrome + HTTP/1 限速夹具 -> PASS（7/7：`normal`, `slow`, `failure-retry`, `body-timeout`, `warm`, `task26-failure`, `stale-task26`）。
3. **Wrangler PWA / P1 / P2 / P4 / Task26 回归组 (`run_wrangler_suites.mjs` 串行逐项执行)**：
   - `qa/aeris/p5-pwa-browser.mjs` -> PASS（8.9s）
   - `qa/aeris/p1-navigation-lifecycle.mjs` -> PASS（31.7s）
   - `qa/aeris/p2-interaction-browser.mjs` -> PASS（47.9s）
   - `qa/aeris/p4-behavior-browser.mjs` -> PASS（81.3s，390/1366/1920）
   - `qa/task26/learning-browser.mjs` (`wrong-review-browser.mjs`) -> PASS（185.8s，320/390/768/1440）
4. **全站 24 项集成回归 (`local-backend/test_app_browser.mjs` + `server.py` + `ci_ollama_stub.py` + Chrome)** -> PASS（24/24，`runtimeErrors: []`）。
5. **Hosted Preview 验真 & P3→P4 原地升级 (`verify_preview_and_upgrade.mjs`)**：
   - `https://v63-phase4.thewyj-v63-preview.pages.dev` -> `p07Ui: enabled`，`/` 与 `/trial` 零错误零溢出，`/language` 未登录跳 `/login`，新 SW 激活无异常。
   - 本地同源从 P3 (`0a94122d`) 原地升级到 P4：未清理缓存、未退出登录，`apple\nbanana` 词表草稿与会话完整保留，升级后 P4 UI 正常接管，`upgErrors: []`。

### 5.3 进程与临时资源清理结果

- 上述所有临时子进程（`wrangler pages dev`、`chrome.exe`、`local-backend/server.py`、`ci_ollama_stub.py`）均由各自脚本的 `finally` 块使用 `taskkill /PID ... /T /F` 精准回收，临时测试目录及 `.tool-e2e` / `.wrangler/p4-sw-install-check` 均已删除；未对项目外任何常驻进程执行通配符查杀。

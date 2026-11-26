# Aeris V6.3 Phase 4 — 五项设计技能联合审查报告（Five Skills Audit）

> 审查范围：`index.html`、`app.js`、`spatial-experience.css`（Phase 4 语言学习模块：`/language`、`#projectPicker`、`#projectApp`、`#setupView`、`#quizView`、`#wrongView`、`#achievementsView`、`#studyView`、`#roundSummaryModal`、`#rejudgeResultModal`）以及前后真机/无头 Chromium 截图与走查数据。

---

## 1. frontend-design（整体美学、主次秩序与视觉边界）

| 维度 | 改前诊断 | P4 重构落地 | 验收结果 |
|---|---|---|---|
| 语言入口 (`#projectPicker`) | 两张卡片缺乏真实限额、草稿词数、进行中状态提示，大号旧版页头压低内容 | 收敛页头高度与图标尺寸（`48×48`），双语卡片展示来自真实存储/权限的动态副标题（进行中题数 / 草稿词数 / 历史错题 / 单轮限额） | PASS（`after-picker-1440.png` / `after-picker-390.png`） |
| 词表编辑主角 (`#setupView`) | `#wordInput` 被上方配置与已展开 `#languageAiDisclosure` 挤到桌面 `y=666.5px`、手机 `y=681.2px`，`#startBtn` 跌出 `390×844` 首屏（`bottom=909.5px`） | 桌面端采用两栏工作区（左主编辑区 `248px` 高文本框 + 主操作；右副栏紧凑设置与按需智能选词）；手机端 `#wordInput` 置顶于首屏、`#startBtn` 居中可见（`bottom=600.2px`） | PASS（`after-setup-1440.png` / `after-setup-390.png`） |
| 单题沉浸与反馈 (`#quizView`) | `#quizView:has(.result-panel:not(.hidden))` 取消最大宽度导致失配，反馈面板掉到卡片下方并在 `390px` 截断；`.quiz-progress-track` 紧贴圆角裁切 | 移除失配覆盖，触发真实 `has-feedback` 语义与明确 `data-quiz-state`（`grading`/`correct`/`incorrect`/`skipped`/`error`），桌面 `>=1100px` 稳定双栏、移动端单栏稳态展开；进度条改用直边满宽贴顶 | PASS（`after-feedback-1440.png` / `after-feedback-390.png`） |

---

## 2. ui-ux-pro-max（UX 可用性、触控目标、对比度与可访问性）

- **触控热区与防挤出**：`#workspace .tabs button`、`#setupView` 操作按钮、`#quizView` 控制条及 `#wrongView` 全部 6 个工具按钮均保证 `height >= 44px`（经 `wrong-review-browser.mjs` 跨 `320/390/768/1440` 验证 `smallButtons: []`）与零横向溢出（`overflow: 0`）。
- **WAI-ARIA APG Tabs & 按键反馈**：
  - `#workspace .tabs` 与 `#wrongView .scope-tabs` 补齐 `aria-selected`、roving `tabindex` 与 `ArrowLeft`/`ArrowRight`/`Home`/`End` 键盘导航，并自动跳过禁用态 `#quizViewTab`。
  - `#achievementsView .achievement-filters` 补齐 `aria-pressed`。
  - `#answerInput` 与 `.wrong-rejudge-input` 补全 IME 组字态（`compositionstart`/`compositionend` + `isComposing`/`keyCode === 229`）Enter 防误提交保护。
- **对比度与错误态持久**：
  - 修复 `#roundSummaryModal .round-accuracy` 原先在白底上使用浅蓝 `#bdefff` 的严重低对比度缺陷（改后为高对比品牌/正文字色 `rgb(36, 36, 36)` on `rgb(253, 253, 253)`）。
  - `#quizView` 网络判卷失败/复习异常移除自动隐藏定时器 `scheduleResultHide()`，保持 `data-state="error"` 直到用户继续作答或切题。
  - `#setupView` 将会阻断并打断视线的 `alert()` 校验/导入结果替换为非阻塞内联横幅 `#setupStatusBanner`。

---

## 3. design-taste-frontend（文字克制、真状态展示、零 AI 模板味）

- **`copy-lint.mjs index.html`**：`17 words, 0 FAIL, 0 WARN`。
- **真状态与无虚假数据**：语言入口页与工作台不虚构学习连续记录、伪造正确率或未开放的能力评分；Task 26 未开放控制面板 `#masterySection` 在设置页保持隐藏，5 个页签数量与边界完整保留。
- **首版修补记录**：首轮截图审查发现两处真实缺陷并已现场修复并重跑验证：
  1. 桌面右栏 `.ai-suggest-grid` 受 `styles.css` 固定四列影响向右溢出容器边框 → 在 `#setupView .ai-suggest-grid` 改为双列响应式并加 `min-width: 0`；
  2. 手机端 `390px` `#shuffleBtn`/`#clearBtn` 与 `#startBtn` 同行受全局 `.action-row button { width: 100% }` 冲突导致 SVG 图标叠字 → 在移动端改为 `#startBtn` 独占整行、`#shuffleBtn` 与 `#clearBtn` 50/50 并排。

---

## 4. impeccable（微交互、状态切换、深浅色与动画降级）

- **单焦点环**：消除 `#answerInput:focus` 与 `:focus-visible` 叠加引起的双层黑框，保持单一清晰焦环与边框切换。
- **明确反馈对照与 `下一题` 强调**：`#resultPanel` 新增 `#resultUserAnswer` 显示「你的作答：...」，答毕待切题期间高亮 `#nextNowBtn.is-ready`。
- **日语听写与 `study-week-chart` 修复**：缩短日语听写引导文案使 `390px` 首屏完整可读不截断；将桌面 `#studyView .study-day-track` 收窄至 `max-width: 28px; margin-inline: auto;`，解决旧版渲染成大黑方块的问题。
- **深色模式与 `prefers-reduced-motion`**：经 Playwright/CDP `Emulation.setEmulatedMedia` 实测 `dark` 主题与 `reduce` 动效模式，无刺眼白块或失控无限动画（`after-dark-quiz-1440.png`、`after-dark-setup-390.png`）。
- **零 `!important` 约束**：`test_i06_module_experience.mjs` 校验 `spatial-experience.css` 在 I06+ 层保持 **0 个 `!important`**。

---

## 5. hallmark（反模板化门禁、`sloplint.mjs` 对照）

- 基线全量扫描（`index.html` + `spatial-experience.css`）：`fails: 120, reflex: 381, warns: 20`（主要由仓库既有全局样式、`transition: all` 历史规则与全站 HTML 段落构成）。
- 重构后扫描（`sloplint.mjs index.html spatial-experience.css --scope app --genre modern-minimal --json`）：`fails: 122, reflex: 409, warns: 20`。
  - Phase 4 新增 CSS 区块（`spatial-experience.css` 行 `12795+`）引入 **0 个运动/对比/布局 `FAIL`**（所有过渡均显式列出属性，不使用 `transition: all`）；新增少量 `REFLEX` 为局部紧凑间距（`6px`/`10px`/`14px` 非 4px 倍数），不影响布局对齐与触控尺寸（均已通过 `>=44px` 实测）。

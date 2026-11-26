# Aeris V6.3 Phase 4 — 外部参考与五项设计检查映射说明

## 1. 外部交互规范实际查阅与借鉴点

1. **Anki Studying（[https://docs.ankiweb.net/manual/studying](https://docs.ankiweb.net/manual/studying)）**
   - **借鉴点**：严格遵循「选定牌组/词表 → 单卡专注作答（仅展示当前题与必要音频） → 显式展示反馈与标准答案对照 → 继续下一题」的线性节奏。
   - **落地方式**：在 `#quizView` 去掉多列突跳和干扰统计卡片，将题目提示、音频控制、输入与反馈收敛在单一稳定中心区域；提交后在同一视野中清晰对比「你的答案」与「标准释义 / 可接受写法」，并用主行动样式突出「下一题（`#nextNowBtn`）」让推进路径明确。
2. **Duolingo Design（[https://blog.duolingo.com/hub/design/](https://blog.duolingo.com/hub/design/)）**
   - **借鉴点**：移动端单题顶部线性进度条层级、即时的乐观交互反馈（点击/提交后立即进入可辨认状态，不让界面无响应），以及将「反馈结果与继续操作」紧贴在拇指热区而不被长内容挤出屏幕。
   - **克制边界**：完全不引入积分连击动画、吉祥物插画或额外延迟动效；`QUESTION_TRANSITION_MS` 与手动点击 `#nextNowBtn` 保持零额外等待。
3. **WAI-ARIA APG Tabs Pattern（[https://www.w3.org/WAI/ARIA/apg/patterns/tabs/](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)）**
   - **借鉴点**：横向 `role="tablist"` 必须由激活页签承载 `aria-selected="true"` 与 `tabindex="0"`，非激活页签 `aria-selected="false"` 且 `tabindex="-1"`；支持 `ArrowLeft` / `ArrowRight` / `Home` / `End` 键盘焦点漫游（自动跳过禁用态页签），`Tab` 直接进入当前激活的 `role="tabpanel"`。
   - **落地方式**：修复 `#workspace > .tabs` 与 `#wrongView .scope-tabs` 原有缺失的 `aria-selected`、roving `tabindex` 与键盘方向键逻辑，同时在 `#achievementsView .achievement-filters` 补全 `aria-pressed`。

## 2. 改前基线实测核心痛点（来自真实走查与截图）

1. **词表编辑被挤出首屏**：改前桌面端 `1440×900` 下 `#wordInput` 位于 `y=666px`（仅 120px 高），导入/导出按钮掉出首屏；手机端 `390×844` 下 **`#startBtn` 位于 `y=865.5px..909.5px`，完全掉出首屏视口**。
2. **答题反馈与结果弹窗缺陷**：
   - `#answerInput:focus` 存在浏览器默认 outline 与 `--ds-focus-ring` 叠加的双层黑框；
   - `.quiz-progress-track` 紧贴卡片圆角上边缘导致左端裁切；
   - 提交答案后 `#quizView:has(.result-panel:not(.hidden))` 取消 `max-width` 却未触发有效分栏，导致反馈面板掉到卡片下方；在 `390×844` 手机端反馈被截在屏幕底边；
   - `#roundSummaryModal` 的 `.round-accuracy` 沿用旧版浅蓝色 `#bdefff`，在浅色白底弹窗上对比度严重不达标。
3. **错题与统计可读性问题**：
   - `#wrongView` 顶部堆叠 8 个等权重操作按钮，手机端 `390×844` 首屏完全看不到第一条错题卡片；
   - `#studyView` 的 7 日柱状图 `.study-day-track` 宽与高接近 1:1，有数据日呈巨大纯黑正方形色块；
   - 中文/日文输入法组字期间缺少 `isComposing` / `keyCode === 229` 拦截，按 Enter 确认候选词有误提交风险。

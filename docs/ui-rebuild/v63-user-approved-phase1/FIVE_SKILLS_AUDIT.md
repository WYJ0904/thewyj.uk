# Aeris V6.3 Phase 1｜五大 Skill 实跑审查与设计决议

> **执行说明**：所有五个 Skill 均在当前工作区实际读取并执行其工具/流程；当 Skill 通用默认规则与用户 39 项已确认设计要求冲突时，**严格以用户确认规范为准**。

---

## 1. Frontend Design (`frontend-design`)

- **实际执行方式**：完整读取 `SKILL.md` 并执行两阶段设计规划（Pass 1 视觉定位与 ASCII 线框 → Pass 2 反模板自检）。
- **发现的问题（针对 `820a14b0` 基线）**：
  1. 登录后首页与未登录首页同时存在多套重复入口：顶部大栏 `#accountBar` + 左侧 `#v3Sidebar` + `#homeV3SummaryGrid`（4 卡片）+ `#workspaceBentoGrid`（6 卡片）+ `.home-quick-access`，属于典型的 SaaS 卡片矩阵堆砌。
  2. 公开首页带有大量营销 Hero 文案、假红绿灯/漂浮 3D 预览框（`.scroll-preview-wrap`）与 5 格 Bento 墙（`#publicBentoWall`）。
  3. 英文大写眉题（`.section-kicker`、`bento-index`）与中圆点拼接元信息（`学习 · 工具 · 账本 · 文件`）随处可见。
- **Phase 1 对应设计决策**：
  - **视觉定位**：基于 ChatGPT 极简中性黑白灰体系构建专业跨设备效率工作区（浅色 `#FAFAFA` / `#F4F4F4` / `#EAEAEA`，深色 `#212121` / `#191919` / `#303030`）。
  - **布局线框**：
    - 桌面端：`[ 可折叠 GPT 侧边栏 (256px <-> 64px) ] | [ 居中极简启动台 (max-width: 680px) ]`
    - 移动端：`[ 52px 精简顶栏 (左上抽屉按钮 + 标题 + 搜索/登录) ] + [ 左侧滑入抽屉 ] + [ 单列居中内容 ]`
  - **自检修正**：移除原计划中的任何卡片网格与统计数字条，仅保留问候语、副标题、中央搜索触发器与用户可自定义快捷入口。

---

## 2. UI UX Pro Max (`ui-ux-pro-max`)

- **实际执行命令与结果**：
  1. `python .../search.py "minimal workspace productivity dashboard monochrome" --design-system -p "Aeris" -f markdown`
     - 输出建议：Flat Design（2D、极简、无多余阴影、排版优先）、Accessible contrast >= 4.5:1、Focus visible、Reduced motion、375/768/1024/1440 响应式清单。
     - *用户规范优先级处理*：脚本通用输出推荐 `#0D9488`/`#EA580C` 配色与 `Plus Jakarta Sans` 外部 Google Font；依据用户 5.1 规范及 Aeris CSP/离线包策略，保留中性黑白体系（`#FAFAFA`/`#212121`）与本地零外部请求系统字体栈（`Segoe UI Variable` / `SF Pro Text` / `PingFang SC`）。
  2. `python .../search.py "keyboard focus modal sidebar navigation" --domain ux`
     - 命中 3 条：Focus States（模态框与控件需可见焦点环）、Keyboard Navigation（Tab 顺序与视觉一致，无键盘陷阱）、Focus Not Obscured（焦点不被粘性头部/浮层遮挡）。
  3. `python .../search.py "dark mode contrast" --domain ux`
     - 命中 3 条：文本对比度 >= 4.5:1（浅色 `#696969` on `#FAFAFA` = 5.26:1；深色 `#AAAAAA` on `#212121` = 6.89:1）、2px `:focus-visible` 3:1+ 状态对比度。
  4. `python .../search.py "reduced motion animation" --domain ux`
     - 命中 3 条：尊重 `prefers-reduced-motion`、使用共享 Motion Tokens 控制距离与时长。
  5. `python .../search.py "accessible modal dropdown" --stack html-tailwind`
     - 命中 1 条：图标按钮必须具备明确 `aria-label`（侧边栏折叠图标、主题切换、通知铃铛、头像菜单触发器）。

---

## 3. Taste Skill (`design-taste-frontend`)

- **实际执行命令与结果**：
  - 读取 `SKILL.md` 及 `references/motion.md`。
  - 运行 `node .../scripts/copy-lint.mjs index.html --kind software`：`0 FAIL, 0 WARN`。
- **关键约束与适用取舍**：
  - 遵循其核心运动原则：交互反馈基于 `transform` 与 `opacity`，**禁止**使用无目的的滚动逐块淡入、卡片倾斜（tilt）或跑马灯循环，**禁止**引入 WebGL/Shader 装饰工作区。
  - **弹性微交互实现**：为按钮、侧边栏导航项、快捷功能胶囊添加细腻弹性曲线（`cubic-bezier(0.34, 1.45, 0.64, 1)`，细微悬停上浮 `1px` 与按压缩放 `0.975`），仅作用于 `@media (hover: hover) and (pointer: fine)`，不移动相邻元素，并在 `prefers-reduced-motion: reduce` 下退化为静默色彩/透明度变化。

---

## 4. Impeccable (`impeccable`)

- **实际执行命令与结果**：
  1. `impeccable.cmd context --target index.html`：确认无 `PRODUCT.md`/`DESIGN.md`（按 redesign 规则将旧外观仅作反面参考，完整保留产品真相、API 与权限契约），输出 `MANUAL_DETECTOR_REQUIRED`（完工后运行 `detect` 验证）。
  2. `impeccable.cmd detect --json index.html styles.css design-system.css public-experience.css workspace-experience.css spatial-experience.css`（基线扫描）发现：
     - `low-contrast`：旧版告警/悬停态文本对比度低至 `1.5:1`–`2.1:1`。
     - `cramped-padding`：多处容器内文本紧贴边框（如 `.finance-side-panel`、`.tool-shelf` 等）。
     - `dark-glow`：残留零偏移发光文本阴影 `#50bef0`。
  3. 读取 `reference/craft-floor.md`、`reference/animate.md`、`reference/distill.md`：
     - **Distill 精简**：将登录后的 4 重首页结构精简为唯一居中功能启动台；将顶栏 `#accountBar` 从登录态工作区移除，所有账户/主题/反馈/退出功能收归左侧边栏底部向上展开菜单（`#accountMenuPopover`）。
     - **Typeset & Layout**：建立清晰字号层级与 `65ch` 聚焦阅读宽度，修正所有低对比度状态色与发光阴影。

---

## 5. Hallmark (`hallmark`)

- **实际执行命令与结果**：
  - 运行基线静态审查：`node .../scripts/sloplint.mjs index.html --scope app`
  - **基线检出**：`32 FAIL, 2 REFLEX, 6 WARN`
    - `FAIL 19`：`<title>` 使用破折号 `—`
    - `FAIL 26a` / `REFLEX 26b`：缺少显式瞬时 `:focus-visible`、`:active`、`:disabled` 统一状态规则
    - `FAIL 34`：`html` 与 `body` 缺少 `overflow-x: clip`
    - `FAIL 54`：25 处标题上方冗余眉题（`section-kicker`、`bento-index`、`local-only-badge`）
    - `FAIL 63`：3 处中圆点拼接元数据字符串
    - `FAIL 76`：`#trialImagePreview` 空 `src` 占位
- **Phase 1 整改目标**：全面消除 `FAIL 19 / 26a / 34`、清理 Phase 1 涉及页面与全局框架内的眉题及中圆点元数据，并在完工后再次运行 `sloplint.mjs` 与 `impeccable detect` 进行前后对比复核。

---

## 6. 完工后复核结果（Before → After）

| Skill / 工具 | Before（`820a14b0` 基线） | After（Phase 1 完工） | 关键说明与取舍 |
|---|---|---|---|
| `frontend-design` | 顶栏 + 侧栏 + 4 摘要卡 + 6 Bento + 快速访问重复结构 | 单一 GPT 侧栏 + 居中极简启动台 / 访客直连工作台 | 完成 Pass 1/Pass 2 架构对齐，登录态仅保留问候、搜索框、自定义快捷入口 |
| `ui-ux-pro-max` | 多套主色、深浅卡片混杂、无搜索下拉 | `#FAFAFA`/`#F4F4F4`（浅）与 `#212121`/`#191919`（深），对比度 >= 5.26:1 | 保持零外链本地字体，符合 CSP `style-src 'self'` 与离线包要求 |
| `design-taste-frontend` (`copy-lint.mjs`) | `0 FAIL, 0 WARN` | `0 FAIL, 0 WARN` | 文案极简直接，动效限 `transform`/`opacity` + `prefers-reduced-motion` |
| `impeccable` (`detect`) | 存在 `#7b4b0a` (2.0:1 暗色对比度失败)、`#50bef0` 霓虹发光、`.aeris-live-sample` 零内边距 | 已修复 `#7b4b0a` → `var(--color-warning)`、移除 `#50bef0` 发光、补足 `.aeris-live-sample` `16px` 内边距 | Phase 1 新增组件零 `low-contrast`/`cramped-padding`/`dark-glow`；`bounce-easing` 警告因用户第 10 节明确要求微弹性微交互而保留并约束在 `@media (hover: hover)`；旧版 `styles.css` 与 Phase 2–8 业务模块警告留待对应 Phase 处理 |
| `hallmark` (`sloplint.mjs`) | `32 FAIL, 2 REFLEX, 6 WARN` | `15 FAIL, 2 REFLEX, 5 WARN` | 消除 `<title>` 破折号、Phase 1 眉题、`#trialImagePreview`/`#paymentQrImage` 空 `src`、链接拼接箭头；剩余项均为跨文件静态检出（外部 CSS 中已有 `:focus-visible`/`overflow-x: clip`）及未重构的 Phase 2–8 模块页 DOM |
| Impeccable Setup 提示 | `CONTEXT_STALE` | `CONTEXT_STALE` (`hook-not-installed`) | 按 Impeccable 规范将在最终汇报末尾原样附带提示行 |

---

## 7. V2 专项整改复查记录（2026-11-24）

- **Taste Skill (`design-taste-frontend`)**：
  - `copy-lint.mjs index.html --kind software`：`== index.html (17 words) 0 FAIL, 0 WARN`。
  - 结合 `references/motion.md` 实施零 `!important` 动效体系、主网格列宽与侧边栏宽度同频 `320ms` 过渡、移除静态 `button[role="tab"]` 悬停放大导致桌面分段胶囊对齐超差的问题。
- **UI UX Pro Max (`ui-ux-pro-max`)**：
  - `search.py "command palette sidebar motion accessibility" --domain ux`：命中 Motion Sensitivity、Reduced Motion、Excessive Motion 3 条高优先级 UX 指南，据此将路由入场动画收敛为纯 `opacity + translate3d`（取消容器 `scale()` 以保持 `>=44px` 触控热区高度稳定）并严格绑定 `prefers-reduced-motion: reduce`。
- **Impeccable (`impeccable`)**：
  - `impeccable.cmd doctor`：确认仅提示 `hook-not-installed [.agents/hooks.json]`，遵循规则未安装未授权 hooks。
  - `impeccable.cmd detect --json index.html styles.css design-system.css public-experience.css workspace-experience.css spatial-experience.css`：V2 涉及的文件中仅在 `design-system.css` 与 `spatial-experience.css` 存在针对 `--ds-ease-elastic` / `--ds-ease-spring` 的 `bounce-easing` advisory 提示，与用户确认规范第 8 题 C 动效需求一致，无新增 `low-contrast` 或 `cramped-padding` 问题。
- **Hallmark (`hallmark`)**：
  - 静态 `sloplint.mjs index.html --scope app`：维持 `15 FAIL, 2 REFLEX, 5 WARN`（Phase 1 首页/侧栏/Command Palette 无新增失败项，剩余均属于 Phase 2+ 业务模块页或跨外部样式文件静态扫描限制）。
  - 动态渲染审查（`sloplint.mjs --render --url http://127.0.0.1:8796 --scope app --json`）：**`0 FAIL, 0 REFLEX, 1 WARN`**（`exitCode: 0`，覆盖 1280x800、1440x900、1920x1080 折叠首屏及 1440/375 整页渲染；唯一 `WARN` 为 `F19` 正文共用到 4 种字重 400/500/600/700；已同步修复 375px 下 `"JSON 与文本"` 标签折行 `FAIL 49a`）。

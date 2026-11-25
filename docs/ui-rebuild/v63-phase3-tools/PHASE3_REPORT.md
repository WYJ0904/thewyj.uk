# Aeris V6.3 Phase 3 工具箱全量审查与统一整改报告

- **当前分支**：`hydrogen/v63-phase3-tools-redesign` (Draft PR #184)
- **Phase 2 基线**：`hydrogen/v63-phase2-finance-redesign` (`2c76d2e9`, Draft PR #182，Core CI `45590898967` PASS)
- **Hosted Preview**：`https://v63-phase3.thewyj-v63-preview.pages.dev`（当前部署实例：`https://3c8bed6b.thewyj-v63-preview.pages.dev`）
- **作用域确认**：未合并 `main`、未部署 Production、未发布 Android Stable、未开启 Phase 4；全部 104 个注册工具（103 可见 + `temporary-file -> /transfer` 重定向）与历史 Phase 1/2 Preview 完整保留。

## 一、核心工程修复（P0）

1. **原子化 PWA 资源图与版本防混载 (`P0-01`)**：
   - 将 `scripts/update_task27_publication.mjs` 与 `sw.js` 对齐为自动化完整清单校验，覆盖 80 项源码/样式/ESM 模块 SHA-256 指纹（`89` 项预缓存安装图中的全部文本/代码资产）。
   - 修复失败场景保留旧客户端与用户缓存：`sw-install.test.mjs`（24/24）、`sw-install-browser.mjs`（8 浏览器场景：`normal`, `slow`, `failure-retry`, `body-timeout`, `warm`, `task26-failure`, `stale-task26`, `warm-task26-failure`）与 `qa/aeris/p5-pwa-browser.mjs` 全部 PASS。
2. **工具箱 CSS 与 Feature Flag 安全解耦 (`P0-03`)**：
   - 清理 `spatial-experience.css` 中遗留 I06 `.tool-catalog/.tool-card` 细线样式冲突。
   - 解耦 `#toolsPanel` 目录瓷砖、图标居中、50:50 转盘、40:60 舞台、3D D6 骰子与硬币、多面体 SVG 与居中临时工具双栏规则，确保在 `p07_accessibility` 为 `enabled`、`disabled` 或 `error` 时几何与功能均不退化；同时保留 `tools-legacy-nav` (`#leaveToolsBtn`) 仅在 `html[data-p07-ui="enabled"]` 下隐藏的回退契约。
3. **测试与交互状态契约收敛 (`P0-02`, `P2-02`, CI)**：
   - 随机工具统一增加 `data-random-state="idle|running|settled"`，升级 `local-backend/test_tools_browser.mjs` 验证完整动画落定与真实视觉状态。
   - 修复 `app.js` 中 `/tools` 会员到期时间未定义 `formatDate` 异常（统一调用 `formatLocalDateTime`）与非阻塞 `/api/tools/access` 并行校验 (`P1-07`)。
   - 修复 `app.js` 移动端首屏切换 `/` -> `/tools` 时 `showStartupRecovery` / `markStartupScreenPresented` 的遮罩残留问题 (`P2-02`)。
   - 修复 `js/core/motion.js` 键盘 `Enter`/`Space` 触发导航失焦后残留 `data-aeris-pressed="true"` 缩放态的问题。
   - 修复 Phase 2 与 Phase 3 `local-backend/test_static.py` 中 `--ds-text-secondary` 仍硬编码旧色 `#696969`（已升级为 WCAG AA `#595959`）导致的静态检查失败。

## 二、目录、工具台与随机体验整改

- **工具目录 (`103` 可见卡片)**：统一 4px 间距与柔和灰瓷砖底（`--ds-surface-subtle`）、更浅居中图标底（`--ds-surface`）、始终可辨认的右上角收藏按钮（默认透明度 `0.56`）、完整自然换行长名称（取消 `-webkit-line-clamp`），消除 `.tool-category-pill-count` 与 `0%` 选项行的对比度降级。
- **转盘与权重体验 (`P1-01`, `P1-03`, `P1-05`)**：
  - 桌面端重构为左控制（4 个默认独立单行选项、0.5% 步进滑杆、结果、开始按钮）与右转盘 50:50；手机端顶部紧凑粘性转盘与下方选项列表可同屏调参联动。
  - 转盘顶部指针采用与转盘共享 `viewBox="0 0 320 320"` 的内嵌 SVG 叠层（Preview 实测水平中心偏差 `<= 2.5px`）。
  - `js/tools/random.js` 新增非 0.5% 历史权重无损比例保留 (`exactWeight` / `precisionPreserved`) 并在默认多选项工具统一提供 4 个初始条目。
- **3D 骰子、多面体、硬币、配色与临时工具 (`P1-02`, `P1-04`, `P1-06`, `P2-01`, `P3-01`, `P3-02`)**：
  - 桌面 40:60 左控右舞台；D6 为真 3D 点阵立方体，D4/D8/D10/D12/D20 与自定义骰通过 `renderDicePolyhedronSvg()` 渲染对应分面多面体 SVG。
  - 硬币为单枚 2019 版人民币 1 元正反面 `preserve-3d` 实体（零分离、零镜像）。
  - 配色/调色板展示可点击复制 HEX 色卡且无内联 `style` 冲突；文件错误同步展示至 `#fileToolResult.is-error`；`temporary-*` 采用居中对称双栏且提交具备 `withButtonPending` 锁定态。

## 三、验证汇总与 Aeris 资源调度记录

- **单元测试与静态检查**：
  - Python (`local-backend`): `186 tests OK`; (`scripts`): `68 tests OK`; `test_static.py`: `31 tests OK`.
  - JavaScript & SW (`test_phase3_random_weights`, `test_tools_js`, `test_i02_css_contracts`, `test_i06_module_experience`, `test_v6_ui_contracts`, `test_i07_motion_engine`, `test_interaction_feedback_js`, `sw-install.test.mjs`): 相关测试全部 PASS；`npm run cf:check`、`functional_audit_gate.py`、`repository_audit.py` 全部 PASS。
- **远端 GitHub Actions Core CI**：
  - PR #182 (`2c76d2e9`): Run `45590898967` **SUCCESS**。
  - PR #184 (`c1a5c8ea`): Run `45604824646` **SUCCESS**（8/8 活跃 Job 全绿，包含 `Browser flow (application)` 与 `Cloud-only browser, canonical session and toolbox`）。
- **本地重型浏览器验证（串行执行，每次仅 1 套堆栈）**：
  - `qa/p07-release/sw-install-browser.mjs` (8 场景) **PASS**；`qa/v63-phase3/verify_phase3_tools.mjs` **PASS** (`104` 注册/`103` 可见, 1.0x MP4 视频已更新)；`qa/v63-phase3/verify_phase3_v2.mjs` + 降级 UI (`disabled`/`error`) 矩阵 **PASS**。
- **Hosted Preview 全量复测 (`https://v63-phase3.thewyj-v63-preview.pages.dev`)**：
  - **104/104** 注册工具（103 可见 + `temporary-file -> /transfer`）与 **69** 种模式在 Desktop (`1440x900`) 与 Mobile (`390x844`) 全数实测 **PASS**，`0` 运行时错误，`0` 溢出，`10/10` 随机工具 1.0x walkthrough MP4 完成编码。
  - 账户矩阵：`v63p1_free` 拦截并打开 `/recharge` (`cards=0`)，`v63p1_vip` 与 `v63p1_admin` 完整可用。
  - 性能延迟：5 次冷入 `/tools` P50 = `125ms`、P95 = `127ms`、max = `129ms`；热切换 P50 = `63ms`。
  - 移动端 `/` -> `/tools` 连续切换 5 轮 `spuriousRecovery = 0`。
- **资源清理确认**：全部临时 Wrangler/Miniflare 与自动化 Chromium 进程均已在任务退出时精准回收，无本任务遗留后台任务或子进程。

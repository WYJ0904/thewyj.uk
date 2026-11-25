# Aeris V6.3 Phase 3 — 工具箱重构与 Phase 2 收尾整改交付报告

> **授权边界**：本分支基于 Phase 2 收尾整改提交（`06a7fdd9a99af41167b88e48b58c6d3b9ca2c604`）切出，交付 **Phase 3 `/tools` 工具箱目录及全量工具工作区重构** 与 **独立 Hosted Preview (`v63-phase3`)**。保留 Phase 1（`v63-phase1`）与 Phase 2（`v63-phase2`）Preview 与历史验收证据；不合并 `main`、不部署 Production、不发布 Android Stable、不开始 Phase 4。

---

## 1. Phase 2 收尾整改汇总（已推送至 `hydrogen/v63-phase2-finance-redesign` / PR #182）

| 项目 | 根因与修复摘要 | 验证状态 |
|---|---|---|
| **2.1 隐藏侧边栏滚动条轨道** | 为 `#v3Sidebar` 与 `.v3-sidebar-nav` 增加 `scrollbar-width: none; -ms-overflow-style: none;` 与 `::-webkit-scrollbar { display: none; width: 0; height: 0; }`，保留 `overflow-y: auto` 滚动能力。520px 低高度窗口实测 `scrollDiffW=0`、`scrolledTo=120`、底部头像与折叠按钮可达。 | **PASS** |
| **2.2 全局下拉菜单与展开区域防自动收回** | 定位并修复三处全局根因：① `design-system.css` 对 `.ds-select-popover` 设默认 `opacity: 0` 而 `spatial-experience.css` 入场动画未带 `fill-mode: both` 且 JS 未写 `data-open="true"`，导致 140ms 动画结束后立即视觉消失；② `<label>` 包裹 `<select>` 引起外部点击误判；③ 后台 `accountUpdated()` 重复调用 `show()` 及 `#financeCandidatesSection` 刷新覆盖用户手动展开态。实测跨窗口缩放、后台同步与手动刷新均稳定保持展开。 | **PASS** |
| **2.3 登录后首页 40% 视觉居中** | 修复 `spatial-experience.css` 中 `#v3MainCanvas.v3-main-canvas` 特异性被 `display: block` 覆盖的问题，采用 `::before`（`flex: 4 1 0%`）/ `::after`（`flex: 6 1 0%`）在扣除顶栏/公告栏/页脚后的剩余空间精准居中偏上约 20%。1440×900 实测 `topRatio=0.444`、`overflowY=0`、`centerDiffX=0`；公开首页未改动。 | **PASS** |
| **2.4 CI 与已知事项修复** | ① 修复 `js/finance/candidates.js:288` 在 mock DOM 下 `section.dataset` 为 `undefined` 导致的 `TypeError`；② 修复 `qa/aeris/p4-workspace-browser.mjs` 2026-10 硬编码日期夹具，改为动态当前月 15 日锚点；③ 保留既有 `calculateFinanceSummary` 含退款算法不变，在走势图与历史表明确标注「收支差额（不含退款）」与「总览结余（含退款）」口径差异；④ 补充真实新增账目操作耗时实测（打开抽屉 `16.4ms`、提交入账 `323.7ms`）。 | **PASS** |

- **Phase 2 收尾提交**：`06a7fdd9a99af41167b88e48b58c6d3b9ca2c604`（Draft PR #182 已更新，`https://v63-phase2.thewyj-v63-preview.pages.dev` 已同步部署 `https://55a22b33.thewyj-v63-preview.pages.dev`）。
- **Preview 数据库共享边界说明**：`v63-phase1`、`v63-phase2` 与 `v63-phase3` 均部署在独立 Preview Pages 项目 `thewyj-v63-preview.pages.dev` 的不同分支别名下，**共享同一套 Preview 隔离库 `wyj-cloud-preview`（D1 `a3e6253b-689f-49f3-998b-7c5828ea255a`）与 Preview R2 绑定**，与 Production（`wyj-cloud` / `thewyj.uk`）完全隔离；三角色合成测试账户沿用该隔离库中的既有账号。

---

## 2. Phase 3 工具箱目录与工作区重构交付

### 2.1 工具目录架构
- **去除二级侧边栏**：移除旧版 `.tools-two-pane` / `.tools-index-rail`，改用单栏自上而下结构（紧凑页头 + Raycast 搜索栏 + 收藏/最近使用横向胶囊栏 + 横向分类胶囊栏 + 无卡片应用图标网格）。
- **搜索优先与快捷键**：复用 `js/tools/catalog.js` 的 `searchTools` 索引（与全局命令面板一致），支持模糊/别名/中英文/IME 组合输入、`/` 聚焦、`↑↓` 选择、`Enter` 打开、`Esc` 清空、空结果提供一键“清空搜索”。
- **103 vs 104 计数核实**：注册表 `TOOLS` 共 104 项，其中 `temporary-file` 为 Task 24.1 合法退役别名（保留在 `TOOL_MAP` 重定向至 `/transfer`），可见目录 `CATALOG_TOOLS` 为 103 项（文本 29 + 文件 17 + 图片 30 + 随机 22 + 临时 5）。
- **无卡片应用图标网格**：为 104 项工具按用途配置细线单色 SVG 图标（`toolIconSvg`），无大边框卡片、无彩色图标底座、无冗长默认介绍（完整描述保留在 Tooltip 与工具页头）；渐进加载首屏 48 项，不预初始化工具编辑器。
- **保留工作流入口**：页头保留显式 `#openWorkflowBtn`（工具工作流），桌面端隐藏与侧边栏重复的导航大按钮并保留 DOM/无障碍兼容。

### 2.2 五类工具差异化工作区（`data-tool-layout`）
1. **文本与代码处理（`split-editor`，29 项）**：顶部紧凑参数与命令条（处理 / 复制结果 / 下载 TXT / 清空）+ 桌面 50/50 双栏等宽编辑器（输入/输出实时字符与行数统计），移动端自动堆叠。
2. **图片与设计（`studio-preview`，30 项）**：左侧参数与拖放上传区 + 右侧画布预览舞台与结果信息，明确区分原图与输出。
3. **文件处理（`file-pipeline`，17 项）**：拖放选择区 + 实时已选文件清单（文件名/大小/上限提示）+ 参数条 + 本地计算输出台，100% 浏览器本地处理不上传。
4. **随机生成与简单计算（`compact-generator`，22 项）**：居中 700px 紧凑工具布局，顶部突出大字等宽结果舞台与生成反馈动画，下方紧凑参数区。
5. **临时工具（`temporary-qr` / `temporary-utility`，5 项可见 + 1 重定向）**：二维码采用左参数右实时预览双栏布局；临时文本/剪贴板/留言房间保持聚焦实用布局；文件传输规范跳转 `/transfer`。

---

## 3. 配套文档与实拍视觉证据

- 五大 Skill 实跑报告：[FIVE_SKILLS_AUDIT.md](./FIVE_SKILLS_AUDIT.md)
- 真实开源/成熟产品参考映射：[REFERENCE_MAPPING.md](./REFERENCE_MAPPING.md)
- 104 工具功能保留矩阵：[TOOL_RETENTION_MATRIX.md](./TOOL_RETENTION_MATRIX.md)
- 1.0x 原速操作录屏：[phase3-tools-walkthrough.mp4](./evidence/after/phase3-tools-walkthrough.mp4)（`70` 帧 · `7.99s`）
- 实拍截图集（`evidence/after/`）：
  - 工具箱默认首页：[after-tools-home-1440.png](./evidence/after/after-tools-home-1440.png)
  - 收藏与最近使用：[after-tools-shelves-1440.png](./evidence/after/after-tools-shelves-1440.png)
  - 分类网格：[after-tools-category-1440.png](./evidence/after/after-tools-category-1440.png)
  - 搜索结果：[after-tools-search-1440.png](./evidence/after/after-tools-search-1440.png)
  - 双栏代码工具（JSON 格式化）：[after-tools-split-editor-1440.png](./evidence/after/after-tools-split-editor-1440.png)
  - 图片工具（渐变背景生成器）：[after-tools-image-studio-1440.png](./evidence/after/after-tools-image-studio-1440.png)
  - 二维码工具（临时二维码）：[after-tools-qr-studio-1440.png](./evidence/after/after-tools-qr-studio-1440.png)
  - 文件处理工具（SHA-256 计算）：[after-tools-file-pipeline-1440.png](./evidence/after/after-tools-file-pipeline-1440.png)
  - 简单生成工具（安全密码生成器）：[after-tools-random-compact-1440.png](./evidence/after/after-tools-random-compact-1440.png)
  - 深色模式：[after-tools-dark-1440.png](./evidence/after/after-tools-dark-1440.png)
  - 移动端目录与双栏堆叠：[after-tools-mobile-390.png](./evidence/after/after-tools-mobile-390.png)、[after-tools-mobile-editor-390.png](./evidence/after/after-tools-mobile-editor-390.png)

---

## 4. Aeris 资源守卫与进程清理记录

- **执行的大负荷任务**：
  1. `verify_phase2_closeout.mjs`（单实例 Wrangler Miniflare `127.0.0.1:8801` + 单实例无头 Chrome `127.0.0.1:9237`）。
  2. `verify_phase3_tools.mjs`（单实例 Wrangler Miniflare `127.0.0.1:8803` + 单实例无头 Chrome `127.0.0.1:9239` + ffmpeg MP4 合成）。
  3. Hosted Preview 在线三角色验证（单实例 Chrome 访问 `https://v63-phase3.thewyj-v63-preview.pages.dev`）。
- **并发形态**：**严格串行（100% Serial）**，无多浏览器或双 Miniflare 并发。
- **进程与临时目录清理**：每个脚本均在 `finally` 块中通过 `taskkill /PID <pid> /T /F` 仅终止本任务启动的子进程树，并删除 `%TEMP%` 下的临时状态/配置目录；未按泛进程名强杀任何其他进程，未编造任何未实测的 CPU/内存数值。

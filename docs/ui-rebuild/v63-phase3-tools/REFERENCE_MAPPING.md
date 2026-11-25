# Aeris V6.3 Phase 3 — 真实参考映射（Reference Mapping）

| 参考对象 | 实际研究来源与方向 | 提取的设计模式 | Aeris Phase 3 对应实现 | 截图与交互证据 |
|---|---|---|---|---|
| **Raycast** | Raycast Root Search、Favorites 与 Recents 交互架构 | 搜索框居首、即时模糊过滤、键盘 `↑↓`/`Enter`/`Esc`/`/` 快速启动、收藏与最近使用横向快捷区、无空态占位大盒 | `#toolSearchInput` 居首、复用 `js/tools/catalog.js` `searchTools` 索引、`#favoriteToolsSection` & `#recentToolsSection` 横向胶囊栏（空时隐藏，零假数据） | `after-tools-home-1440.png`, `after-tools-search-1440.png`, `after-tools-shelves-1440.png`, `phase3-tools-walkthrough.mp4` |
| **IT-Tools** (`CorentinTh/it-tools`) | 开源开发者工具目录分类、收藏、全本地运行 | 清晰功能分类、单页即开即用、纯客户端处理不上传、结果一键复制 | 横向分类胶囊栏 `#toolCategoryList`（全部 103 + 5 分类计数）、保留全部 103 可见工具与 104 注册项、纯本地处理提示与一键复制反馈 | `after-tools-category-1440.png`, `after-tools-home-1440.png` |
| **CyberChef** (`gchq/CyberChef`) | Input / Parameters / Output 专业处理工作台 | 顶部紧凑参数与命令条、输入与输出明确分离、文件流水线清晰展示清单与结果 | `data-tool-layout="split-editor"` 与 `data-tool-layout="file-pipeline"`（拖放区 + 实时文件清单 + 参数条 + 等宽输出控制台） | `after-tools-split-editor-1440.png`, `after-tools-file-pipeline-1440.png` |
| **VS Code** | 双栏代码编辑器、状态计数与可读性 | 50/50 双栏等宽编辑区、顶部状态元信息（字符数/行数）、代码区独立横向滚动、移动端纵向堆叠 | `.tool-split-pane` 双栏等宽编辑器、`#textInputMeta`/`#textOutputMeta` 实时统计、窄屏 `<=860px` 自动堆叠 | `after-tools-split-editor-1440.png`, `after-tools-mobile-editor-390.png` |
| **Apple** (macOS Launchpad / Preview) | 无卡片应用图标网格、精致微动效、图片预览工作台 | 无边框卡片、统一细线图标（无彩色底座）、清晰两行截断标题、悬停上浮与按压弹性反馈、左参数+右画布预览 | `.tool-catalog` 无卡片应用图标网格（46×46 单色细线 SVG 图标）、`.tool-studio-grid` 图片与二维码预览工作台 | `after-tools-home-1440.png`, `after-tools-image-studio-1440.png`, `after-tools-qr-studio-1440.png` |
| **ChatGPT** | 统一黑白克制视觉、单侧边栏外壳、浅/深色一致令牌 | 全站统一 `--ds-*` 单色令牌、不增加第二个侧边栏、深色模式高对比度阅读舒适 | 移除旧版 `.tools-index-rail` 二级侧栏；全部使用 `--ds-surface`/`--ds-border`/`--ds-text` 令牌，浅/深色无硬编码色值 | `after-tools-home-1440.png`, `after-tools-dark-1440.png` |
| **Linear** | 紧凑高效工具栏、无冗余装饰、键盘优先 | 单行紧凑页头、移除重复全局导航大按钮、克制 1px 细线分隔、无意义宣传卡片清零 | `.tools-header` 仅保留标题、状态与 `#openWorkflowBtn` 工作流入口；重复导航按钮在桌面端退回全局侧边栏 | `after-tools-home-1440.png`, `after-tools-random-compact-1440.png` |
| **Floating UI** (`floating-ui.com`) | `offset` / `flip` / `shift` / `useDismiss` 浮层定位与关闭语义 | 视口边缘避让、翻转定位、不因后台同步或标签转发误关闭、Esc 优先关闭顶层浮层 | `js/core/design-system.js` 全局 `enhanceSelect` 修复动画 `fill-mode`、`data-open="true"`、`<label>` 点击防抖及后台刷新保留展开态 | Phase 2 closeout `closeout-finance-dropdown-open.png` 及全站共用 Select 浮层 |

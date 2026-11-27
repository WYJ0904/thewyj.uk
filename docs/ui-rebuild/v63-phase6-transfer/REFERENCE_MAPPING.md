# Aeris V6.3 Phase 6 — 网络调研、开源参考与交互映射（REFERENCE_MAPPING）

> 本文件记录 Phase 6 文件传输模块 UI/UX 重构期间真实执行的公网文档/演示体验调研、开源仓库源码架构与许可证审查结果。所有改动均基于 Aeris 现有前端架构（HTML5/CSS3/原生 ES6+ 模块、`reconcileKeyedRows()`、`design-system.css`）自主实现，**未复制任何第三方的完整组件文件或品牌/图标资源，GPL-3.0 项目严格仅作概念层交互参考**。

---

## 一、公网研究与开源项目审查清单

### 1. Apple AirDrop & Apple Human Interface Guidelines (HIG)
- **参考来源**：Apple HIG（Progress indicators、Modals、Drag and drop、Touch targets）；AirDrop 单手发送/接收视觉反馈。
- **提取的设计模式**：
  1. **克制的环形百分比进度与即刻完成转换**：使用细线环形 SVG 指示整体进度与阶段状态，颜色遵循低饱和语义区分（传输中冷静蓝、完成绿、暂停中性灰、报错红）。
  2. **明确的边界声明**：严格遵守任务约束，**不虚构附近设备发现、雷达扫描或点对点局域网传输动画**；AirDrop 仅参考其信息简洁性、进度视觉聚焦与极低交互噪点。
- **Aeris 独立实现**：`#transferProgressPanel` 采用细线环形 SVG (`#transferOverallRingCircle`) + GPU `scaleX()` 总进度条与五阶段明确提示，无任何装饰雷达动画。

### 2. LocalSend (`localsend/localsend`, `https://localsend.org/`)
- **许可证核查**：`Apache-2.0 License`（实读仓库 `LICENSE`、`app/lib/pages/send_page.dart`、`progress_page.dart`、`receive_page.dart`）。未直接复用 Dart/Flutter 源码，仅借鉴其 UI 状态机与交互模式。
- **提取的设计模式**：
  1. **发送工作台 / 传输进度 / 接收页面职责分离**（`send_page` vs `progress_page` vs `receive_page`）：接收端看到的是干净的文件列表、总体尺寸与明确下载/接收动作，不被发送端表单干扰。
  2. **按文件粒度的独立状态控制与速率/剩余量展示**：`progress_page.dart` 将总体与单文件进度、速率估算及取消/重试逻辑分明呈现，避免整表刷新闪烁。
- **Aeris 独立实现**：在 `#transferPage` 通过 `data-transfer-mode="sender" | "recipient"` 实现单路由模式隔离；复用现有 `reconcileKeyedRows()` 对 `#transferQueue` 执行按键局部增量更新，并在 `updates.js` 真实节流下展示速率与 ETA。

### 3. PairDrop (`schlagmichdoch/PairDrop`, `https://pairdrop.net/`)
- **许可证核查**：`GNU General Public License v3.0 (GPL-3.0)`。按项目许可证合规规定，**严格列为纯概念参考，零代码引入或改写**。
- **实时演示观察**：实测 `https://pairdrop.net/` 页面交互流程。
- **提取的概念模式**：
  1. **零营销冗余的首屏直达**：打开页面即明确告知用户如何选择/拖入/粘贴发送，无需阅读长篇说明。
  2. **非阻塞访问验证弹层**：当接收流程需要前置校验或口令时，使用轻量模态对话框而非系统原生弹窗阻塞主线程。
- **Aeris 独立实现**：采用 `#transferDropZone` 首屏大尺寸选择与粘贴区，并通过 WAI-ARIA `#transferPasswordModal` 完全替换旧版原生 `window.prompt`。

### 4. SwissTransfer (`https://www.swisstransfer.com/en`)
- **实时页面观察**：实测 `https://www.swisstransfer.com/en` 公开页面交互与配置结构。
- **提取的设计模式**：
  1. **发送参数前置摘要 + 按需展开**：默认将有效期（1 天）、下载上限等高级分享选项收纳或简化展示，保证用户拖拽文件后可立即传输，仅在需要加密码、限次数或阅后即焚时展开调整。
  2. **结果页链接 + 扫码 + 文件明细一体交付**：创建分享后集中展示有效期限、剩余下载次数、密码保护标识、链接复制及二维码。
- **Aeris 独立实现**：设计可折叠 `#transferConfigDisclosure`（展示 `1 天 · 最多 5 次 · 创建会话前可调整` / `会话已创建 · 本批参数已锁定`），并与 `#transferShareCard` 元数据胶囊及二维码生成逻辑打通。

### 5. Uppy (`transloadit/uppy`, `https://uppy.io/`)
- **许可证核查**：`MIT License`（实读仓库 `LICENSE`、`packages/@uppy/dashboard/src/components/FileItem/index.tsx`、`@uppy/status-bar/src/StatusBarUI.tsx`）。架构参考、未复用 Preact/JSX 文件。
- **提取的设计模式**：
  1. **完整阶段状态机 (`StatusBarStates`)**：显式区分预处理（Preprocessing / Hashing）、上传中（Uploading）、后端确认/后处理（Postprocessing / Confirming）、已完成（Complete）与失败（Error），不将分片全部发出误标为完成。
  2. **按文件项细粒度按钮状态控制**：仅在当前真实可操作状态显示对应「暂停 / 继续 / 重试 / 取消」操作并维持按钮位置稳定。
- **Aeris 独立实现**：`updateOverallProgress()` 映射「准备校验 → 安全会话 → 分片传输 → 服务端确认 → 生成分享」五阶段；`complete()` 仅在服务端 `POST /api/transfer/uploads/:id/complete` 成功后才切入分享结果卡片。

### 6. FilePond (`pqina/filepond`, `https://pqina.nl/filepond/`)
- **许可证核查**：`MIT License`（实读仓库 `LICENSE`、`src/js/app/view/item.js`；实操 `https://pqina.nl/filepond/` 页面上传演示并检验其添加文件后卡片与按钮变化）。未引入第三方源码。
- **提取的设计模式**：
  1. **即时入队校验与柔和状态切换**：添加或拖入文件后立即在原地校验类型/尺寸/数量，并触发自然的列表项高度与透明度过渡；异常文件在错误态明确给出可操作提示，绝不悄悄吞掉文件。
  2. **拖放目录与多文件追加包容性**：拖入文件夹时通过 `webkitGetAsEntry()` 递归提取保留目录路径信息。
- **Aeris 独立实现**：重构 `addFiles()` 执行前置批量校验与 `#transferValidationBanner` 明确提示；新增 `readDroppedEntries()` 处理文件夹拖拽并保留相对路径。

### 7. Cloudflare R2 Multipart Upload & WAI-ARIA APG
- **参考资料**：Cloudflare R2 Multipart Upload 官方文档（分片完整性、会话清理、`AbortMultipartUpload` 与预留一致性）；WAI-ARIA Authoring Practices Guide（Tabs `role="tablist"` 键盘方向键切换、`progressbar` `aria-valuenow`、Alert `role="alert"`、Dialog `aria-modal="true"` 焦点管理与 `Escape` 关闭）。
- **Aeris 独立实现**：保持 Task 22 / Task 28 `16 MiB` 分片哈希流水线及预留配额机制零改动，确保取消/失败时正确调用 `/abort` 或保留未完成列表释放配额；选项卡、进度条、错误横幅与密码弹窗全面对齐 WAI-ARIA 属性及键盘操作规范。

---

## 二、改前 vs 改后视觉与录像证据索引

- **改前基线截图（`docs/ui-rebuild/v63-phase6-transfer/evidence/before/`）**：`before-empty-1440.png`、`before-dark-1440.png`、`before-queue-ready-1440.png`、`before-share-created-1440.png`、`before-recipient-1440.png`、`before-mobile-390.png`。
- **改后全量实测截图（`docs/ui-rebuild/v63-phase6-transfer/evidence/after/`）**：`after-empty-1440.png`、`after-dark-1440.png`、`after-validation-error-1440.png`、`after-config-expanded-1440.png`、`after-queue-active-1440.png`、`after-share-created-1440.png`、`after-private-share-1440.png`、`after-shares-tab-1440.png`、`after-unfinished-tab-1440.png`、`after-password-modal-1440.png`、`after-recipient-1440.png`、`after-recipient-error-1440.png`、`after-mobile-390.png`、`after-mobile-320.png`。
- **正常速度 1.0x 录屏**：`transfer-phase6-sender-1x.mp4`（119 帧）、`transfer-phase6-recipient-1x.mp4`（105 帧）。
- **托管预览环境证据**：`hosted-preview-transfer-1440.png`、`hosted-preview.json`。

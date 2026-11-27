# Aeris V6.3 Phase 6 — 文件传输模块重构交付报告（PHASE6_REPORT）

## 一、交付概览与 Git 状态

- **阶段目标**：完成 `/transfer`、`#transferPage` 与 `/transfer#share=<id>` 文件传输模块的 UI、信息架构、动效、响应式适配及交互性能重构，完整保留既有分片引擎、D1/R2 存储权威、配额计算、分享安全模型及与 Android 客户端的下载契约。
- **基线来源**：Phase 5 (`hydrogen/v63-phase5-workflow-redesign`，`44668aa205ab29a8727b1e2b4d1ab1c9de5a5301`，Draft PR #186)
- **当前开发分支**：`hydrogen/v63-phase6-transfer-redesign`（基于 Phase 5 创建 Stacked Draft PR #187）
- **资源版本标识**：`ASSET_RELEASE = "20261127-aeris-p6-transfer-v2"`，`PUBLICATION_HASH = "87d4d47bed6895986b6280f992dcf9b9f868ef92e10cf26d197ea649c3e5a316"`（保持 `CORE_SHELL = 81`、`REQUIRED_SHELL = 89`、`INSTALL_SHELL = 89`，零新增根目录静态/JS 文件）。
- **Service Worker 稳定性修复（`e9ca58e4` + `212508f9`）**：
  - `e9ca58e4`：修复 `app.js` 在目标 `registration.waiting` 已安装且等待激活时重复触发 `navigator.serviceWorker.register(...)` 竞争的问题，改为直接向 `swRegistration.waiting` 发送 `SKIP_WAITING`；
  - `212508f9`：根治 `rollback-browser.mjs` 偶发竞态——此前 `boot()` 在页面初始资源及 `assetPrefetcher` 仍在通过旧 SW 发起请求时立即调用 `registerReleaseWorker()`，导致 Chromium 在旧 SW `stopping -> stopped` 瞬间收到新请求而重启旧 SW 并永久打断新 SW `skipWaiting()`；现改为等待 `window.load` + `startupMounted` 稳定后再注册（最长兜底 `1200ms`），并在切换期间暂停 `assetPrefetcher` 预取直至目标 SW 接管控制权（`repro_exact_rb.mjs` 连续 6/6 与完整 `qa/p07-release/rollback-browser.mjs` 连续 3 轮 7/7 全项 PASS）。
- **范围严守**：仅重构文件传输模块；未开启 Phase 7，未合并 `main`，未改动 Production，未修改 `v63-phase5` 预览环境，未重启 Android Hotfix 或财务 AI。

---

## 二、核心重构与架构亮点

1. **三分区信息架构与发送/接收端严格隔离（`index.html` + `js/transfer/app.js`）**
   - 取消旧版单页长堆叠表单，在 `/transfer` 路由下设立轻量分段导航 `#transferSubnav`（`发送文件` / `我的分享与附件` / `未完成上传`），自带真实数量角标（`tabular-nums`）、`ArrowLeft`/`ArrowRight`/`Home`/`End` 键盘切换与 `history.replaceState` 状态记忆，不制造重复路由。
   - 访问 `/transfer#share=<id>` 自动切入 `data-transfer-mode="recipient"` 专注接收模式：隐藏发送端副标题、配额条、功能切换栏、拖放区与历史选项卡，仅展示简洁顶栏、接收安全横幅（「发送我的文件」入口）、分享结果卡或结构化错误恢复卡 (`#transferRecipientError`)。
   - 切换至 Tab 2（`我的分享与附件`）与 Tab 3（`未完成上传`）时精确隐藏 `#transferShareCard` 与 `#transferRecipientError`，保持每个功能区专注纯净。

2. **真实限额前置校验、文件夹拖放与速率计算（`js/transfer/app.js`）**
   - 新增 `readDroppedEntries()` 递归遍历 `webkitGetAsEntry()` 文件夹拖拽并保留相对目录层级。
   - 统一 `addFiles()` 前置校验逻辑：严格结合 `capabilities` 有效配额与单批上限（`500` 文件 / `5 GiB` / `剩余可用配额`）检测超限与 0 字节文件，在 `#transferValidationBanner` (`role="alert"`) 明确提示超限原因，绝不静默丢弃；同时保留选中即自动开始分片上传的业务语义。
   - 消除首次载入异步返回 `/api/transfer/capabilities` 前短暂闪烁 `"总计 0 MiB / 0 MiB"` 的竞态问题，保持 `"配额加载中"` 直至服务端真实配额返回。

3. **五步管线总进度、克制低饱和动效与性能优化（`design-system.css` + `spatial-experience.css`）**
   - 引入低饱和传输语义令牌（蓝/绿/中性灰/红），保留精细 SVG 类型图标，严格零 `!important`、零字面颜色、遵守 `4px` 间距网格。
   - 整体进度区 (`#transferProgressPanel`) 配备 SVG 环形百分比指示器、GPU `transform: scaleX()` 线性进度条以及明确区隔的 5 阶段状态链（`准备校验 → 安全会话 → 分片传输 → 服务端确认 → 生成分享`），禁止将“分片全部发送”误标为“上传已完成”。
   - 复用 `reconcileKeyedRows()` 键值增量更新单文件队列进度、实测速度与 ETA；引入 `visibilitychange` 视觉节流以减少后台选项卡无效重绘（不影响真实上传生命周期），并完整支持 `prefers-reduced-motion` 与 `html[data-android-reduced-motion="true"]`。

4. **分享设置清晰锁态、WAI-ARIA 访问密码弹窗与筛选（`#transferConfigDisclosure` + `#transferPasswordModal`）**
   - 分享设置默认以紧凑摘要条呈现，修复旧版桌面端“有效 / 期”垂直折行问题，并在 `#transferConfigLockBadge` 显式区分「创建会话前可调整」与「会话已创建 · 本批参数已锁定」（随 `activeSession?.id` 禁用修改，与服务端参数完全一致）。
   - 使用符合 WAI-ARIA `role="dialog"` 规范的 `#transferPasswordModal` 替换全部原生 `window.prompt` 调用（支持输入遮罩切换、行内错误提示与焦点回归），解锁密码仅存于易失内存并在切换账号/离开页面时自动清空。
   - `我的分享与附件` 新增纯前端关键词过滤与 5 类状态筛选胶囊（全部 / 公开 / 私有 / 有密码 / 阅后即焚），不改变服务端 API 契约。

---

## 三、改前 vs 改后（Before / After）核心对比与实测数据

| 维度 | 改前（Phase 5 基线） | 改后（Phase 6 重构） | 实测依据 |
|---|---|---|---|
| 页面组织与清晰度 | 发送框、设置、队列、分享卡、历史列表、未完成全部单页纵向堆叠 | 三大功能分区 (`发送` / `我的分享与附件` / `未完成上传`) + 接收端专注视图 | `before-empty-1440.png` vs `after-empty-1440.png`, `after-shares-tab-1440.png`, `after-unfinished-tab-1440.png` |
| 接收端 `#share=` 体验 | 上方保留完整发送端标题、拖放区与表单，易混淆 | 仅显示接收提示横幅与文件清单/错误恢复卡，零发送控件干扰 | `before-recipient-1440.png` vs `after-recipient-1440.png`, `after-recipient-error-1440.png` |
| 分享参数设置排版 | 表单无收起，“有效 / 期”字面折行，锁定态不可见 | 默认紧凑摘要，展开三列清晰对齐，会话后明确锁定禁改 | `before-queue-ready-1440.png` vs `after-config-expanded-1440.png` |
| 口令解锁与失效恢复 | `window.prompt` 原生弹窗阻塞体验 | 非阻塞 WAI-ARIA `#transferPasswordModal` + 行内错码校验；过期/撤销结构化恢复卡 | `after-password-modal-1440.png`, `after-recipient-error-1440.png` |
| 首次交互与流畅度 | 局部整表与竞态闪烁 | `/transfer` 切入可交互 `308.3ms`–`314.4ms`，`longTasks = 0`，`queueRootWrites = 0` | `phase6-verification.json`, `p5-transfer-browser.mjs` |
| 全视口响应式适配 | 小屏表单标签挤压、配额单行裁剪 | `320 / 375 / 390 / 768 / 1440 / 1920 / 2560` 全视口 `scrollW <= clientWidth`，移动按钮高度 `>= 44px` | `after-mobile-390.png`, `after-mobile-320.png`, `phase6-verification.json` |

---

## 四、测试、门禁、Hosted Preview 与本地资源调度报告

### 1. 最后一次代码修改后全部通过的本地门禁与浏览器验证

- `npm run task27:publication`: **PASS** (`publication_hash: 87d4d47bed6895986b6280f992dcf9b9f868ef92e10cf26d197ea649c3e5a316`, `integrity_entries: 80`, `install_shell_total: 89`, `prior_core_shell_preserved: true`)
- `node scripts/stage_pages_deploy.mjs` & `npm run cf:check`: **PASS** (`Compiled Worker successfully`)
- `python -m unittest discover -s local-backend -p "test_static*.py" -v`: **PASS** (`31 tests`)
- `python scripts/functional_audit_gate.py`: **PASS** (`27 routes, 24 app flows, 104 tools, 51 tool modes, 7 checkbox controls, 12 workflow capabilities, 27 workflow flows`)
- `node scripts/check_storage_contract.mjs`: **PASS** (`31 stable key families`)
- `node scripts/check_js_module_graph.mjs`: **PASS** (`67 files, 120 imports`)
- `python scripts/repository_audit.py`: **PASS** (`2622` tracked and candidate files checked)
- `impeccable doctor --json`: **PASS** (`findings: []`, exit `0`)
- 传输单元、恢复与隔离测试 (`test_upload_part_recovery_js.mjs`、`test_transfer_updates_js.mjs`、`test_transfer_isolation_js.mjs`、`test_transfer_session_plan_js.mjs`、`test_transfer_benchmark_js.mjs`、`test_transfer_integrity_js.mjs`、`test_task22_d1_js.mjs`、`test_i05_workspace_shell.mjs`、`test_i06_module_experience.mjs`、`sw-install.test.mjs`、`sw-release.test.mjs`): **全部 PASS**（含 `3/3` I05、`2/2` I06 与最新 `24/24` SW 单测，且 `test_transfer_benchmark_js.mjs` 在模拟延迟下达 `3.48x` / `336.8 MiB/s`）
- `npm run test:task28:runtime` (`qa/task28/workerd.mjs`): **PASS** (`3/3` 用例通过)
- `node qa/v63-phase6/verify_phase6_transfer.mjs`: **PASS**（`8/8` 检查项、7 视口、`interactiveMs: 206.1`、`senderFrames: 146`、`recipientFrames: 122`、`runtimeErrors: 0`）
- `npm run test:task28:browser` (`qa/task28/browser.mjs`): **PASS**（`5/5` 用例、`0` 跳过、含 `axe-core` 无障碍对比度验收）
- `node qa/p07-release/sw-install-browser.mjs --source WORKTREE --label p6-swfix`: **PASS**（`7/7` 用例通过）
- `qa/p07-release/rollback-browser.mjs`（本地 Miniflare + Chrome 连续 3 轮验证）：**PASS**（连续 `3/3` 轮、`7/7` 用例全部通过）

### 2. 全新完全隔离 Hosted Preview (P6–P9) 部署与完整在线闭环验收

- **全新隔离 Cloudflare 资源（方案 A）**：
  - **Pages 项目**：`thewyj-v63-p6p9-preview`（`production_branch: "release-held"`，部署分支 `v63-phase6`，最新部署 URL `https://8e5364c6.thewyj-v63-p6p9-preview.pages.dev`）
  - **预览访问地址**：`https://v63-phase6.thewyj-v63-p6p9-preview.pages.dev`
  - **独立 D1 数据库**：`aeris-v63-p6p9-preview`（UUID `a1550b63-acd2-42bb-9358-b44bedd88d68`，完整按序应用 `0001`–`0045` 全部 45 条迁移，`167` 张表与 `task28_schema_version = 1` 核验一致；`task25_feature_flags` 已启用 `p07_accessibility` 100%）
  - **独立 R2 存储桶**：`aeris-v63-p6p9-storage`（绑定为 `WYJ_STORAGE`，安全配置开启 `D1_RATE_LIMIT_ENABLED=true`、`TASK22_TRANSFER_WRITES_ENABLED=true`、`WORKERS_AI_ENABLED=false`、`EMAIL_SENDING_ENABLED=false`，并独立生成 3 个 32-byte `secret_text` 密钥）
  - **既有环境零改动核实**：共享预览库 `wyj-cloud-preview` (`a3e6253b-689f-49f3-998b-7c5828ea255a`) 与 R2 `wyj-cloud-preview`、P5 验收环境 `https://v63-phase5.thewyj-v63-preview.pages.dev`（HTTP `200`）、DS SSO 环境及 Production (`wyj-cloud-production`) 均保持完好零改动；部署证物见 [`p6p9-preview-provision.json`](./evidence/p6p9-preview-provision.json)。
- **永久测试账户（已于真实在线 Preview 登录实测，保留供验收）**：
  - **普通免费用户**：`v63p1_free` / `PreviewFree#2026!`（配额 `500.0 MiB`）
  - **全功能永久会员**：`v63p1_vip` / `PreviewVip#2026!`（已合法授予 `all_access_lifetime` 全量权益，配额 `2.00 GiB`）
  - **超级管理员（唯一站点所有者）**：`v63p1_admin` / `PreviewAdmin#2026!`（`role = 'super_admin'`，配额 `5.00 GiB`，侧栏可见「管理后台」入口）
  - **游客模式验证**：配额 `50.0 MiB`，`私有附件`与高有效期按规则禁用。
- **Hosted Preview 真实在线全闭环实测与 1.0x 录屏（[`hosted-preview.json`](./evidence/hosted-preview.json)）**：
  - 使用 `v63p1_vip` 上传 `17,039,360` B（`16.25 MiB` `aeris-multipart-bundle.bin` 分片上传）+ `release-notes.txt`，设置密码并实测「暂停 → 续传 → 完成 → 生成分享链接与二维码」；
  - 独立无痕接收端浏览器访问 `#share=...`，验证错密内联报错 → 正确密码解锁 → 真实浏览器下载两个文件，**SHA-256 逐位一致**（`4560429fe58a1051b2f1f2a272af9858b3de345bf927adc2e2d6d933d7003db9` 与 `353b6ca9f6813006796e4f0caa517c5f8d4b72e957e35615d9060c838b8a40a3`）；
  - 真实在线操作 1.0x MP4 录屏：[`transfer-hosted-preview-1x.mp4`](./evidence/hosted/transfer-hosted-preview-1x.mp4)（`490` 帧）。

### 3. 本地环境说明与 `aeris-resource-guard` 调度/进程清理汇报

- **执行的重型任务**：`npm run test:task28:runtime`（Miniflare）、`node qa/v63-phase6/verify_phase6_transfer.mjs`（Miniflare + Chrome）、`npm run test:task28:browser`（Miniflare + Chrome）、`qa/p07-release/sw-install-browser.mjs`、以及针对 `https://v63-phase6.thewyj-v63-p6p9-preview.pages.dev` 的在线布局与传输性能/遥测脚本（`measure_before_layout.mjs`、`measure_after_layout_and_ux.mjs`、`verify_live_browser_telemetry.mjs`）。
- **并发配置**：**严格 100% 串行**；每次仅运行一组 Miniflare/Workerd + 单个 Headless Chrome，前一组完全终止并释放资源后再启动下一组，未发生重叠并发。
- **进程与临时文件清理结果**：每次脚本结束 `finally` 块均按自身追踪 PID（`taskkill /PID <pid> /T /F`）清理所启 Chrome/Pages 子进程及临时目录（`os.tmpdir()`、`.wrangler/p6p9-deploy-context`、`.wrangler/task28`、`artifacts`、`.tool-e2e`），已核实无任何本任务残留的测试进程，也未终止任何非本任务进程。

---

## 五、最终布局居中、状态一致性与传输性能剖析（Before vs After）

### 1. 统一主工作区居中与无跳动核验（参考 `#adminPanel`）

- **根因定位（`spatial-experience.css`）**：
  - 既往 `@media (min-width: 880px)` 规则（第 `3475` 行）向 `#transferPage` 注入了 `align-items: start`，随后重构规则（第 `15392` 行）虽切换为 `display: flex; flex-direction: column;`，却未显式重置 `align-items: stretch`，同时硬编码了 `max-width: 1040px; padding: 20px 24px 36px;`，且 `.tf-subnav` 设有 `display: inline-flex; align-self: flex-start;`。
  - 这导致 `#transferSendPanel`（`788px` / `719.7px`）、`#transferUnfinishedPanel`（`543px`）、`#transferShareCard`（`567.9px`）与 `#transferRecipientBar`（`475px`）在 Flex 列中贴左收缩，而 `#transferSharesPanel` 被内部全宽控件撑满至 `992px`，从而产生「某些页面偏左、我的分享居中」的视觉跳动。
- **统一方案**：
  - 使 `#transferPage:not(.hidden)` 与 `#adminPanel` 完全对齐：`width: min(calc(100% - 48px), var(--ds-container-console)); max-width: none; margin: 16px auto 48px; padding: 0; align-items: stretch;`（移动端 `<= 768px` 对称设为 `width: calc(100% - 32px); margin: 12px auto 32px; padding: 0;`）。
  - `#transferSubnav` 采用与 `.admin-tabs` 一致的全宽底线标签栏样式；`#transferPage` 所有子区段及 `#transferSendPanel` 内部区域（标题与配额、二级导航、拖放区、分享设置、上传进度、队列、分享结果卡、我的分享与附件、未完成上传、接收端提示与错误卡）统一 `width: 100%; max-width: none; box-sizing: border-box;`。
- **Hosted Preview 真实 `getBoundingClientRect()` 实测对比（[`before-layout-metrics.json`](./evidence/hosted/before-layout-metrics.json) vs [`after-layout-metrics.json`](./evidence/hosted/after-layout-metrics.json)）**：

| 视口与状态 | 区域 | 改前宽度 / 左右边距（相对 `#v3MainCanvas`） | 改后宽度 / 左右边距（`#v3MainCanvas`） |
|---|---|---|---|
| `1440×900`（侧栏展开，`1169px` 画布） | `#adminPanel`（参照） | `1121px` / `L=24, R=24` (`Δ=0`) | `1121px` / `L=24, R=24` (`Δ=0`) |
| `1440×900`（侧栏展开） | `.transfer-header` / `#transferSubnav` | `992px` (`Δ=0`) / `392px` (`Δ=-600`) | **均 `1121px` / `L=24, R=24` (`Δ=0`)** |
| `1440×900`（侧栏展开） | `#transferSendPanel` / 拖放 / 设置 / 进度 / 队列 | `788px`（分享后 `719.7px`），`R=292.5`/`360.8` | **均 `1121px` / `L=24, R=24` (`Δ=0`)** |
| `1440×900`（侧栏展开） | `#transferShareCard`（发送端 & 接收端） | `567.9px` (`L=88.5, R=512.6, Δ=-424.1`) | **均 `1121px` / `L=24, R=24` (`Δ=0`)** |
| `1440×900`（侧栏展开） | `#transferSharesPanel` / `#transferUnfinishedPanel` | `992px` vs **`543px` (`Δ=-449`)** | **均 `1121px` / `L=24, R=24` (`Δ=0`)** |
| `1440×900`（侧栏展开） | `#transferRecipientBar` | `475px` (`Δ=-517`) | **`1121px` / `L=24, R=24` (`Δ=0`)** |
| `1440×900`（侧栏折叠，`1361px` 画布） | `#transferPage` 及全部子区域 | `1040px` (`L=64.5`)，内部偏左至 `567.9px` | **全部 `1313px` / `L=24, R=24` (`Δ=0`)** |
| `1920×1080`（侧栏展开，`1649px` 画布） | `#adminPanel` vs `#transferPage` 全部区域 | `#transferPage` `1040px`，卡片 `567.9px` | **与 `#adminPanel` 均 `1320px` / `L=164.5, R=164.5` (`Δ=0`)** |
| `390×844`（移动端） | `#transferPage` / 导航 / 拖放 / 设置 / 进度 | — | **均 `358px` / `L=16, R=16` (`Δ=0`)，`scrollW=390`** |

### 2. 状态联动与误导展示修复

1. **开始新上传自动清理旧「分享已创建」卡片（`js/transfer/app.js` `addFiles()`）**：发送端在已有 `currentShare` 展示时追加或重新选中新文件，立即调用 `clearShare()` 隐藏旧分享结果卡（历史记录仍完整保留在「我的分享与附件」中），实测 `staleShareCardClearedOnNewUpload = true`。
2. **「阅后即焚」与下载次数上限一致性（`js/transfer/app.js`）**：勾选 `#transferOneTime` 时自动将 `#transferMaxDownloads` 锁定同步为 `1` 并展示 `阅后即焚（限 1 次）`；在结果卡与「我的分享与附件」列表对所有 `one_time` 分享统一显示 `阅后即焚（限 1 次 · 已下载 X/1 次）`，与服务端 `task22-service.mjs` 首下即焚逻辑完全一致，不再出现 `阅后即焚` 与 `下载 0 / 5 次` 并存。

### 3. 传输速度性能剖析与真实优化效果

- **9 项细分性能剖析结论（本地 Miniflare + 线上 Hosted Preview 实测）**：
  1. **文件准备与 SHA-256**：WebCrypto 仅 ~`17.3 ms / 16 MiB`（`32 MiB` 约 `36.1 ms`、`168 MiB` 约 `174.4 ms`、`500 MiB` 约 `573.6 ms`），已由 `HASH_LOOK_AHEAD = 2` 完全重叠隐藏，**不是瓶颈**。
  2. **会话创建与文件分配 RTT**：线上 `POST /api/transfer/uploads` 约 `520–784 ms`，`POST /api/transfer/uploads/files` 约 `885–1,875 ms / 文件`。旧版 `js/transfer/app.js` 在 `run()` 中串行 `for ... await uploadItem(item)`，导致 `12` 个小文件仅分配阶段就串行等待 `12.2 s`。
  3. **多小文件与跨文件串行空闲**：旧版对 `< 16 MiB` 单片文件仅启用 `1` 条 HTTP PUT 连接，且 `completeUploadSession` 逐文件串行查询 D1 并执行 `4` 次 R2 调用（`12` 文件耗时 `7,544 ms`），导致小文件实测吞吐跌至 **`98.2 KiB/s`**（与用户截图 `130.2 KiB/s` 一致）。
  4. **Worker 与 D1/R2 内部耗时（本地 `uploadPart` 拆分）**：`readBoundedBytes` 仅 `4.3 ms`、`SHA-256` 仅 `17.3 ms`、`5` 次串行 D1 查询耗时 `384.4 ms / 片`、R2 `uploadPart` 耗时 `1,029.1 ms / 片`（本地）/ 含公网传输入栈约 `8.0–15.8 s / 16 MiB`（线上）。
  5. **网络吞吐与带宽瓶颈如实结论**：从当前测试机直连 Cloudflare Hosted Preview 的物理上行带宽天花板约为 **`3.7–4.3 MiB/s`（~30–35 Mbps）**：`168 MiB` 在 `concurrency=3` 时 `42.22 s`（`3.98 MiB/s`），提高到 `concurrency=6` 仅微增至 `39.52 s`（`4.25 MiB/s`），且单片耗时从 `10.35 s` 翻倍至 `18.22 s`，证实大文件在 `conc >= 3` 时主要由**用户侧物理上行带宽及跨洲 Cloudflare 边缘网络往返延迟**主导，不虚构无法实现的加速比。
  6. **速率与 ETA 计算滞后问题修复**：旧版仅在整片 `16 MiB` 服务端 ACK 后才更新 `item.uploaded` 与累计均值 `item.speed`，在较慢网络（如 ~`1 MiB/s` 上行）会导致前 `15–40 s` 显示 `0% / 无速率 / 无 ETA`。新版打通 `upload-part.js` 的 `xhr.upload.onprogress` 与 `4s` 滑动窗口遥测（保留 `item.uploaded` 仅记录已确认分片字节以确保断点续传准确，同时前端进度上限 `99%` 直至服务端全部 ACK 后才跃迁 `done / 100%`）。
- **实施优化与实测对比（Hosted Preview + Chrome + Miniflare）**：
  - 客户端：`UPLOAD_CONCURRENCY = 4`、`MAX_CONCURRENT_FILES = 4`、`MAX_ACTIVE_PUTS = 6`（单会话先于并发池创建，严守「不在 PUT 进行时切换或中止会话」不变式）+ `xhr.upload.onprogress` 滑动窗口实时遥测。
  - 服务端（`task22-service.mjs`）：`uploadPart` 将 5 次串行 D1 往返合并为批处理 `db.batch`；`completeUploadSession` 改为单条 SQL 取回全部分片、复用 Part 1 已检摘要跳过重复 `R2 GET`，并用 `6` 路受控并发完成最终合并（100% 保留每片 SHA-256 与魔数校验）。
  - **实测对照结果**：
    - **`12 × 256 KiB` 多小文件（Hosted Preview）**：`31,288.1 ms`（`98.2 KiB/s`，`complete = 7,544.4 ms`） → **`7,728.0 ms`（`397.5 KiB/s`，`complete = 1,237.3 ms`）**，总耗时缩短 **4.05×**，完成合并耗时缩短 **6.10×**。
    - **`32 MiB`（Hosted Preview / Chrome UI）**：API 实测 `11,067.3 ms`（`2.89 MiB/s`）→ `11,034.5 ms`（`2.90 MiB/s`）；Chrome 真实浏览器实测 `13,403 ms` 全程录得 **29 次中间进度更新**（`2.98 s` 即开始回报 `1% · 319.1 KiB/s · 剩余 102s`），`neverPremature100WhileUploading = true`。
    - **`168 MiB`（Hosted Preview）**：`42,224.8 ms`（`3.98 MiB/s`）vs `44,522.3 ms`（`3.77 MiB/s`），受测试链路 ~4 MiB/s 上行带宽波动主导。
    - **`500 MiB`（Hosted Preview，32 分片）**：优化后 **`134,756.2 ms`（`3.71 MiB/s` / `3,799 KiB/s`）**，完成后撤销分享配额立即归零（`quotaAfterUsed = 0`）。
    - **本地 Miniflare 服务端对比（去除公网传输时间）**：`32 MiB` `5,158.5 ms → 4,613.8 ms`，`168 MiB` `17,159.4 ms → 15,304.9 ms`，`500 MiB` `46,577.9 ms → 41,686.5 ms`（全规格稳定提速 ~10%–12%）。

# Aeris V6.3 Phase 6 — 文件传输功能保留矩阵（FEATURE_INVENTORY_MATRIX）

> 核查基线：`index.html`（`#transferPage`、`#transferPasswordModal`）、`js/transfer/app.js`、`js/transfer/upload-part.js`、`js/transfer/updates.js`、`functions/_lib/task22-api.mjs`、`functions/_lib/task22-service.mjs`、`functions/_lib/task22-model.mjs`、`local-backend/test_transfer_browser_e2e.mjs`、`local-backend/test_transfer_responsive.mjs`、`qa/aeris/transfer-clipboard-browser.mjs`。
> 约束红线：**不修改后端传输协议、分片大小（`16 MiB`）、D1/R2 存储权威、配额计算、有效期规则、密码校验策略、私有附件权限控制、队列持久化格式（`wyjTransferQueue:v1`/`v2` 与 `wyjTransferGuest:v1`）及 Android 原生下载桥。**

---

## 一、全量功能保留与 UX 重构映射矩阵

| 编号 | 功能域 | 服务端 / 前端契约锚点 | 真实业务语义 | Phase 6 UI/UX 升级实现 |
|---|---|---|---|---|
| F-01 | 多文件与文件夹选择、目录保留 | `#transferSelectFilesBtn`, `#transferSelectDirBtn`, `#transferFileInput`, `#transferDirInput`, `webkitRelativePath` | 支持多选、分次追加、`webkitdirectory` 目录选择与相对路径保留，不合并不同目录同名文件 | 空状态与有队列态均保留独立「选择文件」「选择文件夹」按钮；展示目录徽标与完整文件名 tooltip |
| F-02 | 拖放文件夹递归读取与 Ctrl+V 粘贴 | `#transferDropZone` `drop`, `webkitGetAsEntry()`, `document` `paste` | 支持文件/文件夹拖入；`paste` 严格忽略输入框与 `contentEditable`，仅在传输视图聚焦或激活时接收文件/截图 | 新增拖放文件夹 `FileSystemEntry` 递归遍历保留目录层级；拖放区在拖入时呈现柔和边框与低饱和背景高亮；完整保留剪贴板隔离策略 |
| F-03 | 动态能力读取与前置校验（零静默丢弃） | `GET /api/transfer/capabilities`, `addFiles()`, `maxFilesLimit()`, `maxShareBytesLimit()`, `effectiveRemainingQuota()` | 按游客（`50 MiB`）、普通用户（`500 MiB`）、全功能会员（`2.00 GiB`）、站点所有者（`5.00 GiB`）及单批上限（`500` 文件 / `5 GiB`）校验 | 在入队前统一执行空文件（0B）、单文件/累计文件数、单批大小与账户剩余配额校验；超限整批拒绝入队并在 `#transferValidationBanner` (`role="alert"`) 明确列出原因与可关闭按钮 |
| F-04 | 独立三大功能分区与浏览器历史同步 | `#transferSubnav` (`send` / `shares` / `unfinished`), `history.replaceState` | 单页 `/transfer` 路由下隔离发送工作台、我的分享列表与未完成任务管理，兼容浏览器返回与深链接 | 桌面分段切换条 + 实时数量角标；支持 `ArrowLeft/ArrowRight/Home/End` 切换面板，且不制造新路由 |
| F-05 | 接收端 `#share=<id>` 专注模式 | `recipientShareId()`, `openShare()`, `[data-transfer-mode="recipient"]` | 打开 `#share=` 仅加载对应公开分享或当前登录账户有权访问的私有附件 | 通过 CSS 与 `syncTabUi` 隐藏发送端副标题、配额条、三大导航面板，仅保留顶栏返回、接收提示栏（「发送我的文件」出口）、分享卡或结构化错误恢复卡 |
| F-06 | 自动分片、并发管道与服务端确认状态 | `run()`, `runPartPipeline()`, `createSession()`, `complete()` | 选文件后立即启动预计算 SHA-256 与分片上传，先向服务器完成 `/files`、`/parts`、`/complete` 再解锁分享 | 五步管线进度面板（`准备校验 → 安全会话 → 分片传输 → 服务端确认 → 生成分享`）与 SVG 环形进度 + GPU `scaleX()` 总进度条，严格区分全分片上传与服务端确认 |
| F-07 | 单文件队列操作、持久化与重选续传 | `wyjTransferQueue:<owner>`, `reconcileKeyedRows()`, `pauseItem()`, `resumeItem()`, `retryItem()`, `cancelItem()`, `#transferRelinkInput` | 单文件独立暂停/继续/重试/取消、页面重载后凭本地持久化队列重新选择原文件续传 | 基于 `reconcileKeyedRows()` 键值局部更新进度条、上传字节、实时速率（`B/s..GiB/s`）、可靠 ETA 及按文件类型细线 SVG 图标，不抖动重排按钮与焦点 |
| F-08 | 分享设置与会话锁定真实性 | `#transferConfigDisclosure`, `#transferExpiry`, `#transferMaxDownloads`, `#transferPassword`, `#transferPasswordToggle`, `#transferOneTime`, `#transferPrivate` | 有效期（`60m / 1440m / 4320m / 10080m`，游客上限 `1440m`）、下载次数 `1..100`（默认 `5`）、密码可选、`one_time`、`access_scope: 'private'` | 默认折叠为紧凑参数摘要；`#transferConfigLockBadge` 实时指示是否已创建会话并锁定字段；密码显隐开关使用细线眼睛 SVG；游客超限期限自动禁用并展示 `#transferGuestExpiryHint` |
| F-09 | 分享创建结果、二维码与单次撤销 | `#transferShareCard`, `#transferShareLink`, `#transferCopyLinkBtn`, `#transferQr`, `#transferShareFiles`, `#transferCurrentRevokeBtn` | 生成 `#share=<id>` 链接与真实 URL 二维码；私有附件隐藏公开链接与二维码；点击撤销立即置为 `revoked` 并释放配额 | 卡片元数据拆分为独立胶囊标签（数量、大小、下载进度、有效期、密码、阅后即焚）；复制反馈同步按钮与状态提示；独立危险样式保留单次点击立即撤销合约 |
| F-10 | 访问密码非阻塞模态框与错误恢复卡 | `#transferPasswordModal`, `#transferRecipientError` | 受保护分享 `/api/transfer/shares/:id` 与 `/authorize` 返回 `403 share_password_invalid` 时要求输入访问密码 | 使用符合 WAI-ARIA `role="dialog"` 规范的 `#transferPasswordModal` 替代原生 `window.prompt`，内存中隔离已解锁口令并在切换账号/离开时清除；失效/撤销/用尽分享展示 `#transferRecipientError` 恢复引导 |
| F-11 | 我的分享筛选、未完成任务与预留释放 | `#transferSharesSearch`, `[data-transfer-share-filter]`, `#transferUnfinishedSessions`, `abortServerSession()` | 列表加载服务端分享与未完成上传会话，支持释放预留配额与本地持久化队列清理 | 我的分享增加本地关键词搜索与 5 类筛选胶囊（全部/公开/私有/有密码/阅后即焚），不更改服务端接口契约；未完成上传区区分本机队列与云端预留会话 |
| F-12 | 下载校验与 Android 原生下载桥 | `downloadShareFile()`, `WYJAndroidTransfer`, `/api/transfer/shares/:id/download` | 授权一次性 download grant 并验证/流式下载；Android WebView 环境调用原生下载器桥接与事件广播 | 完整保留单文件下载授权、同源会话 Cookie、`window.WYJAndroidTransfer` 桥接调用及下载进度事件监听 |

---

## 二、后端接口与安全参数复核摘要

- **配额基线**（`functions/_lib/task22-service.mjs` 与实测返回）：
  - 游客（`guest`）：`50 MiB`（`52428800` B），单次分享有效期上限 `1440` 分钟（1 天），禁止 `access_scope: "private"`。
  - 注册免费用户（`user`）：`500 MiB`，可选 `1 小时 / 1 天 / 3 天 / 7 天`，可保存私有附件。
  - 全功能会员（`all_features_access`）：`2.00 GiB`。
  - 站点所有者（`super_admin`）：`5.00 GiB`（单批次分享上限同样受 `MAX_SHARE_BYTES = 5 GiB` 与 `MAX_FILE_COUNT_PER_SHARE = 500` 约束，分片 `16 MiB`）。
- **下载授权与密码**：分享口令仅在用户内存态 `unlockedSharePasswords` 临时保存（`hide()`、`accountUpdated()` 或口令错误 403 时清空），绝不写入 `localStorage`、URL 参数或分析事件；`copy-lint`、静态审计与浏览器验证均确认零新增 `window.prompt` 或明文泄露。

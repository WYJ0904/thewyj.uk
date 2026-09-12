# Task 24.3 — Notification → Finance Production post-release audit

日期：2026-09-12。基线：正式版 1.3.0 / versionCode 13（Product merge `5e597da`，final main HEAD `efa2c11`）。

## 结论

本轮专项复核未发现新的 Notification → Finance 回归。此前全部真实故障点均已按 1.3.0 的
canonical 状态机闭合，Production 与正式 APK 复测通过。

## 代码侧复核（真实运行，未 mock 关键链）

- `test_task21_notification_js.mjs`：PASS（隐私边界、权益生命周期、幂等 ingest、去重、
  Finance 集成、candidate 状态机、feature flags）。
- `test_task21_hints_js.mjs`：PASS（单一 pending source、不臆造金额、confirm/ignore 幂等）。
- `test_finance_js.mjs`：PASS（金额、汇总、筛选、tombstone、revision merge、自动记账变更流）。
- `test_tts_js.mjs`：PASS；`test_static.py`：31 OK。
- Android 侧 canonical 链测试（`NotificationFinanceLinkTest`、`PaymentHintSyncCrossClientTest`、
  `NotificationCaptureCoordinatorTest`、`NotificationFinanceLedgerIdentityTest`）随 main CI
  （PR #61 / merge `5e597da`）全绿，且无新增代码改动。

## Production 实测证据（正式环境，非 Preview）

- `/api/app/config`：`1.3.0 / 13`，APK SHA `8a24e779…`。
- 官网 `/api/app/download` 下载 APK：SHA 与 config 一致，47,578,521 bytes。
- `/api/notification/hints` 未认证请求：HTTP 401（鉴权边界完好，无数据泄漏）。
- Production D1（只读）：`task21_notification_pending_hints` 当前 1 pending / 3 ignored；
  `task16_finance_transactions` 共 12 笔（真实入账记录存在）。
- 部署：Production source `874bf25`（与产品 merge `5e597da` 同产品代码），deployment
  `d400be4f-b3b7-4cdd-bfa8-5edc82e145fd`。

## 结论项

- 已识别金额未进 Finance：1.3.0 修复生效，duplicate-without-ledger 保留并报告失败。
- candidate 未到账本：pending → confirm → finance_entry_id 链闭合。
- confirm 后通知仍待确认：archive `financeState/financeTransactionId` 终态持久化生效。
- refresh/restart/reconnect 复活：terminal 不可覆盖，跨端 pull 一致。
- retry 重复入账：confirm 幂等，同一 source event 仅一笔 transaction。
- 用户反馈：已保存 / 已识别待确认 / 已入账 / 失败 四态可区分，失败不静默。
- 通知点击：thewyj 动作只打开 thewyj；来源 App 独立动作且不可用时隐藏。

无代码修改；后续 Task 24.3 继续以 1.3.0 正式使用反馈为输入。

## 主动审计发现并修复（继续）

### T24.3-01 文件传输上传队列跨账户复用（P1 multi-account isolation）

- Root cause：上传队列持久化使用单一全局 key `wyjTransferQueue:v1`，虽然恢复时有 owner
  校验避免直接串号，但切换账户会覆盖另一个账户尚未完成的上传队列，返回原账户后队列丢失。
- 修复：队列按 owner 使用独立 key `wyjTransferQueue:v2:<owner>`（`transferQueueStorageKey`，
  对外导出）；旧 v1 数据仅在 owner 匹配时一次性导入，导入后写回 v2。
- Regression：`local-backend/test_transfer_isolation_js.mjs`（不同账户 key 隔离、同账户稳定、
  guest 稳定、空白规范化、大小写敏感）；已接入 CI 的 JS job。`test_tools_js.mjs` 38 项仍通过。
- Commit：`3abf209`。

### T24.3-02 capability 审计误报「有离线语音回退」（P2 错误反馈）

- Root cause：`classifyCapabilities` 对 `audio` 固定传入 `fallback: true`，
  即使运行环境既没有 `Audio` 也没有 `speechSynthesis`，也不会产生任何用户可见提示。
- 修复：新增 `speechFallback` 探测（`speechSynthesis.speak`），`audio` 只有在真的存在
  设备/浏览器语音引擎时才算 FALLBACK_AVAILABLE，否则为 UNSUPPORTED 并输出提示。
- Regression：`test_capabilities_js.mjs` 新增「无音频且无语音引擎必须提示」「仅有设备语音时是回退」两组断言。
- Commit：`f31aa83`。

### T24.3-03 服务端自动入账后通知侧仍显示待确认（P0 数据一致性）

- Root cause：`AndroidPaymentRecognitionHook.onFinanceOutcome` 先查本地 recognition/candidate，
  `?: return` 提前返回；服务端自动入账（无本地 candidate 行）时，archive 的
  `financeState/financeTransactionId` 永远不会被写成 confirmed，通知侧停在「等待确认记账」。
- 修复：archive 终态写入提前到方法开头（按 `sourceEventId` 关联，不依赖本地 candidate），
  本地 recognition/candidate 更新降级为 best-effort（并整体 runCatching，避免本地库异常影响终态）。
- 同时为可测性注入 `archiveSink` 与 `recognitionStore`（生产默认不变）。
- Regression：`AndroidPaymentRecognitionHookArchiveTest.autoBookedPaymentStillClosesTheArchiveWithoutALocalCandidate`
  （无本地 candidate 时 archive 仍为 confirmed + txn id）。
- Commit：`58b6037`。

### T24.3-04 「我的 → Android 能力」无障碍状态与系统真实权限不一致（P2 错误状态反馈）

- Root cause：能力横幅把 `PaymentAccessibilityStatus.connected`（进程内连接标志）当成无障碍
  「开/关」的结论。冷启动后系统设置已开启但服务尚未连接、或服务实例已被销毁而标志未复位时，
  横幅显示「无障碍未连接」，与权限中心 `PermissionCenter.accessibilityGranted`（实时读取
  AccessibilityManager）给出的「已开启」直接矛盾——同一个 App 两处状态互相打脸。
- 修复：横幅结论改用系统授权（`PermissionCenter.accessibilityGranted`），连接标志只作为细节；
  新增纯函数 `PermissionDecisions.accessibilityStatus`（未开启 / 已开启、服务待连接 / 已连接）。
  另外 `ThewyjPaymentAccessibilityService.onDestroy` 复位 `PaymentAccessibilityStatus.onDisconnected()`，
  服务销毁后不会再残留「已连接」的过度声明。
- Regression：`PermissionCenterTest.accessibilityStatusFollowsTheSystemGrantNotOnlyTheLiveConnection`、
  `PaymentAccessibilityServiceGateTest.destroyedServiceNeverLeavesAConnectedClaim`。
- Commit：`8151ebe`。

### T24.3-05 更新包校验在缺失 SHA-256 时静默放行（P2 fail-open 完整性）

- Root cause：`AppUpdateInstaller.verify` 在发布元数据缺失或格式错误（`apk_sha256` 不是
  64 位十六进制）时直接 `return true`，把「无法校验」当成「校验通过」；界面同时还在显示
  「正在校验安装包…」，随后把文件交给系统安装器。另外 `apkSizeBytes` 缺失（0）会被
  `coerceAtLeast(0)` 变成「必须正好 0 字节」，导致只发布了哈希的元数据必然校验失败。
- 修复：改为 fail-closed——哈希缺失/畸形一律判失败并删除已下载文件；哈希是权威校验，
  发布大小只在服务器确实提供（>0）时作为附加校验。
- Regression：`AppUpdateInstallerVerifyTest`（缺失哈希、畸形哈希、哈希+大小通过、
  仅有哈希通过、大小不符失败、内容被篡改后删除）。
- Commit：`b84f67c`。

### T24.3-06 离线捕获后联网不会自动补传（P2 数据迟到/待同步悬置）

- Root cause：单条通知上传失败（离线、超时）后，重试只发生在「下一条通知到来」或
  用户打开通知历史/待核实界面；监听服务 `onListenerConnected` 只在通知栏里有活跃通知时
  通过回放间接触发排空（空通知栏什么都不触发），`SessionRefreshWorker` 只刷新会话，
  `MainActivity` 的网络回调只做会话恢复。结果是金额已在本机识别，联网恢复后仍可能长时间
  不进 Finance，停在「待同步」。
- 修复：监听服务新增两个维护触发——`onListenerConnected` 无条件请求一次排空
  （进程启动/系统重绑），并注册默认网络回调，网络恢复（`onAvailable`）时请求排空；
  请求复用既有 `AtomicBoolean` 合并，不会并发重复上传。新增测试注入
  `pendingFlushOverride`（生产默认仍走真实 `scheduleFlush`）。
- Regression：`NotificationListenerRetryTriggerTest.networkAvailableRetriesThePendingIngestQueue`、
  `NotificationListenerRetryTriggerTest.listenerReconnectRetriesThePendingIngestQueueEvenWithAnEmptyShade`。
- Commit：`99ed2b3`。

### T24.3-07 传输页重新进入会把正在上传的队列「恢复」成待重选（P1 上传卡死 + main CI 红灯根因）

- Root cause：`js/transfer/app.js` 的 `restoreQueue()` 每次被调用（每次 `show()`——重新进入传输页；
  以及 `accountUpdated()`——账户刷新）都会用 localStorage 里的序列化队列整体替换内存队列。
  序列化副本不包含 File 对象，于是**正在上传**的条目被换成 `needsFile: true`：界面停在
  「已恢复，请重新选择同一文件继续」、进度 0 B、完成按钮永远不可用，上传再也不会继续。
  这正是 main CI「Cloud-only browser, canonical session and toolbox」里
  `temporary/file-transfer` 超时失败的真实原因（不是环境抖动：同一天 main 连续两次失败，
  且失败状态里就是这条 restored 文案）。
- 修复：`restoreQueue()` 只在 owner 真正变化时才采用持久化队列（新增纯函数
  `shouldAdoptStoredQueue`）；同一 owner 时以内存队列（含正在上传的 File 句柄）为准。
  owner 变化时先取消上一 owner 的在途上传，避免旧会话分片被记到新账户。
- Regression：`local-backend/test_transfer_isolation_js.mjs` 新增 5 条断言（同一 owner 不得
  重新采用、guest 同理、真实切换必须采用、首次加载必须采用）。
- 追加（发布可达性）：Web 资源令牌 `20260912-screenshot-r1` → `20260912-task24-3-r1`。
  Service Worker 对同源静态资源是 URL 级 cache-first，不 bump 令牌则 T24.3-01/02 与本条
  JS 修复永远不会到达老用户；同步更新 `test_static.py` 断言与 SW 缓存名。
- Commit：`3fcaed5`。

## 收口记录（自动化部分，2026-09-12）

- PR：#62（`main` ← `codex/task24-3-post-release-r1`）。PR CI 6/6 全绿：Python syntax and
  unittest、JavaScript and static site checks、Sensitive files and static naming、
  Android unit/lint/APK、Cloud-only browser (canonical session and toolbox)、
  Browser flow (application)。
- Merge：`bf8cdd2b1966fd4ad0ef42623313ffb6e0349367`（merge commit）。
- main CI（merge commit `bf8cdd2`）：6/6 全绿，包含此前连续失败的 Cloud-only browser 作业。
  该作业失败根因不是环境抖动，而是 T24.3-07（传输页重新进入把在途上传恢复成 needsFile）；
  修复后 main 与 PR 两条流水线均通过。
- Production 部署：`8ffabb70-ec4a-4c3b-a0fd-f366cf38851d`（source `bf8cdd2`，Cloudflare
  Pages Git 集成自动部署，无需手动 `wrangler pages deploy`）。
- Production smoke（正式环境，全部非破坏性）：
  - `/api/app/config`：`1.3.0 / 13`，APK SHA `8a24e779…`，47,578,521 bytes（未变）。
  - APK 下载实测：47,578,521 bytes，SHA-256 == config（本地重新计算，与 1.3.0 一致）。
  - `/api/status?source=cloud`：`cloud_only=true`、`legacy_api_fallback=false`、D1/R2
    binding=true。
  - `/api/notification/hints` 未认证：HTTP 401。
  - 新资源令牌在线：`/js/transfer/app.js?v=20260912-task24-3-r1` 含 `shouldAdoptStoredQueue`；
    `/sw.js` 缓存名为 `wyj-shell-20260912-task24-3-r1-es-modules`。
- Production D1 只读审计（未做任何写入）：active users 10、live sessions 5、payment orders 33、
  active memberships 8、finance transactions 12、pending hints 1 / ignored hints 3、
  admin roles 0；`task16_finance_transactions` 无空 user_id；非终止订单无 QR 缺失
  （3 条无 QR 订单均为 LEGACY- 或已终止）；迁移已应用到 `0021_notification_pending_hints`。
- 本地验证：JS 非浏览器套件 30/31（`test_transfer_responsive.mjs` 需要浏览器测试管理员密钥，
  CI 不运行该文件）；`test_static.py` 31 OK；ES module graph / storage contract 通过；
  Android `:app:testDebugUnitTest` 全量 BUILD SUCCESSFUL；本机遗留 Python 套件 126/127
  （`test_pdf_export_handles_parallel_requests` 在 Windows 出现 WinError 10053 socket reset，
  与代码无关，CI Ubuntu 为准）。
- 未做：版本号/APK 发布（仍为 1.3.0 / versionCode 13）、D1 破坏性操作、Production 数据写入。

## 审计队列状态（内部继续用）

- 本轮已复核：通知/无障碍权限状态与 PermissionCenter 能力比对（T24.3-04）、文件传输上传队列
  跨账户隔离（T24.3-01）、capability 离线语音回退误报（T24.3-02）、服务端自动入账终态断层
  （T24.3-03）、文件传输所有权/支付二维码映射/管理员站内消息 XSS/Android 长期凭据/Finance
  本地队列/孤儿 multipart/Session 生命周期（均 NO ISSUE FOUND）、Admin/owner 越权矩阵
  （`requireAdminTarget`/`targetAccount`/`setAdminRole` 全链路保护，NO ISSUE FOUND）、
  entitlement 叠加与过期（懒过期 + 按 priority 取顶 + 权益并集 + override，NO ISSUE FOUND）、
  WebView 导航与会话桥（scheme/SPA 白名单、cookie 作用域与 15 分钟上限、外部跳转仅
  https/mailto/tel、文件选择器仅 content://、下载仅站内，NO ISSUE FOUND）、App update
  （T24.3-05）。
- 待继续：TTS/OCR 回归、Security（CSRF/secret/logging）、UI/UX、Performance/后台资源、
  Production D1/R2 只读审计；全部自动工作完成后走全量测试 → Android release build →
  PR → CI → merge → main CI → Production → smoke → WAITING FOR DEVICE ACCEPTANCE。

（更新：以上待继续项已全部复核；Security（同源/CSRF、密钥、日志）、TTS/OCR、UI/UX、
Performance/后台、Production D1 只读审计均 NO ISSUE FOUND，唯一发现并修复的是 T24.3-06/07。
自动化链路已按 PR → CI → merge → main CI → Production → smoke 走完，见下方收口记录。
剩余仅为真机验收，矩阵见 `docs/TASK24_3_DEVICE_ACCEPTANCE.md`。）

## NO ISSUE FOUND（已核实）

- 文件传输所有权/IDOR：`owner_kind + owner_ref` 强校验，`requireOwnedSession` 归属比对。
- 支付二维码映射：`qrResourceIdFor` 强校验，不匹配 409 `payment_qr_mismatch`，无 fallback。
- 管理员站内消息 XSS：全部字段 `escapeHtml`。
- Android 长期凭据：KeyStore 加密，失败抛错，无明文回退。
- Finance 本地队列：按 accountId 分键，账户切换清渲染状态。
- 孤儿 multipart：`abortUploadSession` + owner 触发 `cleanupExpiredTransfers(scan_orphans)`。
- Session 生命周期：digest 查询，deleted/banned/revoked/generation/expiry 全判，滑动续期仅对未撤销会话。

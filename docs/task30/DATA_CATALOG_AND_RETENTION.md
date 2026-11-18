# Task30 统一隐私数据目录与留存策略 (`DATA_CATALOG_AND_RETENTION`)

服务端权威目录定义于 `functions/_lib/task30-privacy-catalog.mjs`（`TASK30_CATALOG_VERSION = '2026-11-18-v1'`，政策基线 `TASK30_PRIVACY_POLICY_BASELINE = '2026-11-16-v1'`），通过 `GET /api/privacy/v1/catalog` 与 `GET /api/privacy/v1/overview` 向登录用户输出真实可核验的分类元数据。

> 核心原则：**拒绝虚构全站统一的固定 TTL**；每类数据的留存策略严格以现有真实表结构、Cleanup Worker 实现与已发布政策为准。

---

## 1. 八大数据类别与完整控制矩阵

每个类别均完整包含以下 11 项控制元数据字段：
`storage_locations` · `residency` · `owner` · `purpose` · `retention_policy` · `self_service_erasable` · `has_access_grants` · `retention_exceptions` · `immediate_invalidation_guarantee` · `cleanup_completion_criteria` · `present_in_user_backup`

| 类别 Key | 名称 | 驻留位置 (`residency`) | 真实留存政策 | 存在访问授权 | 明确留存例外 | 出现在 Task29 备份中 |
|---|---|---|---|---|---|---|
| `account_security` | 账户资料、安全会话与授权 | `hybrid_cloud_and_device` | 账号存续期间保留；挑战凭据与已过期会话到期清理；注销后立即全量撤销 | 是 | 最小必要安全/登录审计（移除明文哈希与秘密凭据）；站点管理员角色保护触发器 | `false` |
| `finance` | 财务账目、分类与预算 | `hybrid_cloud_and_device` | 账户存续期间按用户意愿长期保留；支持随时按类别彻底清除云端记录并写墓碑 | 是 | 付费会员订单（`task13_payment_orders`）；去标识化防复活墓碑与递增同步游标 | `true`（仅本人离线持有 `.wyjbackup`） |
| `notifications_cloud` | 云端支付通知、识别候选与审核 | `hybrid_cloud_and_device` | 云端支持随时撤销同步与一键清空；Android 本机 Room 遵循设备端设置（`7/30/90/365/0` 天，星标免自动清理） | 是 | Android 本机 Room 通知历史不受网页端远程擦除影响 | `true`（结构化支付事件、候选与线索） |
| `files` | 私有文件、分片上传与访问授权 | `cloud_d1_r2` | 按分享/文件过期窗口（`expires_at`）或主动撤销后过期；Cleanup 周期性物理清除 R2 对象与分片 | 是 | `Cache-Control: private, no-store` 与实时 D1 授权校验，R2 故障转异步重试 | `false` |
| `temporary` | 临时文本、剪贴板、房间消息与短时分享 | `cloud_d1_r2` | 默认遵循创建时设定的过期窗口（`expires_at`），到期清理并支持随时主动全部撤销/删除 | 是 | 无额外法务留存例外（匿名无归属分享不列入个人账号名下） | `false` |
| `backups` | Task29 加密备份与恢复作业记录 | `hybrid_cloud_and_device` | 未提交的恢复预检暂存计划按 `expires_at` 到期清理；导出/恢复记录支持按分类清空 | 否 | 用户自持的本地 `*.wyjbackup` 加密文件不由服务端远程删除，但受防复活墓碑拦截 | `false`（仅云端作业元数据） |
| `support` | 客服工单、邮件投递与反馈记录 | `cloud_d1` | `email_center_inbound_threads` 默认 180 天（`retention_expires_at`）；反馈与投票支持自删 | 否 | 180 天内支持邮件线索与发信投递审计；会员支付订单与权益对账 | `false` |
| `learning` | 学习档案、错题复习与云端缓存 | `hybrid_cloud_and_device` | 学习档案长期留存；`task15_quiz_sessions`（2 小时）与 `task15_ai_cache`（7 天）按期清理；支持一键清空 | 是 | 无额外留存例外 | `false` |

---

## 2. 可选同意与授权项 (`CONSENT_DEFINITIONS`)

「隐私与数据管理 → 授权和同意」严格区分 **网站可选处理授权**、**Android 设备系统权限声明** 与 **账号运行必需处理**：

1. **`finance_ai_assistance`**（默认 `false`）：双向同步 `finance_ai_consents` 与 `task30_user_consents`。撤回后立即停止财务 AI 推理调用，并将未决建议标记为 `invalidated`，已入账流水不受影响。
2. **`cloud_notification_sync`**（默认 `true`）：在 `functions/_lib/task21-service.mjs` 与 `functions/_lib/task21-hints.mjs` 写入入口强校验。撤回后立即拦截 `/api/notification/*` 与待确认线索新上传/写入；页面明确提示 **不能** 替代 Android 手机系统设置关闭。
3. **`learning_ai_explanation`**（默认 `true`）：撤回后停止新的个人 AI 练习解析缓存，保留基础练习与手动错题复习能力。
4. **`active_shares_and_grants`**：一键批量吊销名下有效 `task14_shares` / `task14_download_grants`、`task22_shares` / `task22_download_grants` 及 `task22_upload_sessions`。

---

## 3. 到期清理机制 (`runPrivacyRetentionCleanup`)

- 入口：`POST /api/privacy/v1/cleanup/run`（由 `authorizeFileMaintenance` 维护秘钥或超级管理员触发，并记录于 `task30_cleanup_runs`）。
- 单次综合执行覆盖：
  1. 复用 Task28 `secure-file-cleanup.mjs`（R2 私有对象及超时/取消分片清理）。
  2. 复用 Task14 `cleanupExpiredShares`（过期临时文本/剪贴板/房间/文件）。
  3. 复用 Task29 过期恢复暂存计划清理。
  4. 清理过期的 `task12_sessions`、`task20_device_sessions`、`task27_challenges`、`task15_quiz_sessions`、`task15_ai_cache` 及到期 `email_center_inbound_threads`（`retention_expires_at` 到期线程与关联 `email_center_inbound_messages`）。
  5. 重放处于 `retry_pending` 队列中且到达重试时间的 `task30_erasure_requests`。

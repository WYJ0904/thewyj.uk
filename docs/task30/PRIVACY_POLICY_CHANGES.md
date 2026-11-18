# Task30 隐私政策版本与文案更新说明 (`PRIVACY_POLICY_CHANGES`)

## 1. 政策版本控制策略（不擅自强制触发重签）

- **当前线上激活基线（保持稳定）**：`2026-11-16-v1`（`docs/task27/policies/privacy-2026-11-16-v1.md`），`functions/_lib/task27-policy.mjs` 中现行生效版本保持为 `2026-11-16-v1`，因此不会意外强制全量老用户重新弹窗签署隐私政策或阻塞现有业务访问。
- **Task30 正式归档修订版**：`2026-11-18-v1`（`docs/task27/policies/privacy-2026-11-18-v1.md`），已在 `functions/_lib/task27-policy-archive.mjs` 注册归档。可通过 `GET /privacy?version=2026-11-18-v1` 访问（已通过 `test:task30:runtime` 与 HTTPS Preview 实测 HTTP 200 返回完整文本）。

---

## 2. 本次修订补充的核心合同条款

1. **统一 8 类数据可见性与真实留存机制**：
   - 如实写明个人账本、结构化通知、私有文件（R2）、临时分享（按过期窗口）、Task29 备份作业元数据、支持线程（`email_center_inbound_threads` 默认 180 天 `retention_expires_at`）及学习档案（测验会话 2 小时、AI 缓存 7 天）的各自留存边界，不虚构统一固定 TTL。
2. **可选处理授权与设备边界澄清**：
   - 写明网页端撤回 **财务 AI 辅助核实**、**云端结构化通知识别同步**、**学习 AI 解析缓存**、**有效分享与下载授权** 的即时生效范围。
   - 明确声明网页端操作不能关闭 Android 手机系统权限（`NotificationListenerService` / `AccessibilityService`）或远程擦除本机 Room 数据库（本地留存支持 `7/30/90/365` 天或 `0`=永久，兼容 `1/3` 天，星标免自动清理）。
3. **安全删除状态机与防复活保护**：
   - 公开说明 `requested → verified → access_revoked → cleanup_pending → completed` 流程、`retry_pending / partially_completed / blocked_by_retention` 异常处理含义，以及永久去标识化墓碑（`task30_erasure_tombstones`）防止旧设备或旧 `.wyjbackup` 备份复活已删记录的机制。
4. **合规/安全与订单保留例外透明度**：
   - 明确披露 180 天内入站支持邮件线程、会员支付订单（`task13_payment_orders`）、最小必要登录安全审计与管理员防自删保护触发器边界。

---

## 3. 前端引导文案更新 (`index.html`)

- 在 `#account` 账户中心与安全中心接入 `#accountPrivacyOpen`（`[data-security-privacy]`）「隐私与数据管理」入口。
- 更新 `#deleteAccountModal` 注销确认文案，引导用户在彻底注销前可打开「隐私与数据管理」查看 8 类数据全景、撤销可选同意或按类别安全清理，并说明会员订单与最小安全审计例外。

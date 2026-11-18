# Task30 安全删除状态机、权限校验与幂等并发 (`STATE_MACHINE_AND_SECURITY`)

## 1. 安全删除状态机生命周期

迁移 `0040_task30_privacy_retention_erasure.sql` 通过 `task30_erasure_requests` 与 `task30_erasure_tasks` 实现可追踪、幂等且先断流后清理的状态机：

```text
preview ──(用户取消)──▶ cancelled
   │
   ▼ (commit + 准确确认口令 + Step-up grant)
verified ──▶ access_revoked ──▶ cleanup_pending ──▶ completed
                                       │
                                       ├──(R2 对象/MPU 清理暂败)──▶ retry_pending ──(重试成功)──▶ completed
                                       ├──(同时存在可删项与法务/订单例外)──▶ partially_completed
                                       ├──(仅存明确留存例外保护记录)──▶ blocked_by_retention
                                       └──(不可恢复错误)──▶ failed
```

### 核心安全不变量：先失效、后物理清理

1. **立即失效优先 (`access_revoked_at`)**：
   - 删除一经核验提交，在同一控制阶段先行撤销全部下载授权（`task14_download_grants`、`task22_download_grants`）、废除分享状态（`deleted` / `revoked`）、终止上传会话、清空聊天文本/财务/云端通知主业务表并递增 `session_version`（账号注销场景）。
   - 即使后续 R2 物理删包发生网络超时或手动注入故障（测试参数 `simulate_r2_failure` 仅限非 Production 环境开启），主业务接口与旧下载/分享 URL 也已立即不可访问，不会出现在清理期间“仍能下载已提交删除文件”的窗口。
2. **故障可追溯不丢审计**：
   - 未完成的 R2 删除或分片中止作为明细任务保留在 `task30_erasure_tasks` 中，主请求标记为 `retry_pending` 并允许用户或定时清理任务通过 `POST /api/privacy/v1/erasure/retry` 或 `POST /api/privacy/v1/cleanup/run` 续跑直至 `completed`。
   - 每次同意撤回、预览、提交、重试与账号注销均写入最小化审计表 `task30_privacy_audit`（自动剥离 `secret`、`password`、`token`、`content_text`、`message_text` 等敏感键）。

---

## 2. 认证、授权、Step-up 与账户隔离

在 `functions/_lib/task30-privacy-api.mjs` 与 `functions/_lib/task27-auth.mjs` 中落地：

1. **会话与身份隔离**：
   - 所有 `/api/privacy/v1/*` 接口（除需维护授权的 `cleanup/run`）必须通过 `resolveTask12Account(context)` 认证。
   - **严格忽略或拦截伪造的归属标识**：若请求体传入 `user_id`、`account_id` 或 `target_user_id` 且与 `account.id` 不一致，立即返回 HTTP `403`（`cross_account_privacy_forbidden`）；**即使调用方是站点管理员也禁止替普通用户提交数据删除或查阅私有记录**。
2. **CSRF / 同源与限流**：
   - 所有 `POST` 请求强制执行 `sameOriginResult(context.request)` 校验、`application/json` `Content-Type` 限制、有界流式请求体读取（防超大 payload）及基于 D1 `enforceD1RateLimit` 的分路由频控。
3. **高风险操作绑定 Task27 Step-up**：
   - 扩展 `functions/_lib/task27-auth.mjs` 允许列表：
     - `privacy_consent_revoke`（可选同意/分享撤回）
     - `privacy_data_delete`（及带范围后缀 `privacy_data_delete:<sorted_categories>`）
     - `privacy_account_delete`（并兼容 `/api/account/delete` 接收 `account_delete` 或 `privacy_account_delete`）
   - Step-up grant 绑定当前用户与当前登录会话代际、单次消费，不可重放或跨分类复用。
4. **不可逆二步预检 + 精确确认口令**：
   - 提交分类删除前需先调用 `POST /api/privacy/v1/erasure/preview` 获取受影响记录数、待清理 R2/分片数、业务影响摘要、留存例外说明以及精确确认字符串（例如 `DELETE FINANCE`、`DELETE TEMPORARY` 或全局注销 `DELETE ACCOUNT`）。
5. **管理员关闭保护**：
   - `task18_admin_roles` 活跃管理员或超级管理员在 `preview` 与 `commit` 阶段均被显式阻止自助注销账户（`admin_account_protected` / `403`）。

---

## 3. 幂等性与并发冲突防护

1. **请求级幂等键 (`idx_task30_requests_user_idempotency`)**：
   - `UNIQUE (user_id, idempotency_key)` 保证用户双端连击、网络超时重试或并发提交同一 `idempotency_key` 时不会重复删库、不会状态倒退（如已进入 `completed` 或 `retry_pending` 不会退回 `verified`），直接幂等返回已有请求结果。
2. **状态机单向收口**：
   - 仅允许对状态处于 `preview` / `requested` 的未提交预检执行 `cancel`；已进入 `access_revoked` / `cleanup_pending` / `completed` 的不可逆删除拒绝取消。
   - `retry` 仅重放 `task30_erasure_tasks` 中未完成项，已 `completed` 的 R2/D1 任务不会重复执行物理删除。

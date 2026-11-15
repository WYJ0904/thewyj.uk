# Task28 统一安全文件服务 v1

入口：`functions/_lib/secure-file-service.mjs` 的 `secureFilesV1`。
这是 Task14/22 的适配和安全策略层，不是新的账户、会员或存储计费系统。
调用者必须先通过 Task12/20/27 的真实会话认证；`account` 是可信服务端结果，
不能使用请求体构造。所有句柄只含不透明 ID，不含 R2 Key 或 upload ID。

## 新附件调用

1. `initializeAttachment(context, account, {file_name, mime_type, size_bytes,
   minutes?, max_downloads?, idempotency_key?})` 创建仅所有者可访问的附件上传。
   `idempotency_key` 为 16～80 位字母、数字、下划线或连字符，按所有者隔离。
   相同参数重试复用同一会话/文件；冲突返回 `409 file_idempotency_conflict`，
   不取消原任务。初始化、存储预留和每日创建计数在同一 D1 batch 提交。
2. 返回 `session_id`、`file_id`、分片计划及原 Task22 的 part/status/complete/cancel URL。
   继续使用原分片编号、`Content-Length`、可选 `X-Part-Sha256` 和续传状态。
   也可调用适配器的 `uploadPart`、`resume`、`complete` 方法。
3. `metadata(context, account, {source:'transfer', file_id})` 读取所有者元数据。
4. `authorize(context, account, {source:'transfer', file_id, password?})` 发放
   **指定文件**的限时 bearer 凭证；返回原 Task22 下载 URL，可供 Web/Android
   Range 下载。持有管理员角色不会获得其他所有者的附件权限。
5. `revoke(context, account, {source:'transfer', file_id})` 撤销附件所在上传批次，
   立即撤销全部旧 grant；物理清理由已有机制有界重试。v1 初始化固定为单附件，
   不提供从原多文件分享中拆除单个逻辑引用的业务能力。

历史 Task14 文件可通过 `source:'temporary'` 的 metadata/authorize/revoke 适配；
原分享的密码、次数和到期限制仍然有效。新私有附件统一使用原 Task22 配额，
不会再向 Task14 计费。Task14 既有用户/全局配额和触发器保留原口径。

## HTTP

| 接口 | 权限与用途 |
| --- | --- |
| `POST /api/files/v1/uploads` | 账户登录；初始化单个私有附件，参数同上 |
| `GET /api/files/v1/attachments/:file_id` | 仅所有者；元数据 |
| `POST /api/files/v1/attachments/:file_id/authorize` | 仅所有者；JSON 仅接受可选 password |
| `POST /api/files/v1/attachments/:file_id/revoke` | 仅所有者；空 JSON |

原 `/api/temporary/*`、`/api/share/*` 和 `/api/transfer/*` 均保留。
Task22 初始化可选新增 `access_scope:'private'`（仅账户）和 `idempotency_key`；
不传时仍为原公开分享合同。访客仍使用原 guest ID/密码/分享凭证，不要求登录。
私有 Task22 分享在旧 metadata/authorize 路由中同样执行所有者检查，不能旁路。

私有分享通过原 authorize 接口访问时必须指定 `file_id`。公开分享可继续使用
原整个分享的授权，以保留多文件下载和 Android WebView 到原生下载器的交接。
下载凭证完成后在 TTL 内允许正常重试/Range；跨文件、到期、撤销后的重放拒绝。
TTL 保持 Task14 15 分钟、Task22 30 分钟，且不超过文件到期时间。

交互式 Task14 导入/回滚/清理与 Task22 清理在 Task27 就绪时要求
`X-Aeris-Stepup`，scope 为 `files_cleanup`。沿用 Task27 的会话、版本、到期
和一次性消费合同；继续保留 Task18 管理审计。cron 沿用既有服务绑定权限。

## 验证及响应语义

| 字段 | 含义 |
| --- | --- |
| `validation_status=header_verified` | 支持类型的真实文件头已核对，不代表完整解码或病毒扫描 |
| `content_verified` | 完整文本已分块校验编码；≤1 MiB 完整 JSON 的语法也已检查 |
| `download_only` | 无可靠识别器或活动内容；允许普通二进制传输，仅安全下载 |
| `legacy_unverified` | 历史记录没有新验证证据，不补写虚构证明 |
| `integrity_status=partial_parts_verified` | 上传中，已校验首个分片，尚未完成所有分片 |
| `parts_verified` | 完成前全部分片按实际字节校验，不等于完整文件 SHA-256 |
| `full_sha256_verified` | 单个已验证分片覆盖完整文件，完整文件 SHA-256 已验证 |

JSON 的结构解析限制为 1 MiB，避免对象图展开造成内存放大；更大的完整 JSON
校验文本编码后仅安全下载，不宣称语法已验证。长文本编码按 64 KiB 块检查，
不创建与整个文件等大的文本字符串；多分片类型只声明头部验证。

仅 `full_sha256_verified` 返回 `sha256_hex`；多分片和历史文件返回空字符串。
不得把它们升级为 Task29 的完整备份/恢复验证证明。

每个上传请求最多缓冲服务器计划中的一个分片（硬上限 32 MiB，正常大文件
分片 16 MiB）。实际大小先核对，客户端哈希与服务端 Web Crypto 结果比较后
才写入 R2。完成时检查连续分片、大小、ETag、最终对象大小/所有权和文件头。
下载沿用原单 R2 对象原生流；历史独立分片继续支持范围拼接，不读取 GB 文件
到一个 ArrayBuffer。不同内容不能覆盖已预留的分片摘要。

所有文件以 attachment 下载，附带 nosniff、sandbox、no-store、no-transform
和 no-referrer。HTML/SVG/未知二进制使用 application/octet-stream。
声明 MIME 仍保留在原元数据中；下载 MIME 来自验证结果。未知格式的 MIME
收紧不改变原字节、文件名、扩展名、大小、Range 或原分享 URL。

典型错误：无权访问 `404 file_not_found`；容量不足
`413 transfer_storage_quota_exceeded`；日创建上限 `429 transfer_daily_quota_exceeded`；
实际哈希不符 `400 transfer_part_hash_mismatch`；文件头不符
`400 file_signature_invalid`；正在完成 `409 transfer_finalize_in_progress`
（可重试）；过期/撤销 grant 为 `403 transfer_download_grant_invalid`。
JSON/文件请求均先有界读取；响应不包含内部路径和凭据，错误不安全缓存被禁止。
审计副本使用有界读取；超限时不等待 tee 单分支 cancel，避免请求和审计互等。
此取消语义依据 [Streams tee 合同](https://streams.spec.whatwg.org/#readable-stream-default-tee)。

客户端账户应用后通知文件控制器。退出及跨窗口凭据变化立即清除私有卡片、
列表、配额视图和内存授权；身份尚未确认时暂停读取。私有授权缓存含所有者维度，
迟到的上传完成、续传或授权结果必须丢弃，不能转交给另一个账户。

## 生命周期与清理

原表仍是权威：上传 session 的 active（分配/上传中）→ finalize_token 校验锁
→ published；取消/到期转 aborted/expired，配合 cleanup_state pending/complete。
已发布 share 的 active → revoked/delete_pending → deleted（保留最小墓碑）。
Task14 沿用 uploading/active/failed/delete_pending 和原物理删除合同，审计独立保留。
时间到期即拒绝授权，不等待物理清理；非法跳转不会发布文件或删除已发布对象。

两个原 cron 不变。每阶段最多选取 500 行，默认每轮最多 40 个 R2 操作，内部
可设 1～80。文件/MPU 清理进度在原 session/share 行保存，大批次能从上次位置
继续。grant 和孤立引用清理也有 LIMIT；重试不能把部分失败记为已清理。
扫描游标保存在原 metadata 表，只处理精确规范前缀：

- `temporary/v1/<环境>/files/<ID>[/<上传尝试ID>]`，无引用且至少 1 小时。
- `transfers/v2/<环境>/objects/<ID>/file` 或 `files/<ID>/part-N`，无引用且至少 24 小时。

异环境、非规范名字、仍被引用的对象保留。不会扫描桶中其他前缀，不迁移旧对象。
Task28 文件审计仅保存 ID、动作、结果和时间，90 天后有界裁剪，不保存文件名、
正文、分享密码、grant、R2 Key 或财务内容。

`task28_multipart_cleanup` 是失败清理日志，不是第二套文件/配额权限表。
R2 创建前先记录意图；已知 upload ID 的失败回滚由原 Task22 cron 重试，只 abort
对应 MPU，绝不按同 Key 删除另一个成功上传。若 R2 创建响应丢失且没有得到
upload ID，记录保持 `create_unknown`，计入 `multipart_unknown_pending`，不得标为
已清理。R2 binding 没有枚举未完成 MPU 的接口；此类记录需在单独获授权的环境
通过官方 R2/S3 管理面核对，不猜测 upload ID，也不自动扩大权限。

参考：[R2 Worker API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)、
[D1 batch 合同](https://developers.cloudflare.com/d1/worker-api/d1-database/)。

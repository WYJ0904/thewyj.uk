# Task29 导出、预检与恢复接口契约 (`/api/backup/v1/*`)

所有接口均强制同源策略（写操作校验 `Origin`）、通过 `resolveTask12Account` 校验有效登录会话（绝不信任客户端传入 `user_id`/`owner_id`）、执行 D1 滑动窗口限流并附带 `Cache-Control: private, no-store`。

| 方法与路径 | 鉴权与保护 | 功能说明 |
| :--- | :--- | :--- |
| `GET /api/backup/v1/scopes` | Session + RateLimit (`60/60s`) | 返回三大作用域实测计数、`privacy_declaration`、恢复限制说明及近期导出/作业审计摘要。 |
| `POST /api/backup/v1/export` | Session + Same-Origin + RateLimit (`20/300s`) | 生成并发一致快照导出。`format` 支持 `encrypted`（需 10–256 位 `passphrase`）、`json`（含完整性清单与 `account_binding`）及 `csv`（UTF-8 BOM、公式注入前缀 `' ` 转义、BigInt 整数精度格式化、`restorable: false`）。严禁将明文 JSON/CSV 写入 R2。 |
| `POST /api/backup/v1/precheck` | Session + Same-Origin + RateLimit (`20/300s`) + 16 MiB 有界读取 | **严格只读模拟预检**。校验格式/大小 -> 容器解密与 AAD -> 清单摘要 -> `schema_version` -> 账户归属 (`BACKUP_ACCOUNT_MISMATCH`) -> 隐私边界 (`BACKUP_PRIVACY_BOUNDARY_VIOLATION`) -> P03–P06 不变量与跨节外键 -> 生成 `added` / `skipped_identical` / `conflicts` / `rejected` 差异预览，并按需创建 30 分钟有效 `prechecked` 作业。 |
| `POST /api/backup/v1/restore/jobs` | 同上 | 为明确构建恢复作业提供资源风格别名入口（等价于 `precheck` `create_job: true`）。 |
| `GET /api/backup/v1/restore/jobs/:job_id` | Session + Owner Binding | 查询当前账户名下恢复作业状态、批次进度、差异预览与结果/回滚诊断。 |
| `POST /api/backup/v1/restore/jobs/:job_id/commit` | Session + Same-Origin + **Task27 Step-up Grant (`backup_restore` 或 `backup_restore:<job_id>`)** | 在核验一次性 Step-up 授权后，分批幂等提交新增项，不覆盖现有冲突项，更新 `task16_finance_user_versions` 与 `task16_finance_changes`。相同作业或重复恢复返回 `idempotent_replay: true`。 |
| `POST /api/backup/v1/restore/jobs/:job_id/cancel` | Session + Same-Origin + Owner Binding | 取消处于 `prechecked` / `confirmed` 状态的作业，阻止后续提交 (`409 BACKUP_JOB_CANCELLED`)。 |

## CSV 安全导出格式说明

- 列结构包含 `record_section`, `record_id`, `status`, `direction`, `currency`, `amount_minor`, `signed_amount_minor`, `amount_exponent`, `amount_display`, `occurred_at_iso`, `occurred_at_ms`, `merchant`, `counterparty`, `category_id` 等。
- **防公式注入**：所有文本单元若以空白+`=`、`+`、`-`、`@`、`\t`、`\r`、`|` 开头，统一添加前导 `'` 后按 RFC 4180 引号转义。
- **金额无损精度**：`amount_display` 使用 `BigInt` 与整型取余格式化，支持至 `Number.MAX_SAFE_INTEGER`（如 `9007199254740991` -> `90071992547409.91`）无浮点误差。

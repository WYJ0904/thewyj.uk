# P0 AI 专用 D1 QA Worker（代码交接，未部署）

该 Worker 用真实 D1 binding 调用产品 `financeAiRequest()`，AI 是函数内的内存 mock。
它不提供任意 SQL、真实模型入口或 Pages API 路由。由主任务审查并负责远端执行；
本代码交接不操作云端，不修改仓库根目录的正式 Wrangler 配置。

先本地复验：为 `AERIS_P0_AI_LABEL` 选择未用的 `rN`，运行
`node qa/p0-ai/remote-worker-local.mjs`。输出目录禁止覆盖。
驱动实际启动 workerd，验证认证、缺失/错误数据库标记、五个场景及合成记录清理。
本地 `remote-worker-local-r2` 为 **9 PASS / 0 FAIL**，证据在
`docs/migration-evidence/p0-ai/remote-worker-local-r2/`。初次 r1 的合成 username
超过既有 40 字符限制，得到 4 PASS / 5 FAIL；已将显示用户名限定为 40 字符，
完整随机用户 ID 和 normalized 名保持独立，原失败保留。未修改产品账号合同。

## 独立配置合同

仅在 `qa/p0-ai/` 内创建专用 Wrangler 配置，主任务自行核对数据库名称和 ID：

| 项目 | 值 |
| --- | --- |
| Worker main | `remote-worker.mjs`（相对专用配置文件） |
| compatibility_date | `2026-08-06`，与本轮产品 fixture 一致 |
| 唯一 D1 binding | `QA_DB`，仅下述两个专用 QA ID 之一 |
| `P0_AI_QA_MODE` | `isolated-synthetic-only` |
| `P0_AI_QA_DATABASE_ID` | 与实际 QA_DB 完全相同的专用 ID |
| `P0_AI_QA_TOKEN` | 用独立随机 32 bytes 生成至少 43 字符 base64url，作为 Worker secret |

允许的专用数据库仅为本次主任务已分配的
`08ced2a0-6f77-4550-a34e-2b20fd7119db` 和
`43285c83-06f1-479f-a381-bf37fd26ddb2`。
不要添加 AI、WYJ_DB、R2、Pages 正式/共享 binding，也不要复用真实 Cookie 或账号。
Token 不放进配置、Git、命令行、报告或日志；认证使用长度检查和 timingSafeEqual。

在主任务确认的专用 QA 数据库上，另建如下标记。不要在正式/共享数据库创建：

```sql
CREATE TABLE p0_ai_qa_environment (
  environment_key TEXT PRIMARY KEY,
  database_id TEXT NOT NULL
);
INSERT INTO p0_ai_qa_environment(environment_key,database_id)
VALUES('aeris-p0-ai-isolated-only','<已核对的专用QA数据库ID>');
```

代码同时核查 mode、数据库 ID allowlist、实际数据库内的标记，以及没有 AI/
WYJ_DB binding。标记缺失或不匹配时先返回 503，不创建账号、不迁移任何表。
四张 P06 表和 CHECK 必须已经按正式迁移建立；本 Worker 不修补业务 schema。
临时故障场景仅创建一个按本次随机名字命名、只匹配本次合成用户的 trigger，
随后删除它；部署者需要为固定场景提供足够的 D1 查询配额。

## 固定验收入口

每次只运行一个场景：`POST /run/<case>`，请求头为 `Authorization: Bearer <secret>`。
不需要请求体。不通过认证的请求返回 401。

| case | 验证 |
| --- | --- |
| `quota` | 最后一个桶满时前面三桶回滚；零调用/零次数；恢复后一次调用并复用缓存 |
| `concurrent-month` | 五事件竞争两次月额度；只有两次调用，四桶均恰好为 2 |
| `event-cap` | 同一事件四模型版本竞争；总次数和四桶仍为 2 |
| `late-storage-fault` | 第五 statement 的受控 trigger 故障；四桶回滚；异常文本含 quota 词但不被误分类/泄露 |
| `retry-lease` | 一分钟前的零调用拒绝恢复后，新运行 lease 不被并发读取误超时；原创建时间保留 |

每个请求生成独立 `synthetic-p0-ai-<uuid>` 用户、事件和 budget period 前缀。
适配器只给 period 绑定参数加前缀；产品 SQL 和 `D1Database.batch()` 不改写，
每个 run 的 global 桶互不影响，原预算 period 不会被读写。

完成后只清理本次 period 前缀、精确本次用户（通过已有 FK 级联）和本次 trigger。
返回值只有场景、合成前缀、断言摘要、mock 调用数、真实模型调用 0 和清理结果。
发生未知 D1 错误不会返回异常原文。若 `cleanup_complete=false`，保留报告中的唯一
合成前缀，由主任务在核对同一个专用 QA ID 后审计处理，不自动重跑整组。

本地通过不代表远端通过。远端需保存 exact-head/部署 ID/实际数据库 ID、每个
请求的原始 JSON、清理结果，并继续区分 D1 引擎验收与真实模型质量。
结束后由主任务移除临时 QA Worker/secret；没有正式 AI 启用或发布授权。

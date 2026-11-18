# Task29 恢复作业状态机、冲突控制与失败补偿回滚设计

## 1. 作业状态机 (`task29_restore_jobs`)

```text
  [上传备份] ──(precheck 只读仿真)──▶ prechecked ──(过期 30m)──▶ [拒绝 commit: 410]
                                        │    │
                       (用户取消 cancel)┘    └──(Step-up 核验成功 + 确认提交)──▶ applying
                             ▼                                                     │
                         cancelled                                  ┌──────────────┴──────────────┐
                                                             (全部批次成功)                 (写入异常/并发冲突)
                                                                    ▼                             ▼
                                                                completed                    rolled_back
```

- **`staged_plan_json` 隐私数据保留与自动清理 (`pruneExpiredRestoreJobs`)**：
  1. 作业一旦进入终态（`completed`、`cancelled`、`rolled_back`、`failed`），服务端在同一次数据库更新中立即将 `staged_plan_json` 置空为 `'[]'`，避免敏感待恢复结构化账目在恢复完成后继续滞留。
  2. 所有入口接口（`getBackupOverview`、`precheckBackupRestore`、`commitRestoreJob`、`getRestoreJob`、`cancelRestoreJob`）均调用 `pruneExpiredRestoreJobs(db)`，对所有已过期的 `prechecked` / `confirmed` 作业（`expires_at <= now`）及任何残余终态作业置空 `staged_plan_json = '[]'`。
  3. **不误删正在执行作业**：清理语句严格限定 `WHERE state != 'applying'`，绝不影响正在写入或尚待故障排查的 `applying` 作业；同时也保留 `precheck_summary_json`、`result_summary_json`、`applied_log_json` 与作业主记录以保障幂等、审计与 `410 BACKUP_JOB_EXPIRED` 状态返回。
- **冲突处理策略 (`conflict_policy`)**：
  - 默认 `skip_identical_reject_conflict`：完全一致记录幂等跳过，发现主键或自然键（`source_event_id`, `provider_reference`, `candidate.event_id`, `pending_hints.source_event_id`）对应字段不一致即阻断提交 (`can_restore = false`, `409 BACKUP_PRECHECK_BLOCKED`)，绝不静默覆盖既有账目。
  - 可选 `skip_all_existing`：仍绝不覆盖既有冲突记录，仅将冲突记录标记跳过后恢复其余干净新增记录。

## 2. 幂等性与防重记设计 (`task29_restore_idempotency`)

1. 对同一 `job_id` 或同一显式 `idempotency_key` 重复提交：消费单次 Step-up 授权后直接返回原 `result_summary` 且标记 `idempotent_replay: true`，不执行任何业务表写入，不推进财务版本号。
2. 对已完整恢复且当前云端记录齐备的新建预检作业（`staged_plan.length === 0` 且 `(user_id, scoped_payload_sha256, conflict_policy)` 已存在 `completed` 记录）：同样返回 `idempotent_replay: true`。
3. 若云端后续发生部分记录丢失（新预检检出 `staged_plan.length > 0`），则允许仅补插缺失项并在完成后刷新幂等台账。
4. 每批次写入前均重新比对实库快照，防止预检与提交窗口期间并发同步导致主键冲突或重复记账。

## 3. 分批写入与安全补偿回滚 (`rollbackAppliedRecords`)

- **有界批处理**：每批最多 35 条 SQL 语句 (`RESTORE_BATCH_SIZE = 35`) 在单次 D1 `db.batch()` 内执行，避免 Worker 内存膨胀或 SQLite 变量超限；每完成一批即持久化 `applied_log_json`。
- **精准补偿回滚**：当任意批次失败、触发测试故障注入 (`fault_inject_after_batch`) 或检测到并发修改冲突 (`BACKUP_MIDFLIGHT_CONFLICT`) 时：
  1. 严格按 `applied_log_json` 记录，以**逆依赖顺序**逐一仅删除本次作业新插入的主键行（全局共享的 `task16_fx_rates` 保持不动）。
  2. **绝不删除或修改用户恢复前既有的任何财务或通知记录**。
  3. 因 `task16_finance_user_versions`、`task16_finance_changes` 与 `task16_finance_audit_logs` 仅在全部批次成功后于最后一步原子更新，故失败回滚阶段不会污染同步游标与客户端增量版本号。
  4. 将作业标记为 `rolled_back`，记录脱敏错误码与回滚条数到 `task29_backup_audit` 与 Task27 安全活动事件。

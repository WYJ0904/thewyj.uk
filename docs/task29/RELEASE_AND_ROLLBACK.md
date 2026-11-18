# Task29 发布、停用（Kill Switch）与安全回滚手册

- **目标分支**: `hydrogen/task29-encrypted-backup-restore`
- **增量 D1 迁移**: `cloudflare/migrations/0039_task29_encrypted_backup_restore.sql`
- **当前发布状态**: `PRODUCTION_NOT_RELEASED`（PR 保持未合并、Production 零变更，等待后续统一审批）

---

## 1. 上线前后兼容与增量迁移策略

1. `0039_task29_encrypted_backup_restore.sql` 为严格增量建表脚本，仅新建 `task29_metadata`、`task29_backup_exports`、`task29_restore_jobs`、`task29_restore_idempotency`、`task29_backup_audit`，**不修改、不删除**任何已有 `task12_*`、`task16_*`、`task21_*`、`task27_*`、`task28_*` 表结构、约束或索引。
2. 允许在发布新 Worker 二进制前先对目标 D1 执行 `0039` 迁移；`task29-backup-api.mjs` 在运行时通过 `ensureTask29Schema(db)` 检查 `task29_metadata.schema_version = '1'`，未完成迁移时优雅返回 `503 BACKUP_SCHEMA_NOT_READY`，不影响已有业务接口。

## 2. 运行开关与应急熔断（Kill Switch）

Task29 API 在每次请求前调用 `checkBackupEnabled(env, db)`，支持双层零停机瞬时关闭：
1. **D1 动态开关 (`task25_feature_flags`)**：插入或更新 `flag_key = 'task29_backup_v1'` 将 `kill_switch = 1` 或 `enabled = 0`，全站立即生效并拒绝新的导出/预检/恢复提交 (`503 BACKUP_DISABLED`)。
2. **环境变量开关**：在 Cloudflare Pages 设置 `TASK29_BACKUP_ENABLED=false` 并重新触发部署即可全局禁用。

## 3. 代码回滚与数据保留策略

1. **Worker 代码回滚**：直接回滚至上一已发布稳定版本（如基线 `63bcf0b821d3d381513bcb7cc2dee1926b4e1b30`），已写入的 `task29_*` 表完全不影响旧代码运行。
2. **绝不破坏已恢复账目**：代码回滚或功能关闭期间，已经完成并通过校验提交写入 `task16_*` / `task21_*` 的正常用户记录、版本游标 (`task16_finance_user_versions`) 与安全中心审计事件均保持完整有效。
3. **未完成作业处置**：处于 `prechecked` / `cancelled` / `rolled_back` 状态的 `task29_restore_jobs` 行不会对业务表产生任何写入，待过期后保持只读归档或安全清理。

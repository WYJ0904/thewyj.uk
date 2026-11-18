# Task29 发布、停用（Kill Switch）与安全回滚手册

- **目标分支**: `hydrogen/task29-encrypted-backup-restore`
- **增量 D1 迁移**: `cloudflare/migrations/0039_task29_encrypted_backup_restore.sql`
- **双层开关控制**: `TASK29_BACKUP_ENABLED`（环境变量） + `task29_metadata ('task29_backup_v1')` + `task25_feature_flags ('task29_backup_v1')`

---

## 1. 上线前后兼容与增量迁移策略

1. `0039_task29_encrypted_backup_restore.sql` 为严格增量建表脚本，仅新建 `task29_metadata`、`task29_backup_exports`、`task29_restore_jobs`、`task29_restore_idempotency`、`task29_backup_audit`，**不修改、不删除**任何已有 `task12_*`、`task16_*`、`task21_*`、`task27_*`、`task28_*` 表结构、约束或索引。
2. 允许在发布新 Worker 二进制前先对目标 D1 执行 `0039` 迁移；`task29-backup-api.mjs` 在运行时通过 `ensureTask29Schema(db)` 检查 `task29_metadata.schema_version = '1'`，未完成迁移时优雅返回 `503 BACKUP_SCHEMA_NOT_READY`，不影响已有业务接口。

## 2. 运行开关与应急熔断（Kill Switch，Production 默认 Fail-Closed）

Task29 API 在每次请求前调用 `checkBackupEnabled(env, db)`，在 Production 环境下严格采用 **Fail-Closed** 优先级评估：
1. **环境变量开关 (`TASK29_BACKUP_ENABLED`)**：若未显式设置为 `"true"`（或被设为 `"false"`），Production 立即拒绝所有 `/api/backup/v1/*` 请求 (`503 BACKUP_DISABLED`)。
2. **元数据开关 (`task29_metadata` `key = 'task29_backup_v1'`)**：若存在且不为 `'enabled'`，立即拒绝。
3. **D1 动态开关 (`task25_feature_flags` `flag_key = 'task29_backup_v1'`)**：在 Production 中要求该 Flag 必须存在且 `enabled = 1` 且 `kill_switch = 0`；未创建、`enabled = 0` 或 `kill_switch = 1` 时全站立即拒绝 (`503 BACKUP_DISABLED`)。

## 3. Production 上线前备份、迁移与回滚操作台账

- **Production 目标库**: `wyj-cloud-production` (`11c288d8-c584-409f-bb1f-7e7af11793e5`)
- **迁移前完整 SQL 备份**（git-ignored 本地路径）: `.wrangler/task29/prod-backups/wyj-cloud-production-pre-0039.sql`
  - 大小: `3,950,800` 字节
  - SHA-256: `2A57643AB97B20349863B34FAE319DCDB9A4ACA7A20693609463CAA42F00200D`
  - 迁移前 D1 Time Travel 书签: `00001809-00000028-00005127-3d33e96dfd7fe2ce1df98a763e506d9b`
  - 离线 SQLite 可读性与完整性实测: 加载 `68` 个用户、`PRAGMA foreign_key_check` 0 条违例。
- **0039 增量迁移实测**: 仅执行 `0039_task29_encrypted_backup_restore.sql`（11 条语句，`4.80ms`）；`wyj_d1_migrations` 合计 `40` 条；`task29_metadata` (`schema_version=1`, `task29_backup_v1=enabled`)、5 张 `task29_*` 表及 4 个索引全部就绪；`PRAGMA foreign_key_check` 0 条违例；既有 22 张核心业务表迁移前后行数 100% 一致。
- **Fail-Closed 初态 seeded Flag**: `task29_backup_v1` 已在 `task25_feature_flags` 初始化为 `enabled = 0, kill_switch = 0, channels_json = ["stable","beta","experimental"], rollout_basis_points = 10000`（待 Production Pages 发布完成后按门禁正式开启）。

## 3. 代码回滚与数据保留策略

1. **Worker 代码回滚**：直接回滚至上一已发布稳定版本（如基线 `63bcf0b821d3d381513bcb7cc2dee1926b4e1b30`），已写入的 `task29_*` 表完全不影响旧代码运行。
2. **绝不破坏已恢复账目**：代码回滚或功能关闭期间，已经完成并通过校验提交写入 `task16_*` / `task21_*` 的正常用户记录、版本游标 (`task16_finance_user_versions`) 与安全中心审计事件均保持完整有效。
3. **未完成作业处置**：处于 `prechecked` / `cancelled` / `rolled_back` 状态的 `task29_restore_jobs` 行不会对业务表产生任何写入，待过期后保持只读归档或安全清理。

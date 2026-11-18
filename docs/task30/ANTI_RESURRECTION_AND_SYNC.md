# Task30 防复活墓碑、跨端同步一致性与备份恢复拦截 (`ANTI_RESURRECTION_AND_SYNC`)

## 1. 为什么必须防止数据复活

在离线优先或多端同步架构下，如果仅做物理 `DELETE`，以下 4 类真实场景会导致已删除数据“幽灵复活”：

1. **旧手机离线重连增量上传**：用户删除某笔财务交易或清空云端账本后，另一台长期未联网的设备执行 `/api/finance/sync` 上行历史 `transaction.upsert` / `category.upsert` / `budget.upsert` / `raw_event.ingest`。
2. **迟到的支付识别通知重放**：Android 旧设备重传历史支付通知或待确认提示至 `/api/notification/ingest` 或 `/api/notification/hints`。
3. **跨客户端同时对账合并/更新**：删除瞬间并发到达的合并或状态变更请求尝试写入已删除 ID。
4. **用户随后导入历史 `.wyjbackup` 加密备份**：用户在删除数据之前导出过本地 `.wyjbackup` 文件，删库之后又执行 Task29 `precheck` 或 `commit` 恢复旧备份。

---

## 2. 双层防复活机制设计（D1 实证实现）

### 2.1 实体的永久级墓碑 (`task30_erasure_tombstones`)

在 `0040` 迁移中创建 `task30_erasure_tombstones`（唯一键 `(user_id, entity_type, entity_key)`），在保留最小必要去标识化身份指纹的同时不存储商户名、金额、备注或通知明文：

- 财务实体现有标识映射：
  - `finance_transaction`（对应 `task16_finance_transactions.id`）
  - `finance_raw_event`（对应 `task16_finance_raw_events.id` 及来源身份键）
  - `finance_category`（对应 `task16_finance_categories.id`）
  - `finance_budget`（对应 `task16_finance_budgets.id`）
- 云端通知实体现有标识映射：
  - `notification_event`（对应 `task21_notification_events.id`、`external_event_id`、`source_event_hash`）
  - `notification_candidate` / `notification_hint`（对应 `task21_notification_candidates.id`、`task21_notification_pending_hints.hint_id`）
  - `payment_reference`（对应去重参考键）

### 2.2 分类清除代际锁 (`task30_erasure_generations`)

- 每当 `finance` 或 `notifications_cloud` 执行全量清除，对应 `(user_id, category_key)` 的单调递增版本号 `generation` 自动 `+1`，同步递增 `task16_finance_user_versions`。
- 若业务同步请求提交了历史旧版同步游标或旧实体 ID，系统结合代际锁与实体级墓碑进行拦截，阻止任何“迟到包覆盖新清除状态”的行为。

---

## 3. 各服务接入点核对

| 接入模块 | 接入函数 / 检查点 | 实际拦截效果 |
|---|---|---|
| `functions/_lib/task16-service.mjs` | `upsertTransaction`、`changeTransactionStatus`、`ingestRawEvent`、`mutateSimpleEntity`、`mergeFinanceTransactions` | 写入或变更前查 `task30_erasure_tombstones`；命中后拒绝复活写入，并更新增量游标与返回墓碑阻塞回执/状态 |
| `functions/_lib/task21-service.mjs` & `functions/_lib/task21-hints.mjs` | 云端通知识别摄入、对账写入及待确认线索同步 | ① 先检查 `cloud_notification_sync` 可选同意状态（已撤回则拒绝云端同步）；② 再校验 `task30_erasure_tombstones`，命中已彻底擦除实体则拦截复活 |
| `functions/_lib/task29-backup-service.mjs` | `precheckBackupRestore` & `commitRestoreJob` | ① `precheck` 读取 `task30_erasure_tombstones` 与 `task30_erasure_generations`，把命中已删除记录标记为墓碑拦截项并记录 `erasure_generation_snapshot`；② `commit` 在应用恢复批次前再次核验账号未注销且代际与墓碑未在预检后发生变化，若发生变化则中断回滚并报错 `BACKUP_PLAN_INVALIDATED_BY_ERASURE` |

上述链路已在本地 Miniflare/D1 测试组（`qa/task30/privacy-erasure.mjs` Check 6）完成正反验证。

# Task 16 财务核心审计与验收矩阵

## 范围与边界

本审计覆盖 Task 16 的财务模型、云同步、原始事件识别、跨来源对账、会员权益和旧 DailyPayGuard 数据迁移。它不把完整 Web 财务 UI、Android 自动采集客户端或通知保存功能提前纳入 Task 16。Production 已在仓库外备份和 `0012` schema/数量核对后开启财务 read/write；import 双开关继续关闭，任何真实旧数据导入都必须另行 dry-run、备份、对账和验收。

## 旧 DailyPayGuard 审计

| 项目 | 现状 | Task 16 处理 |
| --- | --- | --- |
| 技术栈 | Kotlin、Jetpack Compose、NotificationListener，minSdk 24、targetSdk 36 | 保留原型作为迁移来源，不建立第二套账户或后端 |
| 数据存储 | SharedPreferences `daily_pay_guard_store` 的 `records` 字符串；tab 分列、newline 分行 | 迁移器支持 XML 与原始导出文本，旧文件只读 |
| 旧字段 | timestamp、Double amount、source、type、time | 转为稳定 ID、minor unit、direction、source 和 occurred time |
| 标识与删除 | timestamp 同时作为记录 ID；支持单项删除和清空今日/全部 | timestamp + 用户/来源不可逆短摘要保持稳定且跨账户隔离；云端使用 tombstone 和 restore |
| 编辑 | 没有稳定编辑流程 | 云 API 使用 revision/base revision 支持新增和编辑 |
| 自动识别 | 通知文本解析；曾把推广金额识别为消费 | 服务端先判断来源/完成语义/方向，推广仅保留 rejected raw evidence |
| 去重 | 进程内 fingerprint + 15 秒窗口；App 重启后丢失 | D1 唯一约束、operation receipt 和 provider reference 跨重启幂等 |
| 测试 | Gradle template 单测；`testDebugUnitTest assembleDebug` 通过 | 云端使用 Miniflare/D1 场景测试；Android 真机仍需连接设备验收 |

旧原型没有 SMS 权限、直接 SMS receiver 或 Accessibility 自动采集实现。Task 16 不把尚不存在的来源宣传为已支持，也不修改旧 Android 数据。

## 云端模型

| 表 | 用途 |
| --- | --- |
| `task16_finance_devices` | 每用户设备、客户端版本和最后同步版本 |
| `task16_finance_user_versions` | 每用户单调 server version |
| `task16_finance_categories` | 收入/支出分类、revision、tombstone |
| `task16_finance_budgets` | 周期预算、币种、revision、tombstone |
| `task16_finance_transactions` | 用户可见 canonical transaction |
| `task16_finance_raw_events` | Notification/SMS/import 等原始事件的结构化证据和正文 fingerprint |
| `task16_finance_transaction_events` | raw event 与 canonical transaction 的可审计关联 |
| `task16_finance_audit_logs` | 新增、编辑、删除、恢复、合并、拆分和导入审计 |
| `task16_finance_changes` | 增量 change stream |
| `task16_finance_sync_operations` | operation ID + payload digest 幂等 receipt |
| `task16_import_batches` / `task16_import_receipts` / `task16_import_record_receipts` | dry-run 后导入、逐记录断点恢复、重放核对和受控回滚 |

所有用户数据查询均绑定 Task 12 稳定 user ID。原始正文不持久化；metadata 只接受有限字段、长度和大小。不存在仅以金额/粗时间桶为唯一键的表或索引。

## API 与状态规则

| 路由 | 权限与作用 |
| --- | --- |
| `GET /api/finance/bootstrap` | `finance_access`；返回 schema、server version、分类/预算摘要 |
| `GET /api/finance/changes` | `finance_access`；按 version 增量拉取 |
| `GET /api/finance/transactions` | `finance_access`；用户隔离分页账目 |
| `POST /api/finance/sync` | `finance_access` + 同源；批量重放本地操作 |
| `POST /api/finance/reconcile/merge` | `finance_access` + revision；手动合并并保留 raw evidence |
| `POST /api/finance/reconcile/split` | `finance_access` + revision；拆分关联并写审计 |
| `POST /api/admin/task16/import` | super admin + import flag；Production 还需第二开关和精确确认头 |
| `POST /api/admin/task16/import/rollback` | super admin；只 tombstone 未被后续修改的同 source 导入记录 |
| `GET /api/admin/task16/import/status` | super admin；返回安全数量和状态，不返回原始内容 |

一条未回答的客户端冲突不会整份覆盖服务器数据。只有正确 base revision 的 mutation 会写入；删除形成 tombstone，恢复需要引用 tombstone 的下一 revision。相同 operation ID + 相同 payload 返回 receipt，相同 ID + 不同 payload 拒绝。

每个 mutation 在读取实体前固定用户 `server_version`；若另一设备先完成写入，原操作不会把 0-row 条件更新伪装成成功。change stream 分页时设备游标只推进到实际返回的 `next_since`。账目列表使用 `occurred_at_ms + id` 复合游标，同一毫秒内的多笔交易不会跨页丢失。

## 强制对账场景

| # | 场景 | 预期 | 自动化证据 |
| --- | --- | --- | --- |
| 1 | 同一 Notification 上传 10 次 | 1 raw event | `test_task16_d1_js.mjs` notification replay |
| 2 | 同一 SMS 上传 10 次 | 1 raw event | SMS replay |
| 3 | 微信通知 + 银行短信，同 reference 的 28 CNY | 1 transaction + 2 raw events | cross-source strong evidence |
| 4 | 20 秒内同商户同金额、不同 transaction ID | 2 transactions | distinct references |
| 5 | 20 秒内同商户同金额、无 transaction ID | 默认 2 transactions | same-source conservative cap |
| 6 | 两商户同时 50 CNY | 2 transactions | merchant separation |
| 7 | 同金额同方向、卡尾号不同 | 2 transactions | account last-four separation |
| 8 | 银行短信晚 2 分钟且 reference 一致 | 合并 | delayed strong reference |
| 9 | 用户拆分误合并 | raw event 不丢 | split link and raw count assertions |
| 10 | 用户合并漏合并 | 完整审计、来源 tombstone | merge audit/change payload assertions |
| 11 | App 重启/离线重放/Worker retry | 不增加 raw event | operation receipt replay |
| 12 | 两设备并发上传同 provider reference | 1 raw event、并发成功幂等 | concurrent first-upload race |
| 13 | 50 万额度/商品宣传 | rejected raw event，不创建 transaction | promotion semantic rejection |

另外验证：手动新增/编辑/删除/撤销、分类、预算、跨设备 revision 冲突、change stream、用户隔离、无权益拒绝、全功能旧会员兼容、导入重放、回滚 tombstone 和 Production 导入双重保护。

## 迁移与隐私

- 默认 dry-run，不修改源文件或 D1。
- 金额用 Decimal 转为 minor unit，避免 Double 再舍入。
- source key、batch key、canonical digest 和稳定旧 ID 支持重复运行核对。
- 无效记录按 opaque ID + error code 隔离；不输出正文、用户名、hash、token 或本机路径。
- Production 报告与备份必须位于仓库外；脚本会拒绝仓库内路径。
- 回滚不 hard-delete：只把本次导入且未被用户修改的账目标记为 tombstone，并写 change/audit。
- 已被用户编辑的导入记录会阻止回滚，避免覆盖较新数据。
- 每条旧记录的摘要 receipt 与 transaction/raw-event/link 在同一批 D1 事务写入；请求中断后可按 source/record ID 断点恢复，不重复计数。
- 最后一批完成前由服务端从 D1 transaction + legacy raw evidence 重建 canonical 数据并核对源 SHA-256，而非只信任客户端报告。

## 当前验证状态

- Android 原型：`gradlew testDebugUnitTest assembleDebug` 通过。
- Android 真机：当前没有连接设备或可用 AVD，因此没有声称真机/E2E 通过；合并前仍需在真实 Android 设备验证旧导出、离线重放和网络切换。
- Task 16 Miniflare/D1：13 个强制对账场景、CRUD、冲突、权限、导入/回滚通过。
- 迁移器：XML、文本、无效/重复隔离、digest、Preview apply receipt 和 Production 防护通过。
- Preview：应在应用 `0012` 后验证 `/api/status?source=cloud` 的 `task16.schema_ready=true` 及读写 flag；Production 不启用。

## Production 停止点

Task 16 Production schema 已在明确批准后完成仓库外备份、稳定用户与既有业务数量核对，并应用 `0012`；财务 read/write 已开启，import 仍关闭。当前没有真实 DailyPayGuard 导出可供导入，因此财务表从零记录开始。未来导入必须先完成仓库外备份、真实旧数据 dry-run、用户归属和 count/digest 核对；期间严禁 SharedPreferences/D1 双写。

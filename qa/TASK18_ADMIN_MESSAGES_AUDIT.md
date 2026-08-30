# Task 18 管理员权限与站内消息审计

## 范围与数据边界

Task 18 只增加普通管理员角色、角色审计、敏感管理员操作审计和通用站内消息。唯一站点所有者继续使用 `task12_users.role = 'super_admin'`，用户稳定 ID、密码摘要、Session、会员、订单、财务、临时分享和学习数据均不迁移或重写。站内消息只保存管理员主动填写的纯文本通知，不保存密码、Session、支付信息或用户处理内容；本任务不使用 R2，也不新增 Secret。

普通管理员角色保存在 `task18_admin_roles`，不会把 `task12_users.role` 的既有 `user/super_admin` 约束改成新的不兼容枚举。每次解析 D1 Session 时动态合并角色，因此授权和撤销会立即作用于现有会话，不需要复制账户或创建第二套身份。

## Dry-run 前置核对

在 Preview 或 Production 应用 `0014_admin_roles_messages.sql` 前，先执行只读查询并保存不含用户名、消息正文或 Session 的仓库外计数报告：

```sql
SELECT COUNT(*) AS active_owner_count
FROM task12_users
WHERE role = 'super_admin' AND banned = 0 AND deleted = 0;

SELECT role, COUNT(*) AS count
FROM task12_users
GROUP BY role
ORDER BY role;

SELECT COUNT(*) AS users,
       SUM(CASE WHEN banned = 1 THEN 1 ELSE 0 END) AS banned,
       SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END) AS deleted
FROM task12_users;
```

阻断条件：`active_owner_count` 不等于 1、出现 `user/super_admin` 以外的源角色、D1 备份失败，或正在进行另一轮角色/消息迁移。Task 18 没有 legacy 普通管理员表或 legacy 站内消息表，因此没有待导入业务记录；迁移前后 `task12_users` 数量和稳定 ID 集合必须完全一致。

## Migration 与核对

`0014` 只做前向、可重复执行的 `CREATE ... IF NOT EXISTS`、索引、trigger 和 metadata upsert。隔离测试会在 fresh D1 上按 `0001` 至 `0014` 执行后再次执行 `0014`，并验证 metadata 仍只有一行。应用后核对：

```sql
SELECT value FROM task18_metadata WHERE key = 'schema_version';
SELECT COUNT(*) AS active_owner_count FROM task12_users
WHERE role = 'super_admin' AND banned = 0 AND deleted = 0;
SELECT COUNT(*) AS admins FROM task18_admin_roles;
SELECT COUNT(*) AS messages FROM admin_messages;
SELECT COUNT(*) AS recipients FROM admin_message_recipients;
SELECT COUNT(*) AS receipts FROM admin_message_receipts;
SELECT COUNT(*) AS role_audits FROM task18_admin_role_audit;
SELECT COUNT(*) AS action_audits FROM task18_admin_action_audit;
```

首次迁移的 `admins/messages/recipients/receipts` 预期均为 0。数据库 trigger 阻止第二个 owner、owner 降级/封禁/删除、把 owner 或不可用用户授予 admin，以及未先撤销 admin 角色就封禁或删除管理员。

## 权限矩阵

| 能力 | owner / super_admin | admin | user |
| --- | --- | --- | --- |
| 授予/撤销 admin、查看角色审计 | 允许 | 拒绝 | 拒绝 |
| 修改 owner | 拒绝 | 拒绝 | 拒绝 |
| 修改自己或其他 admin 的账户状态 | 先撤销角色 | 拒绝 | 拒绝 |
| 用户、订单、会员、反馈日常管理 | 允许 | 允许，且不能操作 owner/admin | 拒绝 |
| 高风险 migration/import/cleanup | 允许 | 拒绝 | 拒绝 |
| 发送站内消息 | 允许 | 允许 | 拒绝 |
| 撤回站内消息 | 任意消息 | 仅自己发送 | 拒绝 |

## 消息语义

- `single` 精确一个目标；`multiple` 为 2 至 100 个目标；`all` 在发送时冻结当时的全站有效账户收件集合，新注册账户不会收到旧广播。
- 批量和全站发送同时要求 UI 确认与服务端 `confirm_bulk_send=true`。
- 同一发送者的 `idempotency_key` 唯一；完全相同的重放返回原消息，冲突内容返回 409。
- 普通消息关闭成功写回执后不重复；需要确认的消息关闭不等于确认，下次会话仍会出现。
- 已确认、过期或撤回消息不再返回。正文通过 `textContent` 按纯文本渲染，来源固定为“thewyj 管理员通知”。
- 发送限频为每用户每分钟 10 次，撤回每分钟 30 次；D1 基础限流仍按环境总开关执行。

## Rollback

1. 先将 `TASK18_ADMIN_MESSAGES_ENABLED=false`，冻结新的角色和消息操作。
2. 导出并核对 `task18_admin_roles`、消息 metadata/收件关系/回执及审计增量；导出文件只保存在仓库外。
3. 代码可以回滚到先前 Pages deployment，但不要删除 `0014` 表、trigger 或审计，也不要降级 owner。
4. 若旧代码不能识别普通 admin，角色表保留不动即可让这些账户回到普通用户能力；恢复 Task 18 代码后角色仍可审计恢复。若必须正式撤销角色，应由 owner 逐项操作并保留审计。
5. D1 migration 只允许前向修复。不得通过 `DROP TABLE`、清空用户、重置 Session 或恢复旧 SQLite 主写来回滚。

## 验收矩阵

自动化至少验证：唯一 owner DB 约束、owner 保护、伪造角色请求、普通管理员日常能力和同级隔离、授权撤销即时生效、单/多/全站消息、三天离线、过期、撤回、普通关闭、明确确认、幂等、XSS、审计 request ID、390x844 Modal、移动端无横向溢出和刷新后回执语义。Production 只有在 Preview、CI、迁移计数和 owner 人工验收全部通过后才可单独打开 feature flag。

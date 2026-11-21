# Aeris → DS Task07/08｜邮箱语义与恢复后人工复核接口决议

> 2026-11-21：PRODUCT_DECISION_APPROVED。运行时接口见文件末尾。
> 决议正文与 DS `docs/task07/EMAIL_RECOVERY_DECISIONS.md` 对应。
> 此提交仅冻结数据合同与安全验收；**不**表明恢复审核接口、后台审核 UI、Production 已上线。

## 重复邮箱权威

- Aeris Task12 稳定用户 ID、Task27 的 MFA/安全版本是认证权威。
- 现有 `task27_security.verified_email` UNIQUE 索引及 `email_center_bindings` 已验证邮箱 UNIQUE 索引保持原样。不得放松 MFA 安全邮箱唯一性。
- DS Task06 `users.verified_email` 是**独立 DS 邮箱验证状态**，可在多个不同 Aeris 身份下具有同一值。这不会给予任何另一个账户的认证权或资格。
- DS V1.1 所称“允许重复邮箱”需要按字段解释；不意味着允许重复 Aeris 已验证安全邮箱。未验证联系邮箱若存在，依实际 schema 确认，不作为所有权权威。
- Task10 才实现一邮箱最多一个 DS 有资格账户；Task07–08 不得提前将 DS 主资料强制合并。

## 密码恢复后确权的受控人工复核（必须实现后才可验收）

`aeris_ds_ownership_recovery_holds` 和密码恢复事件必须保留，不得为了测试而直接清除永久 hold 或审核日志。

建议沿用 `/api/internal/ds-identity/v1` 认证 backchannel，定义**单独范围受限的 review case 契约**：
- 发起申请前必须完成独立目标账户认证，Aeris 决定目标 subject 并签发不可猜测的 case ref；不得以邮箱查目标用户。
- Case 绑定当前 DS actor 的 canonical issuer/subject、有效 grant/会话、目标 Aeris subject、恢复事件/安全代际、用途 `ds_account_ownership_recovery_review_v1`、证据引用和有效期。会话改变、安全事件或证据撤销时关闭。
- 审核由 Aeris 现有已授权、具有**独立明确审核权限**的服务端审核者实施；必须验证审核者身份/近期 MFA/利益冲突，不能审核自己、关联用户或在无已批准角色门禁时开放任意 review API。高敏/管理员身份需要第二人或安全负责人复核。
- 审核只能给出 `APPROVED_FOR_REAUTH` 的单次、短时资格；不能直接生成 Task07 ownership proof，也不能直接允许 Task08 或 Task09 合并。
- APPROVED_FOR_REAUTH 之后，申请人必须在原 DS 会话下重新输入目标账号密码并完成仍有效的 MFA/Step-up，后端再次检查当前来源 subject、恢复及安全版本；通过后才按既有 Task07 合同签发短期 proof。
- 无足够独立证据/无可信审核者/邮箱凭据单独证明等情形保持人工阻断；提供非泄密申诉说明，绝不以工单字段或 UI 开关绕过审核。
- 最少状态 `REQUESTED/UNDER_REVIEW/MORE_EVIDENCE_REQUIRED/APPROVED_FOR_REAUTH/DENIED/EXPIRED/REVOKED/CLOSED`；审计 reviewer、decision code、证据摘要、时间与状态变更，严格限制敏感数据保留；不接收密码、MFA、恢复码作为证据。
- 审核审批与一次性重新认证令牌必须幂等、不可重放、可撤销，禁止跨 DS 身份/客户端或目标账户转用。
- 审核逻辑在未实现真实授权控制前保持 `DISABLED`，运行时现有恢复 hold 继续拒绝自动证明。

## Task08 消费边界

DS Task08 只能读取经 Aeris backchannel 实时复核、且仍属于当前 DS 会话的所有权证明；若 case 未通过或未重认证，用户只能看到通用阻断/申诉状态，不能读取另一个账户的资料、财务、会员或业务权益。Task08 是选择与预览，**无任何合并写入权**。

保留 I04/I05 的 Task27 原账户/安全接口及设备会话语义。所有实现使用独立开发分支，Preview 与 Production 严格隔离，已有迁移不可改写。CI、本地、Hosted 验收分别记录，NOT_TESTED 不得称 PASS。


## 已实现运行时合同

申请由 DS 同源账户中心向签名 Provider 提交。四种申请人状态操作和两段独立确权均要求当前 Aeris Grant、DS 用户 ID 和绑定当前 DS 会话与邮箱版本的用途摘要。首次输入目标账户密码，并验证该账户当前启用的 MFA 后，Aeris 创建审查案件。签名返回的候选判断只供 DS 后端。申请人的队列只返回案件号、状态及时间。

| 签名操作 | 主要输入 | 结果 |
| --- | --- | --- |
| `ownership_review_start` / `ownership_review_verify` | 目标凭据、独立尝试绑定、DS 账户及会话范围 | `mfa_required` 或 `review_created` |
| `ownership_review_status` | DS 账户及会话范围 | 限当前范围的案件状态 |
| `ownership_review_evidence` / `ownership_review_cancel` | 当前范围、案件号，补件时提供既有工单引用 | 补件或撤销 |
| `ownership_reauth_start` / `ownership_reauth_verify` | 当前范围、案件号、全新的目标凭据与尝试绑定 | 与原 Task 07 一致的短期证明 |

审核者接口为 `POST /api/admin/ds-ownership-review/v1`。使用 Aeris 原生有效会话、精确同源 Origin 和 `X-Aeris-Review: 1`。有明确审核授权的账号先通过 `challenge`、`authenticate` 完成其本人密码和当前 TOTP，获得与该 Aeris 会话和安全代际绑定的短期审核凭据。随后可调用 `queue` 或 `decide`。队列只显示经授权且无显式当事人冲突的案件。审核角色授权表为空时，所有审核操作均被拒绝，已提交案件可保持 `UNDER_REVIEW`。普通管理员也需要另行获得明确复核授权。

`decide` 接收案件号、审核凭据、决定、限定的理由代码和审核者已经核验的工单引用。引用格式为 `SUP-` 加 16 至 64 位大写十六进制字符。Aeris 仅保存摘要。支持 `more_evidence`、`deny`、`approve` 和 `revoke`。涉及管理员、超级管理员或与 Aeris 财务交易、有财务设备关联的案件须由两个不同的有效审核者独立确认。审查只读取账号角色和财务关联是否存在，不接触金额或交易内容。

批准最多保留五分钟，并绑定原复核案件。签发真实 Task 07 证明时，在一个 D1 批次内原子消费批准。批准期间和证明读取时查询当前权限、恢复事件和安全代际，相关撤销和版本变化使资格失效。原有永久恢复 hold 和 Task 27 恢复事件继续保留。退出或切换 DS 账户后的会话不再有权使用原申请。

迁移 `0044_ds_ownership_recovery_review.sql` 增量建立复核状态、事件与显式审核授权。已授权的隔离 Preview 使用受限人员与案件编号绑定。没有正式审核权限配置时仍按照失败关闭处理。

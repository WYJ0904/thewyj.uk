# Task27 / PR153 邮件兼容验收

日期：2026-11-15。结论：**消费端适配通过；邮件中心发布仍有阻断**。

## 受测版本与隔离方式

- main：`7766b80eb2c9e448dc08a3a4b317bfa62e0dff6e`。
- Codex 消费端：`308a7722`；后续 `32d7bb84` 只调整测试夹具。
- [PR153](https://github.com/WYJ0904/thewyj.uk/pull/153) 当前 Draft/open，受测头为
  `033b815201a47ac0e874a9d75183371fe99b6f0d`，已经包含它对旧头 `2a17c2bb` 的改进。
- 独立分支 `codex/task27-email-compatibility`，组合提交
  `878c04090d442bc026ec77434b16d2e922f58152`。该分支没有推送或合并进 Task27 交付分支。
- 邮件服务、管理 API、入站处理和 0036 保持 PR153 字节内容。冲突分别处理：
  完整邮件模块及其测试采用生产者版本；Task12 合并双方导入和业务钩子；
  SW 保留全部安全层，再按组合资源重新生成完整性摘要。
- 只使用内存 D1、另建的本地 Wrangler 持久目录、保留地址域和模拟发送绑定。
  没有使用 Preview/Production 数据、凭据或私人转发地址。

## 合同和消费端修复

| 项目 | 实际行为与处理 |
| --- | --- |
| 导出兼容 | 按 `EMAIL_BUILD` 和 `sendVerificationCodeEmail` / `getUserEmailBinding` 能力识别完整中心；单独 Task27 继续兼容 S0 发信接口 |
| 发码参数 | 传入用户 ID、用途、五分钟有效期、请求 ID 和挑战摘要派生的幂等键；OTP 生命周期仍归 Task27 |
| 失败安全 | 完整中心安全包装器返回 `ok:false` 时转成错误；状态码限制为 400–599；发码失败不签发会话，邮箱绑定不变，绑定/登录挑战作废 |
| MFA | 密码通过后只有挑战；邮箱因子正确且挑战只消费一次后才签发完整会话；原 MFA 不因邮件中心集成失效 |
| 邮箱权威 | Task27 自助所有权验证在同一 D1 batch 更新其唯一邮箱、0036 绑定行、安全世代、旧会话撤销和个人通知；验证时间一致 |
| 双表分歧 | PR153 新头会比较验证时间选择地址；认证消费端仍拒绝任何两个已验证地址的冲突，不把“较新”当作所有权证明 |
| 管理路由 | 完整中心独占 `/api/admin/email/*`；失败不落回旧草稿接口；Task27 补充当前权限、会话和关键写操作的一次性 scoped Step-up |
| 绑定管理 | 阻止管理邮件入口直接写入 `verified=true`，要求用户在账户安全中心完成所有权验证；没有建立第二套身份系统 |
| UI | 完整中心存在时隐藏旧邮件按钮；实际 Chrome 完成新中心草稿、预览、确认、Step-up 和模拟排队；没有第二份草稿/投递 |
| 通知隔离 | 安全事件只生成个人通知；普通广播维持原通道；Task27 改密等路由先执行，不再重复触发旧 Task12 同名路由邮件钩子 |
| 敏感信息 | 持久投递记录的 OTP 被脱敏；Task27 通知仅使用固定事件文案，不传 TOTP 密钥、恢复码或会话 Token |
| 送达表述 | 消费端始终返回 `inbox_confirmed=false`。服务器接受和模拟排队都不能作为真实收件箱验收 |

本地组合合同 **10 项通过**，其中生产者缺陷探针也成功复现问题。
这表示验证代码确认了风险，**不表示这些风险已经修复**。
组合 Chrome UI **10 项通过**。证据：
[mail-combined.json](task27/final-evidence/mail-combined.json)、
[browser-combined.json](task27/final-evidence/browser-combined.json)。

## 交给 Hydrogen 的明确修复清单

| 编号 | 严重度/归属 | 证据、影响和应修复行为 |
| --- | --- | --- |
| EMAIL-BRIDGE-ATOMICITY | P1，PR153 `upsertUserEmailBinding` | 把另一个账户已占用的邮箱写给测试用户时，`task27_security` 唯一约束拒绝更新，但 `email_center_bindings` 已持久为已验证，异常被吞掉，安全世代没有变化。应以权威所有权验证和单事务更新两表；禁止吞掉约束错误或通过管理表单替代用户验证。Codex 网关已封住公开管理入口，但没有改写生产者服务 |
| EMAIL-IDEMPOTENCY-RACE | P1，PR153 `sendTransactionalEmail` | 同一幂等键并发调用，两次均先通过 SELECT，再到模拟发送端；记录唯一键只使其中一个调用事后失败。应发送前原子认领、保存处理中/未知状态；重复或未知结果禁止自动重发。探针实际 provider_calls=2 |
| EMAIL-INBOX-CLAIM | P2，PR153 服务及管理 API | 当前把 provider `delivered` 转成 `inbox_delivery_confirmed=true`。应区分服务商/收件服务器接受与实际收件箱确认；真实邮箱验收独立保留 |
| EMAIL-TEST-STEPUP | P2，PR153 测试 | 原测试前三组通过，第 4 组用 `current_secret` 直接调用改密接口，得到 400，未取得 Task27 Step-up grant。应按现行安全流程更新测试，包括 MFA、会话失效和邮件关闭/失败不回滚已完成安全操作的断言。原失败保留，没有删断言或降低接口要求 |

PR153 管理发送预览已有原子消费及 changes 检查；**没有把服务层的并发幂等缺陷
误写成“同一管理预览可重复消费”**。实际用两个独立 grant 并发确认同一预览时，
只有一个请求发送成功、模拟投递一次。

Cloudflare 将 Delivered 定义为收件服务器已接受，见
[官方邮件生命周期说明](https://developers.cloudflare.com/email-service/concepts/email-lifecycle/)。
由此不能推定邮件已放入用户收件箱。配置健康检查也不构成真实入站/回复验收。

## 数据库验收

- main 最新 0034，Codex 新增 0035，PR153 新增 0036，无编号冲突。
- 本地 Wrangler 顺序应用到 0036，账本有 **36** 条；再次 apply 为
  `No migrations to apply`。只使用专用本地持久目录。
- 原始 0035 SQL 再执行会拒绝“表已存在”，不得手工重复执行它的 ALTER；
  由 D1 迁移账本防重复。0036 的 IF NOT EXISTS / INSERT OR IGNORE 重放验证通过。
- 预置旧用户 ID、验证器、Web 会话、会员、财务、学习列的摘要在 0035→0036 后一致；
  历史 MFA 默认 none、must_change_password=0，原合法会话仍可访问。
- Task27 已验证邮箱唯一约束保留。0036 的绑定表实际上没有邮箱 UNIQUE 或用户 FK，
  不能把合同中“引用用户 ID”的描述当作已存在的数据库约束。
- 外键检查零错误。一次额外 Wrangler 本地查询出现 workerd/Windows `fetch failed`
  及 libuv 退出；保留失败，随后以 SQLite 只读连接独立确认原迁移账本和外键结果。
- 未清理、重建或迁移任何远程 Preview/Production 数据库。

## 已保留的失败与后续边界

初版新增夹具的字段长度、会话版本、快照新增列和中文“五分钟”匹配错误已修正；
0035 原始 SQL 不可重放的误设被改成显式拒绝断言和真正的迁移账本复验。
组合浏览器首次/第二次仍继承 Preview 收件人限制，发送被安全拒绝；最终只把本地
模拟环境的 `EMAIL_TEST_RECIPIENTS` 设置为 `fixture@example.test` 后通过，正式配置未变。
原日志哈希均在 [log-receipts.json](task27/final-evidence/log-receipts.json)。

真实邮箱 OTP、两款 Authenticator 真机绑定、Android WebView 真机 URI 接管、
Production 发信、客服 Worker 正式路由及 Android Stable 均为 **NOT_TESTED**。
生产者修复、两个 PR 的最新组合回归及所有者验收完成之前，保持 **RELEASE_HELD**。

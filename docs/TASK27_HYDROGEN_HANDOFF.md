# Aeris V6.3 Task27 — Hydrogen 接手记录

更新：2026-11-15。后续实现负责人：Google Antigravity Hydrogen。

## 交接点

- 仓库：`WYJ0904/thewyj.uk`
- 分支：`codex/task27-security-center`
- 交接前 HEAD：`1a0e30d420ae7a1e9710a7236de6413704c5ae2a`
- main：`7766b80eb2c9e448dc08a3a4b317bfa62e0dff6e`
- Task27：[Draft PR #154](https://github.com/WYJ0904/thewyj.uk/pull/154)，open，未合并。
- Hydrogen 邮件中心：[Draft PR #153](https://github.com/WYJ0904/thewyj.uk/pull/153)，open，未合并，当前头 `033b815201a47ac0e874a9d75183371fe99b6f0d`。

交接前工作树干净：没有暂存修改、未提交修改或未跟踪文件。Task27 有效代码、测试与此前报告都已在分支提交并推送；本次只增加这份交接记录，作为明确的所有权交接提交。没有 stash、reset 或丢弃任何修改。

## 已完成内容

Task27 使用 Task12/20 既有身份及 Android 会话体系，新增注册时主动同意条款、至少 9 位新密码规则、旧密码/哈希/会话兼容、邮箱所有权验证、登录邮件 MFA、TOTP QR/URI/手动密钥三入口、一次性恢复码、防重放、受限管理员临时密码、会话查看与撤销、安全通知及三份政策页面。旧账户不强制改密或启用 MFA。

SEC-S0-M02 已实现：现有 IP 保护保留，并增加规范化账户/IP 8 次、跨 IP 账户 24 次、固定 300 秒预算，Web 与 Android 共用账户预算。公开凭据错误不透露账户是否存在；限流不永久封号、不延长拒绝窗口、不撤销合法会话。恢复流程有独立预算。

Task27 与完整邮件中心的消费端适配已提交：检查邮件服务成功结果、发码显式使用五分钟有效期和用户/挑战幂等键、绑定验证后事务同步 `task27_security` 与 `email_center_bindings`、分歧时失败关闭；完整邮件中心独占 `/api/admin/email/*`，关键写操作需 Task27 一次性 Step-up，管理端不能直接把邮箱标成已验证。存在完整邮件中心时旧邮件草稿 UI 会隐藏并转到其唯一管理界面。

main 已以普通 merge `434642223e57517cb4f81b0423980f00cad6471e` 合入。SEC-S0-M01 深层 JSON 防护、M03 跨账户队列隔离、SW 脚本 URL/完整性校验、原 81 项核心资源、Task26/财务层、Azure TTS、0026–0034 和 Android 数据/发布元数据已保留。Task27 的五个 SW 安全模块要求完整性校验，总数 89。

## 测试与当前 CI

此前完成的本地隔离验收记录包括：Task27 API 31 组、旧用户升级/密码 11 项、M02 9 项、Task27 邮件消费端 6 项、隔离组合邮件合同 10 项、workerd 5 项、Chrome 独立 11 项/组合 10 项、OTPAuth 256 组及 4 种 URI/QR 等价测试、Android 831 tests（120 suites）、Lint/调试 APK、Task12/18/20（15/8/18 组）、SW 20 项、回滚 2 项、Pages allowlist 28 项和 Functions 构建。上述均是已有结果；交接期间未重跑测试。

当前头 `1a0e30d4` 的 Core CI [43685537018](https://github.com/WYJ0904/thewyj.uk/actions/runs/43685537018) 已完成但结果为 **FAILURE**：Pages、两个 Python、Android、JavaScript、敏感文件及 application browser 六项 job 成功；Cloud-only browser 的 Task25 功能管理 UI 检查失败；两个 Task25 专用分支 job 按条件跳过。失败发生于 Task25 管理控制台展开“修改审计”披露项时，页面诊断显示控件仍位于视口下方。相关完整证据在 `docs/task27/final-evidence/ci-fifth-43683601131.json` 和本地忽略目录 `.wrangler/task27-final/ci5-cloud-artifacts/`。该失败没有被改写为 Task27 通过；PR #154 保持 Draft。

## Hydrogen 邮件中心的接口与阻断

当前 Hydrogen 接口契约与消费者参数并不完全相同：

- Task27 调用 `sendVerificationCodeEmail(env, {to, code, userId, purpose, expiresMinutes:5, idempotencyKey, requestId, requireVerifiedEmail, emailVerified})`；Hydrogen 安全包装器以 `{ok:false,...}` 报告投递失败，消费者会把它转成失败，不签发 MFA 挑战会话。
- Task27 的 `sendAccountSecurityNotice` 另传 `userId`、事件、请求 ID 和挑战/事件幂等键，并始终报告 `inbox_confirmed:false`。供应商或收件服务器接受不等同于用户收件箱确认。
- 管理草稿合同不同：Task27 旧 API 用 `id`/`recipient_ids`/`preview`；PR #153 使用 `draft_id`/`recipient_user_ids`/`preview_token`/`confirmed`。组合运行只能由 Hydrogen 管理 API 和 UI 拥有 `/api/admin/email/*`；不得同时回退到旧草稿处理器。
- Task27 自助邮箱所有权验证是已验证邮箱的权威写入者。Task27 会在一个 D1 batch 内同步两表；不得以管理邮件 API 的 `verified=true` 写入替代用户所有权验证。

隔离组合测试已确认以下 **Hydrogen 所属未修复问题**，修复后须重新验证：

1. `upsertUserEmailBinding` 先写 `email_center_bindings`，后写 `task27_security`；唯一邮箱约束拒绝后，异常会被吞掉，留下两表不一致且安全世代不递增。应改成原子写入并向调用者报告冲突。
2. `sendTransactionalEmail` 的幂等检查先查后发；相同幂等键并发时两个请求均可到发送端，事后才由唯一键使一个失败。应先原子认领，记录发送中/未知状态，禁止不确定结果自动重发。
3. Producer 把 `delivered` 标成 `inbox_delivery_confirmed=true`；需准确区分收件服务器接受与真实收件箱验收。
4. `npm run test:email` 原测试前三组通过，第 4 组按旧的无 Step-up 改密合同发送请求而收到 400。应更新成 Task27 当前密码和 MFA/授权合同，再完整运行 Hydrogen 自己的测试。

组合探针能复现缺陷不代表缺陷已修复。PR #153 生产者文件未被 Task27 分支修改。完整分析见 [TASK27_EMAIL_COMPATIBILITY_REVIEW.md](TASK27_EMAIL_COMPATIBILITY_REVIEW.md)。

## 可能冲突的共享文件

Task27 与 PR #153 都改动以下九个路径。合并时须逐文件保留双方有效行为；不能整批选择 ours/theirs：

| 路径 | 合并注意事项 |
| --- | --- |
| `functions/_lib/task12-api.mjs` | Task27 M02 登录预算、统一错误和 MFA challenge；Hydrogen 非阻塞邮件事件钩子与邮件错误转换 |
| `functions/_lib/email-service.mjs` | 生产者邮件服务及签名为 PR153 所有；保留 Hydrogen 最新版本并对照 Task27 adapter 的显式参数 |
| `functions/api/[[path]].js` | 合并 Task27 邮件网关的鉴权/Step-up；完整中心作为唯一 `/api/admin/email/*` handler |
| `app.js` | 两个邮件 UI 入口、管理员面板导航及 scoped Step-up wrapper 需只保留一个邮件平台 |
| `index.html` | 旧邮件入口和 Hydrogen 的 `adminEmailCenterRoot` 不得产生重复标签或空白入口 |
| `product-ui.css` | 两份邮件 UI 样式及管理员布局兼容 |
| `sw.js` | 原 81 核心指纹不变；保留 Task26、财务层和 5 个 Task27 必需项；每次共享资源变化重算 SHA-256 和 publication hash |
| `local-backend/test_email_js.mjs` | 保留 Hydrogen 测试，不降低安全断言；将 Task27 改密用例改成真实 Step-up/MFA 合同 |
| `package.json` | 合并双方测试命令，保留既有依赖与锁文件约束 |

首次独立组合时发生文本冲突的是 `functions/_lib/email-service.mjs`、`functions/_lib/task12-api.mjs`、`local-backend/test_email_js.mjs` 与 `sw.js`；其余共享路径当时自动合并，但仍须语义审查。Task27 独有关键实现有 `functions/_lib/task27-email-adapter.mjs`、`functions/_lib/task27-email-gateway.mjs`、`functions/_lib/task27-login-guard.mjs` 及 `qa/task27/`。

## Hydrogen 接手建议验证顺序

1. 取 PR #154 和 #153 实际最新 SHA；保留两个交付分支，另建可追踪组合分支/worktree。
2. 先修复上述四个邮件问题；检查 `task12-api.mjs`、dispatcher 和 UI 后，验证只有一个 `/api/admin/email/*` handler、权限/Step-up 生效且 `ok:false` 不会发放会话。
3. 在隔离 D1/R2 运行 Task27 API/M02、Task27 邮件适配器、PR153 邮件套件、真实浏览器和 0035→0036 连续迁移。比较旧用户 ID、密码哈希、会话、会员、财务、学习数据的前后摘要；外键检查必须为零错误。
4. 处理当前 CI 的 Task25 管理审计披露项可见性失败，再为最终交付 HEAD 跑 GitHub CI；逐个记录 skipped 与失败，不能把中途结果或历史 SHA 当作当前 PASS。
5. 所有者完成真实邮箱 OTP、Google/Microsoft Authenticator 真机绑定、Android WebView URI 真机接管、Preview 真实数据/备份验收及入站/回复邮件实测后，再讨论正式发布。

## 禁止事项与发布顺序

- 严禁未经独立授权操作 Production D1/R2、0035/0036、功能开关、发信开关、自动回执、Email Routing、真实账户/邮件、签名材料或 Android Stable。
- 现状维持 Production `EMAIL_SENDING_ENABLED=false`、自动回执 `false`、现有客服转发与 Routing 不变；所有者已完成域名、密钥、Email Worker 和 health 配置，不要要求重复创建或配置。
- 不清空或重建 Preview D1/R2；若将来获准操作，先只读检查现有数据和备份。
- 不改固定工作区中暂停的 Android Hotfix 分支及其未提交内容，不读取根目录 `访问口令.txt`，不把私人 Gmail、Secret、凭据或真实用户邮件写入仓库。
- 正式迁移次序只能是 Task27 `0035` 在前、邮件中心 `0036` 在后；两个 PR 均由所有者审查和控制合并，不自动合并。

## 本次交接操作

交接开始时工作树/暂存区/未跟踪文件均为空，原代码已提交并推送到 `origin/codex/task27-security-center`。本次提交仅新增本文件。提交后请 Hydrogen 从该分支最新 HEAD 继续。

# Aeris V6.3 Task27 最终集成报告

日期：2026-11-15。当前结论：**本地代码及消费端集成可审查；RELEASE_HELD**。
旧报告和原始验收没有改写。本报告记录后续 S0 合入、M02 修复和邮件组合验证。

## 1. 分支与实际提交

- 交付分支：`codex/task27-security-center`。
- 最终本地受测源码/测试头：`12a70019869432fbab581f2200e528326a6c88b2`；
  后续报告提交不改变该产品树。最终 GitHub 交付 HEAD 由 Draft PR 的 head SHA 记录。
- 原实现 `4167af98`、产品完善 `3b1ff9d7`、原报告 `d06e50eb` 均在提交链上。
- main 新鲜核对：`7766b80eb2c9e448dc08a3a4b317bfa62e0dff6e`；
  以普通 merge `434642223e57517cb4f81b0423980f00cad6471e` 合入，没有 rebase 或重置。
- 主要增量修复 `8067ca1f`；可选邮件路由注册/测试完善 `308a7722`；
  本地收件人夹具 `32d7bb84`；管理员临时密码静态契约 `12a70019`。
- Task27 Draft PR：待本地证据提交后创建并在本报告补录；禁止自动合并。
- [Hydrogen PR153](https://github.com/WYJ0904/thewyj.uk/pull/153) 为 Draft/open/unmerged，
  最新受测头 `033b815201a47ac0e874a9d75183371fe99b6f0d`。

## 2. main 冲突与保护

逐项处理三个冲突：两个浏览器 harness 同时保留 main 的 Retry-After 限制和
Task27 的真实重新认证/同意夹具；SW 保留 main 的脚本 URL 版本拒绝、81 项核心
身份、完整性校验及 Task26/财务层，再加入 5 个 Task27 必需模块，总计 89 项。
没有整体选择 ours/theirs。

SEC-S0-M01 深层 JSON 和 M03 跨账户队列安全实现及其回归保留并重新通过。
Azure TTS、0026–0034、Android 权限/本地数据/发布元数据没有替换回历史版本。
原固定目录的暂停 Hotfix 与既有未提交修改没有被本任务改写；Hydrogen 交付分支
和工作树没有由 Codex 修改。组合分支只用于本地验收。

## 3. 修改文件与范围

完整功能仍为原 Task27：Task12/20 身份、9 个 Unicode 码点起的新密码规则、
旧密码/哈希/合法会话兼容、20 位管理员随机临时密码、邮箱 OTP、TOTP 三入口、
一次性恢复码、敏感操作重新认证、会话撤销、通知、三份政策和 0035。
旧用户不强制改密或开启 MFA；新密码四类字符与最长 128 码点的规则不用于旧密码验证。
弱密码检查为本地基础名单，不宣称完整泄露密码数据库或安全标准认证。

本轮核心文件：

| 文件组 | 实际变化 |
| --- | --- |
| `task27-login-guard.mjs`、`task12-api.mjs`、`task20-api.mjs`、`task12-service.mjs` | M02 账户/IP 组合与跨 IP 账户预算、失败响应统一 |
| `task27-email-adapter.mjs`、`task27-email-gateway.mjs`、`task27-auth.mjs`、`task27-security.mjs` | 失败安全、合同参数、双表事务同步、完整中心路由所有权和 Step-up |
| `task27-api.mjs`、`functions/api/[[path]].js`、`app.js`、`security-center.js` | 能力发现、唯一管理邮件入口、旧 UI 隐藏/委托、管理请求授权 |
| `sw.js`、两个 P07 harness | main 集成、完整性摘要、原有 Retry-After 与 Task27 夹具同时保留 |
| `qa/task27/*`、Task12/静态测试、`ci.yml`、`package.json` | 新增限流/合同验收和 CI 入口，现有断言适配新临时密码/失败契约 |
| 本报告、邮件复核、`docs/task27/final-evidence/` | 新受测版本证据，与原验收分开 |

注册须主动同意使用条款。30 天密码提醒为非强制个人通知；未开启 MFA 的建议
和版本更新为广播；重大政策变更为个人通知。三份正文与已确认 TXT 逐字一致。
页脚保持 `© 2025–2026 Aeris. All rights reserved.` 并自动更新结束年份；
保留 `support@thewyj.uk` 和“回复邮件可能使用其他邮箱地址。”。没有把私人 Gmail
放入公开页面。TOTP QR、链接和手动密钥使用同一 URI 配置。

## 4. SEC-S0-M02

保留原 IP 限制；在密码 KDF 前原子预留：同用户名/IP 最多 8 次、同规范化用户名
跨 Web/Android/IP 最多 24 次，窗口固定 300 秒。共用原认证窗口表，不新增迁移。
未知、错误、错误密码的封禁用户、无有效验证器账户使用一致公开凭据失败响应。
内部审计原因保留。拒绝不延长窗口；不写 banned、不改密码、不撤销合法会话；
正确密码清除完成的预留，基础设施失败释放本请求预算。恢复流程仍使用独立限流。
存储失败为 503，不绕过保护。9 项测试含 60 个并发请求、混合客户端分布式尝试、
旧密码、窗口恢复与现有会话保留，全部通过。

## 5. 邮件接口、0035→0036 与剩余阻断

详见 [邮件兼容复核](TASK27_EMAIL_COMPATIBILITY_REVIEW.md)。
独立组合头 `878c0409`；邮件生产者文件保持 PR153 原内容。
消费端合同 10 项、组合浏览器 10 项通过，但同时复现两个尚未修复的生产者 P1：
**绑定跨表写入非原子且吞约束错误、服务层并发幂等键发送两次**。
另有收件箱状态表述和旧改密测试未采用 Step-up 的修复项。
因此不能把两个 PR 标成“可正式发布”。

迁移编号无冲突：main 到 0034；正式必须先 0035，再 0036。
本地真实 Wrangler 应用两份增量成功，第二次无待迁移，账本 36 条、外键零错误。
预置旧业务列摘要、验证器和合法会话保留，历史 MFA 关闭、不强制改密。
0035 原始 SQL 重复会拒绝，由账本防重放；0036 可安全重放。
没有清库，没有对远程 Preview 或 Production 执行迁移。

所有者已完成域名/凭据/Worker/转发 Secret/健康检查配置；不要求重复配置。
配置就绪不等于真实邮件端到端。正式发信及入站自动回复保持 false，正式客服
继续现有 Gmail 转发，Email Routing 未切换。

## 6. 本轮本地验收

| 验收 | 当前结果 |
| --- | --- |
| Task27 D1/API | 31 组 PASS：MFA、TOTP、恢复、防重放、临时密码、会话、消息等 |
| 旧用户升级及新密码 | 11 项 PASS，实际编译 worker 与预置业务摘要 |
| M02 账户限流 | 9 项 PASS |
| 独立 Task27 邮件消费 | 6 项 PASS |
| PR153 组合合同 | 10 项 PASS，包含成功复现生产者缺陷的诊断；风险仍 OPEN |
| 真实 workerd 安全流程 | 5 项 PASS |
| OTPAuth 9.6.0 / jsQR 1.4.0 | 256 向量、4 种 URI 标签 QR/链接/手动等价、workerd ESM PASS |
| Chrome UI | 独立 10 项、组合 10 项 PASS；375px、双主题、axe、注册/政策/邮件流程 |
| Android | 120 套件、831 tests，0 failure/error/skipped；Lint、Debug、DebugAndroidTest APK PASS |
| Task12 / 18 / 20 | 15 / 8 / 18 组 PASS |
| Task13 / 15 / 16 / 17 / 财务模型 | 17 / 19 / 11 组及其余各原有套件 PASS |
| S0 JSON 深度 / 传输隔离 | 两套原回归 PASS |
| S0 邮件服务 / Core / harness 注册 | 5 套件及原回归 PASS |
| SW 安装 / 回滚展示 | 20 + 2 项 PASS，保留原81身份与错误资源拒绝 |
| Pages allowlist / 实际构建 | 28 项 PASS；190 文件精确字节审核 PASS |
| Pages Functions / 模块图 / 存储 | 构建 PASS；67 文件110导入；31 个存储键族 PASS |
| Cloud-only gate | 90 生产模块、182 服务路由、107 前端路由 PASS |
| Python static / 仓库敏感资料审计 | 31 项及1730候选文件 PASS（新报告随后再审计） |
| 三份已确认政策 | 正文逐字比对 PASS |
| PR153 原完整邮件测试 | 前3组 PASS；第4组旧改密调用 FAIL，保留并交生产者适配 |

独立和组合各自使用隔离数据。自动化没有打开真实邮件或手机验证器。
新证据在 [final-evidence](task27/final-evidence/source-refs.json)；
原始日志保留于忽略目录，66 份哈希收据在
[log-receipts.json](task27/final-evidence/log-receipts.json)。

保留且已处理的失败包括：新增测试夹具约束/中文匹配、0035 重放假设、
浏览器 Preview 收件人限制、旧静态断言、可选邮件 guard 路由的静态发现。
本地批量工具还误引用两个不存在的脚本及一个被 Node 忽略的附加测试路径；
没有把它们计作通过，已用真实目标分别完成 SW20+回滚2、staging28和政策正文核对。
一次 Pages 审核的输出路径被拒绝后，改用其要求的 `artifacts/` 目录重新验证。
一次额外本地 Wrangler 查询崩溃后，保留失败并只读复核已成功迁移的账本。

## 7. GitHub CI

main 的 [Core CI 43625189929](https://github.com/WYJ0904/thewyj.uk/actions/runs/43625189929)
已核实为 exact `7766b80e`，10/10 成功。这不是 Task27 的 CI。
Task27 在推送并创建 Draft PR 后运行，实际结果和链接将在后续验收收据补录；
本报告当前提交不宣称远端 Task27 已通过。

## 8. 所有者真实验收与发布步骤

以下均为 **NOT_TESTED**：真实邮箱 OTP，Google Authenticator 真机扫码/绑定，
Microsoft Authenticator 真机扫码/绑定，Android WebView 真机 URI 接管，
Production 发信，客服 Worker 正式路由和 Android Stable 发布。
本轮 Hosted Preview 业务验收也未执行，不能用本地结果替代。

建议受控顺序：

1. 两个 Draft PR 分别审查；Hydrogen 修复上述 P1 和测试/状态契约。
2. 重新核实双方最新头，在独立分支组合重跑；完成 Task27 exact-head GitHub CI。
3. 所有者确认后先合入 Task27 及0035，再合入已修复邮件中心及0036；逐项解决最终冲突，重算 SW 摘要。
4. 先核对有数据的 Preview 状态和备份，按0035→0036应用增量，不清库；进行真实邮箱、验证器、手机与入站/回复验收。
5. 全部门禁满足并获得正式发布授权后，再单独执行 Production 备份、增量迁移、部署和受控邮件灰度。
   正式发送、自动回复、Email Routing、Android Stable 分别受控，不随代码审查自动启用。

回滚须保留迁移后的安全元数据和用户数据，不能直接删除0035/0036表或使用绕过 MFA
的旧认证版本。原 S0 证据、Task26 所有者豁免及暂停 Hotfix 保持各自原结论。

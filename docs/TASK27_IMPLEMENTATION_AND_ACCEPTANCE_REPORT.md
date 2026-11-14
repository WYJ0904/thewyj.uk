# Aeris V6.3 Task27 Implementation & Acceptance Report

日期：2026-11-15（Asia/Hong_Kong）。状态：**CODE_READY_LOCAL / RELEASE_HELD**。
本轮为 Task27 原工作树的增量完善，没有重新建立账户、会员、广播或邮件平台。

## 1. 分支、提交及发布边界

- 分支：`codex/task27-security-center`。
- 原始基线：`3f5ea474404df5e513df6198d0244c8a041ad2ff`。
- 前一实现检查点：`4167af98b38ae6c11c632e0b58b3902e62e57c3f`。
- 本轮受测产品提交：**`3b1ff9d7dc09a05bafd310686760e785e93953ef`**。
- 本报告与脱敏证据是后续文档提交，不改变上述产品代码。
- 未推送或创建 Task27 PR；远端 CI 未执行。未修改 [PR #151](https://github.com/WYJ0904/thewyj.uk/pull/151)。

本轮只读核对过 PR151 的 `2365be0b6f68ddca693bc6da30e3ee42f25f36d8`
快照，当时仍为 Draft/open，main 基线为 `4fc025a0...`；这不是持续状态保证。
已审阅并在 Task27 分支窄范围移植 `0961710...` 的 JSON 深度与传输队列
账户隔离修复，没有引入其 S0 发布版本／changelog 改动。正式集成仍需在
Hydrogen 完成 S0 后，重新核对最终稳定 main 与后续安全修复。

原固定目录的暂停 Hotfix 分支及未提交工作没有被本任务改写；Hydrogen 两个
本地分支引用保持原值。没有 main 合并、Production D1/R2／功能开关／真实
账户或订单写入，没有签名配置、Stable 指针、手机数据或手机权限操作。
0026–0034、正式 Wrangler 配置、Android manifest 与发布元数据保持原样。
Task26 的 `CLOSED_WITH_OWNER_WAIVER` 及历史豁免没有改成 PASS。

## 2. 原有实现与本轮完善

| 范围 | 原检查点已有能力 | 本轮变化 |
| --- | --- | --- |
| 账户、MFA、恢复 | Task12/20、邮箱绑定与 OTP、TOTP、一次性恢复码、受限临时密码、Step-up | 保留；增加密码规则及旧用户升级验证，没有替换身份模型 |
| 新密码 | 原有至少 7 位规则 | 新注册与今后主动设置的新密码要求至少 9 位，包含 A–Z、a–z、0–9、标点／符号；最长 128 个 Unicode 码点 |
| 旧用户 | 原账户、合法会话及权益 | 旧密码验证不调用新规则；六位旧密码及两种历史哈希在 workerd 中验证通过；没有批量重置或首次强制改密 |
| 管理员重置 | 随机 20 位临时密码、一次显示、旧会话撤销、原 MFA 保留、首次登录受限改密 | 保证每个临时密码均包含四类字符；保留普通管理员不能重置超级管理员的边界 |
| TOTP 绑定 | 本地二维码、手动显示密钥、绑定前确认、AES-GCM、时间步防重放 | 同一服务器 URI 驱动 QR、验证器链接和复制密钥；增加参数／标签、失败指导及 Android 系统 URI 降级 |
| 会话与私有响应 | Web／Android 会话列表、单个／其它／全部撤销、安全事件 | 保留；兼容原有不透明用户 ID；原生 cookie 哨兵不变时也拒绝跨账户的迟到安全响应 |
| 通知与广播 | 铃铛、权威未读数、筛选、逐条与批量已读、单／多／全站个人投递 | 保留；普通已读不写明确确认；旧广播默认仍为广播 |
| 邮件 | 复用 Cloudflare 发信、必要模板、既有草稿／预览／发送记录扩展 | 认证发码失败准确报错，失败挑战作废；公开恢复不承诺发送／送达；没有新增邮件基础设施 |
| 政策和页面 | 三份公开政策、注册主动同意与版本记录、页脚、精简付款说明 | 正文继续使用已确认 TXT；联系方式及版权规则保留，没有帮助中心或额外 Authenticator 应用 |

规则仍为：30 天密码提醒是非强制个人通知；未开启 MFA 的建议是约 30 天一次
的广播；版本更新是广播，重大政策变化进入个人通知。拒绝开启 MFA 或没有定期
改密不会取消会员、锁定账户或令密码到期。

注册同意框不预选，服务端验证当前政策版本并原子保存记录。页脚保留
`© 2025–2026 Aeris. All rights reserved.`，结束年份由实际年份更新；
`support@thewyj.uk`、mailto 链接及“回复邮件可能使用其他邮箱地址。”保留。
当前运行资源不包含私人转发 Gmail，历史邮件测试中的该地址也已替换为
保留测试域名；没有改写 Git 历史或现有邮件转发线路。

## 3. 关键代码与数据合同

| 目的 | 代码 |
| --- | --- |
| Web／服务端共享密码规则 | [password-policy.js](../js/account/password-policy.js)、[Task12 校验](../functions/_lib/task12-model.mjs) |
| 实时要求、显示／隐藏、粘贴与 autocomplete | [password-fields.js](../js/account/password-fields.js)、[安全中心](../js/account/security-center.js) |
| Android 输入兼容及新密码规则 | [AuthInputPolicy.kt](../android/app/src/main/java/uk/thewyj/app/core/auth/AuthInputPolicy.kt) |
| TOTP、加密、临时密码及标准 URI | [task27-crypto.mjs](../functions/_lib/task27-crypto.mjs) |
| 挑战、重新认证、恢复及账户操作 | [task27-auth.mjs](../functions/_lib/task27-auth.mjs)、[task27-security.mjs](../functions/_lib/task27-security.mjs) |
| Android 标准 URI 与失败降级 | [AuthenticatorLauncher.kt](../android/app/src/main/java/uk/thewyj/app/core/web/AuthenticatorLauncher.kt)、[WebView 路由](../android/app/src/main/java/uk/thewyj/app/core/web/ThewyjWebView.kt) |
| 通知、授权与邮件适配 | [通知](../functions/_lib/task27-notifications.mjs)、[API](../functions/_lib/task27-api.mjs)、[邮件](../functions/_lib/task27-mail.mjs) |
| 增量迁移 | [0035](../cloudflare/migrations/0035_task27_security_center.sql) |

完整合同见 [功能与数据合同](TASK27_FUNCTION_AND_DATA_CONTRACT.md)；完整修改文件列表及
受保护路径检查见 [脱敏验收摘要](task27/evidence/acceptance-summary.json)。

0035 仅增加安全状态、挑战、恢复码、事件、个人通知、同意记录、邮件草稿／投递记录，
扩展既有消息渠道及独立 read 时间，并为旧 Web 会话增加公开的不透明 ID。
旧账户 MFA 默认 none、必须改密默认 0。旧密码日期未知时，从可靠基线开始计量，
不使用普通 updated_at 推断密码年龄。没有覆盖原密码哈希、会员或业务记录。
旧 PBKDF2 只有在原有流程验证真实输入正确后才可升级，绝不把旧哈希作为明文处理。

## 4. 开源项目与安全复核

五个项目的官方代码、文档、许可证、运行条件与未采用原因见
[开源与安全复核](task27/OPEN_SOURCE_AND_SECURITY_REVIEW.md)。

OTPAuth 9.6.0 用作独立 oracle；Better Auth 用于核对 2FA 生命周期；Novu 用于
核对通知状态和幂等；ASVS 5.0.0 用于复核认证／会话／授权；node-qrcode 经评估后
继续使用已有 qrcode-generator 2.0.4。**没有增加生产依赖，根 lockfile 未变。**
OTPAuth 与 jsQR 仅在忽略的测试工具目录安装。

本轮不是 ASVS 全面合规或等级认证。所有者确认的字符组合规则与 ASVS 6.2.5
取向不同；普通 MFA 可选、邮箱 OTP、管理员可见临时密码也不能被写成更高等级
认证已通过。本地常见弱密码拒绝集合是基本检查，没有全面 top-3000／泄露库覆盖，
没有将明文密码交给第三方。

## 5. 实际验收

所有记录均为合成账户、隔离数据和本地运行，项目之间有覆盖重叠，不相加成独立用例总数。

| 检查 | 结果与边界 |
| --- | --- |
| Task27 D1/API | **31 组 PASS**：同意不可绕过、MFA 前无完整凭据、过期／错误／重放／并发、权限撤销竞态、恢复、通知隔离与发信故障 |
| 编译后的 Pages worker | **5 项 PASS**：实际 workerd 中的加密绑定、Web／Android MFA、刷新撤销、收件箱及政策页面 |
| 存量升级与密码 | **11 项 PASS**：迁移前后六类表原字段摘要一致；旧 Web 会话、Android Refresh、会员保留；两种六位旧密码哈希有效；新规则 API 直连校验；旧不透明 ID 可重置及投递；业务内容不变 |
| OTPAuth 独立交叉验证 | **256 组 PASS**；**4 类标签**的 QR／URI／手动配置等价；默认 ESM 在 workerd 中 PASS |
| Chrome 实际 UI | **10 项 PASS**：375px 与桌面、实时密码要求、注册同意、三种 TOTP 入口、复制动作、个人收件箱、旧六位密码登录、邮件草稿／预览／确认、三份全文政策 |
| axe | 注册表单及稳定浅／深色安全中心 **无违规**；无水平溢出 |
| Android | **120 suites／831 tests，0 failure／error／skip**；Lint、Debug APK、AndroidTest APK 编译通过；URI 正常交给系统及缺少处理器的降级由 Robolectric 验证 |
| 保留的账户回归 | Task12 **15**、Task18 **8 组**、Task20 **18**、Task15 **19** 均 PASS；邮件 **5 suites PASS** |
| 构建与保护 | Functions build、67 文件模块图、31 个 storage 键族、仓库审计 PASS；allowlist staging **28 tests PASS**；发布回滚门禁 **2 tests PASS**，原 CORE_SHELL 81 身份保留 |

新注册实际拒绝 8 位、缺任一字符类、常见弱密码及超长输入，接受合规 9 位、
Unicode 与 128 位输入；已有用户主动设置新密码执行同样规则。
1000 个服务端临时密码均满足 20 位和四类字符。密码显示、粘贴事件及
`autocomplete=new-password` 保留。

二维码是实际显示 SVG 的独立解码结果，链接与手动密钥按同一配置核对。
浏览器测试没有调用桌面的真实验证器，也没有使用系统剪贴板保存密钥；复制 API
调用用合成夹具验证。Android 的系统 Intent／无处理器测试不能替代真机验收。

证据： [摘要](task27/evidence/acceptance-summary.json)、
[升级](task27/evidence/upgrade_and_strength.json)、[浏览器](task27/evidence/browser.json)、
[workerd](task27/evidence/compiled_workerd.json)、[oracle](task27/evidence/otpauth_oracle.json)。
代表截图位于 `docs/task27/evidence/browser-fd662c8c/`，均为合成数据，未保留 TOTP 密钥画面。
原始日志在忽略路径，摘要保存 SHA-256 与定位。

早期失败保留：首次 Lint 内部分析器崩溃（根因未确认）、缺少新同意／Step-up 的旧
夹具、首次 read-all 提前断言、邮件收件人响应结构、模糊搜索断言、oracle 入口配置，
以及主题过渡中测量对比度。后续没有放松业务断言、关闭 Lint 或禁用服务端权限。
主题检查等待现有有限过渡结束后测量，失败日志未改成 PASS。

## 6. 邮件依赖、未测事项与后续集成

认证业务继续调用既有 `email-service.mjs`，发件使用获准的
`noreply@thewyj.uk`，Reply-To 为 `support@thewyj.uk`。已认证发码失败返回
503／502 等准确错误，绑定失败不会改变邮箱或 MFA；公开找回回执明确只表示请求
受理，不表示已发码。整体邮件底座不可用时，对存在／不存在账户统一失败。
accepted、queued 或收件服务器已接受均不当作用户收件箱实际收到。

Antigravity 并行邮件分支后续变更仍须按接口受控核对；本轮没有合并它、改写其工作树、
启用 Production 发信、读取私人 Gmail 或实现入站客服邮箱。真实发信权限、配额、
送达与回复链路均 **NOT_TESTED**。

远端 CI **NOT_RUN**；Hosted Preview **NOT_DEPLOYED**；Google／Microsoft
Authenticator 真机扫描、URI 接管、手动录入及实际 Android WebView端到端
**OWNER_NOT_TESTED**；Production **NOT_TOUCHED**、生产验收 **NOT_TESTED**。不能将这些门禁标为 PASS。

后续先核对 S0 最终稳定 main，在 Task27 分支受控同步并重跑精确 SHA 的 CI；
在真正隔离的 Preview 备份／核对 schema 后只应用尚未执行的 0035，使用独立
Secret 与获准邮箱完成真实验证。旧 APK 未实现 MFA 挑战时会安全拒绝完成登录；
启用公开 MFA enrollment 前须交付并验收兼容的 Android 候选。签名、版本与
Stable 推广由所有者单独授权，本轮没有执行。

三份政策仍保留已确认正文中的草案与条件式表述。运营主体、辖区、实际保留期限、
第三方清单和正式生效日仍需实际运营者在正式发布前核实。

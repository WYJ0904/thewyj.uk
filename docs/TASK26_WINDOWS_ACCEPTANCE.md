# Task 26 — Windows 电脑端验收与待真机交接

2026-10-11，香港时间。**电脑端可执行验收与清理已完成；Task 26 NOT RELEASED，不能作为 FINAL RELEASE CLOSURE。** 用户现已授权正式发布，旧 USER HOLD 已解除；最新指令暂不提供手机，保留真实设备与完整网络恢复门禁。Task 26 完整发布及 Closure 后才依次开始 Android Hotfix、财务 AI，两项均未启动。

## 当前恢复点

- 复用 `codex/task26-adaptive-learning-mastery` / [Draft PR #105](https://github.com/WYJ0904/thewyj.uk/pull/105)。main 为 `550bc41bbaa01751d75c109f3246b9e174e4460d`，未合并。
- 已真实 Hosted 验收的 Web/API 源码基线 `41b7e49475a2ed7e060c54cea33fc8db0649f440`；[该精确源码 CI 38076109679](https://github.com/WYJ0904/thewyj.uk/actions/runs/38076109679) 的八项 Actions 及 Pages 均 SUCCESS。新增六组 feature refresh 回归使其自动化为 81 组。随后电脑端复核修正独立 Preview 壳的登录 transport，并新增一组跨层回归，当前共 82 组；另有 Preview Android 四项 unit checks，最终 HEAD/CI 以 PR 最新检查及本地报告为准。
- 该源码 Preview deployment `e4a0df82-cc00-41cc-ad53-2ad0dfe7431d`；[受控分支入口](https://codex-task26-adaptive-learni.thewyj-uk.pages.dev)。app.js、sw.js、config.js、mastery.js 与 Git blob 一致，统一缓存版本 `20261011-aeris-task26-r4`。
- 本文及脱敏证据会形成后续文档提交。最后交付 HEAD 的 CI 与部署须读取 PR 最新检查；不能把源码 CI 移称为另一个 HEAD 的 CI。本地最终报告单独保存该精确结果，避免为自引用反复提交。
- Hosted API 验收发生在同一 Task26 分支；`598769c..41b7e49` 的 `functions/` 和 migration SQL 无差异。新增修复只涉及浏览器 feature snapshot 生命周期与独立测试壳；最新源码重新完成实际 Hosted 页面验收。

## Preview D1 与管理员访问

Preview 精确绑定 `wyj-cloud-preview` / `a3e6253b-689f-49f3-998b-7c5828ea255a`。Production ID `11c288d8-c584-409f-bb1f-7e7af11793e5` 未用于写操作。

0025 已在 2026-10-10 15:10:43 UTC 官方应用一次，本轮未重迁移。Canonical SHA256 `4664bbc91a8d1b6158ee58532186b38c870cb677c17c289e072e1cb4afd4adef`，唯一 ledger、4 表、4 索引、immutable trigger 与三项版本 metadata 已通过真实 D1 验证。立即迁移前 bookmark `0000070e-0000000a-00005100-fb9146cbbfe96228c513d3e1b88bd01b` 仅保存，未 restore。

Task12/Task18 审计发现唯一原 Preview owner 为 `reset_required`、无有效密码哈希，且没有可用其他管理员；失败不能靠 Production 会话解决。依用户明确授权，经正常 Preview register/login 建立四个专用账户，由服务端按真实 Preview Pepper 生成 `pbkdf2_sha256_cf_v1` / 310000 iterations 哈希。这证明实际 Pepper 可用，不是仅凭 secret 名称推断。没有读取、复制或覆盖 Pepper，也没有重置原账户。

通过合法 Cloudflare D1 管理，仅向精确新账户授予 Task18 `admin`，保留管理操作 audit，明确不冒称存在应用 owner session。没有 super_admin、伪造 session、鉴权旁路或永久后门。普通新管理员正常登录后 Flags/metrics 200，owner import 403。A/B 仅获现有双语言会员；finance/notification entitlement 均未授予，价格不变。

## 真实 Hosted 验收

| 证据 | 实际结果 |
| --- | --- |
| API/D1 44 项 | PASS：英日 opaque ticket、确定性正误判定、掌握度/confidence、持久化、弱项、重复原收据、冲突 409、跨账户 404、注入 400、普通 Admin 403、无会员 403、三通道、kill 与恢复 |
| 自然到期复习 6 组 | PASS：等待实际 10 分钟后，英日 due 1→0、review_count=1；没有修改时钟、backdate D1 或注入状态；reconcile 与 pending receipts=0 |
| 旧业务 API 5 组 | PASS：普通会员与免费账户 Quiz；原 sync 路径错题/历史写入与 fresh pull；跨账户隔离；历史 client score 不改变 verified Mastery |
| Workers AI | 英语和日语实际 `ai_status=generated`、`source=workers_ai`；AI OFF 返回课程解析。AI 只解释已判定学习答案，不是财务 AI 或 Mastery authority |
| Chrome 真实页面 | 正常 Admin 登录与诊断；英日正误题/AI 文本；刷新恢复锁定收据；两个窗口的新题/收据与 draft 清理；A→B 正常登录切换无串数据 |
| Chrome 到期复习 | `cat` 实际回答“猫”：score 0→约 11，待复习 1→0、待同步清零 |
| 普通 Quiz 与 kill | kill 开启时开始旧 Quiz 并回答首题，恢复后完成 2/2、100%；kill 时 Mastery 隐藏、旧 Quiz 可见。UI 记录在 kill 后约 65 秒读取，不宣称实测 30 秒内生效 |
| live backend outbox | 无浏览器的真实 Hosted transport 丢响应注入：持久队列恢复稳定 ID；服务端接受后丢收据；同 ID retry 原 seq，D1 count 始终 1，确认后 queue 0 |

**Hosted Chrome 实际断网/重连：NOT EXECUTED。** 受支持浏览器工具只有 viewport，没有 network capability。本地/CI 的真实 Chromium 断网测试已通过，live backend outbox 验证也已完成，但两者不能冒称 Hosted Chrome 或 Samsung 断网 PASS。该项保留到真机网络验收。一次 390px Hosted 捕获发生在 Flags 已恢复 OFF 后，Mastery controls 为空；只记录普通页面无 overflow，不作为 Mastery 可见性 PASS。最新软件 CI 仍执行原五宽度/深浅色/大字号完整矩阵。

## 发现并修复的实际问题

Hosted 页面首次选题请求被 feature refresh 取消：旧刷新在尚未过期时清空有效 snapshot，引发 Mastery observer 停止请求。新增回归在旧实现实际失败，修复保留同账户未过期状态，提前续期并设置原 expires_at 的独立失效边界。网络失败、错误 owner、后台、离线或到期仍关闭；未延长授权 TTL，服务端校验不变。六组新回归与最终八项 CI 通过，runtime/SW/imports 统一更新至 r4。

本地私有 vault 出现一次编码错误：PowerShell 输入代码页破坏非 ASCII JSON，serializer 异常把四个专用测试账户的解密凭据/session 写入工具错误日志。只涉及本轮新账户，未涉及原用户或 Production。已即时通过正常改密接口轮换四个测试密钥；旧 session 均真实 401、新正常登录 200。修复 UTF-8 输入/输出及 generic error suppression，Windows DPAPI CurrentUser 存储保持。验收完成后这四个账户又全部软删除、当前 session 作废；公开证据没有凭据。不能声称从未发生泄露。

清理阶段一次精确账户只读查询返回 Cloudflare 7403；原失败保留。正常 `whoami` 核对预期账户/D1 scope、随后 SELECT 1 零写入成功后，从保存的步骤继续。未覆盖任何密钥，确切后端原因未确立，不把它包装成持续缺少用户权限。

## 专用 fixture 清理与原业务保护：PASS

清理完成时间 2026-10-10 19:01:17.940 UTC。仅操作四个已登记精确账户和先前首次注册产生的精确孤立账户，没有按前缀批量删除。

- 五个新 Flags 恢复原 description、OFF、kill=false、0%、Experimental-only；真实 revisions/audits 保留。
- 15 个专用 overrides 经正常 CAS API 设为 null，保留无效审计 tombstone；原 overrides 逐项相等。
- A/B 专用会员取消；四账户正常自身注销。临时 admin 先经已授权 Cloudflare 管理撤销精确 role，再真实验证现有 session 的 Admin 403，之后自身注销。
- 五账户 deleted=1 / password_scheme=invalid；专用有效 session、role、membership、override 均 0。原 owner 仍唯一、未封禁/删除，`reset_required` 与空 hash 状态不变。
- 原业务排除五个 fixture 后：users 64、learning sync records 138、memberships 8、finance transactions 4、notification events 10；plans 11、entitlements 39、upload files 62、upload sessions 49、shares 1，均与实际迁移后/测试前 baseline 相等。
- 六组原配置逐项/哈希相等。88 旧表中 70 张总计数不变，18 张记录实际 fixture、审计、限流或运行状态变化；未删除这些变化来制造“全部计数相等”。这是聚合/配置和精确操作范围证据，不声称逐字节检查全部用户内容。
- Task26 原用户 events/states 均 0；专用学习事件、投影和不可变审计保留，pending receipts=0，唯一 0025 ledger 时间不变。没有删除 learning ledger 或 restore 数据库。

## 独立 Preview Android 测试包：静态 PASS，真机 NOT TESTED

模块 `android/task26-preview`，独立包 `uk.thewyj.app.preview` / `Aeris Task26 Preview` / `0.0.1-task26-preview` (1)，固定本 PR Preview origin。原 `:app` 代码、manifest、签名和版本元数据未改。

最终 APK 6,656,889 bytes；SHA256 `3712b3b75779f11a1ce27738702d6a5224c86e9ca5a9f28bcc6eb09722ba8d98`；本地 debug signer SHA256 `9ea45db6e2c398de90ce61affd145e432d63d0d1724dd6447ba4ba24193f4fac`，明确不是原生产签名。四项 unit tests、lint（0 errors，warnings 保留）、assembly 均通过；final APK manifest services/receivers/providers/deep links=0、无 shared UID；只有 Internet/network-state 和包自身 receiver signature permission。先前包的 `9441e045…` 仅为历史静态候选，已被该最终测试包取代，没有安装过。

电脑端复核发现初版壳使用 `thewyj-android/…` 标识，使实际 `session.js` 误选原生 Cookie transport、跳过 Web session 持久化，并请求壳不支持的正式 native deep link。跨层回归读取壳的实际 UA/版本并调用真实 Web session controller，在旧壳上实测失败（native=true，期望 false）。改为专用 `Task26Preview/…` 后，普通 Web session 保存/恢复及 header、拒绝 native refresh/logout 均通过；正式 App 原 native 正向识别仍通过，原 `session.js` 未修改。重新构建与 package/signature/manifest 校验通过。这是电脑端登录契约验证，仍不冒充真机实际登录或原 App50 Cookie 验收。

独立 Android sandbox/Cookie/cache/account store，不依赖 `:app`、Room、通知/无障碍/财务/支付/更新器或 JS native session bridge。WebView 与 ServiceWorker 均限制 HTTPS 受控 origin/API，拒绝正式业务/external/file/content/download。Release variants 禁用。可见网络按钮只阻断本壳 WebView/SW，必须称定向故障注入，不能称手机无线网络断开。未上传 R2/Stable。

用户暂不提供手机后没有执行 ADB 安装或运行。Samsung SM-S9360 / Android16 的此前 App50 包名、原签名、APK hash 与原首页仅为基线；不能换标签充当新 Preview 或 Task26 功能 PASS。

## 剩余门禁与下一步

1. 用户重新提供手机后只安装独立测试包，保留 `uk.thewyj.app` 的版本、数据和 Cookie。以新的精确专用 Preview fixture 验证英日/复习/AI/会员/通道/kill、前后台/重启、真实离线重连及受控丢响应、独立缓存/账户；结束再次清理并恢复 Flags。当前测试凭据已经无效，不可复用。
2. 全部 Hosted/适用真机门禁 PASS 后，审核 PR、Ready、确认精确 HEAD CI、合并与 main CI。没有因缺少手机而放宽门禁。
3. 合并后执行 Production D1 只读 preflight/bookmark/旧数据对照，0025 一次、schema/ledger、默认 OFF 部署/smoke，再按 Experimental→Beta→受控 Stable 实际观察指标/kill。最后使用原 Samsung App50 验证真实 Production WebView、发布正式更新日志并完成 Release Closure。
4. Task26 正式 Closure 后自动继续独立 Android Hotfix，完成原签名/真机/发布/Closure，再开始独立财务 Workers AI 审计与实现。不启动 Task27。

Production 当前仍是 `575097ca-d940-4100-af6f-cb689518c7b4` / main `550bc41`，Stable `1.3.37/50`；public config/APK hash/size 保持。Production 0025、部署、放量、App50 Task26 功能验收与正式 changelog 均 NOT EXECUTED。回退策略仍为关闭 flags/master、保留 additive schema/events、恢复同项目兼容部署；没有活动 rollback、全库清理或正式 APK 覆盖。

证据：[`releases/task26/2026-10-11-windows`](releases/task26/2026-10-11-windows)。包含实际 Hosted checks/浏览器截图、清理/audit、原业务聚合比较、私有 vault 事件整改、源码 CI、公开部署检查及独立 APK 静态验证；不含密钥、session 或密码哈希原文。

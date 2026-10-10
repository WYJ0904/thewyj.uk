# Task 26 — Cloud implementation closure / Draft handoff

2026-10-10，沿用 `codex/task26-adaptive-learning-mastery`。本轮交付 API、D1 迁移代码、Web UI、自动化验证及 Draft PR；**不是正式 Production release Closure**。最新用户明确禁止合并或部署 Production，Task 27 未启动。

| 验收项目 | 真实状态 |
| --- | --- |
| TASK 26 IMPLEMENTATION | PASS — server-authoritative mastery-v1、adaptive/review、课程/AI fallback、API、Admin 聚合诊断与 Web UI 已实现 |
| TASK 26 AUTOMATED TESTS | IN PROGRESS — 本地 engine29、D1/API26、client17 已通过；最终 exact-source Core CI 等待结果 |
| D1 MIGRATION CODE | PASS — additive 0025，本地官方 ledger apply 与 replay/旧数据保护通过；只读 preflight/schema 文件已实际执行 |
| TASK 26 HOSTED PREVIEW ACCEPTANCE | LOCAL_REQUIRED / BLOCKED — Git Preview 部署与公开资源验证通过；登录后 schema/API/Admin 完整流程未执行 |
| TASK 26 PHYSICAL DEVICE ACCEPTANCE | LOCAL_REQUIRED / NOT EXECUTED — 没有当前可访问的实体 Samsung，不以云端浏览器/transport/emulator 替代 |
| TASK 26 ANDROID BINARY | NOT REQUIRED — native 源码与正式 1.3.37/50 package/version/signing/update metadata 未改变 |
| TASK 26 PRODUCTION RELEASE | NOT EXECUTED — USER HOLD；无远程 0025、部署、rollout、Stable promotion |
| TASK 26 | NOT RELEASED / BLOCKED |
| READY FOR TASK 27 | NO |

## 源码、PR 与 CI

- Released base/current main：`550bc41bbaa01751d75c109f3246b9e174e4460d`；[Release B Closure](RELEASE_B_FINAL_CLOSURE.md) 及 [PR104 正式记录](https://github.com/WYJ0904/thewyj.uk/pull/104#issuecomment-6096339363)。Task 25 既有完成证据保留，不重做、不降级或伪造设备 PASS。
- [Draft PR #105](https://github.com/WYJ0904/thewyj.uk/pull/105)：OPEN / Draft，可 clean merge，但本轮不 merge、不转 Ready。
- 最新代码验证 checkpoint：`678d646c9a279ad69de0e09dbb39f13271833992`；[Core CI 38053754900](https://github.com/WYJ0904/thewyj.uk/actions/runs/38053754900) 正在执行，最终记录将在完成后补齐。
- [保留的失败 run 38053153749](https://github.com/WYJ0904/thewyj.uk/actions/runs/38053153749)：Python/JS 静态合同仍固定 Release B 的缓存 token；资源已经一致更新，测试错误拒绝新的合法缓存版本。修复以唯一 ASSET_RELEASE 为基准，仍逐个核对 manifest/CSS/entry/import/SW cache；没有删断言、跳过用例或改正确性预期。仅重跑三个受影响本地用例，均 PASS；整合新源码由必要 Core CI 验证。
- [后续失败 run 38053754900](https://github.com/WYJ0904/thewyj.uk/actions/runs/38053754900)：上述六项基础检查通过；应用 PWA cache lookup 和 P6 parked-row fixture 仍请求旧 query URL，后者与当前 imports 生成两个独立模块/WeakMap，丢失 parked identity/draft。已统一 QA 的资源版本读取，保留全部行为断言，并检查实际当前 cache name；本地受影响 PWA 离线/恢复验证通过。失败未隐藏或删除。

## 已实际完成的验证

- Engine 29 组：正确/错误、计时/难度、连续结果、重复/跨日题族证据、review/decay、界限/版本/重放、空历史和 deterministic 选题。
- D1/API 26 组：完整 forward migration 和 replay，所有既有表记录/会员价格/旧 Task25 settings 保留；auth/entitlement/CSRF/限流、opaque ticket、输入校验、单结果、重复/冲突/并发、CAS 重放、projection 失败后恢复、过期/算法不匹配、语言隔离、browser/native/WebView canonical transport、Admin 只读/非管理员拒绝、三通道/user/%/bucket/kill/audit、AI cache/配额/真实 timeout/异常输出/课程 fallback、原文不落库、120-event/4-query 批量恢复。
- Client 17 组：账户和 storage version 隔离、稳定 ID、队列上限不丢数据、无本地 authority、严格收据/缓存验证、旧响应不覆盖新状态、delayed-response/account switch、flag OFF 不提交。离线时 flag refresh 不能取消已开始的安全持久化。
- 本地真实 Chromium 对隔离 Pages/D1：320px 曾通过 `7ee41f2` 的同版 CSS；修复离线 flag-refresh 竞态后的390/768/1366/1920px 已通过，均 light/dark/150%文字、44px controls、无横向 overflow、runtime errors=[]。390 包含真实 CDP 断网、服务已接受后丢响应、同 ID retry、malformed 响应保留 cache。最终 CI 将用完整五宽度矩阵验证最终源码，不能把四结果 JSON 描述为同 HEAD 五宽度 PASS。
- Wrangler 本地官方001–0025 apply、functions compile、module graph、storage-contract、repository audit 已完成；新只读 preflight/schema 查询执行成功，4表/4索引/1trigger、schema1/mastery-v1/aeris-language-v1、invalid rows=0、pending receipts=0。测试账户和 flags 仅存在隔离 fixture，不在真实 Preview/Production 制造测试条件。

本地 QA 的真实失败记录保留：theme 三态与 DOM readiness 误判、错误旧控件 ID、CSP 拒绝测试内联 style、确认前的异步 UI 等待，以及真实离线队列竞态。使用实际 DOM 等待/DevTools 字号探测修复 harness，产品 CSP 未放宽，runtime assertion 未移除；产品持久化竞态已独立修复。

## Migration、flags 与 Hosted Preview

- Canonical migration：`0025_adaptive_learning_mastery.sql`，SHA256 `4664bbc91a8d1b6158ee58532186b38c870cb677c17c289e072e1cb4afd4adef`。
- 4 张 additive 表、4 个索引、immutable event trigger；官方 ledger `wyj_d1_migrations`。没有删除旧字段、重建会员/AI cache 表、重置历史 Mastery 或单独插入远程 ledger。
- 新定义 `adaptive_learning`、`mastery_score`、`adaptive_review`、`ai_error_explanation`、`similar_word_explanation` 默认 OFF / 0% / Experimental-only。Production/root `TASK26_ADAPTIVE_LEARNING_ENABLED=false`；Preview eligibility=true。Local tests 的临时放量不能代表 remote flags 已开启。
- [真实 Git Preview](https://7c49f313.thewyj-uk.pages.dev)，deployment `7c49f313-0721-4e79-9d6f-ac90c28b4f5e`，source678d646：Pages SUCCESS；app.js/sw.js/core config byte-for-byte 与源码相符；app config200；匿名 `/api/features` 与新 mastery summary401。这证明当前部署/鉴权边界，不证明登录后的 schema/migration/write/admin acceptance。
- Remote Preview ledger/0025/schema/bookmark：NOT EXECUTED；没有合法 Cloudflare 管理凭据/hosted Admin session。根因与 Windows 最短接续步骤在 [TASK26_HANDOFF.md](TASK26_HANDOFF.md)。

## Production 与 Android 保护

Production 仍是 Release B `575097ca-d940-4100-af6f-cb689518c7b4` / main550bc41。当前 public config 返回 `uk.thewyj.app` / `1.3.37` /50；APK `app/android/thewyj-android-1.3.37.apk`，SHA256 `9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a`，48,124,983 bytes；原 signer SHA256 `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03` 的既有真实 Release B 证据保留，没有假称本轮新签名。

Task 26 没有修改 native source、签名 identity、R2 object、Stable pointer/update metadata，也未发布新 APK/AAB/changelog。没有新的原签名候选，所以新的 APK/AAB hash 是 NOT APPLICABLE，不把既有50 hash 写作新 candidate。Task 26 WebView 物理行为未验收。

Production migration/deployment/smoke、Experimental/Beta/percentage Stable 真实 staged rollout、kill/rollback：NOT EXECUTED。没有管理 token 不能假称私有 ledger 已核验；本轮也没有对 Production 写入、删除真实用户/财务/通知/文件/学习数据。**删除或重置真实用户数据：0；活动 rollback：无。** rollback 策略是先关 flags/master，保留 additive schema/events，恢复当前已验证同项目部署，绝不 reset D1 或覆盖 APK。

## 交付结论

软件实现与本地自动化证据可审查，Draft PR 保留发布边界。后续首先恢复合法 Preview D1 管理和 Admin 浏览器会话，再执行真实远程 migration/full-flow/cleanup；实体 Samsung 项目单独 LOCAL_REQUIRED。缺失的 signing inputs 仅在未来需要改 native 并发布新二进制时成为 signing gate，本轮没有用新密钥绕过。

**CLOUD IMPLEMENTATION：PASS；FINAL CI：PENDING；HOSTED PREVIEW：LOCAL_REQUIRED；PRODUCTION：USER HOLD；TASK 26：NOT RELEASED；READY FOR TASK 27：NO。**

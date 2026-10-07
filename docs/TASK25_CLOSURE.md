# Task 25 Closure Report — release blocked

UTC date: 2026-10-07. Repository: [WYJ0904/thewyj.uk](https://github.com/WYJ0904/thewyj.uk). Branch: `codex/task25-flags-release-channels`. [Draft PR #96](https://github.com/WYJ0904/thewyj.uk/pull/96). Base/main HEAD remains `efc05c3596c83a12d668911c5f891d2d5f3c395a`.

**软件实现和可执行自动化测试已完成，最终软件分支 CI 8/8 PASS。2026-10-07 托管 Preview 的账户身份、feature snapshot 和三通道验收也已通过，取代昨日的 schema-not-ready 状态。完整软件发布验收仍受远程管理员放量、Production D1 管理与既有签名凭据阻塞；Samsung 真机验收另行保留。没有开始 Task 26。**

```text
TASK 25 SOFTWARE IMPLEMENTATION / AUTOMATED TESTS: PASS
TASK 25 SOFTWARE: BLOCKED — hosted admin rollout, Production migration and existing release-signing gates
PHYSICAL DEVICE ACCEPTANCE: BLOCKED / NOT EXECUTED
TASK 25 RELEASE STATUS: BLOCKED
READY FOR TASK 26: NO
```

本次不符合“唯一剩余项是实体 Samsung”的条件，因此不能使用整体 `TASK 25 SOFTWARE: PASS` 或 `TASK 25: PASS`。CI 通过、unsigned candidate 构建通过、Pages 部署成功也分别不等于 Production/签名/真机验收通过。

## 自动恢复与范围

- 从仓库、已合并 PR、Actions 和最终 closure 自动恢复了 Experience Pass P1–P6：全部 PASS，复用既有证据，没有重做旧 BLOCKED 检查点。[P6 最终 closure](https://github.com/WYJ0904/thewyj.uk/pull/93#issuecomment-6007877132)明确 Experience Pass COMPLETE；后续 #94/#95 也已闭环。各阶段来源见 [execution record](TASK25_EXECUTION.md#experience-pass-recovery)。
- 没有将历史 Windows 路径设为云端执行前提，也没有将 Android 软件工作整体归类为 DEVICE-DEPENDENT。
- 仓库中未找到原 Task 25 详细计划；本次实现范围按用户明确的云端交接规则执行：Feature Flags、服务端管理 contract/UI、账户通道、百分比放量/kill switch、native/WebView 一致性、migration、candidate 和 Stable 保护。
- 软件代码验收与固定候选源 HEAD：`13b952fd64e502aec6af0e800c9a4a3be737d5da`。后续提交记录证据、恢复脚本和修正凭据发现字段；没有更改业务软件或 Stable 发布配置。

## 已完成的软件

| 项目 | 实现与验证 |
| --- | --- |
| Migration | `0024_feature_flags_release_channels.sql`，仅新增 Task 25 表/索引/trigger；重复执行不覆盖现有记录；本地全 24 migrations PASS；两项无害 seed 全局 OFF |
| Evaluation engine | global OFF/ON、账户 ON/OFF/inherit override、Stable/Beta/Experimental gating、0–100% 放量、SHA-256 deterministic bucket、kill switch；override 不能绕过全局 OFF/kill/channel |
| API/security | 账户与管理员鉴权、沿用 CSRF、严格输入、body/rate limits、私有 no-store snapshot、审计、revision CAS、并发失败写入隔离、只读预演 |
| Web/UI | 管理 console、账户通道选择、审计展示、无害 cosmetic badge；390/1366px 实际 Chromium 验证；XSS 输入按文本展示；离线关闭/恢复、过期与账户切换保持 fail-closed |
| Android | 同一服务端 snapshot、内存缓存、过期/暂停/离线/账户变更关闭功能；原有身份凭据和业务权限保留；native 账户通道 UI；共享 parser contract |
| Release channels | 账户三通道偏好与 feature gating 已实现。通道选择不能安装 APK 或改变正式 update metadata；所有通道继续使用现有 Stable binary，candidate 单独保留未发布 |
| Release protection | candidate 用 Gradle properties 指定 1.3.34/47，默认源版本仍 1.3.33/46；APK/AAB hash/metadata 独立生成，`stablePromotionAllowed:false`；既有签名 workflow 核验 Stable certificate，未生成替代 keystore |

详细字段、优先级、TTL 与重跑命令见 [TASK25_CONTRACT.md](TASK25_CONTRACT.md)。Feature Flag 不授予 Finance/Notification/File 或会员权限。

## 自动化验收与 GitHub

| 验收 | 结果与证据 |
| --- | --- |
| D1/API/Worker integration | 12 acceptance groups PASS，覆盖放量边界、1000 个 synthetic IDs、独立 SHA bucket oracle、幂等 migration、审计、并发、鉴权/CSRF/限流、真实 synthetic native session + WebView cookie + browser token 的 canonical account 一致性 |
| Shared Web/native contract | 19 vectors PASS；未知/过期/畸形/错误账户返回 OFF |
| 实际本地 Pages/D1/R2 browser | 390/1366px PASS；管理员创建、0% 放量、override、kill switch、三通道持久化、XSS、无横向溢出；实际 ON flag 断网后 OFF，重新读取后 ON |
| Android JVM | 520 tests、76 XML suites，0 failures/errors/skips |
| Android lint/build | lint PASS（0 errors，85 warnings）；debug APK、instrumentation compile、release APK/AAB、candidate 47 构建 PASS |
| Android software runtime | Android 11/API 30 `google_apis` x86_64 emulator：一个 instrumentation test 执行全部 19 shared cases PASS；[job](https://github.com/WYJ0904/thewyj.uk/actions/runs/37505935692/job/112415101968)，[artifact](https://github.com/WYJ0904/thewyj.uk/actions/runs/37505935692/artifacts/11432770347) |
| Static/release safeguards | 31 static tests、36 release consistency checks、module graph/storage contract/cloud-only gate、Pages Functions build PASS；实际 debug/release package/version 检查 PASS |
| Core CI | 最终软件提交 `c2a4801` 的 [37512761641](https://github.com/WYJ0904/thewyj.uk/actions/runs/37512761641) SUCCESS，8/8：Python、JavaScript/static、repository audit、Android unit/lint/candidate、Android runtime、application browser、cloud-only browser、credential discovery；固定 candidate 的 [37505935692](https://github.com/WYJ0904/thewyj.uk/actions/runs/37505935692) 也为 8/8 SUCCESS |
| CI 修复 | 首次 emulator `sdkmanager` PATH 错误已修正为解析 runner 实际 SDK 路径，最终 runtime PASS；没有删减失败产品断言 |

凭据 discovery job 的 green 仅表示检查完成。其原先从 API token 缺失推断 Preview 不可部署的字段已由真实 Git integration/HTTP 证据纠正；现在将 D1/R2 管理和 Pages 发布分别记录。

后续报告提交 `1a30f17` 的 CI [37509287826](https://github.com/WYJ0904/thewyj.uk/actions/runs/37509287826) 曾有两次失败：P33 重载后的可见/布局等待竞态，以及 Wrangler Pages 开发代理连接重置导致 P4 请求失败。这些失败保留在 Actions。修复将 Pages CI 对齐云端 Node 24，并在首页几何采样前等待可见与 ResizeObserver 帧布局；保留全部原断言。Local P33 全部 guest/authenticated/reload cases 与 P4 三尺寸验证通过。最终软件分支 `c2a4801` 的 [37512761641](https://github.com/WYJ0904/thewyj.uk/actions/runs/37512761641) 已实际完成，8/8 SUCCESS，取代上述失败的 follow-up 检查点。此后文档提交的检查结果以 PR #96 closure addendum 和最新 Actions 为准。

证据提交 `d7a5f3f` 的 [37615300468](https://github.com/WYJ0904/thewyj.uk/actions/runs/37615300468) 另捕获 P1 恢复断言的观察时序问题：250ms 合并写入的持久化进度可能落后于已显示的百分比。测试现在等待确认进度超过暂停时的实际显示值后再恢复，并保留原有隐藏/恢复/session 断言。实际本地 Pages/D1/R2 browser PASS，观察值见 [p1-resume-regression.json](task25/evidence/p1-resume-regression.json)。没有修改生产上传或 Task 25 产品代码。修复后的完整 CI 状态以最终 PR closure addendum 为准；失败 run 保留，不算 PASS。

P1 修复的 [37617315706](https://github.com/WYJ0904/thewyj.uk/actions/runs/37617315706) 实际通过 P1（隐藏 16%，恢复 32%，session 保留），但在后续 P5 工具行身份断言失败，因此整轮仍为 FAILURE。P5 现在先等待账户偏好缓存及全部 103 张目录卡片反映该偏好，再采样“模型不变”时的行身份，保留全部原有身份/草稿断言并增加失败诊断。实际本地验证全部 PASS，见 [p5-hydration-regression.json](task25/evidence/p5-hydration-regression.json)。产品代码不变，最终完整 CI 以 PR closure addendum 为准。

可恢复证据位于 [docs/task25/evidence](task25/evidence)：`core-ci.json`、`local-software-acceptance.json`、`android-runtime-acceptance.json`、`browser-acceptance.json`、候选 metadata、hosted Preview smoke 和 Production Stable smoke。GitHub artifact 有保留期限，关键状态/来源/hash 同时保存在仓库；会话文本不是唯一记录。

## Cloudflare Preview 与 Production

现有 Cloudflare **Git integration 可以部署 Pages**。最终软件提交已发布至 [Preview 8e567f72](https://8e567f72.thewyj-uk.pages.dev)，branch alias 为 [codex-task25-flags-release-c](https://codex-task25-flags-release-c.thewyj-uk.pages.dev)。没有新建平行基础设施。

| 项目 | 实测状态 |
| --- | --- |
| 配置边界 | Preview D1 `a3e6253b-689f-49f3-998b-7c5828ea255a` / R2 `wyj-cloud-preview`；Production D1 `11c288d8-c584-409f-bb1f-7e7af11793e5` / R2 `wyj-cloud-production`，原 bindings 未变 |
| Hosted Preview | `api/status` 200，environment=preview、D1/R2 bindings=true、Task 25 master ON；app config 200，Stable 46/hash 保留 |
| Hosted authentication | 仅新建 synthetic Preview 账户；注册 201、browser/native login 200、匿名 feature 请求 401、普通用户 admin 请求 403；未改变真实用户、Finance、Notification、File 数据 |
| Hosted Task 25 contract | 2026-10-07 实际复测：browser token、native token、WebView cookie 全部 200，canonical account 与 flag decisions 一致；Beta → Experimental → Stable 切换全部 PASS。昨日三路 `503 task25_schema_not_ready` 仅为历史检查点。远程管理员 flag/rollout mutation 未执行，普通用户权限拒绝 403 PASS |
| Preview migration provenance | API 的 schema marker 检查和 D1 读写已可用，但本会话没有执行 remote migration；直接 D1/migration ledger 检查仍缺管理凭据。不能据此宣称已核验迁移执行者、时间或远程 ledger |
| Cloudflare API | 本地 Wrangler 未登录；实际 Pages API、remote D1、R2 管理命令均因缺 API token 拒绝；Actions 也证明标准 token/account bindings 未配置。Git integration 不提供本会话 D1/R2 管理凭据 |
| Production migration | NOT EXECUTED；直接 remote schema 检查被凭据阻断；没有 reset/drop/覆盖 Production D1 |
| Production Task 25 deployment | NOT EXECUTED；保留 Draft PR，远程管理员放量和 Production schema/migration gate 未通过，因此未合并触发 Production 发布 |
| Existing Production smoke | `api/status`、`api/app/config`、完整 APK 下载均 200；metadata 与发现基线相同；完整 APK hash 与基线相同。这是既有 Production 的只读 smoke，不是 Task 25 Production acceptance |

最新证据：[hosted-preview-smoke-20261007.json](task25/evidence/hosted-preview-smoke-20261007.json)、[final-state-20261007.json](task25/evidence/final-state-20261007.json)、[cloud-readiness.json](task25/evidence/cloud-readiness.json)。昨日 [hosted-preview-smoke.json](task25/evidence/hosted-preview-smoke.json) 的 503 和 [production-stable-smoke.json](task25/evidence/production-stable-smoke.json) 的完整 APK hash 保留为历史证据。`qa/task25/remote-preview-smoke.py` 先核验 Pages hostname 和 environment=preview，才创建 synthetic 账户；凭据不进入报告。本次新增一个 synthetic Preview 账户，仅切换其自身通道并撤销此次 browser/native sessions。早期两次 probe 也仅创建 synthetic Preview 账户；未触及真实用户。

## Android candidate 与 Stable

固定 GitHub candidate：[artifact 11432003030](https://github.com/WYJ0904/thewyj.uk/actions/runs/37505935692/artifacts/11432003030)，source HEAD `13b952f`，90 天保留。ZIP、APK 和 AAB hashes 已下载独立计算，并用 aapt2 检查 APK 实际 package/version。状态是 **unsigned / unreleased**，不能作为签名兼容或可安装升级验收。

| 产物 | 值 |
| --- | --- |
| Candidate package/version | `uk.thewyj.app`, 1.3.34 / 47 |
| CI APK | 47,898,061 bytes；SHA-256 `c43875b6028a10f825c816e7bb062c8f1cf27ef7c37462cbee8b73fb34730351` |
| CI AAB | 24,663,647 bytes；SHA-256 `0764029b1c0df5dfabc37e2c826a0ab4cd7c78b1af0eaf149d0a1bb88c0ccfd2` |
| Local candidate | 另一次云端构建，hash 独立记录于 [candidate-local-metadata.json](task25/evidence/candidate-local-metadata.json)，不与 CI 文件混用 |
| Signing | Fresh [37505069396](https://github.com/WYJ0904/thewyj.uk/actions/runs/37505069396) FAILED at Validate signing secrets；四项既有 signer secret 全部缺失；没有替换 signing identity |
| Stable promotion | `stablePromotionAllowed:false`；candidate 未上传/覆盖 Stable R2，未改变 latest/download pointer |

当前 Stable 保持 1.3.33/46，R2 `app/android/thewyj-android-1.3.33.apk`，47,893,965 bytes，SHA-256 `17da079bc7428dc87b1b0b2141ca011f6297101fba3a5d2cc6bbac3fe289048c`，certificate SHA-256 `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`。`android/release-metadata.json` 与所有环境 `ANDROID_*` bindings 保持原值。

## Samsung 物理验收

当前云端 adb device list 为空。以下项目 **全部 NOT EXECUTED / DEVICE-DEPENDENT，绝不计为 PASS**：

- 正式 1.3.33 APK → 同签名 candidate 的 Samsung 原地升级和安装签名兼容最终确认。
- Samsung Android Back/Resume 与实际 WebView 行为。
- 真机断网/恢复、haptic、系统权限与安装权限。

既有 P1–P6 的真机 PASS 属于其已闭环版本，不能替代本次 candidate 的验收。API/JVM/emulator/Chromium 软件证明已完成，但不声称三星真机已验证。

## Blockers 与继续执行边界

1. **Remote administration credential**：Pages 部署和 Preview 用户 contract PASS。缺少授权管理员 session，未执行 hosted admin flag/rollout mutation；缺少 Cloudflare API token，无法直接检查 Preview migration ledger 或进行 Production D1 preflight/migration/功能验收。2026-10-07 实际 Production 只读 SQL 再次因缺 token 拒绝。
2. **Existing Android signer credential**：四项 signing secret 缺失，无法生成与当前 Stable certificate 一致的 signed candidate；unsigned 软件产物已完成。
3. **Physical Samsung**：云端没有实体 Samsung，以上升级/设备行为验收未执行。

后续 Codex 先读取当前 branch/status、main、PR #96、Actions 和 execution/closure 文件，从这些点继续。可用凭据出现后先检查 Preview/Production schema 与 migration ledger，再仅执行既有 additive migration；以 synthetic Preview 账户/无害 flag 完成远程 contract 后才作 server/web Production 发布决定；既有 signer 构建核验证书后再进行物理 gate。不要重做 P1–P6，不要 reset Production，不要提前移动 Stable pointer，不要开始 Task 26。

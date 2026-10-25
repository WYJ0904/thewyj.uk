# P03/P04 与 Experimental 体验通道的交付核查

2026-10-24，Asia/Hong_Kong。本文为本轮独立核查，不覆盖 `ce7c87e` 已封存报告、原始失败或验收门禁。**P03/P04 仍为 PARTIAL；Production 变更未获授权。**

当前已证实：上一轮截图来自专属 Cloudflare Pages Preview 的合成账户；该 Preview 随测试结束已删除。账户选择 Experimental 不会从本地分支下载新源码，也不会分发尚未发布的 Android APK。P04 多币种界面在当前实现中没有独立 Task25 Feature Flag，因此不能靠切换现有通道打开未部署的 P04 代码。

本轮用户已接受独立 Preview 的空白账本；**这不等于真实 Production 账户认证已经接通，也不等于正式账目已导入或允许写入正式账本。** 新 Preview 的实际部署、登录及操作结果须在本文对应位置补充，未执行前全部标为 NOT TESTED。

## 1. 本地、远端和用户访问版本对照

| 对象 | 提交 / 部署身份 | 当前结论与证据 |
| --- | --- | --- |
| P04 隔离工作树基线 | `codex/finance-p04-multicurrency`；`ce7c87ef3e23907577c0266bfcccc002bcebcd2c` | 本轮起始实际 HEAD；上一轮最终 QA/报告提交，未把本地提交本身当成部署 |
| 上轮回归 / 截图所用产品源码 | `73764f77fd02ada240e41c24734e523c5dad8805` | [上一轮最终证据索引](FINAL_EVIDENCE_INDEX.md)及下述部署命令、staging manifest |
| 固定主工作区 | `codex/android-accessibility-accounting-hotfix`；`e2febc6d9a33997bd9dc4cb042ecff216d31fde4`，保留既有未提交 Hotfix | 本轮启动只读核查；详细前后文件保护对照待补，不修改或强制重置主工作区 |
| GitHub `origin/main` | `74eadf589b0a6ffe1e5ab7a9564115891c4ef2dc` | 本轮 `git ls-remote` 实时结果，非本地 tracking ref |
| GitHub 财务分支 | `codex/finance-p04-multicurrency` 的远端 ref **ABSENT** | 本轮远端引用清单没有该分支；本地封存不等于远端交付 |
| 当前 Production Pages | `566292b3-3c7f-4ef5-93b5-6977e606c14a`；Branch=`main`；Source=`74eadf5`；部署 URL=`https://566292b3.thewyj-uk.pages.dev` | 本轮 Cloudflare 控制面实读。该 Source 对应 GitHub 当前 main，而非 P04；实际浏览器加载字节仍按下节另证，不依据展示版本推断完整 SHA |
| 既有共享 Task26 Preview | `642a5f0a-03d6-4793-93c7-22c3f1d72ab4`；Branch=`codex/task26-wrong-review`；Source=`6247c41` | 本轮只读列表；不是 P04 Preview，不修改其绑定或数据 |
| 用户实际访问页面 | **NOT TESTED：待记录精确 URL、登录身份范围、页面及资源指纹** | 用户截图显示 Experimental 偏好；该截图本身不能证明已部署 P04 |
| 本轮新独立 Preview | **NOT TESTED：待安全构建、部署与实际访问验证** | 独立项目 / 独立 D1 / 独立账户与空白账本；不连接正式财务数据 |

<!-- ROOT_CURRENT_REMOTE_AND_RUNTIME_EVIDENCE -->
本轮实时元数据已于2026-10-24 **21:53:46–21:54:04 HKT**取得，见[远端审计原始记录](../migration-evidence/finance-p04/experience-channel-current/audit-r1/result.json)。Production 与共享 Preview 操作均为只读，记录为 `production_mutations=false` / `shared_preview_mutations=false`。待补：用户实际页面 URL、浏览器加载资源指纹及其与控制面 / 本地候选的比对；尚不能只凭 Source 字段声称完整运行字节一致。

## 2. 上一轮 P04 截图的完整溯源

以下 `E/` 为本机保留的忽略证据目录 `docs/migration-evidence/finance-p04/closure-current/`。历史 URL 与元数据用于溯源，**原 QA 资源已删除，不能再作为可用的体验入口**。

| 字段 | 已有可追溯值 | 证据 |
| --- | --- | --- |
| 截图页面 URL | `https://finance-p03-p04-qa.thewyj-finance-qa.pages.dev/finance` | 部署 alias、同 origin 的 HTTP / FX 证据及当时 Cua 页面记录；DOM 文件自身未保存 URL 字段 |
| 对应不可变部署 URL | `https://bf3aaabd.thewyj-finance-qa.pages.dev/finance` | [最终 QA 部署记录](../migration-evidence/finance-p04/closure-current/cloud-final-backup-r2/result.json) |
| 环境与截图方式 | 实际 Cloudflare Pages 独立 Preview，Cua 控制浏览器访问并截图；不是本地开发服务器，也不是 Production | [部署 stdout](../migration-evidence/finance-p04/closure-current/cloud-deploy-final/stdout.log)、[实际绑定检查](../migration-evidence/finance-p04/closure-current/hosted-bindings-final/result.json) |
| Pages 项目 / 分支 | `thewyj-finance-qa` / `finance-p03-p04-qa`，Environment=`Preview` | 最终 QA 部署记录 |
| 完整 Deployment ID | `bf3aaabd-bf85-4fbc-9b55-63cbc70d9545` | 同上 |
| 记录的源码 SHA | `73764f77fd02ada240e41c24734e523c5dad8805` | [完整部署 argv](../migration-evidence/finance-p04/closure-current/cloud-deploy-final/command.json)、[staging manifest](../migration-evidence/finance-p04/closure-current/hosted-stage-final-manifest.json) |
| 部署时段 | 2026-10-24 10:06:24–10:06:38 HKT | 部署命令 JSON 的 UTC 起止转换 |
| 最终页面取证时点 | 2026-10-24 21:14:49.745 HKT；页面最近同步为 21:14:23 | [DOM 原始证据](../migration-evidence/finance-p04/closure-current/hosted-final-19-dom.json) |
| 账户 | `synthetic-p04-closure`；ID=`synthetic-p04-closure-owner`；角色=`super_admin` | 已验证的最终 QA 本机恢复 SQLite；只读取合成账户的 ID / username / role，不读取密码或正式数据 |
| 账目 | 19 条合成记录；CNY 展示支出 ¥14,350.64；不是既有微信 ¥0.01 的实际端到端账本 | DOM 与[最终 QA 备份证明](../migration-evidence/finance-p04/closure-current/cloud-final-backup-r2/result.json) |
| 专属 D1 | `finance-p03-p04-qa`，ID=`c2eb978f-9f49-4e4c-8286-f6b398fae0de` | 实际下载配置的 binding 检查；不是正式 D1 或共享 Preview D1 |
| 构建产物 | allowlist staging 共 157 文件；Wrangler 4.118.0 编译 Functions，部署日志记录 87 个静态资源对象 | staging manifest / 部署 stdout；两种数量不是独立用例，也不能相加 |
| 清理状态 | 专属项目的 4 次部署及两个独立 D1 已于 2026-10-24 21:20:54 HKT 清理 | [实际清理及回读](../migration-evidence/finance-p04/closure-current/cloud-cleanup-r2/result.json) |

重要校验值：

| 对象 | SHA-256 |
| --- | --- |
| `hosted-stage-final-manifest.json` | `cda417b8b87f4ce197b267c12d247d5f2d12d2e7ed25e5114b0c3c63c8f32bb8` |
| staging 的 `js/finance/app.js` | `a633f5254ddfa0f0be329d7afd30cd7f93da9099d4c08cf81bfcb16dcc44493a` |
| staging 的 `js/finance/money.js` | `8110b8a11a9a1ca7e79e070bae84727f25a9fb3cdda6ba7bd06b7d842b3725d4` |
| staging 的 `functions/_lib/finance-fx.mjs` | `aeac6f2bcd81f80baa11112af3fd47b07bd089946f7fe4f130924dd7301b3680` |
| [CNY 截图原件](../migration-evidence/finance-p04/closure-current/hosted-final-19-cny.png)，57,803 bytes | `f9b6601c1e2c33ec27b656cf01b8078ba6489c54f40619e0bc79c0e3fd92b8ab` |
| [JPY 截图原件](../migration-evidence/finance-p04/closure-current/hosted-final-19-jpy.png)，57,452 bytes | `f8424223a36e4cfe520feb3c8f9cffc830a49bdf92b64d02099fe3d1d770ccea` |

截图旧文件名为 `.png`，实际文件 magic 是 `FF D8`，即 **JPEG，1265×712**。本轮保留旧件及其 SHA，不通过重编码、改名或覆盖“修正”历史原件。新截图应按实际 MIME / magic 保存并记录 URL / 环境 / 构建身份。

**源码 SHA 与完整运行字节的证明范围不同。** 旧命令显式设置 `--commit-hash`，并带 `--commit-dirty=true`；staging 另有独立 QA binding 覆写。源码元数据、157 文件清单、上传成功与特定功能验证均已存在，但当时没有封存运行时 build-info 端点、编译后 Functions bundle 的独立 SHA，或全部远端静态资源逐字节核对。因此不能只凭 Cloudflare Source 字段宣称所有运行字节等于 Git clean tree。

## 3. 截图对应的 Feature Flags 与权限

以下是最终合成 QA 库于 2026-10-24 21:18:09–21:18:38 HKT 导出后、恢复 SQLite 中的 Task25 白名单只读查询结果。恢复文件 SHA-256 为 `3de6fc40a8bb8b294dfa5299d6b651cf239d787b0675f57a0668617a4e470a88`，与原恢复证明相符。**这是备份快照，不冒充截图时点的实时 `/api/features` 响应；当时的原始 FeatureSnapshot 未单独封存。**

| flag_key | enabled | kill_switch | 允许通道 | rollout_basis_points | revision |
| --- | ---: | ---: | --- | ---: | ---: |
| `adaptive_learning` | 0 | 0 | experimental | 0 | 1 |
| `adaptive_review` | 0 | 0 | experimental | 0 | 1 |
| `aeris_experimental_badge` | 0 | 0 | experimental | 10000 | 1 |
| `ai_error_explanation` | 0 | 0 | experimental | 0 | 1 |
| `mastery_score` | 0 | 0 | experimental | 0 | 1 |
| `similar_word_explanation` | 0 | 0 | experimental | 0 | 1 |
| `task25_validation` | 0 | 0 | stable / beta / experimental | 0 | 1 |

该快照没有 release preference、没有用户 flag override，Task25 flag audit 数量为 0。依 [`readFeatureSnapshot`](../../functions/_lib/task25-service.mjs) 第20–38行，缺少 preference 时默认 `stable`；依 [`evaluateFlag`](../../functions/_lib/task25-model.mjs) 第74–90行，这7项都会在 `global_off` 提前返回。即使账户是超级管理员，也不因此越过 Task25 全局关闭判定。

`TASK25_FEATURE_FLAGS_ENABLED=true` 只表明 flags API 基础设施启用，不表示任何具体功能 flag 已打开。旧 QA 配置还启用了 Cloud / Task16 财务读写及账户基础设施，范围为专属 QA D1；`WORKERS_AI_ENABLED=false`。这些环境变量与 Task25 逐用户 rollout 是两层控制，不能混记为“Experimental 全功能已开放”。配置见 [qa-bindings.json](../migration-evidence/finance-p04/closure-current/qa-bindings.json)。

财务页面另按 `isSuperAdmin || finance_access || all_features_access` 判断入口权限，见 [`js/finance/app.js`](../../js/finance/app.js) 第513行。截图使用合成超级管理员，不能证明真实用户在 Production 已取得新代码或新权限；本轮不修改正式会员权限。

## 4. Stable / Beta / Experimental 实际控制什么

[`task25-service.mjs`](../../functions/_lib/task25-service.mjs) 读取当前部署中的 flags、用户 override 和 release preference；设置通道只更新用户 Task25 preference。flag 判定还依赖全局开关、kill switch、允许通道和 rollout，不能只看用户选项。

当前 P04 的币种选择、原币持久化、金额计算与 FX 页面实现没有独立 Task25 gate：[`js/finance/app.js`](../../js/finance/app.js) 直接加载 `SUPPORTED_CURRENCIES` / money 模块，币种控件事件注册于第1348行附近。因此，在实际部署了这一版本且具有财务访问权限的环境中，P04 控件并不需要先选择 Experimental；在未部署该代码的环境中，切换 Experimental 也不会生成这些控件。

调用链也相符：[`app.js`](../../app.js) 第4668行附近创建财务控制器时传入账户和 entitlement 回调，没有传入 feature controller；第4726行附近的 feature 变化处理及第4732行的 features 参数用于 mastery。币种选择控件位于 [`index.html`](../../index.html) 第351行附近的静态标记，不由一个名为 P04 / multi-currency 的 Task25 flag 动态生成。

Android 更新独立读取 [`GET /api/app/config`](../../functions/_lib/task20-api.mjs) 第161行附近的 `ANDROID_LATEST_VERSION_CODE` 等元数据；此路径没有按 Task25 体验通道选择不同 APK。客户端 [`AppUpdatePolicy.kt`](../../android/app/src/main/java/uk/thewyj/app/core/network/AppUpdatePolicy.kt) 在当前 code 大于或等于 latest code 时判定无需更新。体验通道设置不安装或替换未发布 APK。

<!-- ROOT_CHANNEL_CACHE_AUDIT_DETAILS -->
### 当前 Production 的全局 flags 与 schema 实读

本轮没有用合成 QA 的默认值替代 Production，而是只读 SELECT 了正式 D1 的 flags 及 Task16 / Task21 schema 元数据。三组结果分别记录 `changes=0`、`rows_written=0`、`changed_db=false`；未读取正式账目、密码或修改用户偏好。证据为[本轮审计 JSON](../migration-evidence/finance-p04/experience-channel-current/audit-r1/result.json)中的 `production_flags_and_versions`。

| Production flag | enabled | kill_switch | 通道 / rollout | revision | 对 Experimental 的全局结果 |
| --- | ---: | ---: | --- | ---: | --- |
| `adaptive_learning` | 1 | 0 | stable / 10000 | 36 | `channel_excluded` |
| `adaptive_review` | 0 | 0 | experimental / 0 | 26 | `global_off` |
| `aeris_experimental_badge` | 0 | 0 | experimental / 10000 | 1 | `global_off` |
| `ai_error_explanation` | 0 | 0 | experimental / 0 | 11 | `global_off` |
| `mastery_score` | 1 | 0 | stable / 10000 | 31 | `channel_excluded` |
| `similar_word_explanation` | 0 | 0 | experimental / 0 | 9 | `global_off` |
| `task25_phys_c98bac3cfb1d` | 0 | 1 | stable / beta / experimental，0 | 9 | `kill_switch` |
| `task25_validation` | 0 | 0 | stable / beta / experimental，0 | 1 | `global_off` |
| `task25_web_39fdd27d2b25` | 0 | 1 | stable / beta / experimental，0 | 8 | `kill_switch` |

因此，这9项全局配置中没有 P04 旗标；当前 Experimental 不能启用其中被全局关闭或通道排除的功能。对 Stable，只有 adaptive_learning / mastery_score 的全局通道及百分比允许，仍须服从实际用户的适用权限与 override；Beta 不在这两项的允许通道内。**没有读取用户个体 override / 实时 FeatureSnapshot，个体完整快照仍 NOT TESTED**，但这些个体值也不能越过全局 OFF / kill switch / 通道排除。

正式 Task16 schema 元数据当前为 **1**、Task21 为 **2**，与上轮 P04 独立 QA 的 **5 / 9** 不同。不能仅把 P04 前端指向正式后端来完成体验，也不能为此自动执行正式迁移。新 Preview 必须使用自己的匹配迁移与独立 D1。

鉴权 API 的 GET 名称不保证整条链无写入：[`task25-api.mjs`](../../functions/_lib/task25-api.mjs) 第35行虽然使用 `touch:false`，但第41行仍有 rate-limit 写入路径，且失效 session 清理在 [`task12-service.mjs`](../../functions/_lib/task12-service.mjs) 第262行附近可能执行 DELETE。本轮全局核查采用上述 D1 SELECT，不把生产账户认证写入包装成只读。

## 5. 缓存检查与因果边界

当前源码中的 [`sw.js`](../../sw.js) 对同 origin `/api/` 请求不做 Service Worker 拦截；导航优先联网，异常时回退缓存 HTML；静态资源优先取当前缓存。激活新 Worker 时清理旧缓存，并接管页面。主脚本在 [`app.js`](../../app.js) 第7194行附近以带 `ASSET_RELEASE` 的 URL 注册 Worker。

当前 P04 Worker namespace 为 `wyj-shell-20261014-aeris-task26-r9-es-modules-finance-money-v3`，main `74eadf5` 的 namespace 仍为旧 `…es-modules`。资源 query 中仍有 `20261014-aeris-task26-r9`，因此真实升级时仍需检查过渡资源混用，但这不是未部署代码自动出现的通道机制。`_headers` 对 SW 使用 no-store、HTML 使用 no-cache；新独立 origin 则与 Production 的 SW、CacheStorage、localStorage 分离。API 使用相对路径及 same-origin 凭据，见 [`js/core/api.js`](../../js/core/api.js) 第105–111行。

该机制意味着缓存是需要实际核验的因素，但**目前不能把这次 P04 缺失直接归因于缓存**。旧代码尚未发布到用户访问环境时，清空缓存或改体验通道不能补出尚未部署的 P04 资源；反之，只有先证明服务器确实提供新资源，才能把客户端仍加载旧字节归因于缓存。

<!-- ROOT_LIVE_CACHE_AND_ASSET_EVIDENCE -->
Production当前浏览器缓存状态 **NOT TESTED**。无Cookie静态GET /finance返回403，未读取诊断响应或绕过；Cloudflare部署身份和Git main已只读核对。新Preview五份实际资源字节比对PASS、独立origin浏览器成功，不将此冒充Production缓存验证。不清理用户真实站点存储、Cookie 或账本缓存来制造差异。

## 6. 本轮独立 Preview 体验与安全边界

用户已同意独立 Preview 的空白账本。交付须同时满足：独立项目、独立 D1、独立认证与会话、明确环境标签和可验证构建身份；财务写入只进入该 Preview 的空白账本。不得导入正式财务数据、复制正式 Pepper / 会话 / 密钥、修改真实会员权限或自动合并账目。

用户已接受**独立 Preview 登录与空白账本，不要求复用正式认证**。这仍不能被表述为真实 Production 账户认证已经完成，独立账户也不因用户名相同而成为同一正式账户。本轮新项目名称准备为 `thewyj-finance-p04-preview`、专属 D1 名称为 `finance-p04-owner-preview`，分支为 `owner-p04-preview`，生产分支设置 `release-held` 且只部署 Preview；这些名称只表示已准备方案，实际创建 / 绑定 / 部署结果以下节证据为准。若以后需要生产侧改动或共享认证写入，须另说明风险并取得授权。

<!-- ROOT_NEW_PREVIEW_DELIVERY -->
2026-10-25实际交付：资源为新建独立项目，不是恢复原已删QA。

| 项目 | 实际证据 |
| --- | --- |
| 入口 | https://owner-p04-preview.thewyj-finance-p04-preview.pages.dev/finance |
| 不可变URL / 部署 | https://fa42e9b0.thewyj-finance-p04-preview.pages.dev/finance；fa42e9b0-5027-40f1-9377-b0942aaeb857 |
| 源码SHA | 298d5057d7b4c7432e0625bb5c9297ba9243b6df，P04产品继承73764f7/ce7c87e；不含后续P05 |
| 产物树SHA256 | 127d1c0f1b35026f2617e3c2baa6a7ddb6d078e9450442cb870364215798a928 |
| 构建声明 | /__preview/build.json，含完整SHA、独立环境说明、156产品文件hash与两项stage-only覆盖；共160文件，旧157为156产品+config |
| 绑定 | D1 941b465f-185d-42a3-9a11-0c959c11aea4；实际下载配置复核；无R2/AI/Production/共享绑定 |
| 空白账户 | p04-owner为普通Preview用户，仅独立库finance_access，账本0；不是正式账户身份认证 |
| HTTP合同 | 11 PASS，38请求，六币种读改/重复/旧请求/重新登录/另一账户隔离；验证账户有6合成账，owner账户0 |
| 运行版本 | build.json、index.html、finance app/money、sw共5份远端资源与staging逐字节相同，见runtime-proof-r1.json |
| 浏览器 | owner-browser-proof.json及owner-preview-blank.jpg，实际显示完整SHA横幅、六币种入口和0账；未写owner账目 |
| Schema | 独立库Task16=5、Task21=9，FK违规0；7个初始feature flag未启用，P04界面仍可用 |
| 登录信息 | 受限本机E/private/OWNER_PREVIEW_ACCESS.txt；不入Git/正文，不复用正式密码 |

新证据位于 `docs/migration-evidence/finance-p04/experience-channel-current/`。初始staging测试19/20是156产品文件与历史含config的157计数混淆，r3为20/20；Pages配置不支持account_id导致secrets-r1失败，移除后用保留旧artifact的r2完成。r4路径拒绝断言因错误消息文字变更19/20，保留原失败，恢复明确错误文本后r5复验。未削弱拒绝Production/共享D1与非allowlist文件的保护。

## 7. 当前结论与后续填写要求

上一轮“本地修复、复验和封存完成”不等于 P03/P04 全部 COMPLETE，更不等于用户已获得新版本。原截图证明的是独立合成 Preview 的界面与限定测试范围。Experimental 只在当前部署已有代码和相应 flags 中选择体验；不能代替源码发布或 APK 分发。

本轮应以实际可访问的 Preview URL、准确部署身份、构建 / 运行资源比对、独立账户与空白账本、用户可以亲自操作的验证结果作为体验交付证据。旧截图或测试通过均不能单独证明用户实际访问了最新版本。其余尚未实测的项目继续 NOT TESTED；P03/P04 原失败及 Production 放行门禁不因本报告改变。

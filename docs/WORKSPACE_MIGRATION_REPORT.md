# Windows 固定工作区迁移报告

日期：2026-10-15，香港时区。`WORKSPACE_MIGRATION = COMPLETE`。

`PRODUCT_DEVELOPMENT = PAUSED_BY_OWNER`；`RELEASES = PAUSED_BY_OWNER`。
Android Hotfix 仍为 INCOMPLETE，财务 AI 未启动。迁移完成不代表这些任务完成。

所有者最新明确指示“你暂停停止，所有任务然后开始迁移”，取代附件中必须先
完成未结开发任务的迁移前置条件；未因此放宽 Hotfix 的测试或发布门禁。

报告使用 `%USERPROFILE%` 表示本机 Windows 用户目录，避免把个人绝对路径
写入受 CI 审计的共享源码。完整解析路径、逐文件清单和执行时间在本地
`migration-evidence/workspace-inventory.json`。该证据目录被 Git 忽略。

## 1. 最终工作目录及 Git 信息

- 固定入口：`%USERPROFILE%\Desktop\编程\thewyj.uk`。
- origin：`https://github.com/WYJ0904/thewyj.uk.git`。
- 当前分支：`codex/android-accessibility-accounting-hotfix`。
- HEAD：`e2febc6d9a33997bd9dc4cb042ecff216d31fde4`。
- 本地 main / 最新 origin/main：`74eadf589b0a6ffe1e5ab7a9564115891c4ef2dc`。
- 正常独立 `.git`，非 shallow；没有 objects alternates 或旧工作区链接依赖。
- 从实际源仓库获取完整提交及原本地/远端引用，再向 GitHub fetch 核对。
- 当前 WIP 与迁移文档/配置改动均保留，未自动提交、推送、合并或发布。

`git fsck --full` 已通过。当前工作树有意保留未提交工作，具体差异可审阅，
不是干净 main，也不是可以直接发布的 Android 版本。

## 2. 源代码版本、分支和提交

实际源仓库为 `%USERPROFILE%\Documents\Codex\2026-07-05\cloudflare-pages-1-zip-2-html`。
通过 Git 实时读取确定版本，没有按日期文件夹判断。
源分支/HEAD 与上述 Hotfix 相同；其已提交修复由 33bf326、c016eb9、e2febc6
组成。最新已发布网站成果在 main 74eadf5 中，未把 Hotfix 写进 main。

GitHub 只读核查时间 `2026-10-15T07:48:50.845Z`，精确记录见
`migration-evidence/github-state.json`：开放 PR 仅 #110，Draft，HEAD e2febc6。
未触发 CI 重跑、workflow dispatch、Pages 部署或任何远端写入。

## 3. 未合并分支及未提交成果保留

源工作区的 10 个 tracked 修改及 4 个 untracked 文件均已独立备份并还原。
14 个文件与暂停清单 SHA-256 全部逐字节一致。内容包括无障碍聊天保护、
UI 提示、独立 QA 标签、服务验收测试及尚未完成 CI 验证的本地代理补丁。

暂停快照：
`%USERPROFILE%\Documents\Codex\2026-10-10\li\work\android-hotfix\pause-2026-10-15T07-40-45-523Z`。
其中包含 11,424,900 字节的完整 Git bundle、binary patch、staged patch、
逐文件副本及 SHA-256；bundle verify 通过。没有 stash、reset 或丢弃修改。

新 Git 保留 `migration-source/*` 的原本地分支和 `migration-archive/*` 的原
远端引用。额外 `migration-worktrees/*` 保存已核查的历史 detached HEAD。
原 main 工作树 6ef3772 与附件指定历史 550bc41 均无未提交改动，提交可在新
Git 访问。两个已不存在的 Temp 工作树仅记录为历史 registry 条目，未 prune。

迁移新增的 tracked 文件更改仅 `.gitignore`、README、package.json 的本地
启动入口和 Android Gradle 路径/编码兼容配置。新增一个本地启动脚本、
AGENTS、迁移/启动/暂停说明及两份有效 Closure
交接副本。Hotfix WIP 没有混入迁移提交；本轮没有创建提交。

## 4. 目录结构

| 路径 | 用途与处理 |
| --- | --- |
| 根目录 HTML/CSS/JS、js/ | 原站点与业务模块，沿用原结构 |
| functions/、cloudflare/ | Pages API、模型/服务及 D1 迁移，保留 |
| android/ | 原生 App、独立 Preview、Gradle、Room schemas，保留 |
| assets/、vendor/ | 正式资源和原第三方静态依赖，保留 |
| local-backend/ | 既有隔离测试与历史兼容工具，保留 |
| qa/、scripts/、.github/ | 测试、工程工具和 CI/CD，保留 |
| docs/ | 工程文档、发布历史、本次报告与暂停交接 |
| docs/migration-evidence/ | 忽略的本地完整验收日志、统计和清理清单 |
| node_modules/、android/.gradle/ | 本机可重建依赖/增量元数据，不提交 |

没有大规模移动源码、修改 Import 或重新组织业务目录。

## 5. 文件总数和体积

- 源 Git 基线：817 个 tracked 文件。
- 另保留 4 个 untracked 源码/资源文件，合计迁入基线名录 821 个文件。
- 源名录文件原始逻辑体积：15,165,679 字节。
- 新目录对应名录逻辑体积：15,181,330 字节。差异包含 Git 的 CRLF 处理及
  四个明确的迁移配置/说明修改；代码内容比较与 14 个 WIP 字节校验已通过。
- 额外新增迁移文档及有效发布报告交接副本另列，不把依赖、Git 对象库、
  本地证据、缓存和构建产物混算为迁入源代码。
- 原 node_modules、旧 build、旧 .wrangler 状态和完整旧日期目录均未复制。

统计清单：`migration-evidence/workspace-inventory.json`；原始文件引用快照与
暂停 manifest 可交叉核查。体积为逻辑字节，不声称等同 NTFS 实际占用。

## 6. 实际清理

清理前已枚举文件及大小，验证绝对目标位于新根目录，拒绝 reparse point；
使用 PowerShell `Remove-Item -LiteralPath` 删除本轮新生成、已确认可重建的内容。

| 分类 | 删除文件数 | 逻辑字节 |
| --- | ---: | ---: |
| 新 Android app/build | 3,611 | 278,693,732 |
| 新 Pages 静态 staging | 144 | 5,716,811 |
| 新 Functions build | 1 | 921,538 |
| 新 Wrangler types | 1 | 553,224 |
| 本轮 Python __pycache__ | 45 | 1,266,945 |
| 首次清理合计 | 3,802 | 287,152,250 |

最后的启动验收又产生了 staging/tmp；停服后第二批清理 158 个文件、
13,110,514 字节。两个已枚举清理批次合计 3,960 个文件实例、300,262,764
逻辑字节；不重复统计构建过程自身的 staging 替换。首次结果保留为
`cleanup-initial-result.json`，最后批次为 `cleanup-result.json`。

删除 tracked 文件 0；删除旧工作区文件 0。构建的 Debug APK 属于可重建测试
产物，已记录 hash/包信息；JUnit XML 与 lint 报告另存后才清理 build。
必要依赖和有效增量元数据保留。源素材未按名字或扩展名批量删除。
详细绝对路径/计数见 migration-evidence 内的两批 cleanup plan/result。
一份无敏感内容的自建 canary 因自动审批拒绝删除而保留为本地审计样本，
归档在 `root-exclusion-canary.txt`，未计入删除数量；根目录已无该临时文件。

## 7. 重要素材和测试数据

48 个正式图标、Web 图片、字体及历史发布验收图完整保留。
逐个检查代码、CI、脚本与文档字符串引用，35 个找到静态引用；13 个未找到
直接引用的历史验收图片仍保留，不能据此认定无用。名单见 inventory 的 assets。
Android 资源还经实际资源编译及 APK 构建核验。

保留 qa/task25、qa/task26 的测试资料、固定 JSON、测试代码内 fixtures、
Room 1～10 schema 及全部 D1 0001～0025。没有删除 golden/baseline 或原有
发布/回滚脚本。两份 Task26 最终发布报告以交接副本保留，仅规范化用户目录
前缀并增加说明；原件未改，复制 manifest 保存原件和副本 hash。

## 8. 按语言统计

以下为物理源码行与非空行，含注释、含测试；不冒充排除注释的 SLOC。
排除依赖、vendor、build/dist、自动生成文件、Room 自动导出 JSON、文档和
纯配置/固定数据。共纳入 219 个测试源码文件。

| 语言 | 文件数 | 物理行 | 非空行 |
| --- | ---: | ---: | ---: |
| Kotlin | 217 | 35,897 | 33,319 |
| JavaScript | 227 | 63,988 | 60,536 |
| Python | 45 | 20,555 | 18,871 |
| CSS | 5 | 12,074 | 10,317 |
| SQL | 43 | 2,818 | 2,574 |
| PowerShell | 4 | 2,807 | 2,631 |
| HTML | 1 | 1,251 | 1,192 |
| XML | 20 | 294 | 294 |
| Kotlin Gradle | 4 | 217 | 198 |
| Batch | 2 | 139 | 113 |
| Java | 1 | 72 | 70 |

## 9. Web、Cloudflare 和 Python 验收

均从新目录运行，没有调用旧源码构建或复用旧目录的 node_modules。

| 验收 | 实际结果 |
| --- | --- |
| npm ci 固定 lockfile | PASS，34 packages，不升级依赖 |
| JS 语法 | PASS，原 227 文件及新增本地启动器单独核查 |
| JS/API 脚本 | PASS，38/38 脚本，包括账号/会员/财务/通知/文件传输/Task25/Task26 |
| 模块依赖、前端 storage contract、cloud-only gate | PASS |
| Python compileall | PASS |
| local-backend unittest | PASS，185 tests |
| 仓库敏感路径/内容、正式版本一致性及其自测 | PASS |
| Wrangler types / Functions build | PASS，保留固定 4.118.0 |
| 仅本地 D1 migrations | PASS，0001～0025 连续，ledger count=25 |
| 仅本地 Task26 schema | PASS，四张 Task26 新表存在，D1/API 测试通过 |
| Pages allowlist staging | PASS，仅既有正式允许的资源，不含个人根目录文件 |
| 本地启动与 HTTP | PASS，首页、JS、manifest、status 均 200；根目录 canary 未提供 |
| 原未提交 CI 代理补丁 VM 自测 | PASS；未修改 node_modules，也不代表远端 CI PASS |

本地服务仅监听 127.0.0.1，D1/R2 均为 local，AI binding 不存在。
真实 status 的 backend_ready=true，但整体是 **DEGRADED**：新库用户为 0，
未创建 owner，且本地 Pepper/分享/设备 Secret 未配置。Task18 schema_version=1
和四张 Task26 表已直接只读核对，默认本地库 ledger=25；没有伪称完整登录
和管理员功能健康。38 个隔离脚本使用独立 fixture 验证对应业务。
未复制 Production 凭据来消除该预期状态。HTTP canary 只使用本轮自建随机
文本，未请求或读取原有私人文件。临时服务已正常停止，8788 无监听。

日志与退出码：`migration-evidence/javascript-results.json`、`python-results.json`、
`cloudflare-results.json`、`local-d1-ledger.log`。没有执行远端迁移、AI 推理、
Production 写入、账号授权或真实付款。

## 10. Android 验收

新目录运行 `:app:testDebugUnitTest :app:lintDebug :app:assembleDebug
:app:assembleDebugAndroidTest --no-daemon --console=plain`。

- Kotlin、资源、主 App Debug 构建、AndroidTest 编译：PASS。
- JUnit：81 suites，563 tests，0 failures、0 errors、0 skipped。
- Lint：PASS，XML/HTML 保留在 migration-evidence。
- AAPT2 实读 Debug APK：`uk.thewyj.app.debug` / `1.3.37-debug` / code 50，
  minSdk 30、targetSdk 36。未安装，不是原签名正式发布包。
- Debug APK SHA-256：`7896c7071f105b6e118b6fe134a1d18d5136c95e63e9ba626a604ec28e6ac04b`。
- 正式 applicationId 仍 `uk.thewyj.app`；release metadata 仍 1.3.37/50。
- Room schema 1～10 保留；已提交 Hotfix 的 9→10 定义及测试未改动。
- 原签名材料留在仓库外，本轮不复制、不读取、不签正式候选、不安装/卸载。
- 未运行任何真机 instrumentation，未读取手机数据或修改权限。

SDK/JDK/Gradle 下载缓存是正常系统级依赖，不是旧源码目录。JUnit 与构建
证据见 `migration-evidence/android-verification.json` 和 android-junit/。

## 11. 问题及处理

1. Git apply 使一个混合行尾 WIP 文档 hash 不同：先保留失败，核实只有 CRLF
   差异，再恢复暂停副本原字节；14 个 WIP 最终全部精确匹配。
2. AGP 拒绝包含中文的固定 Windows 路径：按 AGP 自身提示增加项目级
   `android.overridePathCheck=true`，随后仍实际执行完整构建与测试。
   [AGP 实现](https://android.googlesource.com/platform/tools/base/+/f2e10dfd33283e562c562905856827eae2495886/build-system/gradle-core/src/main/java/com/android/build/gradle/internal/plugins/AndroidPluginBaseServices.kt)。
3. 固定 Gradle 9.4.1 的 worker 参数文件 UTF-8 与本机 native.encoding=GBK
   不匹配，导致已编译测试 ClassNotFoundException。一次定向 native 编码试验
   通过后，将项目 Gradle JVM 编码设为 `COMPAT`；完整 563 项及 lint/build
   随后通过。未改系统编码、测试断言、Gradle 版本或权限。
   [Gradle #30304](https://github.com/gradle/gradle/issues/30304)、
   [JDK 21 COMPAT 定义](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/charset/Charset.html)。
4. 旧 AAPT 在该路径的单独 APK 检查失败；使用同一已安装 SDK 的 AAPT2
   成功读取原位置 APK。没有通过复制旧目录构建绕过新目录验收。
5. 共享文档用 `%USERPROFILE%` 表达本机路径，保留原仓库个人路径审计规则，
   没有删除或放宽任何现有审计断言。
6. 短启动发现固定 Wrangler Pages 不支持自定义 `--config`，初版启动失败；
   后续改为检查原 development 默认配置并显式绑定本地 D1/R2，与本地迁移
   使用相同的 database ID。最终实际启动和五项 HTTP 检查通过，原正式配置未改。
7. 初始化默认本地 state 时，SDK 在 0016 返回 `bad port`。保留失败日志，
   仅作一次有限续跑，依据 ledger 跳过已执行项，完成其余迁移；最终只读确认
   ledger 25、Task18 元数据 1、Task26 四表及用户 0。未把短暂失败归因于已
   证实的代码缺陷，未修改 SQL，更未对 Production 重试迁移。
8. 自动审批两次拒绝删除本轮无敏感内容的 canary，仅给出 `blocked by policy`。
   不再尝试删除，使用可逆移动归档为忽略的审计样本，未绕过删除审批。

首次 AGP/worker 失败日志、定向试验和成功日志均保留，未把失败改成 PASS。

## 12. 剩余风险及未验证事项

迁移所需本地核心检查通过。以下属于明确保留的远端/产品状态：

- Hotfix PR110 的远端 Core CI attempt 2 仍 7/8，Cloud-only browser FAIL。
  新源码的完整 CI、Hosted 和正式端到端发布门禁尚未完成，暂停期间不继续。
- 原签名候选 51 早于未提交聊天修复，未发布；不能代替最终候选。
- 适用真机支付链、主微信/支付宝、断网/权限/同步及长期稳定性未全量验收。
  已有 scoped 三星/Preview 证据保留，未冒充整体验收。
- 本轮只读 Pages API 额外核查返回 HTTP401，未刷新/覆盖密钥或修改云端；
  保存的最后一次成功 Pages deployment/config 结果为历史证据，不冒充新鲜结果。
  迁移本身不需要生产凭据；恢复远端操作前应正常恢复 Cloudflare 登录。
- Task26 状态保留 CLOSED_WITH_OWNER_WAIVER，豁免项仍 WAIVED_BY_OWNER。
  新迁移没有重新执行 Production Smoke，也未重开已关闭的 Task26 门禁。
- 未提交 Hotfix 和迁移文档清楚列在 Git 状态，需后续评审；没有提前推送。
- AI 未启动。所有产品开发/发布维持暂停，等待所有者后续继续指示。

## 13. 旧目录、备份及既有本地文件

源目录、附件指定 550bc41 工作树、历史 main 工作树、旧候选与发布备份保持
原位。旧源码 HEAD、status 与暂停前完全一致，未执行旧仓库清理或删除。
原 `.git/objects` 的临时垃圾提示仅记录，未清理，也未作为对象库迁入。

目标原有 `_wyj-tools/`、`.wrangler/cache/` 及 `访问口令.txt` 均保留。
口令文件未读取、未复制入 Git；本地工具/口令/证据已明确忽略。
没有更改 Codex 全局配置、其他项目配置、Production D1/R2、正式域名、
会员/支付/账户、APK 签名/Stable 指针、手机资料或手机权限。

## 14. 今后使用方式

后续在此固定根目录打开 Codex。先读取 AGENTS.md 与
`PAUSED_DEVELOPMENT_HANDOFF.md`，再按 `WINDOWS_WORKSPACE.md` 使用既有
依赖、构建及正常分支；不要从旧日期副本继续开发。

不需要为每次任务复制整份源码。必要临时工作树需明确用途；工程报告进入
docs，原始短期日志进入忽略的证据目录。保留当前 WIP，不切 main 后强行
覆盖，不对根目录执行 `git clean -fdx`。

本轮最终交付为可在固定根目录独立构建、测试、审阅 Git 历史和继续开发的
工作区。开发任务保持暂停，迁移完成后没有自动进入 Hotfix 或财务 AI。

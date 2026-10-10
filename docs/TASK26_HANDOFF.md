# Task 26 — Draft PR 与本地接续交接

本轮范围是完成现有分支的 API、D1 迁移代码、Web UI、自动化测试和 CI，提交 Draft PR。**不合并、不部署 Production、不启动 Task 27。** 本报告中的未来发布步骤是恢复入口，不代表本轮已经执行或获准绕过发布门禁。

## 仓库与恢复入口

- 仓库：WYJ0904/thewyj.uk。
- 分支：`codex/task26-adaptive-learning-mastery`，继续使用现有进度。
- 基线 main：`550bc41bbaa01751d75c109f3246b9e174e4460d`，正式 Release B；没有从旧 Task 25 candidate 创建新基线。
- [Draft PR #105](https://github.com/WYJ0904/thewyj.uk/pull/105)。保持 Draft；最终 HEAD/CI 以 [最终报告](TASK26_FINAL_CLOSURE.md) 和 PR 最新检查为准。
- 核心实现：`b286cec`（引擎）、`7ee41f2`（API/D1/UI）、`27cdb57`（离线持久化与批量恢复）、`678d646`（缓存版本一致性静态检查）。
- 架构及审计：[TASK26_DESIGN.md](TASK26_DESIGN.md)；持续记录：[TASK26_EXECUTION.md](TASK26_EXECUTION.md)。正式 Release B 与既有设备证据：[RELEASE_B_FINAL_CLOSURE.md](RELEASE_B_FINAL_CLOSURE.md)。不要把旧设备验收改名为 Task 26 PASS。

首先执行以下只读恢复检查，避免重复已经通过且源码未变的本地测试：

```powershell
git fetch origin
git switch codex/task26-adaptive-learning-mastery
git status --short --branch
git pull --ff-only origin codex/task26-adaptive-learning-mastery
git log -6 --oneline
gh pr view 105 --repo WYJ0904/thewyj.uk --json state,isDraft,headRefOid,mergeable,statusCheckRollup,url
gh run list --repo WYJ0904/thewyj.uk --workflow ci.yml --branch codex/task26-adaptive-learning-mastery --limit 3
```

工作树存在本地未提交内容时，不执行 reset/clean，也不直接覆盖。核对报告与实际 HEAD 后继续。纯文档提交不需要人为重跑已通过的引擎/browser 测试；最终 HEAD 的必要 GitHub CI 仍须真实完成。

## 已完成的软件内容

服务端是唯一正确性与 Mastery authority。`mastery-v1` 使用 0–100 连续分数、0–1 confidence、有效/原始尝试、连续结果、计时验证、难度、遗忘/复习间隔、重复冷却、题族与跨日证据；相同已接受事件序列可重放。服务端课程 v1 包含 62 个英语/日语词汇或语法知识点、124 个题目变体。现有完整词库、自定义 Quiz、错题本、重判、历史同步和会员价格保持原路径，不宣称这个初始课程覆盖全部旧词库。

服务端签发不泄露答案或语义知识点 ID 的 opaque ticket，确定性判题后保存不可修改事件，并以 CAS 更新投影。每个 ticket 仅有一个结果；同一 event ID 重试返回原收据，不同内容复用 ID 返回 409；投影或网络失败不丢已经保存的事件。120 个积压事件的恢复只用 4 次 prepared query，保留全部收据，不按每个事件逐次查询。

Web 在现有语言工作区提供自适应/弱项/复习模式、掌握度概览、知识点详情、结果变化、课程例句和辨析。按账户隔离的 v1 outbox 先持久化再提交；不在客户端计算分数。离线及响应丢失保留同一 event ID，恢复后确认；切换账户不会提交或显示另一账户的状态。存储失败、未知版本、过期 ticket 或不可恢复响应保留证据并明确提示，不静默清空队列。普通 Quiz 是服务/flag/AI 故障时的独立降级入口。

AI 仅补充已经确定的错误解释，复用 Workers AI、现有 `rubric` 类缓存/配额/租约和 3 秒 timeout；缓存输入带 Task 26 namespace。AI 不可用、配额不足、超时或输出夹带分数/正确性字段时使用课程解析，不能改判或影响 Mastery。AI/课程内容只作为文本渲染。

所有 API 复用账户、语言 entitlement、Task 25 决策、CSRF 和 D1 限流。没有任意修改普通用户分数的后台；Admin 新增只读聚合诊断，继续使用原有 flags、CAS revision 与 audit trail。

| 方法与路径 | 契约 |
| --- | --- |
| POST `/api/learning/adaptive/next` | `language`, 可选 `mode`/`knowledge_id`；返回 server ticket |
| POST `/api/learning/events` | 稳定 `event_id`、`ticket_id`、事件类型、必要 answer/response_ms；客户端 score/correct/user/channel 声明拒绝 |
| GET `/api/learning/mastery/summary?language=…` | 当前账户的概览、知识点和弱项；private/no-store |
| GET `/api/learning/mastery?language=…&knowledge_id=…` | 当前账户的知识点状态 |
| POST `/api/learning/mastery/reconcile` | `{language}`；显式重放并修复未完成投影 |
| GET `/api/learning/review?language=…` | 当前账户到期复习队列 |
| POST `/api/learning/explanation` | `{event_id}`；仅该账户已完成的答题 |
| GET `/api/admin/learning/metrics` | 权限保护的聚合指标，不输出用户原文或任意编辑分数 |

## LOCAL_REQUIRED 与精确阻断

| 项目 | 当前实际限制 | 解锁后的第一步 |
| --- | --- | --- |
| 远程 Preview D1 | 云端 Wrangler 未认证；Actions token/account presence=false；不能核查私有 ledger 或取得 bookmark | 在拥有合法项目权限的本地会话执行下面的只读 preflight |
| 托管完整学习/Admin 流程 | 没有合法 hosted Admin session；匿名 401 只能证明鉴权边界，不能证明 schema/写入/管理员验收 | 使用本地受支持 Chrome 正常登录 Preview，先核对账户/环境与 flags；不导出 Cookie/token |
| Samsung/WebView | 当前执行器没有可访问的实体三星；云端 Chromium/HTTP transport 不是手机 | `adb devices -l`，核对真实设备与现有 1.3.37/50，再观察 Task 26 Preview/WebView |
| 原签名 | 四个 signing inputs 未配置；本轮 native 实现没有变化，因此不要求新 APK/AAB | 保留原材料；仅在后续有 native 变更并需要新二进制时恢复原 signed-candidate workflow |
| Production/merge/rollout | 最新用户指令明确禁止；不是凭据到位就可以自动解除 | 维持 Draft 和 master OFF；未来正式发布任务再核对全部真实 gates |

这些步骤没有阻止已经完成的 API/UI/本地 D1/浏览器/CI 工作。无需给当前云端导出浏览器凭据、私钥或本机文件。若当前没有合法管理权限，不重复空跑写操作，也不创建替代 Cloudflare 环境。

## Preview D1 恢复步骤

现有 Preview D1 `wyj-cloud-preview` / `a3e6253b-689f-49f3-998b-7c5828ea255a`；Production D1 `wyj-cloud-production` / `11c288d8-c584-409f-bb1f-7e7af11793e5`。R2 同名且分别绑定 `WYJ_STORAGE`，Pages 项目仍为 `thewyj-uk`。**下面所有执行命令明确使用 Preview，不能替换成 Production。**

```powershell
$Task26Evidence = Join-Path (Get-Location) '.wrangler/task26-handoff-evidence'
New-Item -ItemType Directory -Force $Task26Evidence | Out-Null
npm ci --ignore-scripts --no-audit --no-fund
npx wrangler whoami
npx wrangler d1 migrations list WYJ_DB --env preview --remote
npx wrangler d1 execute WYJ_DB --env preview --remote --file cloudflare/task26-preflight.sql --json | Set-Content -Encoding utf8 (Join-Path $Task26Evidence 'preview-preflight.json')
if ($LASTEXITCODE -ne 0) { throw 'Readonly preflight failed; stop migration' }
npx wrangler d1 time-travel info WYJ_DB --env preview --json | Set-Content -Encoding utf8 (Join-Path $Task26Evidence 'preview-bookmark.json')
if ($LASTEXITCODE -ne 0) { throw 'Recovery bookmark unavailable; stop migration' }
$Task26Canonical = (Resolve-Path cloudflare/migrations/0025_adaptive_learning_mastery.sql).Path
if ((Get-FileHash $Task26Canonical -Algorithm SHA256).Hash.ToLowerInvariant() -ne '4664bbc91a8d1b6158ee58532186b38c870cb677c17c289e072e1cb4afd4adef') { throw 'Canonical SQL differs; stop' }
```

文件由 `.gitattributes` 强制 LF，避免 Windows checkout 改变审计哈希。先审查输出：前置 0024/schema_version1 必须完整；0025 未记录且 9 个 Task 26 对象均不存在才是 fresh apply。若已经有唯一 0025 ledger，只验证而不重复应用；若 ledger/schema 部分存在、不匹配或前置 migration 缺失，停止并调查，不能单独插入 ledger 或跳过其他 pending migrations。记录原有业务表的聚合计数，不导出用户内容。确认 dry review、恢复 bookmark、准确绑定和 pending migration 列表后才执行：

```powershell
npx wrangler d1 migrations apply WYJ_DB --env preview --remote
if ($LASTEXITCODE -ne 0) { throw 'Apply failed; stop feature enablement and inspect recovery' }
npx wrangler d1 execute WYJ_DB --env preview --remote --file cloudflare/task26-schema-verification.sql --json | Set-Content -Encoding utf8 (Join-Path $Task26Evidence 'preview-verified-schema.json')
if ($LASTEXITCODE -ne 0) { throw 'Schema verification failed; stop' }
```

预期：唯一 0025 ledger；4 张表、4 个显式索引、1 个 immutable trigger；metadata 为 schema1/mastery-v1/aeris-language-v1；5 个定义全部 OFF/0%/Experimental-only；旧表、价格、Task 25 operator settings 和真实数据未变。主开关 Production/root 仍 false，Preview eligibility true 不等于任何 flag 已开放。只读校验查询已在隔离本地 D1 实际执行，不能替代远程输出。

只有 Wrangler 实际报告此前项目已记录的 trigger 分割 `incomplete input` 时，保留失败并核查恢复后的 ledger/schema，才沿用同文件导入恢复方式。禁止为了方便先手工标记 ledger。准备一个新文件，原 SQL **逐字节不变**，在同文件末尾追加 ledger；通过 D1 file import 的原子恢复路径执行，不添加手工 BEGIN/COMMIT：

```powershell
$Task26Import = Join-Path $Task26Evidence '0025-reviewed-import.sql'
$Task26Bytes = [System.IO.File]::ReadAllBytes($Task26Canonical)
$Task26Ledger = [System.Text.Encoding]::UTF8.GetBytes("`nINSERT INTO wyj_d1_migrations(name, applied_at) VALUES ('0025_adaptive_learning_mastery.sql', strftime('%Y-%m-%dT%H:%M:%SZ','now'));`n")
$Task26Stream = [System.IO.File]::Open($Task26Import, [System.IO.FileMode]::CreateNew)
try { $Task26Stream.Write($Task26Bytes,0,$Task26Bytes.Length); $Task26Stream.Write($Task26Ledger,0,$Task26Ledger.Length) } finally { $Task26Stream.Dispose() }
Get-FileHash $Task26Import -Algorithm SHA256
npx wrangler d1 execute WYJ_DB --env preview --remote --file $Task26Import --json
if ($LASTEXITCODE -ne 0) { throw 'Import failed; stop and inspect recovery' }
npx wrangler d1 execute WYJ_DB --env preview --remote --file cloudflare/task26-schema-verification.sql --json
```

此为延续项目 [Task 25 同文件恢复规则](TASK25_CLOUD_HANDOFF.md) 的待用路径；本轮没有执行远程导入、ledger INSERT 或 restore。若现有对象与 canonical SQL 不同，需要审查新的修复 migration，不能强行 IF NOT EXISTS 掩盖差异。

## 托管 Preview 验收与测试清理

自动 Git Preview 成功只证明部署和公开资源；最新真实 URL/source 在最终报告与 PR Pages check 中。管理员正常登录后，在 Preview 创建专用测试账户/安全 flags targeting，用现有审计管理流程启用 Experimental 的 adaptive_learning/mastery_score/adaptive_review，验证 login → question → answer → mastery → next → wrong/explanation → review → reload，以及英语/日语隔离、会员边界、第二会话、非管理员 403、revision/audit、kill 与反复刷新。

继续验证已有课程解析、AI 正常/不可用、断网及恢复、服务失败、响应丢失后同 ID 重试、登录过期、错误账户或 malformed 响应。Web/browser/native/WebView transport 应读取同一账号与状态；对同 ticket 不可各端重复制造结果。五宽度、深浅主题和大字号保持现有严格断言。

`qa/task26/learning-browser.mjs` **故意仅接受 127.0.0.1**，它会修改隔离测试 fixture。不要删掉此保护后指向真实 Preview/Production。CI 已自动运行全部本地矩阵；仅源码改变或失败时重跑对应部分。托管验收使用正常浏览器和专用 fixture，保留 environment/source/deployment/request ID、非敏感截图、audit reference 与清理结果，不保存会话秘密。清理仅自建账户/测试 override，先恢复原 flag 配置；保留审计和失败记录，绝不删除真实用户数据。

## Samsung 与 Android 边界

本轮没有 native 源码、签名、包名、版本或 update/R2 metadata 变更。Task 26 是现有 WebView 加载的 Web/API 能力，因此 **新 APK/AAB candidate：NOT REQUIRED**，不是 unsigned/signing PASS。Release B 正式 1.3.37/50 保持当前 Stable；签名缺失不能用临时 key 替代。

```powershell
adb devices -l
adb -s <observed-physical-Samsung-serial> shell getprop ro.product.model
adb -s <observed-physical-Samsung-serial> shell getprop ro.build.version.release
adb -s <observed-physical-Samsung-serial> shell dumpsys package uk.thewyj.app
```

只在真实设备可用时记录 model/Android/ADB identity、已安装版本、会话和已有学习记录。通过合法受支持的 Preview/WebView 入口观察三通道、Mastery/解释/复习、离线重连、kill、Back/Resume/cold/warm start、进程恢复、旧历史与错题本。若正式 App 不能安全选择 Preview，标记该路径限制，不重指 Production、不改真实用户数据制造条件。无需为了纯 Web 功能重新安装同一 APK；后续如实际修改 native，才增版本、原签名核验并 `adb install -r` 原地升级，禁止 uninstall/clear data/强制降级。当前 Task 26 物理验收是 LOCAL_REQUIRED / NOT EXECUTED。

## Production 保持与未来回滚

本轮 main 保持 550bc41，Production 保持 `575097ca-d940-4100-af6f-cb689518c7b4`，Stable `1.3.37/50`：R2 `app/android/thewyj-android-1.3.37.apk`，SHA256 `9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a`，48,124,983 bytes，原 signer SHA256 `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`。没有上传替换 APK、发布 Task 26 changelog、改 pointer 或修改 Production secrets。

未来若用户启动正式 release 任务，需重新核实 exact-head CI、完整真实 Preview/Admin/D1 验收、设备适用门禁、只读 Production preflight/bookmark/业务计数和 rollback。先 additive migration/ledger/schema，部署兼容服务（master/flags OFF），smoke 后才 Experimental → Beta → 小比例 deterministic Stable → 扩大；每阶段记录真实观察窗口、error/latency、score/review/loop 异常、audit、kill/恢复，不得把配置验证等同真实用户阶段观察。不要在本轮执行这些操作。

紧急回滚优先 kill/关闭 rollout，再关闭 Task 26 master；现有基础 Quiz 保持可用。必要时恢复同一 Pages 项目的已验证 550bc41/deployment575097ca 服务，保留 additive 表和 immutable events，不 drop/reset，不用旧客户端状态覆盖新 Mastery。Time Travel restore 只有真实灾难恢复审查时才考虑，会影响其他业务写入，不能用来清测试数据或让验收变绿。回滚未触发；真实用户删除/清空操作数为 0。

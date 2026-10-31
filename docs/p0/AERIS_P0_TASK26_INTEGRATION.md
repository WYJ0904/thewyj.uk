# Aeris P0 / Task26 恢复与 main 隔离集成

2026-10-31，Asia/Hong_Kong。**本地恢复、冲突解决和所列本地回归已完成；远端 CI、Hosted Preview、Samsung 与发布门禁尚未由本子任务验证，暂缓发布。** Task26 历史 `CLOSED_WITH_OWNER_WAIVER` 及其豁免原样保留，不改为 PASS。

## 1. 来源与边界

本轮使用已明确授权的新隔离树 `%USERPROFILE%/.codex/worktrees/aeris-p0-task26-recovery/thewyj.uk`，分支 `codex/aeris-p0-task26-recovery`，初始工作区干净。原 PR #111 的 Git 对象基线为 `6247c4148904cafa264204fc1816b2e8e1d4360a`，本次正常本地合入指定 main `c4d63fa2fb8181a368826db034017fbdabd6ce6f`，共同祖先为 `74eadf589b0a6ffe1e5ab7a9564115891c4ef2dc`。

此旧 PR 树内没有 `AGENTS.md`、`WINDOWS_WORKSPACE.md`、`WORKSPACE_MIGRATION_REPORT.md`、`PAUSED_DEVELOPMENT_HANDOFF.md`；已确认缺失，沿用本会话前一子任务读过的保护要求和所有者最新 P0 指令第 8/12 节。该最新继续指令覆盖旧开发暂停；本子任务仍只做本地恢复/集成，不使用更广的发布授权。

原 Task26 工作树目录仍缺失，本轮恢复的是 Git 中的提交，不能据此声称原目录或原未提交文件已恢复。历史保护覆盖仍保留 **18/19** 限制，未写成 19/19。未修改旧 Task26 目录、Hotfix、财务树、父工作树或手机；没有 push、远端 merge、GitHub job dispatch、Cloudflare 资源/正式 flags/账户写入或 Production 迁移。下文 E 表示忽略的 `docs/migration-evidence/p0-task26/`，该本地证据未上传。

## 2. 冲突与解决结果

`git merge --no-commit --no-ff c4d63fa2...` 初次 exit 1，产生 **27 个冲突文件、55 个冲突区块**；原日志、清单、逐文件原始冲突快照及解决记录分别在 E/merge-initial.log、merge-result-initial.json、initial-conflicts/、merge-resolution.json。早期进度更新人工说过 28 个，已按 Git 的实际清单更正为 27。

其中 21 个文件只有资源版本冲突；另 6 个含实质内容，处理如下：

| 文件 | 最终处理 |
| --- | --- |
| `app.js` | 保留 Task26 wrong-review / 旧题恢复 imports；同时保留 main 已发布的 `setInterfaceEnhancementsEnabled`。flags onChange 同时更新 mastery、wrong-review，并维持 main 的 accessibility flag 回调 |
| `js/language/mastery.js` | 保留旧签发题/旧 IndexedDB outbox 的恢复适配器，不重新引入已退役 catalog / 第二张答题表单；接受 main 的资源版本更新 |
| `js/language/wrong-book.js` | 保留复习事件 sanitize、merge 和错误次数合并 import，维持 Task11 冲突合并合同 |
| `package.json` | 保留完整 13 条 Task26 命令、build 的 staging 后输出检查及 cf:dev 使用受检查 build 的入口；不改变 pinned 依赖 |
| `local-backend/test_static.py` | 同时保留 main 的 staging 路径 containment 断言和 Task26 的精确 build 安全命令断言；另一个继承的旧 build-equality 断言冲突见第 5 节 |
| `sw.js` | 保留原 shell 与两个 wrong-review 模块，更新统一 cache key，避免新页面继续复用旧缓存 |

21 个仅资源版本冲突文件为 `index.html`、`js/core/{api,changelog,config,dashboard,home-widgets,keyed-list,session,ui}.js`、`js/finance/{app,candidates}.js`、`js/language/{achievements,history,mastery-journal,sync-adapter}.js`、`js/tools/{digest-worker,file,image,text}.js`、`js/transfer/app.js`、`tools.js`。其中业务上由 Git 已自动合并的内容全部保留。

浏览器入口、imports、config 和 Service Worker 统一到 `20261031-aeris-task26-p0`；新 wrong-review-sync 的 import 同步更新。没有沿用任一旧版本假装覆盖另一套资源。静态检查确认模块图 **58 文件 / 96 imports，无循环或反向 core 依赖**，前端 storage contract **31 个稳定 key families** 通过。

main 的 `design-system.css`、`js/core/design-system.js`、`qa/p07ui/` 与指定 main 无差异；Android 目录与 main 无差异。这是保留主线已发布行为，没有新开发 P07 页面/动画/设计系统，没有操作 PR #115/#117 或其 Preview。

## 3. 旧路径、算法、身份和迁移

原调用链仍是 `reviewBtn / reviewHistoryBtn → startWrongReview → startQuiz → answerForm / submitAnswer`，保留五个标签、skip/next、题型、恢复及统计路径。没有正常 catalog panel / mastery 独立答题表单。首次正确保留错题；wrong-review-v1 的冷却、UTC 日限制、跨天间隔及错误回退由原算法测试验证，不以旧错题次数伪造成功事件。

`0025_adaptive_learning_mastery.sql` 与 `0026_wrong_book_review.sql` 相对原 PR 内容未变。0026 只有两张新表、一条新索引和不可变触发器：`task26_wrong_review_events`、`task26_wrong_review_states`、`idx_task26_wrong_review_replay`、`task26_wrong_review_immutable`；不 DROP/ALTER/重写旧表。

Wrong-review D1 原测试实际执行 0026 和重放，核对既有账户、价格、会员、Task11 错题及旧 Task26 行保留；原 Task26 D1 套件另核对完整前向迁移、旧行/价格/设置及新 flags 默认 OFF/0%。这些都使用独立 Miniflare 数据库。浏览器还在独占本地状态目录实际运行 0001–0026 迁移，不连接正式数据库。

幂等 event/attempt ID、持久 outbox 后网络、回执丢失重放、账户/profile/语言/current/history 隔离、客户端不提交权威分数/日期、服务端判卷、Task11 tombstone/删除、Task25 flags、Kill Switch 和会员有效权益仍由原套件约束。无 flags/无权益/关闭智能能力继续保留基础复习，不把本机结果显示成服务端确认。

## 4. fresh 本地测试

`npm ci --ignore-scripts --no-audit --no-fund` 安装 lockfile 指定的 34 packages；未升级 Wrangler 4.118.0 或 Miniflare 5.20260730.0-alpha。各命令退出码、输出及结束时间均保存在 E/ 下。

| 集合 | 实际结果 / 证据 |
| --- | --- |
| `npm run test:task26` 完整原命令链 | **13 条 Node 命令全部 exit 0**；E/task26-r1/ |
| 原 mastery engine / D1-API / client | 分别 **32 / 29 / 17 acceptance groups PASS**，包含在上一行 |
| 原 multi-window / account deletion / durable outbox | 分别 **2 / 1 / 4 groups PASS**，包含在第一行 |
| wrong-review engine / D1 / client | 分别 **12 / 13 / 6 groups PASS**，包含在第一行 |
| feature write budget、feature refresh、preview transport、Pages output gate | 第一行完整执行并 exit 0，保留各自日志；不再加进前述计数 |
| `npm run test:task11` | model **6**、API routing **10**、Miniflare/D1 **10** checks PASS；E/sync-flags-r1/ |
| `npm run test:task25` | D1/API **12 groups PASS**，client **19 vectors 及 infrastructure boundary PASS**；同目录 |
| static Python | r1 **30 PASS / 1 FAIL**；修正宿主合同后 r2 **31 PASS**，旧失败保留 |
| staging 安全测试 | **28 PASS / 0 FAIL**；E/static-r1/staging.log |
| build / 输出 gate | **exit 0**，只使用既有 allowlist staging；E/browser-r1/build.log |
| 实际 Chrome 原 wrong-review browser | **5 宽度、42 检查组 PASS**；E/browser-r1/task26/browser-acceptance.json |

这些是不同层的检查组、向量和命令，不能相加成一个 JVM/608/真实业务总数。原 607、冻结 608、财务 JVM833、GitHub Actions 等不由本子任务更新。

最终 844 个 tracked/candidate 文件的仓库审计及 `git diff --check` 通过。166 个已记录受测文件在快照后没有变化；静态宿主断言的最终 SHA-256 另记于 E/precommit-summary.json，并由 static-r2 实际重跑验证。

## 5. 唯一测试失败与修复依据

E/static-r1/python.log 中 `test_manifest_and_service_worker_shell_are_deployable` 第 142 行失败：main 的旧断言要求 `build == pages:stage`，但 PR111 保留的更严格命令是 `npm run pages:stage && node scripts/check_pages_output.mjs`。两个独立分支在不同位置对 build 合同作了不一致断言，自动合并没有标出这一处语义矛盾。

没有移除断言或绕过输出检查；将该旧 equality 更新为完整双步骤命令的精确 equality，与本文件另一个现存安全断言一致，仍强制调用原 staging 和输出 gate。实际 build 与 28 个 staging 测试均已通过。E/static-r2/python.log 的 31 项随后全部通过。原 r1 失败、原冲突快照和日志不删除、不改判。

## 6. 实际浏览器的限定范围和清理

使用新的独占 Chrome profile、Chrome **156.0.8078.74**、localhost Pages 与新建本地 D1/R2 状态，端口 8894/9446/9470。启动前核查默认 Wrangler 配置没有 AI、D1、R2 或 service 远程 binding；未选 preview/production env，只显式绑定本地模拟资源。WORKERS_AI=false；语音路径由原 driver 返回受控不可用响应，不调用外部语音/模型。随机合成 owner/本地密钥仅在 ignored `.dev.vars`，未复用或提交真实凭据。

原 driver 未改输入/断言，宽度 **320、390、768、1366、1920**，深浅主题。每种宽度通过 8 组，390 另通过旧签发题及原 IDB/outbox 在 flags OFF 下恢复、以及实际 JSON 导出/单条删除/历史清空/同步重载/显式导入两组，合计 **42**。还覆盖首次正确保留、刷新只算一轮、current/history、英文/日文听写、断网本机保存与原表单。runtime errors 只允许原 driver 明确标出的离线网络错误。截图在同目录，抽查了 320 dark / 390 light；截图包含交互过渡态，不作为 P07 视觉放行结论。

这不是 Hosted Preview、Samsung 或真实付费用户验收：结果文件明确 `physical_device=false`、`hosted_preview=false`、`production=false`。旧 Samsung/历史豁免不借记本轮 PASS。

完成后核对 PID 的独占状态/profile 路径，再停止本轮自建 Pages/Chrome 进程及其子进程；E/browser-r1/cleanup-result.json 确认三端口 **0 个剩余监听**。本地合成数据库、截图、日志及必要复验材料保留，未清理旧目录或正式数据。

## 7. 交付和后续门禁

27 个冲突已全部解决，原 PR111 与指定 main 的 Git 历史均通过正常 merge 保留。受测源码清单、迁移/main 保全核查及提交信息在 E/tested-source.json、migration-main-preservation.json、commit-provenance.json。未合并到远端 main、未推送 PR111 或发布网站。

当前可以交付本地集成候选；root 仍须在安全环境隔离被证明后核查候选 SHA 的远端 CI、适用 Hosted / 真实设备业务、生产迁移与恢复及发布门禁。本报告不取消这些门禁，不把历史豁免当新验收，不把旧工作树缺失或历史 18/19 保护缺口写成已恢复。

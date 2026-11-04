# Task26 独立发布前质量验收

日期：2026-11-04（Asia/Hong_Kong）。仓库：`WYJ0904/thewyj.uk`。

## 结论

**TASK26_READY_FOR_INTEGRATION**

建议 Gemini 进行独立集成，集成输入必须包含 PR #111 与本次修复提交
`c0636541000953d548a2fff4b9df3a4f93bae17a`。本次发现 1 项 P2 缺陷，已在本地候选中修复。
远程 PR #111 仍保留原 HEAD，因此该修复尚未进入远程 PR。

此结论只允许进入独立集成流程。新的组合 HEAD CI、Hosted Preview、Samsung 真机及
Production 门禁仍需分别完成。本次未改变历史 `CLOSED_WITH_OWNER_WAIVER` 或
`WAIVED_BY_OWNER` 的含义，任何豁免项均未改写为 PASS。

## 1. 被测版本与远程核对

开始前和结束前均通过 `git ls-remote`、GitHub PR API 实时核对，结果一致：

| 项目 | 实际值 |
| --- | --- |
| PR #111 HEAD | `df67fd0a3a5239bfa2853fbd74fe6b31d2c1d61e` |
| 最新远程 main | `3eb268b748a6e7a1aaa7369059db474810bb59d4` |
| PR #112 HEAD | `9ab3a5667b6230560b64531764720a754922b4c7` |
| main 与 PR #111 共同祖先 | `c4d63fa2fb8181a368826db034017fbdabd6ce6f` |
| 本地业务修复候选 | `c0636541000953d548a2fff4b9df3a4f93bae17a` |
| main + 修复候选合成 tree | `5a506676bdc73b0a665fc127745d2790b8f91379` |
| PR 状态 | OPEN / Draft；未修改远程状态 |
| 原 PR HEAD 的最新 CI | 10/10 SUCCESS，Core CI run `41181675911` |

GitHub PR 记录的 base SHA 为 `c4d63fa`，它是共同祖先；本次兼容测试实际采用最新远程
main `3eb268b`，未把 PR 的旧 base 当作最新 main。

原 HEAD 的 CI 证据：[PR #111](https://github.com/WYJ0904/thewyj.uk/pull/111)、
[Core CI](https://github.com/WYJ0904/thewyj.uk/actions/runs/41181675911)。
本地修复及合成 tree 未推送，未获得新的远程 CI 结果。

## 2. 隔离与保护结果

- 分支：`codex/task26-independent-qa`，从实时核对的 PR HEAD 创建。
- 独立工作树：`%USERPROFILE%\.codex\worktrees\task26-independent-qa\thewyj.uk`。
- 业务修复、测试、报告和本地提交均位于该工作树。未切换或写入固定 Hotfix 工作区。
- 集成验证使用 `git merge-tree --write-tree` 生成合成 tree，再以 `git archive` 展开到本工作树
  忽略目录中的测试 fixture。未创建合并提交，未执行 `git merge`，未改变 main。
- 固定 Hotfix 工作区的 HEAD、branch、Git status 及 27 个 WIP 文件哈希在保护快照间一致。
- PR #112 的 `finance-release-convergence` 以及三个 P06 相关工作树的 HEAD、status、WIP 哈希一致。
- Argon 的 P07 工作树存在并行进展：初次清点 HEAD 为 `3eb268b`，随后只读快照为 `e37a026`；
  两次哈希快照之间 HEAD 保持 `e37a026`，WIP 文件数由 11 变为 39。本审计没有写入该路径，
  没有恢复、清理或覆盖这些并行修改，也不声称该工作树在整个期间保持不变。
- 未读取根目录 `访问口令.txt`；未复制本地凭据、签名材料或其他开发者的未提交内容。
- 无 push、merge、部署、远程迁移或 release workflow dispatch；无 Production D1/R2、正式账号、
  权益、Feature Flag、签名、Stable 指针或手机操作。

保护证据：本地 `protected-before.json`、`protected-after.json`、`protected-comparison.json`。

## 3. 实际测试统计

验收组是脚本自身定义的场景组，不等于底层 assertion 数；各行独立统计，不相加冒充独立测试总数。

| 被测阶段 / 测试 | 结果 |
| --- | --- |
| 原 PR HEAD：`npm run test:task26` | 13 个脚本，125 组 PASS，exit 0 |
| 新增时间回归，修复前 | 原 12 组 PASS；新增第 1 组 FAIL；后续 2 组未执行 |
| 时间回归，修复后 | 15/15 组 PASS |
| 修复候选：完整 `npm run test:task26` | 13 个脚本，128/128 组 PASS，exit 0 |
| 最新 main + 修复候选：完整 Task26 | 13 个脚本，128/128 组 PASS，exit 0 |
| 独立迁移脚本 | 最终 10/10 组 PASS，5 个持久本地 D1 库 |
| Task11、Task25、语言、learning-sync 关联测试 | 7 个脚本 PASS |
| 模块图与 storage contract | 2 个 gate PASS |
| 合成树 Python 全量 | 186 tests，OK，exit 0 |
| 合成树 Functions 编译 | PASS |
| 合成树 Pages allowlist staging 与输出 gate | PASS |
| 真实本地 Chromium 页面 | 最终功能覆盖 42 项 PASS；首轮另有 1 次 FAIL_ENV，见第 8 节 |
| 真实登录、退出、重新登录 | 3/3 组 PASS |

Task26 完整套件修复后的分组数为：
`1 + 32 + 29 + 17 + 2 + 1 + 6 + 1 + 4 + 15 + 13 + 6 + 1 = 128`。

环境保持固定依赖：Node `v24.18.1`、Python `3.15.0`、Wrangler `4.118.0`、
Miniflare `5.20260730.0-alpha`、compatibility date `2026-08-06`。未升级依赖或配置日期。

## 4. Mastery、数据与账户覆盖

| 范围 | 已执行证据与结果 |
| --- | --- |
| 新题初始化 | 初始分数、证据数为零；旧 wrong_count 不制造正确证据，PASS |
| 升级、降级、连续正确/错误 | mastery-v1 的积累与退化；wrong-review-v1 五个间隔日期掌握、错误清 streak 并恢复优先级，PASS |
| 复习间隔 | 1/3/7/14/30 天、错误后十分钟复习、到期复习不重复计分，PASS |
| 冷却与每日上限 | 20 分钟、每日一次有效错题证据；原 mastery 的每日 cap 与不同题族限制，PASS |
| 日期边界 | UTC 跨日、跨日仍受冷却约束、同日错误后不能再次刷有效证据、时区偏移规范化，PASS |
| 极端时间 | 扩展正/负年份、最大可解析日期、非字符串及非法时间；修复后过滤或明确拒绝，PASS |
| 重复与并发 | 相同事件重放、相同事件不同内容冲突、同题多个结果竞争、不同事件并发、CAS 投影重建，PASS |
| 用户、档案、语言与范围 | 两个真实 D1 fixture 用户，英语/日语、current/history、精确 profile 前缀及通配符边界，PASS |
| 登出/重登 | 真实页面登录；退出删除本地身份并使旧 token 返回 401；重登同账户恢复相同 canonical 学习证据，PASS |
| 旧题与客户端差异 | 旧题无伪造成功、旧键保留、未知存储版本保留、旧算法/过期票据明确处理；browser/native/WebView 传输读取同账户状态，PASS |
| 离线、恢复、断网与丢 ACK | IndexedDB 先持久化，响应丢失重放原 ID，网络失败不假确认；真实页面断网及旧格式 outbox 恢复，PASS |
| 删除、清空、导入 | tombstone 防复活；真实 JSON 导出、删除、清空、同步、刷新与显式重新导入，PASS |

保持原五标签、`reviewBtn` / `reviewHistoryBtn`、原 `answerForm` 与下一题流程。
修复未新增产品 UI，也未改变评分、权益或既有安全判定。

## 5. D1 0026 迁移验收

所有数据库均为本机 synthetic fixture。使用实际 Miniflare/workerd D1 binding，另以固定 Wrangler
执行一次全新本地迁移和一次重复执行。未配置远程 D1 或 AI binding。

| 项目 | 结果 |
| --- | --- |
| 空库 | 0001–0026 全链成功；迁移前测试库用户为 0，PASS |
| Wrangler 台账 | 26 条，最后为 `0026_wrong_book_review.sql`；重跑 `No migrations to apply`，PASS |
| 历史增量 | 保留 91 张旧表、85 行 synthetic 数据；覆盖账号、session、会员、价格、已有 flag 设置、Task11 错题、非空旧 Task26 ticket/event/projection，PASS |
| 重复 SQL | 完整 schema、数据和 AUTOINCREMENT counter 精确一致，PASS |
| 迁移前备份 | 写出全部项目 schema、行及 sequence；从保存文件在另一隔离 D1 还原，精确一致后再次升级，PASS |
| 失败回滚 | 在迁移前两条 DDL 后注入错误 SQL，批次回滚；旧库快照不变；完整重放成功，PASS |
| 中断恢复 | 先提交部分 DDL，关闭运行时，重新打开持久库；确认部分索引仍存在，再补齐 0026，最终快照精确一致，PASS |
| 表与约束 | CHECK、NOT NULL、FK、复合主键、每账户 event/attempt 唯一性及 JSON 校验，PASS |
| 索引和触发器 | EXPLAIN 使用 `idx_task26_wrong_review_replay`；UPDATE 触发 immutable 拒绝，PASS |
| 完整性 | D1 `foreign_key_check` 零异常；关闭运行时后以 `mode=ro` 打开 5 个本地 D1 SQLite 文件，全部 integrity_check=ok、FK 异常为 0，PASS |
| 账户删除 | 仅级联删除目标 fixture 用户的新 Task26 行，PASS |

迁移文件本身未修改。D1 SQL authorizer 不允许完整 `integrity_check`；测试保留该拒绝断言，
完整检查在关闭后的本地文件上只读执行，没有放宽 SQL 授权。

最终本地证据：`migration-SU088w/result.json`、`pre-0026-backup.json`、`read-only-integrity.json`。

- 迁移前逻辑备份 SHA-256：`d7671c06dd54ce66da0bfdea73da6a909ed3ff2dd0182bee545b23dfa13630d3`
- 迁移后逻辑快照 SHA-256：`04cfc823e7e723ac8edbfb44792effb4963ea5df9aca6a9916a886c635c51522`

## 6. 安全验收

| 场景 | 实际结果 |
| --- | --- |
| 未登录、跨账户 ticket/event/错题访问 | 401 / 404 / 409 等既定拒绝；无跨账户状态泄漏，PASS |
| 参数篡改、错误语言/profile/scope、重复 query key、方法及 Content-Type | 明确拒绝，PASS |
| 非法掌握度、客户端 correct/state/score/accepted_at | 客户端无权提交权威值；异常 receipt/state 不能进入确认缓存，PASS |
| 重复请求、同 ID 不同 payload、并发写 | 唯一事件或明确 409；原 ID 重放修复投影，不重复计分，PASS |
| 权限提升、无学习权益的管理员、普通用户管理接口访问 | 服务端有效权益及管理角色分别检查，PASS |
| Feature Flag OFF、rollout/channel/override、Kill Switch、总开关 | 智能 API fail closed；原基础复习和受约束的旧票据恢复保留，PASS |
| 不可信客户端数据、原判卷版本 | source digest 绑定本账户确认过的 Task11 版本；无新权威分数或日期输入，PASS |
| CSRF、私有响应缓存、限流 | 原中间件、私有缓存及 per-account D1 限流测试通过，PASS |
| AI | 仅 synthetic stub/故障/超时测试；评分仍由确定规则决定。无真实模型调用或财务 AI 启动 |

安全结果主要来自完整套件的 D1/API 29 组、wrong-review D1 13 组，以及客户端验证、Task25
关联测试和真实会话检查。它们是本地证据。

## 7. 缺陷、最小修复与回归

### T26-IQA-001 — P2，极端时间元数据导致错题界面不可用

触发：导入或同步一个合法结构的 review event，其 `at` 为
`+275760-09-13T00:00:00.000Z`，然后打开错题列表或智能复习。

修复前：时间可被 `Date.parse` 接受，排程加上间隔后 `toISOString()` 抛出
`RangeError: Invalid time value`。负扩展年份还产生不符合 UTC 日期契约的 day key。
路径为 `orderWrongReview → wrongReviewView → replayWrongReview → reduceWrongReview`。
影响为本账户受污染导入/同步数据可阻断错题显示；未发现服务器跨账户写入或数据删除。

最小修复：仅接受字符串时间，把可支持的时间规范化为四位年份 UTC ISO；在事件清理前过滤扩展年份，
在直接 reducer 入口明确拒绝异常时间，并从规范化时间提取每日证据日期。
旧 wrong_count 与正常记录保留，普通时间的排程与判分不变。

提交：`c0636541000953d548a2fff4b9df3a4f93bae17a`。
业务文件：`js/language/wrong-review.js`；回归：`qa/task26/wrong-review-engine.mjs` 新增 3 组。
旧断言全部保留。修复后定向、完整套件、合成 main 套件及真实页面流程均执行。

失败证据：`before-time-regression.log`，SHA-256
`e63659787732eb76dc32c6b6f42f35d962da322b5f1d04a75e8392b91dfcf0a6`。

## 8. 保留的失败与证据限制

1. 原始 PR 基线命令在输出等待中被中断过一次，但测试进程继续并最终 exit 0。保留汇总与捕获尾段；
   修复后和合成树的完整运行日志均连续保存。
2. 首轮 Chromium：320px 的 8 项通过；390px 在后续日语导航遇到 `Network connection lost`。
   截图显示 Wrangler `middleware-ensure-req-body-drained.ts` 的本地错误页，页面 runtimeErrors 为空；
   后续本机 GET 探针返回 200。保留为 **FAIL_ENV**，未改写成 PASS。
3. 对失败的 390px 及尚未执行的 768/1366/1920px 只做一次有界复跑，全部通过，合计 34 项。
   最终 42 项功能覆盖来自首轮 320px 的 8 项和复跑的 34 项，不声称一次全宽运行全绿。
4. 使用仓库既有 pinned local CI proxy workaround，仅处理精确的本地取消连接错误；HTTP 失败仍可见，
   无含糊 POST 自动重试，其他异常保持失败。参考已有
   [workers-sdk issue #15451](https://github.com/cloudflare/workers-sdk/issues/15451)。
5. 新迁移审计工具编写时的失败均保留：fixture token 格式、备份还原的外键顺序、Miniflare 5 的
   `resourcePersistencePath` 适配、部分执行与整库执行的 DDL 换行差异、D1 禁止的完整性 PRAGMA，
   以及离线诊断把 metadata 文件计入数据库数量。分别修正测试 fixture 或调用方式后才复跑；
   原 0026 SQL、旧测试断言和权限边界均未修改。最终迁移脚本 10/10 PASS。
6. Node 模块类型提示和 Python HTTPError ResourceWarning 留在原始日志中；未当作产品测试失败。

## 9. 主干兼容性与未关闭门禁

三方合成无冲突。合成 tree 包含最新 main、PR 和修复候选；该 tree 的实际 Web/D1/同步测试结果见第 3 节。
main 相对共同祖先没有 D1 migrations 变化，因此独立 0026 迁移演练使用的旧 schema 与合成树一致。
新增会话测试作为测试驱动放入合成 fixture；未改动合成业务源文件。后续本地审计提交只增加测试与报告。

| 门禁 / 问题 | 当前状态 |
| --- | --- |
| P0 / P1 | 本次已执行范围内未发现 |
| P2 T26-IQA-001 | 本地候选已修复；远程原 PR HEAD 尚未包含修复 |
| 本地 Web/D1/同步集成 | PASS，包含明确保留的首次 FAIL_ENV 与后续通过记录 |
| 新组合 HEAD 的远程 CI | NOT_TESTED；原 df67fd0 的 10/10 不能替代它 |
| Hosted Preview | 本轮 NOT_TESTED；历史证据不迁移为本轮 PASS |
| Android 原生构建 / 真机 | 本轮未重跑原生构建；Samsung NOT_TESTED；桌面移动尺寸模拟不替代真机 |
| Production D1 0026 | 本任务未执行且未连接复核；所有者提供的“尚未迁移”不是本地测试的通过证据 |
| Production smoke / 真实账户及付款 | NOT_TESTED；无 Production D1/R2 或账户操作 |
| 历史 Task26 owner waiver | 原状态保留，未改成 PASS |

建议 Gemini 以最新 main、PR #111 和 `c063654` 组成独立集成候选，运行新组合 HEAD 的完整 CI 和
相应 Preview/真机门禁，并保留本次回归。Production 迁移及发布继续按独立授权与发布门禁执行。
本审计没有向 Gemini/P06 工作树写入文件或发送集成操作。

## 10. 可复现入口与本地证据

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run test:task26
node qa/task26/independent-migration-audit.mjs
npm run test:task11
npm run test:task25
node local-backend/test_language_js.mjs
node local-backend/test_learning_sync_js.mjs
node scripts/check_js_module_graph.mjs
node scripts/check_storage_contract.mjs
python -m unittest discover -s local-backend -p 'test_*.py' -v
npm run cf:check
npm run build
```

真实浏览器使用 CI 的 Cloud-only 本地 fixture 设置方式：独立随机本地 Secrets、仅本地 D1/R2、
allowlist 静态目录、AI OFF，以及独立 Chrome profile。本轮端口为 18994 / 19265；测试脚本以
`WYJ_TEST_BASE`、`WYJ_CDP_URL`、`WYJ_TEST_ADMIN_SECRET`、`WYJ_TEST_ARTIFACT_DIR` 接收本机配置。
先运行 `node qa/task26/learning-browser.mjs`，再运行新增的
`node qa/task26/independent-session-browser.mjs`。两者均硬性限制 loopback origin。
新会话脚本依赖前者生成的日语旧票据 fixture。私有随机值未进入报告或提交。

本地原始证据根目录：`.wrangler/task26-independent-qa/`，已被 Git 忽略并保留：

- `baseline-summary.json`、`baseline-tail.log`
- `before-time-regression.log`、`after-time-regression.log`、`after-task26-full.log`
- `migration-first.log` 至 `migration-sixth.log`、各次独立库和失败 JSON、最终 `migration-SU088w/`
- `cli-empty-first.log`、`cli-empty-replay.log`、`cli-empty-ledger.json`
- `integration-tree.json`、`integration-task26.log`、`integration-related-tests.json` 及各脚本完整日志
- `integration-python.log`、`integration-cf-check.log`、`integration-build.log`
- `integration-browser-first.log`、`browser-artifacts/task26/failure-390.*`
- `integration-browser-rerun.log`、`browser-artifacts-rerun/task26/`、`integration-session-first.log`
- `browser-artifacts-session/task26/independent-session.json`
- `protected-*.json`、`service-closeout.json`、`final-pr111.json`、`evidence-manifest.json`

本机 Pages 和独立 Chrome 已停止；18994 / 19265 无监听。数据库、备份和失败证据保留在忽略目录中。
报告与可复现测试作为本地独立审计提交；没有推送、合并或部署。

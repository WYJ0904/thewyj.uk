# Task26 历史 PR #111 最小收敛

交付核对：2026-11-11，Asia/Hong_Kong。
结论：**必要历史能力已移植，本地验收通过，可提交替代 Draft PR；未授权发布。**
既有 Task26 `CLOSED_WITH_OWNER_WAIVER` 不变，豁免不改 PASS；未完成的 Samsung
验收继续 UNVALIDATED / DEFERRED_BY_OWNER，不以桌面 Chromium 替代真机。

## 基准与实际差异

- 开始及交付前远端 main：`4fc025a044e5e39d742166df9510d488413f7043`。
- 历史 #111 精确 HEAD：`df67fd0a3a5239bfa2853fbd74fe6b31d2c1d61e`；与
  main 的共同祖先是 `c4d63fa2fb8181a368826db034017fbdabd6ce6f`。
- 独立 Worktree：`%USERPROFILE%/.codex/worktrees/task26-final-convergence/thewyj.uk`；
  分支 `codex/task26-final-convergence`，基于上述最新 main。
- 产品及测试提交：`0e9d3e1a51100a8b07f6491446fdda6da5344baa`。
  后续提交仅补本报告；中断恢复后已逐文件核对受测源码 hash 未变。

| 范围 | main 已有 | 本次必要移植 |
| --- | --- | --- |
| 复习入口 | 本轮/历史按钮、原答题表单、五个学习标签 | 仍走原表单；首次正确保留记录；恢复题型、判卷快照及范围；退休旧独立题库面板 |
| Mastery | mastery-v1 引擎、签发题目、事件/投影和旧队列 | 将真实错题的生命周期、原答题事件及人工纠正关联到 wrong-review-v1；旧签发题只作恢复 |
| 间隔与掌握证据 | 未包含 wrong-review-v1 | 原到期排序、20分钟冷却、UTC日上限、1/3/7/14/30天间隔和跨5个UTC日期有效正确证据 |
| Task11 / 离线 | 同步、tombstone、释义保全、离线删除回补 | 保留原进度字段与事件；原 attempt/event ID 持久队列；账号/档案/语言隔离，删除优先且显式导入可恢复 |
| 权限和 Flags | 原会员权益及 Task25 服务端快照 | 复用 adaptive_learning / mastery_score / adaptive_review；Flag OFF 仍可普通复习，不伪造同步确认 |
| P07 | 三张悬浮卡、动态布局、页面策略、学习入口 | 保持主壳；只增加错题状态/旧题恢复入口，保留 main 的 tabpanel/ARIA 与生命周期策略 |

这些必要能力在 main 缺失，并非仅剩 Owner Waiver，因此需要代码收敛。
没有整体 cherry-pick #111，也没有复制旧版页面或旧资源版本号。

## 代码与冲突处理

主要产品文件：

- `app.js`、`index.html`、`product-ui.css`：原错题流程、统计和旧题恢复。
- `js/language/wrong-book.js`、`wrong-review.js`、`wrong-review-sync.js`、
  `mastery.js`、`quiz.js`：复用 #111 的调度/证据/队列及退休适配器。
- `learning-sync.js`、`functions/_lib/task11-model.mjs`：保留复习字段及合并规则。
- `functions/_lib/task26-api.mjs`、`task26-service.mjs`、`task26-wrong-review.mjs`：
  既有接口、有效会员/Flag校验、旧票据恢复、可信时间和幂等回执。
- `sw.js`：仅将两个新复习模块加入 main 的 CORE_SHELL，不回退 P07 Worker。

复用既有 `0026_wrong_book_review.sql`，字节与 #111 完全相同，SHA-256：
`7f97ac05943b5e6b3cdf2395251d62acbd3e6fee7fb676867add02ed0436d764`。
仅含原两张错题事件/投影表及索引/不可变约束；没有新迁移编号，未改0025。

三方合并的5处冲突位于4个文件，均已解决：

- `app.js` 保留 main 的 `applyInterfacePolicy()` 并增加复习更新。
- `index.html` 保留 P07 setup tabpanel/ARIA，移除 #111 已退休的旧独立题库。
- Task11 模型/客户端同时保留 main 非空释义修复、同设备离线删除回补，以及
  #111 的复习事件合并和明确恢复修订，未以旧版本覆盖 main。

只对已复现的异常时间戳崩溃带入既有独立 QA 修复 `c0636541`：拒绝不安全/
扩展年份并规范化 UTC 证据。原失败 `RangeError: Invalid time value` 日志保留，
复用原回归用例后通过；没有新建专项测试框架。

#111 的旧构建入口/断言、CI恢复和全局 cache-bust 不属于本次范围，未移植。
整合初期夹带的两条旧构建断言曾失败，已撤回这些无关差异，恢复 main 原测试，
31项通过。main 现有 allowlist staging 保持；旧失败日志与排除文件原件均保留。

`js/finance/`、Android、P03/P04/P05/P06、正式配置和原历史报告均无差异。
没有操作 Flash 的 Android Worktree；没有依赖或锁文件升级，没有 DeepTutor。

## 实际验证

所有结果均为本地隔离合成数据；新建 D1 使用 development 配置，未连接远端。
Chromium 实际访问的所有修改后运行时文件与上述代码提交的工作文件字节相同。
源码清单、日志和截图保存在忽略目录 `docs/migration-evidence/task26-final/`。

| 命令 / 集合 | 实际结果 |
| --- | --- |
| `npm run test:task26` | 最终 exit 0；原引擎32组、D1/API29组、客户端17组及其他原恢复/隔离测试通过；新增复习复用集合 engine15 / D1 13 / client6 组通过 |
| `npm run test:task11` | model7 / API10 / D1 10组通过 |
| `node local-backend/test_learning_sync_js.mjs` | local-first、旧ID迁移、隔离、幂等及会话恢复通过 |
| `node qa/task26/wrong-review-browser.mjs` | 320/390/768/1366/1920五宽度，42项通过；含明暗色、首次正确保留、刷新、Flag OFF听写、旧IDB票据、离线、导出/删除/同步/显式导入 |
| P07 p1-navigation-lifecycle | 导航合并、非活动界面及恢复合同通过；不是实际Android生命周期验收 |
| P07 p33-shared-home-browser | 访客8、登录8及恢复4个视图通过，三卡真实渲染/动态布局保留 |
| P07 p5-contract-browser | 工具/工作流/账本停泊身份与学习草稿保留，runtimeErrors=0 |
| P07 home-widgets-browser | 拖动、账号隔离、响应式及导航通过 |
| P07 sw-install-browser，source=上述代码SHA | normal / slow / failure-retry / body-timeout / warm五项PASS；受控安装失败保持旧缓存，重试按原合同执行 |
| ES模块图 / storage contract | 60文件、98 imports通过；31类稳定存储键通过 |
| main 原静态测试 | 31 tests PASS，未放宽断言 |
| `npm run cf:check` | 固定 Wrangler 4.118.0 Worker构建通过 |

各集合有重叠，不相加作为独立用例总数。没有用 mock/桌面结果关闭真机门禁。
常规错题复习不新增模型判卷；本轮没有真实模型调用或付费操作。

## 与 #141 和历史 #111 的关系

对本代码提交与 #141 的
`9ae26436c5e9afbf2626bb4a239b4e05269435e7` 进行了只读 `git merge-tree`：
exit0、无文本冲突，预测树为 `7b0d0a6062ca903965b60db5f944aa57460d3068`。
这不是实际合并，也不是联合财务业务验收；没有改动两个财务模块或 #141。
目前没有遗留的本次源码文本冲突；上游后续变更仍须重新核对。

**无需再整体合并 #111。** 本替代分支承接其必要错题/Mastery范围，并保留
main 的 P07 和 Task11 修复。替代 Draft 被所有者接受并合入 main 后，可将
#111 关闭为 superseded；此前保留其跟踪。若所有者决定放弃该历史功能，也须
明确记录范围，不能把未移植功能当作 Owner Waiver 已自动覆盖。

本轮未关闭 #111、未合并 main、未部署、未运行 Production 0026，未改正式
Flags、签名、Stable、手机数据或权限。Task26 历史 CLOSED_WITH_OWNER_WAIVER
及 #111 的 Samsung UNVALIDATED / DEFERRED_BY_OWNER 分别保留。
远端 CI 仅由新 Draft 的正常流程触发；本报告不把尚未完成的远端 CI 标为PASS。

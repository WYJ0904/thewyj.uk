# Task25 D1 并发合同诊断

状态：**P07_TASK25_D1_PARTIAL**。原 CI 的 23/30 失败尚未复现并定位；本分支不宣称已修复根因。即使新 CI 通过，也不能把一次绿色运行当作根因已关闭。

首个诊断提交 `7d115fb340fd9d336a39f548ae10b8ff8aa02be8` 的 [Core CI 42373213925](https://github.com/WYJ0904/thewyj.uk/actions/runs/42373213925) 中，JavaScript 作业和原 Task25 合同通过。但我打包的原 CI 栈含 Runner 绝对路径，仓库审计失败，两个 CI 浏览器任务因依赖被跳过。原始日志保留在 ignored 目录；提交副本只将 workspace 前缀脱敏并记录原件哈希，未修改失败内容或仓库审计规则。新精确提交再次执行 CI，不能把前一次跳过写成通过。

## 固定输入与隔离

- 产品基线：PR #131 `7e938bdbda734d319053f1e23fe4a96703486ae6`。
- 原失败：[Core CI 42348512895](https://github.com/WYJ0904/thewyj.uk/actions/runs/42348512895)，JavaScript job `128331410158`。
- 原合同：`local-backend/test_task25_d1_js.mjs`，约 188 行。31 并发，30 个 200、1 个 429、Retry-After=1，下一分钟恢复，D1 窗口计数 `[31,1]`。
- 独立工作树/分支：`p07-task25-d1-concurrency` / `codex/p07-task25-d1-concurrency`；新 Draft PR 目标为 `codex/p07-f-a11y-closeout`。
- 开始时 #128–#131 HEAD 仍分别为 `5f83167…`、`4e2fc0c…`、`72940be…`、`7e938bd…`，没有移动这些 HEAD。

仅使用新工作树、本地 Miniflare 临时 D1 和测试账户。Linux 对照在 WSL 的独立依赖目录运行；便携 Node 22.23.4 下载自 nodejs.org，并核对官方 SHA-256。未安装/切换系统 Node，未升级锁定的 Wrangler/Miniflare，未操作真实 D1/R2、正式账号、Production 或 AI/OCR。

## 已知 RED 与缺失的诊断信息

原 CI 在前十组合同通过后，31 并发请求中有 23 个 200、1 个 429、7 条 `task25_error / temporarily_unavailable`，随后 `23 !== 30`。详见 [原失败原件](evidence/task25-d1/ORIGINAL-CI-FAILURE.json)。

现有产品日志只输出异常分类，未保留 message、cause 或失败阶段；原测试也在成功数断言处停止，未输出这一次失败的窗口计数。因此，仅凭原日志不能判断是 SQLite 锁、D1 RPC、身份读取、快照读取或其他异常，也不能确认七个失败在 CI 中究竟计数几次。没有把它直接归咎于 GitHub Runner。

## 有界复现实验

原测试文件、31 请求、30/1 预期及恢复/权限/审计断言均不变。[观测汇总](evidence/task25-d1/LOCAL-OBSERVATIONS.json) 保留所有对照，不挑选某次 PASS 覆盖原 RED。

| 对照 | 结果与含义 |
| --- | --- |
| Windows 原脚本、无加载器 | 12 组 PASS；只说明当次未复现 |
| Windows Node 24.18.1 两批独立并行 | 均 30/1，无 D1/异常链错误 |
| 固定原 CI 分钟 `2026-11-07T06:50:00Z` | 30/1；固定 59.5 秒与下一分钟恢复不变，不能将分钟窗口漂移认定为原因 |
| 对齐 30 个获准请求的快照读取 | 30/1；未复现批读取重叠错误 |
| Windows Node 22.23.4 | 30/1；未证实仅 Node 版本差异造成失败 |
| Linux/WSL Node 22.23.4、相同锁文件及 Miniflare | 30/1；关闭 SQL 代理，仅在 API 异常后记录，避免观测包装改变成功路径 |
| 四批独立 Linux 压力对照 | 每批保留 31 并发和原断言，均通过；不是降低并发，也不代表原 CI 风险已消失 |
| 受控 GC/RPC 时序 | 将七个批调用的传输推迟、观察真实 FREE，未注入数据库错误；未包装与保留引用的对照均通过，故代理生命周期假设未成立，未据此修改产品 |

本地环境为 Windows Node 24.18.1、便携 Windows/Linux Node 22.23.4；Wrangler `4.118.0`，Miniflare `5.20260730.0-alpha`。这些对照不能代替原 Runner 的异常链。测试安装/缺少诊断环境变量的启动错误单独留在原始日志，不当作合同失败。

## 当前能确认与不能确认的事项

1. 原限流 SQL 是单条 `INSERT … ON CONFLICT … RETURNING`，不采用先读后写；本轮未改变原子计数、上限饱和或 429 语义。
2. 快照仍以 D1 batch 一次观察 flags、override、channel，没有改为可能混合版本的多次独立读取。
3. [已取证的本地实例](evidence/task25-d1/LOCAL-COUNTS-AND-AUDIT.json) 中，31 请求后的窗口计数为 31，评估前后审计数量同为 22，下一分钟计数为 `[31,1]`。这不是原 CI 失败时的数据库证明。
4. 未观察到可以据以编写因果回归的 SQL/锁/RPC 异常。因此没有新增“模拟一个任意异常然后让重试通过”的伪根因测试，没有添加产品重试或重放请求。
5. 根因保持 NOT_DETERMINED，真实代码缺陷、夹具缺陷与执行环境差异尚未完成区分。

[Cloudflare D1 retry 文档](https://developers.cloudflare.com/d1/best-practices/retry-queries/) 要求按具体错误判断可否重试；不能因看到 generic unavailable 就重放整个管理请求。本分支不将重试引入计数、写审计、计费、账目或会话逻辑。

## 本分支实际修改

| 文件 | 范围 |
| --- | --- |
| `qa/task25/diagnostic-register.mjs` | 限原始本地合同入口，记录原文件哈希、运行环境及结果，退出时保存 JSON |
| `qa/task25/diagnostic-loader.mjs` | 仅该 Node 测试进程增加异常链、31 响应分布、窗口/审计只读取证；原文件在磁盘上不变，原断言照常失败或通过 |
| `qa/task25/diagnostic-trace.mjs` / `diagnostic-rpc.mjs` | 可选本地 SQL/调度实验；CI 关闭 SQL 包装和 GC/传输时序，不改变正常成功路径 |
| `.github/workflows/ci.yml` | 原 D1 合同用加载器运行并上传诊断 JSON，随后仍执行原 19 向量客户端合同；未删除、跳过或放宽任一断言 |
| `qa/p07-r4a/run-gates.mjs` | 只增加独立证据目录名，复用已有冻结工具，避免覆盖既有证据 |

**产品文件没有变更。** `functions/`、UI、会话、权限、审计、财务/计费、Service Worker、配置、锁文件和原 Task25 合同均保持基线。没有 UI、启动动画或后台标签页恢复修改。P07-F 的八项修复完整保留；不需要修改公共基础模块，也不存在本分支重试导致重复计数或重复审计的新路径。

原异常日志没有内部信息；只有专用测试加载器在本地夹具/CI 中保留原因，不增加正式 API 的内部错误响应或敏感日志。诊断不记录绑定值、请求头或会话凭据。

## 最终 CI 与不回退验证

新 Draft PR 的最终评论和 `docs/migration-evidence/p07-task25-d1/` 记录最终完整 SHA、精确 CI、实际执行的 application/Cloud-only 结果，以及固定 P07-F、R5 冻结、会话/策略、OFF/Kill、离线结果。没有把原先跳过的 CI 浏览器任务当作通过。

首轮本地复核中，冻结 25/25、主工作区 3/3、运行 7/7、策略 5/5、R5 13/13、P07-E 32/32、P4/PWA、OFF/Kill 通过。固定 P07-F 另观察到 LoginPage 的 color-contrast 1 类/4 节点，原件保留于 `task25-final-regression/p07-f-preflight-report.json`，**不计通过**。这些 UI 文件在本分支均未改动；不擅自断定是扫描时序还是视觉缺陷，不改前端或增加固定等待掩盖问题，交给 Flash 的独立登录/动画任务。P07-F 的代码修复完整保留不等于本次所有扫描自动通过。

本地复现例子（无产品代码修改）：

```powershell
$env:TASK25_DIAGNOSTIC_OUT='.wrangler/task25-diagnostic.json'
$env:TASK25_DIAGNOSTIC_SQL='off'
node --import ./qa/task25/diagnostic-register.mjs local-backend/test_task25_d1_js.mjs
node local-backend/test_task25_client_js.mjs
```

可选 `TASK25_DIAGNOSTIC_WINDOW=1794034200000` 固定原 CI 分钟；`TASK25_DIAGNOSTIC_BARRIER=snapshot` 对齐读取；`TASK25_DIAGNOSTIC_RPC=gc-before-batch` 必须配合 `--expose-gc`，只用于已记录的负假设，不属于生产修复。

若新 CI 没有再次触发失败，状态仍是 PARTIAL，下一步是利用已补齐的异常链定位真实失败，再选择最小修复和可重复 RED→GREEN 回归。未对原 CI 做无限重跑或把暂时全绿标成修复完成。

历史离线复习超时保持独立风险，未改动、未关闭。不合并 main，不部署 Production，不操作正式绑定或账号，也不发布 Android Stable。

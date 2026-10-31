# Aeris P0 / P06：AI 额度与恢复缺陷本地 RCA

日期：2026-10-31（香港时区）。状态：`LOCAL_FIX_VERIFIED`；
`REAL_MODEL_QUALITY = NOT_TESTED_THIS_RUN`；`RELEASE = HELD`。

本报告仅覆盖 P06 额度预留、拒绝后恢复及原角色测试的证据判断，不关闭整个 P0。
本次使用所有者最新 P0 继续指令，未将旧工作区迁移/暂停报告当作开发授权。
Production AI 必须继续 OFF；本地修复不满足真实模型或正式发布门禁。

## 1. 基线与保护

- 独立写入目录：`%USERPROFILE%\.codex\worktrees\aeris-p0-ai\thewyj.uk`。
- 分支：`codex/aeris-p0-ai`；父提交：`253a776f4bab013b13fdbf7545c932d45c91314b`。
- 接手时已有 `functions/_lib/finance-ai.mjs` 修改和 `qa/p0-ai/` 两个未提交驱动。
  未 reset、stash、清理或覆盖；先逐字节复制到忽略目录
  `docs/migration-evidence/p0-ai-inherited-20261031-095445/`，保留 binary diff、
  Git 状态及 SHA-256 manifest。继承产品文件 SHA-256：
  `77d87b1159464e67646062790a472f5b28bdfacdf7f4c141770e99c4230a28c0`。
- 写入范围只有上述产品文件、新增专项测试和本报告；未修改旧角色测试、
  0034 迁移、Android、其他工作树、原失败报告或真实模型调用台账。
- 原始日志保留在本独立工作树的 `docs/migration-evidence/`，该目录不入 Git。

## 2. 已确认根因和修复

### A. 后面的额度桶拒绝，前面的桶仍然占额

原 `reserve()` 按全局日、全局月、用户日、用户月依次执行四次独立写入，
最后才增加事件 `attempts`。例如全局月桶已满时，全局日桶已经提交；
返回拒绝且 provider 调用为 0，日桶却被占用。恢复月额度后，重试仍可能被
先前虚耗的日额度阻塞。原专项 `quality-and-budget-r1` 实测 **12 PASS / 6 FAIL**，
失败分别覆盖后面三个桶的拒绝及对应恢复；原结果与日志保留。

最终使用一个 **5 statement D1 batch**，将四个桶和事件次数一起提交。
每个桶在事务内重新检查事件 digest 和 `attempts < 2`；额度拒绝或事件失效
时写入临时 `-1`，触发既有迁移的 CHECK，从而让整个 batch 回滚。
该值不能在受支持的 schema 中提交。没有使用跨 statement `changes()`
充当事务令牌，也没有在失败后执行可能与其他请求冲突的补偿减额。

单纯把原 conditional writes 装进 batch 不足以解决问题：零行更新属于成功，
不会触发回滚。D1 的 batch 事务失败合同见
[Cloudflare D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)。
实际 rollback、并发及恢复行为另以本地 Miniflare/D1 引擎验证。

并发验证包括五个不同事件竞争两次月额度，以及同一事件的四个模型版本
竞争两次事件总额度。结果均只调用 mock provider 两次，四桶各为 2；
被拒请求不再虚耗其他桶。输入在预读后、事务前改变时，四桶和次数都不增加。

### B. CHECK 依赖必须验证，文本不能冒充约束

预留回滚依赖 0034 已有的 `reserved_calls >= 0` 和 `attempts BETWEEN 0 AND 2`。
只核查四张表存在，无法防护缺失这些约束的部分恢复库。继承的中间版本
`atomic-recovery-r1` 因此为 **4 PASS / 2 FAIL**，失败证据保留。

最终在推理可用性检查中核查实际 `sqlite_master.sql` 约束。
检查前剔除 SQL 注释、字符串和引用标识符，防止其中的“CHECK”文本误启用。
扩展复现 `atomic-recovery-r3` 在继承补丁上得到 **7 PASS / 4 FAIL**：
三种伪约束文本误启用，加上下述旧 lease 竞态。

该检查支持仓库原迁移的未引用约束写法；无法识别的自定义等价写法会保守禁用。
它不修补、删除或重建线上 schema。缺约束与三种伪约束均在本地合成库中
返回 disabled，provider 调用为 0；原迁移的冷逻辑恢复仍可正常使用。

### C. 额度恢复后的新请求被旧创建时间误判超时

原来零调用的额度拒绝可以重试，但重新 claim 仅更新 `updated_at` 和 lease，
保留原 `created_at`。watchdog 使用旧 `created_at`，导致拒绝超过 30 秒后
恢复额度的新调用，可能被并发查询错误改为 `timed_out / finance_ai_interrupted`。

使用每次 claim 都更新的 `updated_at` 判断 running lease 年龄，保留原创建时间
作为审计记录。确定性测试把旧拒绝时间设为一分钟前，保持新 mock 调用在途，
并发查询仍为 running；释放后得到 suggestion，重复请求复用缓存且只花一次调用。
旧 worker 中断后的超时恢复测试继续通过。

### D. 错误分类与成本边界

事务失败后只读取结构化事件/预算状态来判断当前的额度拒绝，不解析或返回
D1 异常消息。没有当前额度拒绝时，保留未知存储失败的安全通用分类。
本地故障 trigger 的消息特意包含 `finance_ai_budget_exhausted`；实际结果仍为
`finance_ai_provider_unavailable`，未泄露私有消息，四桶回滚，调用为 0。

不回收已提交的、调用结果不确定的预留，不放宽两次事件上限，也不追溯修改
历史已用计数。提供者重试、超时、consent、Kill Switch、人工确认和零入账权限
保持原合同。所有本次模型调用都是驱动内的合成 mock，新增真实模型调用为 0。

## 3. 原角色 21 PASS / 2 FAIL 的判断

原 `qa/finance-p06/ai-v2-contracts.mjs` 的两个输入只更改 direction/模型角色，
却沿用选中金额的 `本次 / 扣除` 原词：

- `refund-role-only-copies-original-source-money` 将扣款词改解释为退款。
- `income-role-is-not-an-expense` 将同一扣款词改解释为收入。

这是原正向预期与来源证据不一致，产品以
`finance_ai_semantic_evidence_insufficient` 拒绝是正确的安全行为。
未改原输入、断言或失败结果，整组仍报告 **21 PASS / 2 FAIL**。

新控制组分别证明：原扣款词不能授权收入/退款；明确 `收款` 或 `退款` 的
版本化合成证据可以生成人工审核建议。新控制组通过不替代原始两项失败，
也不证明真实模型准确率或真实支付凭证有效。

## 4. 实际验证与证据

本次 Node 为 24.18.1；固定依赖 Miniflare `5.20260730.0-alpha`、Wrangler `4.118.0`，
未升级 lockfile、兼容日期或配置。D1 fixture 实际执行仓库迁移，`d1Persist: false`；
AI binding 是本地函数，不是 Workers AI 远程 binding。

| 组别 | 实际结果 | 本地证据 |
| --- | --- | --- |
| 新角色、四桶拒绝/恢复、账户/profile、注入与 Kill Switch | 18 PASS / 0 FAIL | `p0-ai/quality-and-budget-r5/result.json` |
| 新并发、事务故障、digest 竞态、旧拒绝 lease、冷恢复、schema | 11 PASS / 0 FAIL | `p0-ai/atomic-recovery-r4/result.json` |
| 原 P06 基础合同 | 51 PASS / 0 FAIL | `finance-p06/p0-ai-regression-r1/ai-contracts/contracts.json` |
| 原 P06 角色合同（未改） | 21 PASS / 2 FAIL | `finance-p06/p0-ai-regression-r1/ai-v2-contracts/contracts.json` |
| 原 P06 恢复合同（未改） | 14 PASS / 0 FAIL | `finance-p06/p0-ai-regression-r1/ai-recovery-contracts/result.json` |
| 三个 JS 语法、模块图、storage contract、diff 格式 | 6 checks PASS | `p0-ai/static-checks-r1.log` |
| Pages Functions 本地构建 | PASS | `p0-ai/functions-build-r1.log` |
| 仓库隐私/敏感路径审计 | PASS，1467 files | `p0-ai/repository-audit-r1.log` |

表内路径均相对 `docs/migration-evidence/`；不同组存在覆盖重叠，不合并成独立
全量产品用例数。新两组各有 6 次 mock 调用，真实模型均 0；检查到的财务 ledger
始终为 0，来源 hint 金额没有由 AI 写入。构建没有发布。

最终产品文件 Git blob：`a1dd9a015204be76aef1eda503384a1786979b09`。
文件 SHA-256、两份新测试驱动及 inherited snapshot 的 hash 见
`p0-ai/final-source-manifest-r1.json` 和继承保护 manifest。
原 607/608、JVM833 未在本子任务重跑或改写。

复验时选用未使用的 `rN`，驱动会拒绝覆盖已有结果目录：

```powershell
$env:AERIS_P0_AI_LABEL='r100'
node qa/p0-ai/quality-and-budget.mjs
node qa/p0-ai/atomic-recovery.mjs
```

原三组入口沿用 `qa/finance-p06/README.md`，为每个脚本设置独立的新
`FINANCE_P06_OUTPUT`。原角色入口退出码 1 是本报告保留的两项失败，不应隐藏。

## 5. 尚未关闭的门禁

- 真实模型 `finance-assistance-6` 质量、本次模型版本 JSON Schema 支持及真实费用：
  **NOT_TESTED_THIS_RUN**。未新增真实预算，未运行 live-provider 或重置历史计数。
- 独立远端 QA D1、Hosted Preview、CI、Production、三星真机：本子任务 **NOT_TESTED**。
- 冷恢复是合成逻辑快照到新本地 D1，引擎与产品路径真实；不代表用户数据备份、
  远端 D1 Time Travel 或正式数据库恢复演练。
- 没有 push、merge、远端迁移、云端配置/数据写入、ADB、APK 或正式开关操作。
  不启用正式财务 AI，不将安全拒绝或本地全绿改写为真实模型/设备/发布 PASS。

可交付物是本地小范围源码修复、可复现测试及保留失败的 RCA。
真实模型与正式发布继续由相应独立门禁控制。

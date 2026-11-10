# P04 PR138 独立审核 — Flash 接手

2026-11-09，Asia/Hong_Kong。按所有者额度指示停止开发，保留 Worktree。
**REVIEW_INCOMPLETE / CHANGES_REQUIRED；P04 = PARTIAL；RELEASE_HELD。**
未修复产品，未整合 #138，未合并 #112，未操作 Production。

## 版本与保存位置

- Worktree：`%USERPROFILE%/.codex/worktrees/p04-pr138-independent-review/thewyj.uk`。
- 独立分支：`codex/p04-pr138-independent-review`。
- 审核原始 HEAD：`b394525a848d415027cdefdbc2858418de59e59a`（PR #138）。
- #138 目标 / #112 候选：`codex/finance-release-convergence`，
  `9ab3a5667b6230560b64531764720a754922b4c7`；本轮未移动该分支。
- 本轮只读 fetch 的 `origin/main`：`4fc025a044e5e39d742166df9510d488413f7043`；未改动 P07。
- 交付提交以本分支 `git log -1 --format=%H` 及忽略目录的 `delivery.json` 为准，
  避免报告自引用自己的提交 SHA。
- 原始日志全部保留于 `docs/migration-evidence/finance-p04/pr138-review/`。
  该目录被 Git 忽略；远端提供可重跑测试、本文及摘要，不声称远端包含原始日志。

## 根因与已复现事实

1. `functions/_lib/payment-currency-evidence.mjs:5` 的
   `hasAmbiguousCurrencySymbol` 使用整条通知的 JP¥ / US$ / 币种文字排除歧义，
   使另一金额上的裸 ¥ / $ 被一并消歧。示例：
   `已扣款 US$100.00 余额 $100.00`、`已扣款 JP¥100 余额 ¥100`。
2. 该 helper 只被测试导入，实际 raw 入账没有调用它。
   `finance-raw-currency.mjs:13` 聚合全文币种；第 29–30 行将金额文本放入 Set，
   相同数值的两个金额折叠为一个 token。全文只有一种已识别币种时，
   另一金额的歧义无法阻止 `classification=accepted`。
3. helper 将 CA$ / AU$ 排除为非歧义，但 `explicitCurrencyCodes` 未返回 CAD / AUD。
   新增测试要求这类不支持币种不能继承 USD 账户默认值；当前 RED。
4. 新增正向对照同时暴露 JP￥、USD $100.00、$100.00 USD 的本地线索识别不一致。
   它们的失败与自动入账风险分开记录，不应放宽负向断言来取绿。

实际调用链：

`syncFinance` → `processOperation(raw_event.ingest)` → `ingestRawEvent`
→ `normalizeRawEvent(currencyPolicyVersion: 2)` → `rawCurrencyMoney`
→ 返回 accepted → `ingestRawEvent` 创建 transactionId / `transactionRowFor`
→ `commitMutation` / `transactionInsertStatement` 写入隔离 D1 账本。

独立 D1 测试第一次提交上述 US$ / $ 合成通知，就返回非空 `txn:...`，
在“不得自动入账”的断言处失败。该测试随即停止，后续六个 D1 样本、重放和
最终行数断言尚未到达；不能写成它们已经执行。

## 已完成与未完成

- 新增 `qa/finance-p04/independent-review.mjs`，未降低断言，未改原测试。
- 本轮原新增六币种套件：**20 PASS / 0 FAIL**；日志 `original-suite.log`。
- 本轮独立 RED：**21 tests / 8 PASS / 13 FAIL，exit 1**；
  日志 `independent-red.log`。包含 7 条混合线索、8 条局部线索、2 条不支持美元
  前缀、格式化兼容、默认决议、显式双币种和实际 D1 入账测试。
- `formatFinanceMoney` 单参数 CNY 兼容测试通过；显式传入 undefined / null / 空串 /
  XXX / AUD / 非规范代码保持“金额单位待核实”，JPY 不除以 100。
  本轮没有修改该函数，不能把此局部结果扩大为整体兼容通过。
- 已完成独立 Worktree 的固定依赖安装；没有运行大型 P03–P06 或 P07 回归。
- 审核六文件范围已核对，但完整审核、JPY/FX/旧客户端/身份回归及 CI 均未完成。
  主线 P07 格式化仍为两位小数；与财务候选 JPY 的接口兼容门禁仍待验证。
- 产品修改 **0**。交接前只有新测试未提交；本次交付另增加本文和证据摘要。
  提交后应仅剩忽略的日志 / node_modules；主工作区 Hotfix WIP 未操作。

## 复现命令

在保留的独立 Worktree 运行（本次停止后未再次执行）：

```powershell
npm ci --ignore-scripts --no-audit --no-fund
node --test --test-reporter=tap qa/finance-p04/independent-review.mjs
```

需保存新一轮日志时使用新文件名，不覆盖已有 RED。原始对照命令：
`node qa/finance-p04/p04-six-currencies-regression.mjs`。

## Flash 下一步

1. 先读本文、RED 原始日志和 v2 合同
   `docs/finance/contracts/FINANCE_V2_ACCEPTANCE_CONTRACT.json`。
2. 先修最值得继续的任务：按金额局部绑定币种线索，并将歧义结果接入实际 raw
   入账链。保留孤立符号按已选账户默认币种处理时的 review/provenance 合同；
   不支持的明确币种不得回落到 USD/CNY。
3. 用现有 RED 验证最小修复；随后才验证重放 ID、JPY 0 位、历史 FX 冻结、
   旧客户端 fail-closed 和受影响 P03–P06。不得把未到达断言当作通过。
4. 当前所有者已撤回本轮整合步骤：**不得合并 #138 或 #112**。
   继续开发/集成须等新的指示；当前任务到交接为止。

剩余门禁沿用原 `FINANCE_P03_P06_RELEASE_READINESS.md`，未经本轮重跑：
P03 提供方身份/账户证据及旧红；P04 真实备份恢复、新旧客户端与升级恢复；
P05 字母 OCR 精确性和设备验收；P06 修复后真实模型质量及消费授权；正式迁移、
真机/Hosted/CI 与主线整合门禁。原失败与豁免不重标 PASS，AI/OCR 不开通。

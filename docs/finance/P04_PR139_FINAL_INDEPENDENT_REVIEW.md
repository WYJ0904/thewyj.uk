# P04 PR139 最终独立审核

2026-11-09，Asia/Hong_Kong。**审核 BLOCKED；P04 PARTIAL / RELEASE_HELD。**
**`P04_INTEGRATION_READY_FOR_OWNER_APPROVAL = false`。**
原21项确已转绿且未改 oracle，但余额/手续费可被错误当作交易金额并写入隔离 D1。
依所有者要求停止集成；未创建 staging 分支、集成 SHA 或 Draft PR，未移动 #112 HEAD。

## 固定输入与范围

开始 fetch、结束只读 `ls-remote` 均与固定输入一致，无漂移：

| 引用 | 完整 SHA |
| --- | --- |
| 财务候选 #112 | `9ab3a5667b6230560b64531764720a754922b4c7` |
| P04 #138 | `b394525a848d415027cdefdbc2858418de59e59a` |
| 原独立审查 / RED | `8fbaddbbdfc98699d78a8c44c58dd359ceadd802` |
| Flash #139 最终修复 | `c24cd89e976d7b104184045d0f030bd41fc6e434` |
| main | `4fc025a044e5e39d742166df9510d488413f7043` |

#139 的两次修复为 `8ccb134e385f5d7ff54dc1ba073752bdfe6b8316`、
`c24cd89e976d7b104184045d0f030bd41fc6e434`；相对8fbaddb仅改两个后端模块及
`qa/finance-p04/unsupported-qualified-currencies.mjs`。本轮已读这两次修复的完整相关 diff。

新 Worktree：`%USERPROFILE%/.codex/worktrees/p04-pr139-final-review/thewyj.uk`；
独立审核分支 `codex/p04-pr139-final-review`，产品基准为c24cd89。
本轮只新增独立 RED 和本文，没有产品修复、整合、Push、远端 CI dispatch、设备或生产操作。
审查交付提交通过本分支 `git log -1 --format=%H` 及本地 `delivery.json` 记录；不能冒充集成 SHA。

## P1：辅助金额被当作缺失的实付金额自动入账

通知没有提供扣款金额，只有明确标注的余额或手续费；“已扣款”不能给这些数值授予实付角色。

| 合成输入 | 应有边界 | 最终 SHA 的实际持久化 |
| --- | --- | --- |
| `已扣款，余额 USD100.00` | 金额角色待核实，不产生正式支出 | `classification=accepted`，自动 USD 支出10000最小单位 |
| `已扣款，手续费 USD2.00` | 不能把独立手续费数值推作整笔扣款金额 | `classification=accepted`，自动 USD 支出200最小单位 |

测试实际查询 `task16_finance_transactions`，两行均为 `source_kind=automatic / revision=1`。
分别用新的 delivery operation ID 重放同一 source event，raw ID和transaction ID均保持不变。
因此是**首次错误写入，非重放多记**；幂等通过不能抵扣金额角色错误。
加上明确实付和真实设置账户默认USD的两个正向对照，最终4条输入产生4笔账，负向本应为0笔。
fixture 为内存隔离 Miniflare D1，全部为合成来源，无真实财务写入。

根因链：

1. `functions/_lib/notification-cash-evidence.mjs:30` 对不含券类词的普通通知直接返回全文，
   不承担余额/手续费角色筛选。
2. `functions/_lib/finance-raw-currency.mjs:18` 的币种金额正则可匹配任何角色的 `USD100.00`；
   位置区间解决了数值折叠，却没有记录金额角色。第63–79行在只剩一个匹配时直接解析。
3. `functions/_lib/task16-model.mjs:265–272` 用上述金额补充分类，并在全文存在完成词时接受；
   没有要求完成词、币种、金额共同绑定到实际交易角色。
4. `syncFinance → ingestRawEvent → normalizeRawEvent → rawCurrencyMoney`
   返回accepted后，`task16-service.mjs:506、528、549` 创建并提交自动交易。

**归因：新确认的真实产品缺陷，继承自候选基线，不声称由#139首次引入。**
对9ab3a56、8fbaddb、c24cd89的原始 rawCurrencyMoney 源码做两条同输入对照，三者均返回上述金额。
对照仅为该纯函数，复用money.js的Git blob完全相同；真实D1写入只在最终c24cd89执行。
#139修复了已知符号/位置歧义，但未满足本次明确要求的金额角色门禁。

## 本轮执行与实际 CI

| 检查 | 实际结果与范围 |
| --- | --- |
| 原 `independent-review.mjs` | **21 PASS / 0 FAIL / 0 SKIP，exit0**；覆盖7组混合符号的首次D1入账拒绝及重放，原断言未改 |
| 原测试完整性 | 8fbaddb与c24cd89该文件Git blob均为 `96f843de8105ade313fb6861fd2ff0d4d0d19939`；`git diff --exit-code`通过 |
| `unsupported-qualified-currencies.mjs` | **14 PASS / 0 FAIL / 0 SKIP，exit0**；NZ$/SG$/S$及CAD/AUD单元、声明币种与重放对照 |
| 新 `pr139-role-boundary-review.mjs` | **2 PASS / 2 FAIL，exit1**；两条角色负向均查到错误自动账，两条正向和实际USD默认来源标记通过 |
| 原21项中的格式化边界 | 单参数CNY兼容、显式未知币种不回落、JPY不除100的断言通过；不等同完整JPY回归 |
| #139已有远端Core CI | [run 42575973448](https://github.com/WYJ0904/thewyj.uk/actions/runs/42575973448)，commit c24cd89，**8 SUCCESS / 2 SKIPPED**；本轮只读取，未重跑 |
| staging本地回归/必需CI | **NOT_RUN**；数据正确性门禁失败，阶段二未进入 |
| 完整JPY精度/历史FX/旧客户端、P03–P06及P07 | 本轮未继续执行或重新验收；已有CI不替代这些专项证据，也不替代新RED |

补充套件的D1循环中，`override.defaultCurrency`没有实际写入fixture币种偏好；
其直接函数/normalizer默认参数测试有效，但不能据D1案例名称宣称真实USD/CNY账户默认负向组合全部验收。
本轮新正向对照明确调用 `currencyPreferences` 设置USD，验证裸符号仍带
`currency_review_required=true / currency_decision_source=account_default`。

复现新RED（固定依赖已安装）：

```powershell
$env:FINANCE_P04_OUTPUT=Join-Path (Get-Location).Path 'docs/migration-evidence/finance-p04/pr139-role-rerun'
node qa/finance-p04/pr139-role-boundary-review.mjs
```

原命令：`node --test --test-reporter=tap qa/finance-p04/independent-review.mjs`；
补充命令：`node --test --test-reporter=tap qa/finance-p04/unsupported-qualified-currencies.mjs`。
新运行使用新的输出目录，不覆盖既有RED证据。

本地证据目录 `docs/migration-evidence/finance-p04/pr139-final-review/` 保留：
`original-21.log`、`unsupported.log`、`role-red.log`、`role-red/role-boundary.json`、
`inherited-role-probe.json`、`remote-ci.json`、输入/日志hash清单及交付记录；全部被Git忽略。
原旧失败证据未覆盖，现有三个PR均未被更改或合并。

## 剩余门禁与最小后续范围

- 先关闭本次P1：在实际raw入账入口要求币种与金额绑定到实付/实收/退款角色；
  余额、手续费、订单号等不能凭全文完成词或币种线索成为缺失的交易金额。
  有多个金额或角色无法证明时保留待核实；不要仅删除余额数字后继续猜。
- 保留原21项及新增两条RED；增加等额/不同额的余额、手续费和无关数字对照，
  同时保留明确实付、裸符号账户默认来源、JPY精度、未知单位和重放ID正向行为。
- 补齐真实账户默认币种下不支持币种的D1负向测试；随后才执行受影响的JPY、历史FX、
  旧客户端兼容检查以及依赖明确的隔离整合、差异审计和完整必需CI。
- 正式备份/恢复、新旧客户端升级与生产恢复等P04历史门禁仍未关闭；本轮不以局部绿灯
  或已有CI宣称财务可发布，P05/P06 AI/OCR不因本次审核开通。

第二阶段状态：**NOT_STARTED**；`codex/p04-convergence-staging`及Draft PR均未由本轮创建，
无集成SHA；#112候选HEAD与main保持固定值。保存本报告和RED后停止。

# P04 金额角色最终复核

2026-11-09，Asia/Hong_Kong。**#139 = BLOCKED；P04 PARTIAL / RELEASE_HELD。**
**`P04_INTEGRATION_READY_FOR_OWNER_APPROVAL = false`。**
已复现实际隔离 D1 错误入账，依指示停止集成；产品修复0、未Push、未创建staging或Draft PR。

## 输入与执行版本

- #139远端及受测产品：`66b1d40d075164ca397e4d3749ae7d2a8ec99623`，开始fetch、结束ls-remote一致。
- #112：`9ab3a5667b6230560b64531764720a754922b4c7`；#138：`b394525a848d415027cdefdbc2858418de59e59a`；
  原独立RED：`8fbaddbbdfc98699d78a8c44c58dd359ceadd802`；main：`4fc025a044e5e39d742166df9510d488413f7043`，均未漂移或移动。
- 新Worktree：`%USERPROFILE%/.codex/worktrees/p04-amount-role-final-review/thewyj.uk`；
  本地分支 `codex/p04-amount-role-final-review`。未改现有主工作区或Flash工作分支。
- 所有测试实际运行HEAD均为66b1d40；运行时仅新增本轮独立RED文件，原有产品文件没有工作区改动。
  本轮测试/报告提交的完整SHA另存忽略目录 `delivery.json`，不是集成SHA。

## 确认的产品问题

以下都经过真实 `syncFinance → ingestRawEvent → normalizeRawEvent → rawCurrencyMoney`
及内存隔离Miniflare D1写入、SQL读取和同来源新delivery operation重放，全部为合成数据。

| 输入 | 实际结果 | 本轮业务要求 |
| --- | --- | --- |
| `已扣款，预计扣除手续费 USD2.00` | accepted，自动USD支出200最小单位 | 预计费用待核实，不得记账 |
| `已扣款，手续费 USD2.00 待扣` | accepted，自动USD支出200 | 待扣后缀不能被前面的完成词覆盖 |
| `余额 USD100.00，预计付款 USD10.00，另一订单支付成功` | accepted，自动USD支出1000 | 另一订单的完成事实不能授权本条预计付款 |
| `支付成功 USD100.00，另扣手续费 USD2.00` | accepted，仅记主金额10000 | 额外手续费没有独立完成证明，当前单金额接口未可靠表达此情况，应保持待核实 |

前三条是未完成金额的错误自动账；第四条是未证明的另扣费用被排除后整条仍accepted。
没有凭第四条强行要求两笔账。六条独立样本最终产生6条账，期望仅两个已证正向产生2条。
所有重放复用原raw ID及transaction ID，没有重复新增；幂等正确不能抵扣首次错误写入。

**按本轮明确的业务要求，`已扣款，手续费 USD2.00` 是允许的正向，实测通过。**
`已扣款 USD100.00，含手续费 USD2.00` 也只记10000并通过，未重复加手续费。
没有继续拿上轮“所有手续费都禁止”的旧负向裁决阻止集成，历史报告及原RED仍保留。

根因位于 `functions/_lib/finance-raw-currency.mjs`：

- 第30、46–50行的预计费用匹配仅覆盖“预计手续费”等窄形式；“预计扣除手续费”会命中
  第32、47行的通用“扣除手续费”，在检查金额后“待扣”前已返回 `fee_deducted`。
- 第52行仍可用全文扣款词授权手续费；默认 `transaction` 角色也没有局部完成要求。
  `task16-model.mjs:265–272` 继续使用全文完成词补成accepted，故另一订单成功可授权预计金额。
- 第106–121行直接过滤 `fee_unproven`，未将未能表达的独立另扣手续费作为整条待核实门禁。

最小后续修复规格：局部预计/未扣证据优先于任何通用扣除词；实际金额必须绑定自身完成事实；
含手续费只记主金额，另扣费用缺独立证明或单金额接口无法安全表达时保留待核实。
本轮依“错误入账即停止”要求只保存RED，没有修改产品或追加无关重构。

## 指定测试、计数与版本标签

| 本轮命令/集合 | 结果 |
| --- | --- |
| `node --test --test-reporter=tap qa/finance-p04/independent-review.mjs` | 21 PASS / 0 FAIL；原21文件与8fbaddb完全相同 |
| `node --test --test-reporter=tap qa/finance-p04/unsupported-qualified-currencies.mjs` | 14 PASS / 0 FAIL |
| `node qa/finance-p04/pr139-role-boundary-review.mjs` | 10 PASS / 0 FAIL；余额、含费、已扣手续费、实际USD默认及重放对照 |
| `node qa/finance-p04/default-currency.mjs`（未传model-only） | 11 PASS / 0 FAIL = 4模型 + 7 D1 |
| 新 `node qa/finance-p04/amount-role-completion-review.mjs` | **2 PASS / 4 FAIL，exit1**；六条D1首次写入及重放均已执行 |

原21项Git blob在8fbaddb与66b1d40均为 `96f843de8105ade313fb6861fd2ff0d4d0d19939`。
默认币种文件在#112与66b1d40均为 `04c6fa420e7bab29adb25624b37c5121d2f9d812`，没有删除断言。
**7是其中D1子集的数量，完整文件仍为11。** 本轮已完整执行11项，未以7替代11。
未取得“本轮7项”那份原始执行日志，不能推定那份报告的具体命令；上述是源码和本轮新执行事实。

角色10项的 `role-boundary.json.reviewed_sha` 确实错误硬编码为
`c24cd89e976d7b104184045d0f030bd41fc6e434`（源文件第72行）。本轮保留原文件与原JSON，
不把它当c24或66的版本证明；逐命令 `*-execution.json.actual_run_sha` 均绑定实际66b1d40。
新独立RED通过运行时 `git rev-parse HEAD` 记录正确66b1d40，标签与实际一致。
后续应将旧测试的标签改成运行时来源，不仅手动替换成另一个常量；不涉及修改测试oracle。

## CI、交付和剩余门禁

#139该完整SHA已有 [Core CI run 42597256604](https://github.com/WYJ0904/thewyj.uk/actions/runs/42597256604)：
**8 SUCCESS / 2 SKIPPED**。本轮只读核实，没有dispatch或重跑，不能用该绿灯掩盖新RED。
未进入隔离集成，因此 `codex/p04-convergence-staging`、集成SHA、Draft PR和集成CI均无本轮交付。
#112、#138、#139均未合并；主线P07、Production、D1/R2正式数据、Android Stable、P05/P06均未操作。

先关闭上述完成证据/另扣费用RED及版本标签问题，再补受影响的完整六币种/JPY、历史FX、旧客户端
及隔离整合回归。本轮已有原21/14/10局部通过，不宣称所有相关行为已完整重验。
正式备份/恢复、真实Android通知/离线重启/同步、新旧客户端升级与生产恢复门禁仍未关闭；
未重新审计P03–P06或重复P07验收，P04整体继续PARTIAL / RELEASE_HELD。

全部日志、原角色JSON、实际SHA执行清单、CI摘要与hash清单保留在本Worktree忽略目录
`docs/migration-evidence/finance-p04/amount-role-final-review/`；结论见 `review-result.json`。
复现新RED时设置 `FINANCE_P04_OUTPUT` 为该忽略根目录下的新目录，勿覆盖已有证据。
本报告及新RED在独立审核分支本地提交，未Push。保存后停止，Worktree保留。

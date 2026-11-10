# P04 结构性修复独立验收

2026-11-09，Asia/Hong_Kong。**#139 BLOCKED；P04 PARTIAL / RELEASE_HELD。**
**`P04_INTEGRATION_READY_FOR_OWNER_APPROVAL = false`。**
冻结35项已全绿，但本轮限定结构检查实际复现4条错误自动账，未进入条件集成。

## 固定输入与完整性

- 产品受测HEAD及#139远端：`08f0191017e32a66b6e99965451ed29bf469ad68`。
- #112 `9ab3a5667b6230560b64531764720a754922b4c7`，#138 `b394525a848d415027cdefdbc2858418de59e59a`，
  原独立RED `8fbaddbbdfc98699d78a8c44c58dd359ceadd802`，main `4fc025a044e5e39d742166df9510d488413f7043`。
  开始fetch及结束ls-remote均匹配，未移动这些分支。
- 新Worktree：`%USERPROFILE%/.codex/worktrees/p04-structural-acceptance/thewyj.uk`；
  本地审核分支 `codex/p04-structural-acceptance`。原主工作区、Flash工作树及历史证据未改。
- 冻结矩阵Git blob、实际运行文件及运行后SHA-256均为
  `f16563d3bb8668d5fe14dd42dedbb32debcf64acf2eeb935631e83d7afb0c75f`。
  新checkout起初为Windows CRLF，hash为8f67273a…；核对仅换行差异后恢复为Git冻结原字节，原CRLF副本另存。
  HEAD、index及运行文件的Git blob均为 `7409b869bc84cd3486b472ca0fe8323a08788190`，未改输入/oracle。
- 全部测试实际运行HEAD均为08f01910；只新增本轮6项结构测试，原产品及现有测试无逻辑改动。
  审查交付本地SHA另存 `delivery.json`，不是集成SHA。

## 统一准入路径核查

`task16-service.mjs:485` 固定policy2调用 `normalizeRawEvent`；它直接消费
`rawCurrencyMoney.admission_decision`。该wrapper当前所有分支均给出显式决策，普通文本由
`parseAmountFacts`处理；未证实请求字段可以绕过这条实际v2文本路径。
原无文 `legacy_import` 结构化分支仍存在，未当作已完成通知的证明，也未在本轮改动。

因此当前阻塞是**统一决策内部的事实绑定错误**，不能仅通过确认入口已统一就批准集成。

## 限定检查发现的真实数据缺陷

新增 `qa/finance-p04/structural-binding-review.mjs` 仅6项：两项币种归属、两项同句不同操作及两个正向。
没有随机扩展字符串，也没有改冻结35项。实际执行服务、查询D1并重放，结果 **2 PASS / 4 FAIL，exit1**。

| 合成输入 / 配置 | 实际正式账目 | 必须满足的合同 |
| --- | --- | --- |
| `支付成功 10.00，余额 USD50.00`，无默认币种 | accepted，自动USD支出1000最小单位 | 余额的USD不能证明主金额币种，应待核实 |
| 同输入，已实际设置账户默认CNY | accepted，仍自动USD支出1000，未带默认来源标记 | 可以待核实；若采用用户默认，则必须为CNY1000且保留account_default复核来源，不能被余额USD覆盖 |
| `本次付款金额 USD10.00，上一笔退款成功` | accepted，自动USD支出1000 | 上一笔退款不能完成本次付款，也不能转成已证支出 |
| `本次收款金额 EUR10.00，上一笔退款成功` | accepted，自动EUR收入1000 | 上一笔退款不能完成本次收款 |

四条均由SQL实际读取到 `source_kind=automatic / revision=1`，不是只检查辅助函数输出。
两项正向——明确USD付款且账户默认CNY、已确认扣除的独立手续费——均正确通过。
首次及重放的raw ID和transaction ID保持不变，重放未重复新增；错误在首次准入。

### 根因与最小必要修复范围

**A. 币种仍可能跨金额继承。** `finance-amount-admission.mjs:95–140` 使用前后20字符宽窗口匹配，
随后将全文唯一币种当成当前金额的显式币种，且优先于账户默认。上述第一金额未附币种，
另一个余额的USD仍使其成为已核实USD事实；统一gate只看到两个同为USD的fact，无法阻断。

修复限于币种绑定器：为每个金额提取真正附着的前/后缀币种span，区分当前金额的证据与其他金额证据；
全文币种集合只能检查冲突，不能授予当前金额“explicit”。缺证时使用带provenance的合法账户默认或REVIEW。
保留结构化声明币种、六币种精度及现有默认来源合同，不新增币种/FX功能。

**B. 同一子句仍被当作同一操作。** 模块第55行不按逗号分句，无显式订单ID时整个通知为null order scope；
第340–351行对金额标签扫描整条同scope/clause的任意强完成词，甚至将 `退款成功` 用于提升付款或收款标签，
原标签方向则被保留。存在类型化facts，但完成证据仍未绑定具体操作和匹配方向。

修复限于事实绑定器及AUTO验证：完成谓词必须绑定同一个操作对象、对应金额角色与一致的现金方向，
并有可核对的证据span；同句出现多个操作且归属不明时REVIEW。不能仅把逗号加入分隔符或追加“上一笔”等词，
因为已验证的实付/实收和手续费正向也可跨逗号表达同一操作。
`task16-model`继续消费唯一决策，并在AUTO前验证这些绑定不变量，不重新用全文词推导授权。

本轮未修产品。最小一次性范围为准入模块的币种/操作证据绑定、wrapper/normalizer必要验证和对应固定测试，
保留冻结35项、旧断言、历史交易/来源/operation ID、回执及用户决定；不涉及数据库迁移、P03身份、Android或AI。

## 实际测试与CI

| 集合 | 本轮实际结果 |
| --- | --- |
| 冻结语义矩阵 | **35 PASS / 0 FAIL**，实际14条账，35条来源，重放基数检查通过 |
| 原独立21 / 不支持币种14 | 21 / 14 PASS，0 FAIL |
| 角色10 / 完成6 / 扩展10 | 10 / 6 / 10 PASS，0 FAIL |
| 默认币种 | 完整11 PASS = 4模型 + 7 D1 |
| 本地HTTP及D1合同 | 39 PASS，0 FAIL |
| 金额/JPY / 模拟FX历史 | 76 / 22 PASS；未将模拟率当作真实提供方验收 |
| Task16 / Task17 | Task16 11 checks PASS；Task17 D1脚本PASS，未提供数值计数 |
| 本轮限定结构检查 | **2 PASS / 4 FAIL**，4条错误自动账均有SQL结果 |

集合重叠，不累计为独立样本总数。现有测试全部按固定输入源码原样运行，未修改oracle。
角色10、完成6、扩展10、冻结35及本轮结构JSON的运行版本均绑定08f01910；逐命令清单保存完整SHA。

该SHA的 [Core CI run 42614086705](https://github.com/WYJ0904/thewyj.uk/actions/runs/42614086705) 为
**8 SUCCESS / 2 SKIPPED**。本轮只读核实，未dispatch或重跑；已有绿灯不能抵扣当前数据错误。

## 证据、交付与剩余门禁

证据目录：`docs/migration-evidence/finance-p04/structural-acceptance/`，被Git忽略，全部保留。
`structural-6/structural-binding.json` 保存实际原始raw/transaction ID、SQL行、parser facts与admission；
`red-full-inputs.json` 按实际执行测试定义确定性还原完整首次/重放请求，原返回ID及SQL结果原样复制，注明重建来源。
另保留13份执行日志/SHA清单、矩阵字节完整性记录、各用例JSON、CI摘要及 `review-result.json` 的hash manifest。
SQL为 `SELECT id,currency,amount_minor,direction,source_kind,revision FROM task16_finance_transactions WHERE id=?1`。
全部D1为隔离合成fixture，未查询或修改真实财务记录。

复现：设置 `FINANCE_P04_OUTPUT` 为本Worktree `docs/migration-evidence/finance-p04/` 下的新目录，运行
`node qa/finance-p04/structural-binding-review.mjs`；不要覆盖原RED。冻结矩阵仍用原执行器和原输入。

条件集成未开始：无本轮 `codex/p04-convergence-staging`、集成SHA或Draft PR，#112 HEAD不动。
本地只提交测试/报告，未Push；没有合并现有PR、修改main/P07、Production D1/R2、Stable或真实账目，
没有开通P05/P06或Task27。Worktree及全部证据保留，保存后停止。

正式备份恢复、真实Android离线/重启/同步及旧APK访问升级库、新旧客户端能力/迁移恢复等历史门禁仍未关闭。
即使未来隔离整合达成ready，也只代表候选可供所有者审核；P04整体继续PARTIAL / RELEASE_HELD。

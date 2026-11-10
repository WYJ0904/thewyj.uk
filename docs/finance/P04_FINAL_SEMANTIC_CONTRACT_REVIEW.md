# P04 金额完成证据最终合同审查

2026-11-09，Asia/Hong_Kong。**#139 BLOCKED；P04 PARTIAL / RELEASE_HELD。**
**`P04_INTEGRATION_READY_FOR_OWNER_APPROVAL = false`。**
固定矩阵中8项已在隔离D1错误自动入账。未整合、Push、创建Draft PR或移动#112；产品修改0。

## 输入与复核边界

- 实际受测产品HEAD：`ea52c7a7ab270b6524d4b7a66500cb9a295a6aad`，#139远端开始及结束核对一致。
- #112 `9ab3a5667b6230560b64531764720a754922b4c7`；#138 `b394525a848d415027cdefdbc2858418de59e59a`；
  独立RED `8fbaddbbdfc98699d78a8c44c58dd359ceadd802`；main `4fc025a044e5e39d742166df9510d488413f7043`，均未漂移。
- 新Worktree：`%USERPROFILE%/.codex/worktrees/p04-final-contract-review/thewyj.uk`；本地分支
  `codex/p04-final-contract-review`。原主工作区、旧失败证据及Flash分支未修改。
- 本轮只新增固定矩阵、执行器和本文；全部测试运行时HEAD保持ea52c7a，原产品文件无工作区修改。
  审核成果的本地提交SHA另记于忽略目录 `delivery.json`，不是集成SHA。

## 固定合同矩阵

输入冻结于 `qa/finance-p04/fixtures/semantic-contract-matrix.json`，共35项，SHA-256：
`f16563d3bb8668d5fe14dd42dedbb32debcf64acf2eeb935631e83d7afb0c75f`。
每项显式记录角色、完成状态、局部/跨订单作用域、金额数量及预期决策；测试前固定，运行后未改oracle或追加样本。

| 预期决策 | 固定样本范围 | 本轮结果 |
| --- | --- | --- |
| AUTO，14项 | 六币种；实付/实收/退款；已完成手续费；含费；等额/不同额余额；实际账户默认币种 | 14 PASS |
| REVIEW，18项 | 完成未知/预计/待扣；跨订单/反序/换行；多金额/等额；另扣费；混币；未知/不支持币种；JPY过精度 | 9 PASS / 9 FAIL |
| NON_FINANCIAL，3项 | 纯余额、额度、优惠，无现金交易事实 | 3 PASS |

执行器 `qa/finance-p04/semantic-contract-matrix.mjs` 逐项调用真实 `syncFinance`，查询正式交易表，
再以新delivery operation重放相同来源，核对raw ID、transaction ID与最终行数。
**总计26 PASS / 9 FAIL，exit1；实际22条正式账，合同预期14条，额外8条均为自动账。**
35条来源重放后仍35条，重放未新增账；错误发生在首次准入。

### 8项重大数据正确性失败

| 案例 | 金额与完成事实的关系 | 实际错误账目 |
| --- | --- | --- |
| M18–M20 | 订单A仅有`付款金额 USD10.00`，订单B才`支付成功`；覆盖先后顺序及换行 | 各自动支出USD1000最小单位 |
| M21 | 订单A仅有`收款金额 EUR10.00`，订单B才`收款成功` | 自动收入EUR1000 |
| M22 | 订单A仅有`退款金额 HKD10.00`，订单B才`退款成功` | 自动退款HKD1000 |
| M23 | 订单A仅有`手续费 USD2.00`，订单B才`已扣款` | 自动支出USD200 |
| M24–M25 | A的未证付款金额，加等额/不同额余额，B才支付成功 | 各自动支出USD1000 |

每笔都实际查到 `source_kind=automatic / revision=1`，证据保存完整输入、预期、首次/重放ID、SQL读取的金额/币种/方向。
这不是单个拼写遗漏：跨付款、收款、退款、手续费，改变顺序、分隔或辅助金额后仍复现。
**增加不相关订单的完成事实，不得将原金额从“完成未知”提升为可入账；当前联动违反该不变量。**

M15单独列为分类差异：`付款金额 USD10.00` 没有入账，返回rejected / transaction_semantics_missing，
而矩阵要求保留待人工核实。该FAIL原样保留，**不作为错误自动入账的证据或主要阻塞依据**。

## 共同根因

1. `finance-raw-currency.mjs:76` 默认返回 `transaction`，没有要求该金额具备正向角色与自身完成证明。
2. 第68行手续费分支仍以全文扣款词产生 `fee_deducted`；来源订单/语义对象未绑定。
3. 第125–148行在过滤辅助/预计金额后，单个剩余 `transaction` 即可提供数值。位置去重与角色过滤不能证明完成。
4. `task16-model.mjs:155、183、189、265–272` 独立扫描全文方向与完成词，再用精确金额结果补分类；
   订单B的完成/方向与订单A的金额可以组合成accepted，随后真实服务提交交易。

现有预计/待扣规则和6项旧RED已经通过，但默认允许与全文重新授权仍在。
将更多词加入排除列表无法建立金额、订单、方向和完成证据之间的约束。

## 一次性最小结构性修复规格

修复范围限于两个被审模块、必要的一个共享纯解析模块及合同测试；不扩展P03身份、FX、Android、AI/OCR或数据迁移。

1. **统一金额事实输出。** 为每个金额保留数值/币种/单位、原文span、角色、方向、订单/语义作用域、
   完成状态及其证据span。角色和完成状态默认unknown；没有正向证据时不能默认transaction/confirmed。
   已识别模板可以产生事实；自由文本作用域无法可靠判定时返回待核实，不能靠固定字符窗口补证明。
2. **在同一作用域绑定。** 金额、货币、现金角色、方向及完成证据须指向同一操作对象；其他订单、余额、
   优惠等上下文不能授予完成。预计、未完成、待扣属于对应金额事实，不能被另一对象的完成覆盖。
3. **只做一次准入决策。** AUTO仅接受唯一、完成已证的实付/实收/退款或独立已扣手续费；含费只取主金额。
   多个未能表达的现金操作、未证另扣费、币种/单位/作用域冲突返回REVIEW；纯辅助信息返回NON_FINANCIAL。
   旧默认币种来源标记和未知单位保护不变，不强行生成两笔账。
4. **normalizer消费该决策。** policy2不再用独立全文 `STRONG_COMPLETION_TERMS` 或方向扫描覆盖解析决策。
   全文关键词最多用于候选识别/路由；没有绑定的金额事实就没有自动写入权限。
5. **兼容边界。** 原source event、operation、transaction ID、回执及历史用户决定不重建；不回写旧账。
   保留六币种精度、账户默认来源、重放/CAS及旧客户端fail-closed合同；不新增迁移或正式开关。
6. **固定验收。** 保留本35项全部输入及oracle：8条错误自动账变为0，14条正向金额/方向/ID正确，3条非财务不入账，
   M15按显式分类合同处置；反序、换行、添加余额不得改变另一金额的完成状态。再跑下表原样集合及必要集成CI。

这是共享事实与准入边界的一次修复规格；本轮不实施产品补丁，也不继续新增字符串变体。

## 实际回归与版本证据

| 集合 | 本轮结果 |
| --- | --- |
| 原21 / 补充不支持币种14 | 21 / 14 PASS，0 FAIL |
| 角色10 / 完成状态6 / 扩展10 | 10 / 6 / 10 PASS，0 FAIL |
| 默认币种完整套件 | 11 PASS = 4模型 + 7 D1，0 FAIL |
| 本地HTTP + D1合同 | 39 PASS，0 FAIL |
| 精确金额/JPY | 76 PASS，0 FAIL |
| D1参考FX/历史快照 | 22 PASS，0 FAIL；模拟提供方，未作真实汇率验收 |
| 新固定语义矩阵 | 26 PASS / 9 FAIL，其中8项错误入账、1项无账分类差异 |

集合有重叠，不累计成独立样本总数。所有现有测试按ea52c7a源码原样执行，未修改断言；
原21项与8fbaddb文件比较无差异。逐命令执行清单均记录实际ea52c7a；角色10、完成6、扩展10和矩阵的
`reviewed_sha` 也均为ea52c7a，不再沿用c24旧标签。

该SHA已有 [Core CI run 42605276458](https://github.com/WYJ0904/thewyj.uk/actions/runs/42605276458)：
**8 SUCCESS / 2 SKIPPED**。本轮仅读取，没有dispatch或重跑；它不能抵扣新矩阵的实际错误账。

复现固定矩阵：在本Worktree设置 `FINANCE_P04_OUTPUT` 为
`docs/migration-evidence/finance-p04/` 下新的独立输出目录，运行
`node qa/finance-p04/semantic-contract-matrix.mjs`。固定输入hash随结果保存，旧日志不覆盖。
全量本轮证据位于 `docs/migration-evidence/finance-p04/final-contract-review/`：
十份日志/执行SHA清单、全部用例JSON、CI摘要、`review-result.json`及逐文件hash manifest；原失败证据未变。

## 条件整合与剩余门禁

审核未通过，`codex/p04-convergence-staging`、集成SHA、Draft PR及集成必需CI均未由本轮创建。
#112 HEAD保持9ab3a56；现有PR均未合并，main/P07、Production、D1/R2正式数据、Stable、P05/P06、Task27均未操作。
本地只提交矩阵/测试/报告，未Push，Worktree及全部证据保留。

本轮隔离金额与旧客户端合同通过，仍不能关闭正式个人备份/恢复、真实旧APK访问升级库、新旧客户端能力门禁、
Android离线/重启/Outbox端到端、真实跨设备及生产恢复/回滚等历史门禁。
未重新审计完整P03–P06或重复P07上线验收；P04继续PARTIAL / RELEASE_HELD，保存后停止。

# P04 结构绑定最终独立验收

2026-11-10，Asia/Hong_Kong。**第一阶段 PASS；P04 PARTIAL / RELEASE_HELD。**
只代表指定解析合同的有限验收通过。整合就绪还须独立staging验证与精确HEAD的必需CI，不能提前置true。

## 固定输入

- #139实际GitHub HEAD与本轮受测HEAD：`6b1bea481f17c31490d67fe43889fc40efee8aec`。
  使用完整Git对象，不采用另一个仅前缀相同的错误记录。
- #112：`9ab3a5667b6230560b64531764720a754922b4c7`；#138：`b394525a848d415027cdefdbc2858418de59e59a`；
  原独立RED：`8fbaddbbdfc98699d78a8c44c58dd359ceadd802`；main：`4fc025a044e5e39d742166df9510d488413f7043`。
- 新Worktree：`%USERPROFILE%/.codex/worktrees/p04-binding-final-acceptance/thewyj.uk`，
  独立分支 `codex/p04-binding-final-acceptance`。原主工作区及Flash工作树未改。
- 冻结35项运行文件SHA-256：`f16563d3bb8668d5fe14dd42dedbb32debcf64acf2eeb935631e83d7afb0c75f`。
  仅将Windows checkout换行恢复为Git冻结原字节，输入、oracle、Git blob不变，完整性记录保留。

## 实际结果

| 集合 | 本轮结果 |
| --- | --- |
| 结构绑定6项 | **6 PASS / 0 FAIL**；2条正确账，未知/借用币种与跨操作完成均无错误账 |
| 冻结语义矩阵 | **35 PASS / 0 FAIL**；14条正确账、35条来源，重放基数检查通过 |
| 原独立21 / 不支持币种14 | 21 / 14 PASS，0 FAIL |
| 角色10 / 完成6 / 扩展10 | 10 / 6 / 10 PASS，0 FAIL |
| 默认币种完整套件 | 11 PASS = 4模型 + 7 D1 |
| 本地HTTP及D1合同 | 39 PASS，0 FAIL |
| 金额/JPY / 模拟FX历史 | 76 / 22 PASS；不代表真实提供方或设备验收 |
| Task16 / Task17 | Task16 11 checks PASS；Task17 D1脚本PASS，未报告数值计数 |
| 正则专项 | 36次连续真实解析稳定；9次D1首次写入与重放 **9 PASS**；3条正确账、9条来源 |

集合有重叠，不累计成独立样本总数。所有既有测试按固定源码原样执行，未修改断言；
各执行清单和运行时JSON均记录实际完整6b1bea48 HEAD。本轮未修改产品。

## 金额作用域结论

按金额附着的币种证据已替代跨金额全局继承；未知币种及辅助余额与账户默认冲突进入REVIEW。
本次付款/收款不再借上一笔退款完成，已扣手续费仍能正确入账，预计/未证费用保留待核实。
明确CNY/USD/JPY、收入/退款、含手续费只记主金额、默认来源标记与首次/重放身份均有本轮通过证据。
在本次限定输入和代码路径内，未确认新的真实错误自动入账或数据正确性缺陷。

## OPERATION_MARKER_REGEX 状态审查

该正则有g标志。独立复制同一表达式后连续 `.test('上一笔')` 返回true/false/true，
证明其JavaScript状态性；这只是独立表达式微观复现，不是产品准入漏洞复现。

产品内仅有 `findOperationScopes` 的 `matchAll` 与标签完成检查的 `.test(between)` 两处使用。
正常入口从lastIndex=0开始；matchAll不改变原对象lastIndex，between限定在同operation与同clause内，
不含已被分段的操作标记，当前检查为false并将lastIndex保持/恢复为0。
本次固定序列包含同操作标签完成及上一笔付款/退款的拒绝，36次解析的准入、span和scope逐次一致。
真实D1再做3轮、9条独立来源及重放：仅同操作正向产生3条USD支出，各1000最小单位，其他均pending。

**未复现可达的状态污染或偶发边界漏判，不定为P1，也不据此阻止整合。**
若将来改变作用域构造，无状态边界谓词或显式重置可作为维护加固；本次没有为理论风险修改产品。
专项脚本 `qa/finance-p04/operation-regex-state-review.mjs` 明确区分独立正则微观行为和真实解析/D1结果。

## 证据与整合边界

源分支该SHA已有 [Core CI run 42742459575](https://github.com/WYJ0904/thewyj.uk/actions/runs/42742459575) SUCCESS，
它不替代staging精确HEAD的CI。本轮源验收日志、SQL快照、原始/重放ID、parser序列、完整SHA执行清单及hash清单
保留于 `docs/migration-evidence/finance-p04/binding-final-acceptance/`，全部为隔离合成fixture。

Git审计确认9ab3a56至6b1bea48为9个线性P04提交：#138两次、独立RED一次、#139六次正式修复。
差异仅为P04源码、QA和历史P04报告，无P07、签名、数据库迁移或其他任务。
阶段二使用独立staging，从#112 HEAD整合该明确祖先链，保留历史RED报告；本报告不移动#112或合并现有PR。
后续staging SHA、Draft PR与完整必需CI记录在整合交付报告和PR说明中。

正式备份/恢复、历史账目保护的真实升级恢复、Android真机离线/重启/同步、新旧客户端能力与旧APK升级库门禁
仍需独立关闭。未操作Production D1/R2、真实账目、Stable、P05/P06或Task27。

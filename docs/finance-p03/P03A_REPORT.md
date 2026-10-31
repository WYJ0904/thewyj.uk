# FINANCE-P03-A 实施与验收报告

**最终状态：PARTIAL。合成合同内核完成验证，真实提供方适配器仍 BLOCKED；不建议无条件关闭 P03-A。整个 P03 继续 PARTIAL。**

基线 `09442c2985368dfb09ddfa6b613c3be2d0f21b9d`，分支 `codex/finance-p03-identity-preauth`，使用原隔离工作树。开工实际HEAD/branch/clean已核对，原closeout seal的45份源码/报告与698份证据通过。最终本地提交、Git tree、APK SHA-256及证据seal见 [REVISION.json](../migration-evidence/finance-p03/phase-a/REVISION.json)；本轮无发布。

P01现按实际主工作区子目录读取：14,773字节、111行、七章节及最终状态完整，SHA256 `c91558842104cb44079a59e325242a7bbf7f33ceb49b01dfbc9506098a111ebc`，与开工保护清单字节相同；不声称与不可访问的ChatGPT沙盒原件独立比对。它是远端静态历史参考，未代表当前本地代码、未据此重启P01/P02/P03或新增P04/P05/P06。原资料路径经所有者更正后补读，原P02/P03报告与raw证据不重写。历史资料读入/格式检查1224份、0解析错误，见historical-read-index.json。

实现：精确来源证明下的Capture/Refund绝对金额更正、候选晋升、同操作候选幂等归并、家族/操作重归属、单个错误别名解除和之后独立恢复、保留旧正式ID与不可变回执、全额退款冲正、用户决定保护、Room/outbox恢复、D1原子余额/CAS与change feed。签名/真实提供方语义适配器缺失时默认拒绝，合成注册器不会随产品启用。没有复制第三方实现、引入AI、修改金额识别或OCR策略。

| 当前执行集合 | 真实结果 |
| --- | --- |
| 原607 | 588 JVM +13 Node +6 DOM PASS，0 FAIL/SKIP；保留前轮3个已披露夹具条件 |
| 标准JVM | {'PASS': 663}；663方法，包括原588、旧P03的26、closeout的18、本轮31 |
| 原P03新增63 | {'PASS': 63}，case ID集合保持 |
| 上轮新增41 | {'PASS': 41}，case ID集合保持 |
| 本轮新增99 | {'PASS': 99}；31标准JVM、58服务、8迁移、2跨JVM方法 |
| Lint / Debug | PASS；Lint实际告警 {'Warning': 85, 'Hint': 12}，无Error/Fatal |
| 冻结608行 | {'PASS': 536, 'FAIL': 7, 'EXPECTED_RED': 42, 'NOT_TESTED': 23}；状态变化 0，26行复用本轮JUnit，不额外计执行 |

这些集合存在交叠，不能相加；30次循环、重跑及全量661→662→663的中间轮次不增加独立用例数。最终选取索引、全部命令/退出码和完整失败账本在 TEST_RUNS 与机器JSON。未验证的一律NOT_TESTED。

三组真实Room文件/outbox/loopback HTTP/本地D1桥接通过。新组修正已提交后实际503，再重建D1 runtime，重放原请求及30次重复：原交易ID、USD90、revision2、一条已应用修正、队列空，共34请求。旧组仍3账/2待核实/至少9请求和4账/1待核实/至少15请求。均为合成账户，不是手机或真实云端验收。

C005仍原170目标、实际80、EXPECTED_RED，90缺独立引用不自动入账；C007仍原170目标、实际0、EXPECTED_RED。独立受证80+90的170路径另测，未替换冻结样本。原FAIL7与EXPECTED_RED42完整保留，P04/P05/P06红灯未作为P03-A开发范围。

新增Role保护拒绝把已接受的授权/解除/过期控制事实消耗成Capture别名。兼容性回归修复generic raw、旧structured缺字段、hint共用入口绕过；已受证旧来源返回实际Event receipt，未伪造hint行。八候选审计上限、旧别名第三版仍读第二版等本轮中间缺陷均先保留失败再修复。原始源事实/旧关系不删除。

保护：原主工作区832文件全部hash不变；P01等3份材料开工已存在，只有所有者新增路线图1份（当前833）；HEAD/branch/既有dirty相同。其余12组工作区/证据零新增、缺失、变化。Task26豁免状态、D01/D02 CLOSED、原Hotfix均保持。正式版本/签名配置不改；没有操作设备，正式App实际数据状态NOT_TESTED。本轮未ADB、真实交易、Production、远端迁移、正式签名、PR、push、merge或发布。

剩余阻断：真实提供方的账户作用域、独立操作引用、前驱/绝对版本及完成/退款语义未取得；当前App没有已验证的真实自动修正适配器。多正式账目、未知人工来源、跨账户/发行方、证据不足、超过完整证明集合容量继续隔离，不能称完整业务支持。真实备份恢复、旧正式APK、真实通知/云同步/三页面/生命周期仍NOT_TESTED。详见交接。

- [实施计划](P03A_PLAN.md)
- [业务合同与限制](P03A_RECONCILIATION_CONTRACT.md)
- [模型、迁移与恢复](P03A_MIGRATION_AND_RECOVERY.md)
- [逐案608行及新增/既有测试](P03A_TEST_MATRIX.md)
- [命令、失败、保护及改动清单](P03A_TEST_RUNS.md)
- [P03-B交接与停止条件](P03A_P03B_HANDOFF.md)

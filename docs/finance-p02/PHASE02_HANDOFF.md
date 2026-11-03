# FINANCE-P02 一页中文交接

**阶段完成，基线红灯保留；只交付测试体系/诊断，不是产品修复完成。停止于P02，等待P03授权。**

基线：`1398c76d9321919ac8c94550f2d23c2c8e1a1e84`，独立 `codex/finance-p02-tests`，未用main覆盖本地Hotfix。PR110/111最新仍draft/open/unmerged，分别e2febc6/6247c41；其CI分别failure/success。主工作区WIP、现有Hotfix和Task26仅只读保护。

本轮新执行原607：607 PASS、0 FAIL、0 SKIP；另有本地后端3脚本PASS。细粒度矩阵608行：{'PASS': 516, 'FAIL': 7, 'EXPECTED_RED': 62, 'NOT_TESTED': 23}。其中直接产品调用/新执行行559：{'PASS': 490, 'FAIL': 7, 'EXPECTED_RED': 62}；26行复用607既有JUnit，不重复计执行。AI mock示例15个已构建/执行，但产品集成15项NOT_TESTED；8项真实硬件/云/回滚边界未测。新矩阵JUnit有真实失败（含EXPECTED_RED），不是全绿验收。

已证实：强消息/引用身份与同源重放控制通过；两个候选的amount/time reconcile直接接口仍选第一项但没有写账；跨来源延迟保留2笔；12个明确单一ISO外币标记的合成输入被实际记为CNY，另有6个符号/默认/清算歧义币种红灯；JPY格式、混币月/预算/分类、历史FX与预授权存在目标缺口；传统一分/无符号固定文本有3个语义拒绝FAIL。双JVM Room/队列保留旧ID，真实本地D1三次重放/同receipt只一笔，编辑/删除/恢复/旧响应保护通过；5个明确负入账控制均0笔。

未证实：A零间隔无message/reference的4个FAIL没有充分可观察新事件证明，不能推断真实三星吞单；没有产品入口调用旧reconcile的证据，不能推断真实跨源误并。OCR只是固定文本+mock engine，不是真ML Kit硬件率；AI模块未集成，F012仅测试桩契约不一致，不是生产泄露证明。真实手机、支付、Hosted/Production、模型调用与回滚都未操作。

P03最小建议与前置：先批准新事件证据合同和缺证据核对策略，保护原稳定ID/receipt/outbox；审查未调用的金额/时间匹配接口，不能直接把它当去重规则。对明确ISO却写CNY的动态证据，应先由所有者决定是否提升为阻断或调整修复优先级，最小方向是保留明确币种证据并禁止静默改为CNY，不在本阶段实施。再设计既有账本上的授权/清算/解除关系与additive迁移/回退保护，无可靠共同引用不得自动关联。完整六币种/FX仍属Phase04，OCR语义Phase05，AI授权与真实模型Phase06；如要调整阶段顺序须所有者明确。禁止用红灯授权自动抢跑产品实施。

报告：[逐案矩阵](BASELINE_MATRIX.md)、[fixtures与真值](FIXTURES_AND_GROUND_TRUTH.md)、[身份/重放归因](IDENTITY_REPLAY_RCA.md)、[币种/预授权缺口](CURRENCY_PREAUTH_GAPS.md)、[运行与失败账本](TEST_RUNS.md)、[新增路径清单](ADDED_FILES.md)。原始证据在ignored docs/migration-evidence/finance-p02：[完整机器记录](../migration-evidence/finance-p02/report-results.json)、[度量汇总](../migration-evidence/finance-p02/summary.json)、[SHA与隔离核验](../migration-evidence/finance-p02/provenance.json)。完整输入、期望、actual、堆栈、fixture哈希、环境与复现命令可追溯。

隔离核验：主工作区832、原修复840、Task26 826、D-01 859、D-01对照829、D-02 871、原候选881个文件全部哈希不变；7个工作区HEAD/分支/dirty相同，原始phase3/D01/D02/候选证据140/870/207/366文件不变。产品代码、依赖与版本配置差异0。D-01/D-02保持CLOSED；Task26保留所有者豁免状态。没有ADB、手机、真实支付、远端生产、推送、合并、发布或P03实施。

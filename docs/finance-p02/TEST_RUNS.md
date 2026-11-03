# 执行命令、环境与失败账本

基线 `1398c76d9321919ac8c94550f2d23c2c8e1a1e84`；分支 `codex/finance-p02-tests`，managed worktree `%USERPROFILE%/.codex/worktrees/finance-p02-tests/thewyj.uk`。主工作区 e2febc6、PR110 e2febc6、Task26/PR111 6247c41；远端 main74eadf5。两个PR当前仍 open/draft/unmerged；Core CI 110 failure38690670403、111 success38844323258。本轮只读接口核查，不改 PR/CI，不把 PR 的 mergeable/test merge SHA 当已合并。GitHub 元数据与 ls-remote 不证明 CF Production live状态；**Production live/真实手机均 NOT_TESTED**，遵守用户禁止操作的边界。

已检查 status/branches/worktrees、AGENTS/迁移/暂停报告、历史 Hotfix RCA/phase4 与最近15+Pinned线程；可见唯一活跃 Codex 为当前任务，不声称穷尽全部历史线程。新 P02 授权只解除本阶段测试限制，未启动财务 AI 产品/P03。主工作区新材料目录被保留，实际路径比用户最初给出位置多一层 thewyj.uk。原件 SHA 在 provenance.json，仅读且复制到 ignored。gh CLI不在PATH，已用GitHub只读connector和git ls-remote替代；无需安装gh或改全局配置。

环境：Windows PowerShell，Node24.18.1，Python3.15.0，Android Studio JBR OpenJDK21.0.10，Gradle9.4.1，SDK36；新增Robolectric用API34虚拟Android。没有模拟器/手机/ADB、真实短信/账户/交易、Cloudflare远端操作或付费AI。Miniflare仅本地D1，源码中的 preview URL是Request对象，不是网络请求该地址。npm ci固定原lockfile，仅安装隔离node_modules，未升级依赖。原始 stdout/stderr 在下列路径，非零退出没有隐藏。

| 命令（均从隔离root，Gradle用-p android） | 结果 | 原始证据相对 finance-p02/ |
| --- | --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | PASS，34 packages | npm-ci.log |
| `gradlew :app:testDebugUnitTest --rerun :app:lintDebug` | 588 PASS/0 FAIL/0 SKIP；Lint通过 | existing-android-baseline.log、existing-junit/、existing-lint.xml |
| `node local-backend/test_aeris_state_consistency.mjs` | 13 PASS | existing-node-state.log |
| `node qa/aeris/state-consistency-browser.mjs` | 6 PASS，非手机 | existing-browser-state.log |
| `node local-backend/test_task21_notification_js.mjs` | 脚本PASS，本地隐私/幂等/提示回执 | backend-task21.log |
| `node local-backend/test_task16_d1_js.mjs` | 11组PASS，本地D1 | backend-task16.log |
| `node local-backend/test_task17_d1_js.mjs` | 脚本PASS，本地D1 | backend-task17.log |
| `python qa/finance-p02/generate_fixtures.py` | 主fixture525，匿名固定真值 | fixtures/matrix.json、fixture-generation-final.log |
| `gradlew -I qa/finance-p02/test.init.gradle :app:testDebugUnitTest --tests '*FinanceP02MatrixTest' --tests '*FinanceP02TimingTest' --rerun` | 退出1：7个JUnit方法，矩阵5组失败，含7 CURRENT FAIL和48 EXPECTED_RED；timing及negative方法通过 | validated-matrix.log、validated-matrix-junit/、validated-matrix/*.ndjson |
| 同overlay，`--tests '*FinanceP02MatrixTest.C_preauthorizationTarget' --rerun` | 退出1：复核C008参考号装配后8 EXPECTED_RED | preauth-reviewed.log、preauth-reviewed-junit/、preauth-reviewed/kotlin-C.ndjson |
| 同overlay，`--tests '*FinanceP02MatrixTest.D_parserCurrencyTarget' --rerun` | 退出1：24个D样本6 PASS/18 EXPECTED_RED，额外导出实际booked_currencies/amounts；金额/币种真值未变 | currency-booking-final.log、currency-booking-final-junit/、currency-booking-final/kotlin-D.ndjson |
| 上述overlay分别 `--tests '*FinanceP02SeedTest'`、`--tests '*FinanceP02RestoreTest'` | 2 PASS，两个真实JVM PID | process-seed/restore.log、对应-junit/、matrix/process-*.ndjson |
| `node qa/finance-p02/web-contracts.mjs` | 非零：23行，11 PASS/12 EXPECTED_RED；AI15产品NOT_TESTED，桩决议1项不匹配 | web-contracts-final.log、matrix/web-pure/ai-contract.ndjson |
| `node qa/finance-p02/web-dom.mjs` | 退出1：CNY2 PASS、混币2 EXPECTED_RED | web-dom-final.log、matrix/web-dom.ndjson |
| `node qa/finance-p02/ledger-d1.mjs` | 11 PASS | ledger-d1.log、matrix/ledger-d1.ndjson |
| `python qa/finance-p02/report.py` | 生成索引/度量/报告，不改任何结果为PASS | summary.json、report-results.json |
| `python qa/finance-p02/protection.py docs/migration-evidence/finance-p02/protected-final.json --before docs/migration-evidence/finance-p02/protected-before.json` | 退出0，7工作区和4组原始证据无变化 | protected-final.log、protected-final.comparison.json |
| `python scripts/repository_audit.py` | 退出0，901个tracked/candidate文件检查通过 | repository-audit-final.log |
| `python qa/finance-p02/provenance.py` | 校验仅P02新增路径并保存SHA，禁止覆盖旧索引 | provenance.json |

Overlay还需传 `-Dfinance.p02.root=<隔离root>/qa/finance-p02`、`-Dfinance.p02.output=<全新ignored输出目录>`；PowerShell逐项引用-D参数。精确复验命令和输出保护见qa/finance-p02/README.md。JDK/SDK按WINDOWS_WORKSPACE设置，正式签名环境变量从测试进程移除。第一次seed不要覆盖已有DB；复验使用新输出目录，保留之前样本。513个动态case在5个JUnit聚合方法中执行；另有timing和negative两个方法，不能伪称每个fixture是独立JUnit。复用G行已经包含在588中，不重复执行/计数。

## 所有保留失败/装配纠正

- 原新增矩阵先执行A–E并失败，原 ndjson/JUnit/log 仍在matrix、matrix-junit和attempt1。7基线FAIL和48目标RED都保留，未删用例、改期望或改产品。
- 首次C装配遗漏参考号、初版D parser耗时包含coordinator写入。最终C把合成参考号送入源文本，取消对特定字段命名的实现耦合、验证授权原币证据；D分开测纯parser和Room。重跑保留到metrics-rerun/final-matrix/validated-matrix，8/18目标红灯仍在，并没有为转绿改币种或170/200真值。最后发现C008两个独立授权误用同一参考号，保留fixture-before-two-hold-review.json，改为A/B后仅重跑C8，结果全RED，不重算未变的A/B/D/E。
- B首次未实际遵守restart=false标记；已修QA，使两种registry实例策略真正分别执行并导出registry_recreated。validated-matrix保留最后结果，跨来源2笔结论不变。另加5个真实coordinator/Room负入账控制（待收款、优惠、OTP、无金额、不可信legacy），全部0笔；保留原先无负样本的运行，不能从它推断false-booking=0。
- timing测试首次错误地给Robolectric getApplication加泛型，编译失败保留metrics-cd-compile-failure.log；只修QA API调用，没有动依赖/产品。
- D最后补充实际Room币种导出时，首次命令把方法过滤器拼成D_currencyParserTarget而不是D_parserCurrencyTarget，退出1且零测试；currency-booking-reviewed.log保留，不算执行样本。随后用正确过滤器在新目录currency-booking-final执行24个原样本，实际写入币种可逐条核对，不靠parser字段推断落账值。已归档改导出前的Kotlin源，见validated-sources。
- 首次DOM未等deferred render且用了过短交易ID，另有cleanup API拼写错误；attempt1三行和web-dom-attempt1.log保留。修正合法fixture装配、等原aria-busy完成并用现有公共resetAccount；未延长wait阈值。第二次预算把“剩余800”误当目标“已用800”，其假阳性与测试源保留在attempt2；最终读取small中的已用部分，实际200，mixed预算/分类均RED，未改800真值。
- 初版AI示例对sensitive_fields的期望做过特判；已移除，冻结fixture不变，最终F012桩返回accept而期望review，保留为契约桩不一致。没有据旧特判声称通过，更没有证明生产隐私泄露；AI产品15项全部NOT_TESTED。
- Node提示MODULE_TYPELESS_PACKAGE_JSON，未为消除告警修改package.json；非致命。真实降级/Service callback没有安全测试缝隙，标BLOCKED_REQUIRES_PHASE03_APPROVAL；其它独立测试继续完成。

## 固定真值集指标（仅软件/模拟分层）

金额正确/错误/无答案以所有正金额真值样本为分母，不能丢掉解析失败。无金额的聊天/OTP/余额/列表样本另列negative/safe-rejection，不能冲高金额率。下表不是人群估计或实际银行/ML Kit准确率。

```json
{
  "notifications": {
    "positive_truth_samples": 12,
    "correct": 10,
    "wrong_currency": 9,
    "wrong_currency_booking_scenarios": 9,
    "explicit_single_iso_wrong_currency_bookings": 6,
    "incorrect": 2,
    "no_answer": 0,
    "wrong_direction": 0,
    "amount_correct_rate": 0.8333333333333334
  },
  "SMS": {
    "positive_truth_samples": 12,
    "correct": 10,
    "wrong_currency": 9,
    "wrong_currency_booking_scenarios": 9,
    "explicit_single_iso_wrong_currency_bookings": 6,
    "incorrect": 2,
    "no_answer": 0,
    "wrong_direction": 0,
    "amount_correct_rate": 0.8333333333333334
  },
  "UI_tree": {
    "positive_truth_samples": 5,
    "correct": 4,
    "no_answer": 1,
    "negative_samples": 5,
    "safe_rejection": 5,
    "incorrect": 0,
    "wrong_currency": 0,
    "wrong_direction": 0,
    "wrong_currency_booking_scenarios": 0,
    "explicit_single_iso_wrong_currency_bookings": 0,
    "amount_correct_rate": 0.8
  },
  "OCR_MOCK": {
    "positive_truth_samples": 5,
    "correct": 3,
    "no_answer": 2,
    "negative_samples": 5,
    "safe_rejection": 5,
    "incorrect": 0,
    "wrong_currency": 0,
    "wrong_direction": 0,
    "wrong_currency_booking_scenarios": 0,
    "explicit_single_iso_wrong_currency_bookings": 0,
    "amount_correct_rate": 0.6
  },
  "AI_MOCK_CONTRACT": {
    "examples_executed": 15,
    "oracle_checks": 12,
    "oracle_pass": 11,
    "oracle_fail": 1,
    "wire_only": 3,
    "correct": "NOT_TESTED",
    "incorrect": "NOT_TESTED",
    "no_answer": "NOT_TESTED",
    "product_accuracy": "NOT_IMPLEMENTED / NOT_TESTED; mock is not a product parser"
  }
}
```

Booking计数只对直接导出records且有真值的场景：`{'counted_scenarios': 457, 'missed_booking_scenarios': 20, 'duplicate_booking_scenarios': 4, 'negative_booking_controls': 5, 'false_booking_scenarios': 0}`。其中负入账控制5个，实际均0笔；False为0仅代表这些固定控制，不外推用户误记率。Missed含隐含真值但来源证据不足的A场景，不能称真实漏记率；不产生账本的E行不硬填false-booking=0。币种/方向错误按字段样本计，非金融损失统计。notifications和SMS各9个wrong-currency booking中，各6个具有明确单一ISO标记；合计12个排除了符号/偏好歧义及人民币清算混合输入。

性能是当前开发机的monotonic实测，30次queue/Room样本和24次parser；不是手机延迟：

```json
{
  "parser_host_jvm": {
    "samples": 24,
    "p50_ms": 0.72125,
    "p95_ms": 16.0388
  },
  "coordinator_room_host_jvm": {
    "samples": 24,
    "p50_ms": 10.4093,
    "p95_ms": 24.064
  },
  "queue_host_jvm": {
    "samples": 30,
    "p50_ms": 0.7081,
    "p95_ms": 11.3781
  },
  "booking_host_jvm": {
    "samples": 30,
    "p50_ms": 1.57495,
    "p95_ms": 2.1722
  },
  "ocr_hardware_p50_p95": "NOT TESTED",
  "retry_max_attempts": 8,
  "retry_window_ms": 90000
}
```

OCR硬件P50/P95、真实消息投递、锁屏、跨设备云与回滚均NOT_TESTED，不填估算数字。没有复制GPL/AGPL或其它第三方产品模块；仅复用本项目既有测试辅助与锁定Miniflare库，未创建重复开源名录。

## 隔离和可追溯核验

完整继承：e2febc6 → 94f5177 → 9ff7a7f → f6a2ec7 → 57b622e → 8c0de9c → ff11072 → 1398c76。D-01/D-02维持CLOSED，本阶段没有新证据重新打开；Task26仍CLOSED_WITH_OWNER_WAIVER，其CI通过不改写豁免门禁。

保护脚本为纯文件系统/Git哈希，没有ADB或手机操作。首次protected-before与最终protected-final比较如下；源码/ignored原始证据都保留。候选相对f6a2ec7的Android/JS/Worker/SQL产品差异为0；本次相对1398c76仅新增P02测试与文档，依赖/版本/签名/发布配置不变。

| 保护范围 | 文件数 | 新增/丢失/改变 | HEAD/分支/dirty |
| --- | --- | --- | --- |
| main | 832 | 0/0/0 | 全部相同 |
| repair | 840 | 0/0/0 | 全部相同 |
| task26 | 826 | 0/0/0 | 全部相同 |
| d01 | 859 | 0/0/0 | 全部相同 |
| d01control | 829 | 0/0/0 | 全部相同 |
| d02 | 871 | 0/0/0 | 全部相同 |
| candidate | 881 | 0/0/0 | 全部相同 |
| phase3 | 140 | 0/0/0 | 原始证据逐文件相同 |
| d01Evidence | 870 | 0/0/0 | 原始证据逐文件相同 |
| d02Evidence | 207 | 0/0/0 | 原始证据逐文件相同 |
| candidateEvidence | 366 | 0/0/0 | 原始证据逐文件相同 |

详细证据：protected-final.comparison.json、protected-final.log；provenance.json收录原材料相同SHA、基线继承、源/fixture/报告/原始证据SHA、JDK/Node/Python版本。原始库只读状态核查不等于验证Production live或手机状态。没有推送、合并、发布、正式签名、正式App迁移；P02没有任何ADB调用。

最终D仅为明确Room落账币种补充诊断输出，性能coordinator_room_host_jvm包含coordinator、Room读写和导出诊断开销；parser_host_jvm单独测量。最后运行包含冷启动/主机调度差异，不删除高耗时样本，不宣称生产SLA。

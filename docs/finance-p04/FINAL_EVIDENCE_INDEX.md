# FINANCE-P03/P04 最终证据索引

2026-10-24，Asia/Hong_Kong。**P03 PARTIAL / P04 PARTIAL / Production HELD。** 本索引只指向实际证据，不将合成、Hosted、Samsung、真实微信及Production混记。`E/`为本机忽略证据目录`docs/migration-evidence/finance-p04/closure-current/`；完整raw不保证随Git下载。私有认证和微信原件不进入Git/正文，必要hash引用受限本机保全。

## 1. 代码与原始材料

当前回归产品SHA：`73764f77fd02ada240e41c24734e523c5dad8805`，含`2e1e2240a440ab7991c7f04248944440b8bc95e7`的OCR币种上下文修复及后续JPY上下文/FX运行时修复；继承原本地封存`329aa0c8da33776d72bc778c9a3737865d26fd6f`。最终QA/报告提交SHA记录于E/FINAL_DELIVERY_PROVENANCE.json，不用未来SHA冒充已测试产品版本。

| 材料 | 指针 |
| --- | --- |
| 统一P03结论 | [FINANCE_P03_FINAL_REPORT.md](../finance-p03/FINANCE_P03_FINAL_REPORT.md) |
| 统一P04结论 | [FINANCE_P04_FINAL_REPORT.md](FINANCE_P04_FINAL_REPORT.md) |
| 原报告原字节及校验 | [baseline-reports/SHA256.json](../migration-evidence/finance-p04/closure-current/baseline-reports/SHA256.json)，源/备份SHA相等；原历史不是本轮PASS |
| 冻结输入完整性 | [input-integrity.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/input-integrity.json)，原fixture/oracle不改 |
| 完整失败/范围 | [FAILURE_AND_SCOPE_LEDGER.md](FAILURE_AND_SCOPE_LEDGER.md) |

## 2. 本地最终回归与精确命令

| 集合/操作 | 实际结论 | 证据 |
| --- | --- | --- |
| 标准JVM730 | 724 PASS / 6 FAIL | [summary](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/summary.json)、[命令/JUnit身份](../migration-evidence/finance-p04/closure-current/final-current/android-current/command.json)、[失败](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/jvm-failures.json) |
| 原607 | 602 PASS / 5 FAIL | [original-607](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/original-607.json) |
| 原冻结608 | 549 PASS / 8 FAIL / 28 EXPECTED_RED / 23 NOT_TESTED | [frozen-608](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/frozen-608.json) |
| 版本化608 / P04原18 | 555/8/22/23；P04 18 PASS，原样12 PASS/6 EXPECTED_RED | [contract-608](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/contract-608.json)、[18逐项](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/currency-18.json) |
| P03原26 | 4 FAIL / 22 EXPECTED_RED | [p03-original-26](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/p03-original-26.json)；C005/C007原真值保留 |
| Node/DOM/实际Chrome/HTTP/迁移 | 34命令30退出0/4退出1；各子集按summary独立，不相加 | [Node命令](../migration-evidence/finance-p04/closure-current/final-current/regression/node-commands.json)、[JVM桥命令](../migration-evidence/finance-p04/closure-current/final-current/regression/jvm-commands.json)、[新增命令](../migration-evidence/finance-p04/closure-current/final-current/extra-commands.json) |
| Lint/Debug | 0 Error/Fatal，86 Warning/12 Hint；Debug构建完成，组合命令因JVM失败exit1 | [android-current/command.json](../migration-evidence/finance-p04/closure-current/final-current/android-current/command.json)，含实际APK hash，不是正式签名 |
| 命令失败及有限重试 | 原Windows ESM/legacy/collector等失败保留 | [command-failures](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/command-failures.json)、[qa-retries](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/qa-retries.json) |

## 3. Samsung、真实页面与隔离云

| 检查 | 实际结论 | 证据 |
| --- | --- | --- |
| 最终Samsung组件 | 登录1P、冷重读1P、Room3P、六币种3P、MainWeb1P；smoke原FAIL/清理后PASS分列 | [final-components](../migration-evidence/finance-p04/closure-current/samsung-final-components.json)、[smoke-r2](../migration-evidence/finance-p04/closure-current/samsung-final-smoke-after-cleanup-r2.json) |
| 实际四组件冷恢复 | seed/restore各1P、QA偏好SHA恢复 | [backup-guard](../migration-evidence/finance-p04/closure-current/samsung-final-backup-guard.json) |
| 正常进程通知/生命周期 | OS合成通知4投递/更新/重投及1移除P、账目增量0；生命周期30/30P | [notifications-final](../migration-evidence/finance-p04/closure-current/normal-notifications-final.json)、[lifecycle30](../migration-evidence/finance-p04/closure-current/samsung-final-normal-lifecycle-30-r1.json) |
| 最终息屏/本人解锁 | 原20秒FAIL，解锁后仅观察RESUMED，不改PASS | [screen-r1](../migration-evidence/finance-p04/closure-current/samsung-final-normal-screen-r1.json)、[解锁后观察](../migration-evidence/finance-p04/closure-current/samsung-post-owner-unlock-observation.json) |
| 实际SDK/product OCR | 同七向量before6F→after1F→0F，最终独立30×7P；safety8P2NT、组级FAIL | [series-r2](../migration-evidence/finance-p04/closure-current/samsung-ocr-series-r2.json)、[safety-r1](../migration-evidence/finance-p04/closure-current/samsung-ocr-safety-r1.json) |
| 实际workerd FX/Hosted FX | 受控workerd3F→3P；Hosted r2含登录4P，市场参考非支付成交价 | [workerd-after](../migration-evidence/finance-p04/closure-current/fx-worker-contract-after-r1.json)、[hosted-fx-r2](../migration-evidence/finance-p04/closure-current/hosted-fx-r2.json)、[适配披露](../migration-evidence/finance-p04/closure-current/hosted-fx-r2-adaptation.json) |
| Hosted HTTP/NativeCloud | HTTP11P；native r3 seed/跨进程restore各1P，六币种小单位/丢ACK/精确重放/另账户隔离 | [HTTP-r2](../migration-evidence/finance-p04/closure-current/hosted-http-r2.json)、[native-seed](../migration-evidence/finance-p04/closure-current/samsung-hosted-native-seed-r3.json)、[native-restore](../migration-evidence/finance-p04/closure-current/samsung-hosted-native-restore-r3.json)；旧r1/r2失败保留 |
| 最终Hosted实际浏览器 | 19条合成记录可见，CNY/JPY显示留图 | [DOM](../migration-evidence/finance-p04/closure-current/hosted-final-19-dom.json)、[CNY](../migration-evidence/finance-p04/closure-current/hosted-final-19-cny.png)、[JPY](../migration-evidence/finance-p04/closure-current/hosted-final-19-jpy.png)；非真实微信 |
| 真实微信既有¥0.01 | 指定截图OCR CNY1/INCOME/completion；OS metadata稳定但截图profile归属NT，方向INCONCLUSIVE，0 ledger，W01–W10完整链0/10P | [Samsung/微信附录](SAMSUNG_AND_WECHAT_ACCEPTANCE.md)、[来源静态复核](../migration-evidence/finance-p04/closure-current/wechat-screenshot-provenance-review.json)；不公开私人原件，不称真实记账E2E通过 |

## 4. 恢复、清理与保护

| 检查 | 实际证据 |
| --- | --- |
| 本地四件/Room/D1/跨JVM恢复及边界 | [DATABASE_RECOVERY_AND_COMPATIBILITY.md](DATABASE_RECOVERY_AND_COMPATIBILITY.md) |
| 实际generation8已停来源恢复 | [loopback-native-recovery-g8](../migration-evidence/finance-p04/closure-current/loopback-native-recovery-g8.json)：105表/3合成账，退出原因未知 |
| 真实远端QA早期导出导入 | [hosted-d1-restore-r2](../migration-evidence/finance-p04/closure-current/hosted-d1-restore-r2/result.json)：105表/12账/24回执；不是最终水位 |
| 最新云封存/本机恢复 | [cloud-final-backup-r2](../migration-evidence/finance-p04/closure-current/cloud-final-backup-r2/result.json)：105表/19账/25财务回执/6通知回执，hash及FK核对 |
| 手机冷封存/QA预检 | [phone-final-data-seal](../migration-evidence/finance-p04/closure-current/phone-final-data-seal.json)、[preflight9P](../migration-evidence/finance-p04/closure-current/backup-preflight-final-r1.json) |
| 手机/云/Windows实际清理 | [CLEANUP_REPORT.md](CLEANUP_REPORT.md)：4APK、owned项目4部署/2D1、49手机dump、Windows13,807文件/1,471,872,541逻辑字节 |
| 正式权限/版本最终读回 | [phone-after-permission-restore-r1](../migration-evidence/finance-p04/closure-current/phone-after-permission-restore-r1.json)：a11yTRUE/NLSFALSE/1.3.37 code50 |
| 最终13组保护 | [protected-final.comparison.json](../migration-evidence/finance-p04/closure-current/protected-final.comparison.json)：无added/missing/changed，8个Git工作树HEAD/branch/status相同；不等同正式手机私有数据全hash |
| 清理拒绝保留例外 | [cleanup-policy-rejection-final.json](../migration-evidence/finance-p04/closure-current/cleanup-policy-rejection-final.json)：owned QA `__pycache__`删除未执行、未换方式重试，残留保留 |
| 未放行门禁 | [RC6_PRODUCTION_GATE.md](RC6_PRODUCTION_GATE.md)：原FAIL/真实链/CI/正式升级/生产恢复仍未满足，无Production发布 |

<!-- FINAL_CLEANUP_AND_SEAL_STATUS -->
最终13组保护检查PASS（E/protected-final.comparison.json，无added/missing/changed，8个Git工作树HEAD/branch/status相同）；最终本地Git SHA/证据总manifest记录于 `E/FINAL_DELIVERY_PROVENANCE.json`。历史683件封存校验、原报告备份和本轮逐项证据不能代替最后检查。不得由本索引推断COMPLETE、合并、推送或发布。


清理保留例外：`qa/finance-p04/closure/__pycache__`的最后删除被自动审批拒绝（仅`blocked by policy`，无具体理由），命令未执行、未换方式重试，故小型pyc缓存仍保留；见E/cleanup-policy-rejection-final.json。不得称零残留。

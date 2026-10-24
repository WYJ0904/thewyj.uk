# FINANCE-P03 最终统一报告

2026-10-24，Asia/Hong_Kong。**P03 = PARTIAL；P04 = PARTIAL；Production = HELD。** 本轮有已验证的产品修复、隔离 Samsung 组件和合成 NativeCloud 链路；P03 原 26 项仍 4 FAIL / 22 EXPECTED_RED，原 607 和标准 JVM 仍有 FAIL，真实微信付款角色冲突未解决。当前不具备整体 COMPLETE 或发布条件。

## 1. 当前版本与历史原文保全

本报告更新的是继承 P03 的既有 P04 隔离工作树，未恢复暂停的 Android Hotfix、修改主树或重开 Task26。Task26 保持 CLOSED_WITH_OWNER_WAIVER，豁免不改 PASS；不进入 P05/P06。下文 E/ 表示 docs/migration-evidence/finance-p04/closure-current/，D/ 表示其中 final-current/delivery-current-r2/；两者为本机忽略证据，不保证从远端 Git 可下载。

本地产品修复为 **2e1e224**（OCR 账户币种上下文 / policy2）及 **73764f7**（JPY 二次金额确认上下文 / 精度、FX workerd redirect 兼容）。本地最终回归源码为 **73764f77fd02ada240e41c24734e523c5dad8805**。早期 Samsung 候选 **94ab0fc82bc5b21b4f04237ff110574d10da565c** 的结果保留其原始源码身份，不能冒充最终版本重测。

改写前已用 CreateNew 独占保存旧报告的原字节，源与备份 SHA-256 完全一致。历史版本不能作为本轮新 PASS：

| 历史报告 | 原字节数 | SHA-256 / 保存位置 |
| --- | ---: | --- |
| P03 旧统一报告 | 51719 | 2ec681506653f8bb1317a570eb04118d3bc2f8ad801eaa894861505b637e80e3；[原字节副本](../migration-evidence/finance-p04/closure-current/baseline-reports/finance-p03-before.md) |
| P04 旧统一报告 | 22295 | 937907eeae97454251f3b0dcef3358be8c907ed6348e2b8f7763fb89a8cc1177；[原字节副本](../migration-evidence/finance-p04/closure-current/baseline-reports/finance-p04-before.md) |

保存时间、独占方式及校验见 [SHA256.json](../migration-evidence/finance-p04/closure-current/baseline-reports/SHA256.json)。原先 2026-10-23“仅非手机”的阶段说明是历史范围；本轮已执行的手机 / Hosted 项目只按下文独立证据记账。

## 2. 最终本地回归：原集合与新集合不相加

当前唯一用于本地最终统计的汇总为 [delivery-current-r2/summary.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/summary.json)，生成于 2026-10-24 15:22:28 +08:00。该 collector 只统计本地测试；Samsung、微信、Hosted 结果单列。

| 集合 | 当前实际结果 | 计数边界 |
| --- | --- | --- |
| 原 34 个 Node 命令 | 30 个退出 0，4 个退出 1 | aeris-dom、task21、p02-web、p02-dom 非零退出；不能将整组记为 PASS |
| 标准 JVM 730 方法 | **724 PASS / 6 FAIL** | 新增 8 个 OCR unit 方法已包含在 730 内 |
| 原 JVM 588 | **585 PASS / 3 FAIL** | 原 607 的 JVM 部分 |
| 原 607 | **602 PASS / 5 FAIL** | JVM 585/3 + Node 13 PASS + Chrome 4/2 |
| 受保护 681 | **675 PASS / 6 FAIL** | 与标准 JVM / 其他集合重叠 |
| P04 native 方法视图 | 49 PASS，其中本地新增视图 25 PASS | 新增 OCR 8 PASS 是其中部分，不另累计 |
| 原样冻结 608 | **549 PASS / 8 FAIL / 28 EXPECTED_RED / 23 NOT_TESTED** | 冻结驱动 / 输入 / oracle 原样执行 |
| 当前版本化合同 608 | **555 PASS / 8 FAIL / 22 EXPECTED_RED / 23 NOT_TESTED** | 仅补原声明但原驱动未转发的参数；原样结果另存 |
| P04 原 18 | 版本化驱动 **18 PASS**；原样 **12 PASS / 6 EXPECTED_RED** | 两份执行不能互相覆盖 |
| P03 原 26 | **4 FAIL / 22 EXPECTED_RED，0 PASS** | 原业务目标仍未满足 |
| P03 重叠 63 / 41 / 99 / 79 | 63 为 58 PASS / 4 FAIL / 1 NOT_TESTED；其余各自全 PASS | 不累加为独立总数 |
| 已有新增 38 行 | 38 PASS | 不覆盖原 26 |

完整原始记录见 [original-607.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/original-607.json)、[jvm-failures.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/jvm-failures.json)、[frozen-608.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/frozen-608.json) 与 [contract-608.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/contract-608.json)。

标准组合 Android 命令 exit 1。--continue 实际完成 lint / Debug 构建，lint 为 0 Error/Fatal、86 Warning / 12 Hint；这些构建产物不能消除 6 个 JVM FAIL。未将 Debug 产物当正式签名发布包。

## 3. P03 原 26 与原回归失败仍保留

原 26 每行原预期、before/after 和错误见 [p03-original-26.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/p03-original-26.json) 及 [失败与范围台账](../finance-p04/FAILURE_AND_SCOPE_LEDGER.md)。4 FAIL 是 A009 / A011 / A201 / A203；其余 22 仍 EXPECTED_RED。A 类的独立事件 / 重投 / 版本归并目标未满足，不能凭相同金额、文案、时间或槽位补独立 operation。

**C005 保留 USD 80 + USD 90 两次结算的原真值 17000，实际仍为 8000；C007 原无引用 USD 170 结算真值仍为 17000，实际仍为 0。** 未降低真值、改写 fixture、虚构 Capture / revision / 前驱证明或用另一份显式证明数据取代原输入。

原 607 的五个 FAIL 为两个 omitted-currency Chrome 显示断言及三个 JVM 旧无币种前提断言：MessagingStyle 金额 expected10000 / actual0、缺失理由新增 currency，以及本地账目为空导致 single() 失败。标准 730 另有三个 FinanceP03IdentityLifecycleTest 失败（两项空列表、一项 expected2 / actual0）。旧前提与当前不猜 CNY 的安全合同差异已解释，但原 FAIL 没有改判。

G-REUSED-014 复用同一个 offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive，**PASS → FAIL**，不额外计执行。前版 delivery-current 的 actual 误继承 PASS，已在 delivery-current-r2 按本轮 JUnit 更正为 FAIL；旧汇总保留。E004 / E007 / E008 仍为页面完成 / 无符号 0.01 语义 FAIL，不因金额模块支持最小单位而关闭。4 个 A + 3 个 E + G 构成冻结 608 的 8 FAIL。

## 4. P03 能力、恢复与 P04 继承范围

预授权 / 多次部分清算 / 解除 / 过期 / 退款、余额约束、权威修正、ID 历史关系、人工优先级和精确回执控制继续按原来源 / 版本合同工作；需要可靠证明的原 26 项继续待核实。

本地工程已修复同一 Outbox 文件多实例争抢临时文件的问题，60 并发操作完整保留；旧协议到拒绝上限后仅对明确 currency_client_upgrade_required 提供一次持久化 capability3 重试。旧 body / ID 不重写；再次拒绝仍停止。人工币种确认走独立持久化命令，空200、错金额 / 币种 / 事件回执不能吞队列，账户 / epoch / 人工决议边界保持。

| 独立本地验证 | 当前结果 | 限定范围 |
| --- | --- | --- |
| 原 legacy bridge | seed FAIL，restore NOT_TESTED，requests=0 | 原隐式 CNY fixture 预期3笔、实际1笔 |
| 显式默认币种 bridge | PASS | 新增明确账户默认的独立前提，不覆盖原失败 |
| clearing / correction / unified bridge | PASS；15 / 34 / 35 请求 | 本地 HTTP + Miniflare D1、独立 JVM、提交后丢回执 / 幂等 |
| 四组件冷备份恢复 | PASS | Room16、FX / 人工决议库1、五列 Outbox、币种偏好，合成数据 |
| Miniflare 二进制副本恢复 | PASS，105表 | 本地物理持久化；长路径 QA 失败及短路径对照保留 |

Room / D1 的增量迁移、旧 opener 拒绝降级、完整四组件恢复、缺件 / 错账户 / 校验失败拒绝与 Production 恢复边界见 [数据库恢复与兼容性](../finance-p04/DATABASE_RECOVERY_AND_COMPATIBILITY.md)。Git 回退不等于数据库回退；真实个人备份和正式 App 数据恢复仍 NOT_TESTED。

## 5. 本轮 OCR、FX、Samsung 与 NativeCloud

| 独立证据 | 本轮实际结果 | 不可扩大的结论 |
| --- | --- | --- |
| 新 OCR unit | **8 PASS** | 已包含标准730；不代表真实页面准确率 |
| 实际 workerd FX 合同 | **3 FAIL → 3 PASS** | workerd 真运行、受控响应，upstream_requests=0；不是公开提供方实读 |
| Hosted FX | 原 r1 2 PASS / 1 FAIL；r2 **4 PASS** | 含登录、参考率缓存、同币种和合成历史；provider-name 断言适配为 canonical Frankfurter，金额 / 日期 / 货币断言未改 |
| 七个固定 bitmap 的实际 SDK / 产品 OCR | **6 FAIL → 1 FAIL → 0 FAIL**，最终7 PASS | 相同原始金额 / 预期；限定 OCR 组件 |
| 同七向量重复 | **30 × 7，全部 PASS** | 210次执行、7个不同输入，不是210笔业务 |
| 新 safety10 | **8 PASS / 2 NOT_TESTED；suite FAIL** | 两项 OCR 漏掉“支付成功”，null 不构成目标安全 PASS |
| 合成 NativeCloud r3 seed / restore | **各 1 PASS** | 实际 Task20 / HTTPS、六币种各1最小单位、提交后丢ACK、跨进程重登录 / 精确Outbox重放 / 另账户不可见；不是微信 |

OCR unit 见 E/ocr-unit-r1/junit/TEST-uk.thewyj.app.task21.payment.CurrencyOcrPipelineTest.xml；workerd 见 E/fx-worker-contract-before-r1.json、after-r1.json 与 fx-runtime-r1.json；Hosted 见 E/hosted-fx-r2.json、hosted-fx-r2-adaptation.json。设备与重复证据见 [Samsung / 微信附录](../finance-p04/SAMSUNG_AND_WECHAT_ACCEPTANCE.md)。NativeCloud 见 [seed-r3](../migration-evidence/finance-p04/closure-current/samsung-hosted-native-seed-r3.json) / [restore-r3](../migration-evidence/finance-p04/closure-current/samsung-hosted-native-restore-r3.json) 及同名日志，均使用独立合成账户和独立 QA 包。

原 NativeHosted r1 因 app_device_id_invalid 失败；r2 六条请求因 46 字符合成 provider_reference 超过现行40上限而被拒，服务端 rows=[]。原六请求与两次 FAIL 保留。r3 使用新的34字符有效引用和独立数据集，不改旧队列，不把 r2 改 PASS。

早期 94ab0fc 下的 smoke、Room、六币种、合成备份、本地登录、MainActivity、生命周期30轮和息屏等 PASS 保留，但不计最终73764f7的对应复测。早期 instrumentation 无障碍绑定 / 通知监听各 1 FAIL 同样保留；正常进程对照不覆盖 FAIL。历史独立 Activity 异常仍 INCONCLUSIVE，D-01/D-02 保持 CLOSED。

<!-- FINAL_DEVICE_RETEST_STATUS -->
最终 **73764f7** 已执行独立复测：[组件汇总](../migration-evidence/finance-p04/closure-current/samsung-final-components.json) 中登录1 PASS、既有三笔本地合成账冷启动重读1 PASS、Room迁移3 PASS、六币种持久化3 PASS、MainActivity三个Web表面及三次STOP/RESUME/recreate 1 PASS；[四组件备份](../migration-evidence/finance-p04/closure-current/samsung-final-backup-guard.json) seed / 不同进程restore各1 PASS，测试临时隔离的QA币种偏好按SHA原样恢复。正常进程[通知对照](../migration-evidence/finance-p04/closure-current/normal-notifications-final.json) PASS（4次投递/更新/重投、1次移除，0.086–0.410秒回调，实际Room归档，账目增量0），[生命周期矩阵](../migration-evidence/finance-p04/closure-current/samsung-final-normal-lifecycle-30-r1.json) 30/30 PASS，每轮956–1158ms。这些是最终源码的新结果，不借计94ab0fc。

最终smoke首次 **1 FAIL**：原断言要求QA采集gate关闭，但该宿主此前已为受控测试主动开启gate。封存后仅关闭本轮QA采集guard，再执行相同smoke断言为 **1 PASS**；[原失败](../migration-evidence/finance-p04/closure-current/samsung-final-smoke-r1.json)与[清理状态重测](../migration-evidence/finance-p04/closure-current/samsung-final-smoke-after-cleanup-r2.json)并列，不冒充全新安装默认值证明。最终[息屏恢复](../migration-evidence/finance-p04/closure-current/samsung-final-normal-screen-r1.json) **1 FAIL**：正常唤醒后仍为需要本人认证的keyguard，原20秒检查失败；所有者正常解锁后仅[观察到MainActivity RESUMED](../migration-evidence/finance-p04/closure-current/samsung-post-owner-unlock-observation.json)。未延长超时、重分类原FAIL或绕过认证，真实未同步事件与90秒票据仍NOT_TESTED。

清理前[手机数据封存](../migration-evidence/finance-p04/closure-current/phone-final-data-seal.json) PASS：实际安装APK SHA与最终候选一致，本轮QA冷数据5,658,112 bytes、SHA-256 `5dacd2735284a15dd94cc968b8270a4741601ce594c3ecf4915d3fe1b5a127a8`；8份真实指定详情密文与本地受限副本逐项校验，并在内存完成DPAPI/AES-GCM恢复校验，未导出明文密钥或正式App数据。此封存不是跨设备凭据恢复证明，也不代表权限恢复/卸载已完成。

## 6. 真实微信与 Production 门禁

所有者声明既有CNY ¥0.01转账由分身付款、主微信收款且已本人领取。取证前后OS metadata分别稳定于user0/user95；对QA截图执行完整产品OCR都为 **CNY / 最小单位1 / INCOME / completion=true**，probe均 **0 ledger**。但QA使用UiAutomation全屏截图/根节点，产品API34使用窗口截图；**截图层的profile归属NOT TESTED**。标为分身probe的INCOME与付款声明不一致仍 **INCONCLUSIVE**，不足以确认产品读取付款页面却误判，也未证实QA跨profile缺陷。先补来源关联，不能把OS窗口稳定当作实际截图账户证明。

没有可信独立 operation / 提供方引用 / 交易时间来补齐完整链路，不虚构证明或凭同额跨 profile 合并。真实通知 → ticket → Room / Outbox → Hosted回执 → 同事件三页尚未完成，**W01–W10 0/10完整PASS，完整链路均 NOT_TESTED**。工具未新增支付、领取或消息操作；私人截图 / OCR 文本不进入报告。

Production 仍 **HELD**。独立 Hosted、合成 NativeCloud、公开 FX 读取和本地迁移不等于 Production D1/R2 / 正式数据、Stable、正式签名 APK 或 CI 放行；详见 [RC-6 / Production 门禁](../finance-p04/RC6_PRODUCTION_GATE.md)。真实个人备份、正式原地升级及未执行的真实业务项目保持 NOT_TESTED。

## 7. QA 失败保全、清理与最终封存

误绑定既有共享 Preview 的 QA 部署已披露；旧 Preview 审计发现本轮3次登录audit，不能宣称整轮没有共享Preview副作用。另保留 stdin exec-in 空文件（shell -T canary修复）、无效QA设备ID、超长合成引用、Gradle R-def缓存缺件（freshTasks恢复）、Windows ESM URI初次失败后r2成功、collector变量遮蔽KeyError与G继承actual修正。Hosted FX provider名断言适配也单列；未删原失败或改货币 oracle。完整分类与证据见 [失败与范围台账](../finance-p04/FAILURE_AND_SCOPE_LEDGER.md)。

<!-- FINAL_CLEANUP_AND_SEAL_STATUS -->
清理已实际完成并读回：[手机清理](../migration-evidence/finance-p04/closure-current/phone-cleanup-r1.json)仅卸载本轮4个owned APK；[正式状态读回](../migration-evidence/finance-p04/closure-current/phone-after-permission-restore-r1.json)为无障碍 **TRUE**、通知监听 **FALSE**、版本1.3.37/code50，QA包与敏感授权已无。手机49个精确已创建临时dump已删除。owned Pages项目（4次部署）和2个独立D1在最新105表/19合成账/25财务回执/6通知回执完整备份及恢复校验后删除，正式与共享D1仍存在；共享Preview原3条失败登录audit作为事故证据保留，未再写库掩盖。

Windows本轮可重建缓存与5个owned合成Chrome profile合计清理 **13,807文件 / 1,471,872,541逻辑字节**，不承诺物理释放量；源码、失败、APK、备份及必要证据保留。正式Chrome profile与owner Wrangler keyring未动。详见[清理报告](../finance-p04/CLEANUP_REPORT.md)、[证据索引](../finance-p04/FINAL_EVIDENCE_INDEX.md)。最终13组保护核验已PASS（E/protected-final.comparison.json，无added/missing/changed，8个Git工作树HEAD/branch/status相同）；最终Git SHA及总manifest见 `E/FINAL_DELIVERY_PROVENANCE.json`；此项不影响上述已完成清理事实，也不提前放行产品。

P03剩余关闭条件是原合同的可靠身份/操作/版本证据、现存原回归失败的明确处置、实际截图/窗口/profile来源关联，以及尚无完整证据的真实微信链路。已完成的最终设备组件只关闭其限定范围；当前保持PARTIAL，Production HELD。


清理保留例外：`qa/finance-p04/closure/__pycache__`的最后删除被自动审批拒绝（仅`blocked by policy`，无具体理由），命令未执行、未换方式重试，故小型pyc缓存仍保留；见E/cleanup-policy-rejection-final.json。不得称零残留。

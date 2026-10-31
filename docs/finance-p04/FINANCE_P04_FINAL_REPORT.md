# FINANCE-P04 统一最终报告

2026-10-24，Asia/Hong_Kong。**P04 = PARTIAL；P03 = PARTIAL；Production = HELD。** 六币种 / 精确金额 / 决议 / FX 的实现与独立合同已有通过证据，P04原18项版本化驱动为18 PASS；原样驱动仍12 PASS / 6 EXPECTED_RED。原607、标准JVM、P03原26和真实微信角色冲突仍阻止整体COMPLETE。

## 1. 版本、证据和旧报告保全

本轮在既有 finance-p04-multicurrency 隔离工作树进行。最终本地回归源码为 **73764f77fd02ada240e41c24734e523c5dad8805**，本地产品提交 **2e1e224** 修复 OCR 账户币种上下文 / policy2，**73764f7** 修复 JPY 二次金额确认的币种上下文 / 精度及 FX workerd redirect 兼容。未将这些修复并入主树或暂停的Hotfix；Task26保持CLOSED_WITH_OWNER_WAIVER，不改豁免为PASS，不进入P05/P06。

最新本地统计只使用 [delivery-current-r2/summary.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/summary.json) 及同目录明细，生成于2026-10-24 15:22:28 +08:00。下文 **E/** 表示 docs/migration-evidence/finance-p04/closure-current/；**D/** 表示其中 final-current/delivery-current-r2/。collector不包含Samsung / 微信 / Hosted，它们按E下独立证据列出。本机忽略证据不保证可从远端Git下载。

改写前已独占保存两旧统一报告原字节，源与备份SHA相同：[SHA256.json](../migration-evidence/finance-p04/closure-current/baseline-reports/SHA256.json)。P04旧报告22295 bytes，SHA-256 **937907eeae97454251f3b0dcef3358be8c907ed6348e2b8f7763fb89a8cc1177**，[旧原文](../migration-evidence/finance-p04/closure-current/baseline-reports/finance-p04-before.md)；P03旧报告51719 bytes，SHA-256 **2ec681506653f8bb1317a570eb04118d3bc2f8ad801eaa894861505b637e80e3**，[旧原文](../migration-evidence/finance-p04/closure-current/baseline-reports/finance-p03-before.md)。历史“本轮不操作手机”的阶段说明不是当前执行范围，也不计新PASS。

## 2. 六币种与资金合同的实现范围

| 范围 | 当前实现 / 合同 |
| --- | --- |
| CNY / USD / EUR / HKD / GBP | 2位小数；按原币最小单位持久化、精确计算和传输 |
| JPY | 0位小数；整数不除100，过精度拒绝 / 待核实，旧未证单位不擅自重标 |
| 金额 / 舍入 | JS BigInt有理数、Kotlin Long最小单位 / BigDecimal；HALF_EVEN，只在最终目标单位舍入；业务上限1e13最小单位 |
| 交易事实 | 原ID、时间、来源、金额 / 币种、引用、人工修改和关系保留；账户币种、展示币种、可空识别默认币种分开 |
| 混合币种 | 原币分组或明确参考折算；不直接相加，不用1:1补缺失率，不改原账 |
| 完成 / 身份 | 默认币种不是通知ISO证据，也不能构造独立操作、完成证明或解除P03待核实 |
| 原清算合同 | 授权不入支出；多Capture、解除 / 过期、退款及冻结余额仍受P03来源 / 版本 / 人工优先控制 |

实际写入入口固定policy2：无账户默认且无可靠币种时不猜CNY。默认决议保留currency_review_required / decision_source；可信完成证据与默认决议可入账并提示后续核实，通知拒绝不消耗提醒，重复 / 重启不重复提醒。人工编辑或精确当前回执清除标记，旧账户 / epoch不能覆盖新状态。

raw_event.ingest使用精确金额 / 币种路径，保留未知与待核实；Web未知币种要求显式选择后重新输入金额，Android用独立持久化review/confirm命令确认canonical原事件。旧ingest body不改写成另一笔钱；冲突返回409。Outbox多实例共用文件锁、一次持久化capability3升级重试、空200 / 错金额 / 错币种 / 错事件回执保护均保留。

这些能力不意味着P03原26的提供方事实已补齐。C005原80+90=17000、C007原17000的真值不变，实际8000 / 0仍红。

## 3. FX参考、运行时修复与证据分类

参考提供方为Frankfurter v2 daily reference。保留精确十进制lexeme，验证币种对、类型、正数、范围与日期；交易UTC日可引用此前最多7日营业日率。保存来源 / rate_timestamp / fetched_at / expires_at / rounding / 完整性hash，6小时缓存，同pair/date并发去重；交易ID / revision / 展示币种的历史引用冻结，更新来源不重写旧交易或触发第二次财务同步。正文64KiB流式上限、严格UTF-8及原8秒请求 / 7秒批次上限保持。

**参考率不是银行或支付通道成交率。** 缺失 / 过期且离线不可获取时明确不可用；synthetic_rate=7等始终是测试资料，不冒充真实行情 / 凭证。

| FX证据 | 当前结果 | 精确范围 |
| --- | --- | --- |
| 本地独立公开提供方读取 | 12 PASS | D/summary的live_FX集合；与模拟套件分开 |
| 模拟缓存 / 提供方合同 / 历史 | 22 PASS | 不调用公开提供方 |
| 实际workerd before → after | **3 FAIL → 3 PASS** | E/fx-worker-contract-before-r1.json、after-r1.json；实际workerd、受控响应、upstream_requests=0 |
| workerd运行时诊断 | redirect:error不支持，manual支持 | E/fx-runtime-r1.json；73764f7按运行时支持方式修复，不延长超时 |
| Hosted r1 → r2 | 2 PASS / 1 FAIL → **4 PASS** | E/hosted-fx-r2.json；含登录、真实参考率缓存、同币种、合成历史不改原账 |

Hosted FX适配单列于E/hosted-fx-r2-adaptation.json：provider-name断言改为精确canonical值 **Frankfurter**（大写F），金额 / 日期 / 货币断言不变。不能宣称该次QA的所有断言逐字未变，也不能把受控workerd3项称作公开提供方实读。

## 4. 最新本地回归及原合同

| 集合 | 当前实际结果 | 计数说明 |
| --- | --- | --- |
| 原34个Node命令 | **30退出0 / 4退出1** | aeris-dom、task21、p02-web、p02-dom非零；不是整组PASS |
| 标准JVM730 | **724 PASS / 6 FAIL** | 新OCR unit8已包括在内 |
| 原607 | **602 PASS / 5 FAIL** | 原JVM588=585/3；Node13PASS；Chrome6=4/2 |
| 受保护681 | **675 PASS / 6 FAIL** | 重叠视图 |
| P04 native方法 / 本地新增视图 | 49 PASS / 25 PASS | 均与730重叠，不能累计 |
| 原样冻结608 | **549 PASS / 8 FAIL / 28 EXPECTED_RED / 23 NOT_TESTED** | 原fixture、驱动和oracle保留 |
| 当前版本化合同608 | **555 PASS / 8 FAIL / 22 EXPECTED_RED / 23 NOT_TESTED** | 6项驱动传参差异不覆盖原样结果 |
| P04原18 | **18 PASS**；原样仍 **12 PASS / 6 EXPECTED_RED** | 同原fixture / oracle的两个独立执行 |
| P03原26 | **4 FAIL / 22 EXPECTED_RED，0 PASS** | 原业务真值不变 |
| P03重叠63 / 41 / 99 / 79 | 63为58PASS / 4FAIL / 1NOT_TESTED；41、99、79各全PASS | 不累加 |
| 已有新增38 | 38 PASS | 不替代原26 |

原18的6项差异是D004 / D008 / D016 / D020补传fixture声明的default_currency并使用policy2，及两项DOM补传声明的synthetic_rate=7 / date并走protocol2与真实产品FX/D1引用。未改输入或checkExpected、/800/与/200/货币oracle；其余12项原驱动已PASS。逐行见 [currency-18.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/currency-18.json) / [input-integrity.json](../migration-evidence/finance-p04/closure-current/final-current/delivery-current-r2/input-integrity.json)。

| P04专项本地集合 | 结果 |
| --- | --- |
| HTTP / D1 | 39 PASS |
| migration_restore / default_review_migration | 12 PASS / 8 PASS |
| default_review / unit_review | 11 PASS / 19 PASS |
| Chromium | 18 PASS |
| raw_transport | 36 PASS |
| exact_money | 76 PASS |
| independent_Decimal_oracle | 219 PASS，含216向量和3边界 |
| simulated_FX / live_FX | 22 PASS / 12 PASS，范围分开 |

以上方法、行、向量、脚本与重复轮次不相加。细节由D/summary及其引用的final-current原始执行文件支持。Android组合命令exit1，--continue实际完成lint（0 Error/Fatal、86 Warning / 12 Hint）和Debug构建；不能把有APK当作6个JVM失败已解决。

## 5. 原失败与QA错误继续披露

原607五个FAIL包括两个原无币种Chrome显示断言和三个原无币种前提JVM；标准730另有三个身份生命周期JVM失败。旧默认CNY前提与policy2合同冲突有解释，但原断言未被删除、原FAIL未改PASS。G-REUSED-014从PASS变FAIL，collector在delivery-current-r2已把继承actual修正为当前JUnit的FAIL；旧汇总保留。E004 / E007 / E008的0.01完成 / 方向文本语义也仍FAIL。

P03原26保留4FAIL / 22EXPECTED_RED；C005原80+90=17000实际8000，C007原17000实际0。可靠账户 / 独立操作 / revision / 前驱证据不足，不能猜测合并或虚构凭证。逐行原值、标准六FAIL、607五FAIL及608八FAIL的对应关系见 [失败与范围台账](FAILURE_AND_SCOPE_LEDGER.md)。

QA失败也未隐藏：首次部署误绑定既有共享Preview，审计发现本轮3次登录audit；stdin exec-in写成空文件后改shell -T；NativeHosted无效device ID改DeviceIdentityStore；r2超长provider_reference被拒；Gradle R-def缺缓存后freshTasks恢复；projection首次Windows ESM路径未运行断言，改file URI后r2PASS；collector变量遮蔽KeyError和G继承actual错误均已修正汇总而保留旧版。HostedFX provider名适配独立披露。原task21旧协议失败与补capability3的派生PASS并列，原legacy bridge seed失败、restore未执行继续NOT_TESTED。

## 6. 实际Samsung OCR与合成NativeCloud

| 最终源码相关证据 | 当前结果 | 边界 |
| --- | --- | --- |
| 新CurrencyOcrPipelineTest | **8 PASS** | 已包含标准730；E/ocr-unit-r1/junit对应XML |
| 原七bitmap实际SDK / 产品OCR | **6 FAIL → 1 FAIL → 0 FAIL**，最终7PASS | 2e1e224后仍有JPY二次确认失败，73764f7后解决；原金额 / 预期不变 |
| 同七向量30轮 | **30 × 7全部PASS** | 7个不同输入，210次向量执行，不当作210笔真实业务 |
| 新safety10 | **8 PASS / 2 NOT_TESTED；suite FAIL** | explicit-usd-eur-conflict和password-page-is-not-evidence缺“支付成功”OCR证据；拒绝null不能充完整PASS |
| NativeCloud r3 seed / restore | **各1 PASS** | 独立QA包 / 合成账户，实际Task20 / HTTPS、六币种各最小单位1、提交后丢ACK、跨进程重登录 / 精确Outbox重放 / 另账户不可见 |

NativeCloud原r1因app_device_id_invalid失败；原r2的6条请求均provider_reference_invalid，合成引用46字符超过现行40上限，服务端无对应事件。六请求保留未改。r3新独立数据集使用34字符有效引用，不能把旧r2改PASS。证据见 [seed-r3](../migration-evidence/finance-p04/closure-current/samsung-hosted-native-seed-r3.json)、[restore-r3](../migration-evidence/finance-p04/closure-current/samsung-hosted-native-restore-r3.json) 及同名日志；**该链不是微信**。

早期94ab0fc候选已有多项Samsung组件PASS，只对其原版本有效；其instrumentation无障碍绑定 / 通知监听各1FAIL与正常进程对照并存。历史Activity异常仍INCONCLUSIVE，D-01/D-02保持CLOSED。最终OCR组件证据不能自动刷新早期其他场景。

<!-- FINAL_DEVICE_RETEST_STATUS -->
最终 **73764f7** 的[组件复测](../migration-evidence/finance-p04/closure-current/samsung-final-components.json)已完成：登录1 PASS、既有三笔合成账冷启动重读1 PASS、Room迁移3 PASS、六币种持久化3 PASS、MainActivity三个Web表面及三次STOP/RESUME/recreate 1 PASS；[四组件冷备份](../migration-evidence/finance-p04/closure-current/samsung-final-backup-guard.json) seed/restore各1 PASS，QA币种偏好SHA原样恢复。最终[正常进程通知](../migration-evidence/finance-p04/closure-current/normal-notifications-final.json) PASS（4次投递/更新/重投、1次移除，0.086–0.410秒回调，实际Room归档、账目增量0），[生命周期矩阵](../migration-evidence/finance-p04/closure-current/samsung-final-normal-lifecycle-30-r1.json) **30/30 PASS，956–1158ms/轮**；这些都不是微信真实链。

最终smoke先有 **1 FAIL**（宿主受控采集gate此前已开启，与原smoke要求关闭的前提不符）；证据封存并仅关闭QA guard后，相同断言[重测1 PASS](../migration-evidence/finance-p04/closure-current/samsung-final-smoke-after-cleanup-r2.json)。原失败保留，后者只证明清理状态，不能声称全新安装默认值通过。最终[息屏检查1 FAIL](../migration-evidence/finance-p04/closure-current/samsung-final-normal-screen-r1.json)：正常唤醒后secure keyguard仍在，原20秒检查未通过；所有者正常解锁后[观察MainActivity RESUMED](../migration-evidence/finance-p04/closure-current/samsung-post-owner-unlock-observation.json)，不把原失败改PASS、不绕过认证。完整组件与历史对照见 [Samsung与微信附录](SAMSUNG_AND_WECHAT_ACCEPTANCE.md)。

[手机数据封存](../migration-evidence/finance-p04/closure-current/phone-final-data-seal.json)已通过：安装APK SHA与候选一致，QA冷数据5,658,112 bytes、SHA-256 `5dacd2735284a15dd94cc968b8270a4741601ce594c3ecf4915d3fe1b5a127a8`；8份指定微信详情密文有恢复校验，未导出明文密钥或正式App数据。卸载、敏感权限撤销与正式权限恢复结果在第9节单列；不由封存PASS推定。

## 7. 真实微信仍未闭环

所有者指定的既有CNY ¥0.01转账已由本人领取。最终OS metadata分别稳定于user0/user95，对QA截图执行完整产品OCR均为 **CNY / amount_minor1 / INCOME / completion=true**，probe均 **0 ledger**。但QA使用UiAutomation全屏截图/根节点，产品API34使用窗口截图；**截图层profile归属NOT TESTED**。标为分身probe的结果与付款角色声明冲突仍 **INCONCLUSIVE**，不能确认为产品方向缺陷，也没有足够对照确认QA跨profile缺陷；需先补截图/窗口/账户来源关联。

没有可信独立operation、provider reference、原始交易时间 / revision / 前驱证据，不能用同额同状态跨profile合并、再造两笔收入或付款方支出，也不能把completion字段等同完整转账凭证。真实通知→ticket→Room / Outbox→Hosted回执→同事件三页尚未打通，**W01–W10 0/10完整PASS，完整链路均NOT_TESTED**。合成NativeCloud和bitmapOCR只证明各自范围。没有新增付款、领取或消息；私人材料保持受限，报告不收录金融明文。详见 [真实微信逐项状态](SAMSUNG_AND_WECHAT_ACCEPTANCE.md)。

## 8. 数据库、回退与Production门禁

Room主库14→15保留旧单位事实，15→16新增决议列；FX / 人工币种决议库v1含不能丢的manual decisions / source units / default preferences。D1 0031 / 0032 / 0033为增量，Task16元数据5、Task21为9。合成迁移 / 中断回滚 / 重试、旧opener拒绝降级、四组件一致备份恢复和本地Miniflare105表二进制副本均有独立证据。

只能在同 / 更高兼容版本恢复同一账户 / 时点的完整一致四组件备份；缺件、错账户或hash错误拒绝。Git回退不是数据库回退，不允许旧APK读取升级库、清库或以旧快照丢弃升级后账目。真实个人备份、正式App原地升级、Production备份 / 迁移 / 恢复仍NOT_TESTED。详见 [数据库恢复与兼容性](DATABASE_RECOVERY_AND_COMPATIBILITY.md)。

**Production = HELD。** 本轮独立Hosted合成库不等于共享Preview、正式D1/R2或正式数据；参考率读取不等于支付凭证。没有凭本地 / Hosted / Samsung组件结果放行正式签名、Stable、正式APK或Production。CI / RC-6 / 真实业务门禁独立保留，见 [RC-6与Production门禁](RC6_PRODUCTION_GATE.md)。

## 9. 清理、正式状态与最终封存

<!-- FINAL_CLEANUP_AND_SEAL_STATUS -->
清理与正式权限恢复已实际完成：[手机清理](../migration-evidence/finance-p04/closure-current/phone-cleanup-r1.json)仅卸载4个owned APK并撤销QA敏感授权，[读回](../migration-evidence/finance-p04/closure-current/phone-after-permission-restore-r1.json)确认正式无障碍 **TRUE**、通知监听 **FALSE**、版本1.3.37/code50，QA包已无；49个精确owned手机临时dump已删。最新owned D1 [备份/恢复](../migration-evidence/finance-p04/closure-current/cloud-final-backup-r2/result.json)105表/19合成账/25财务回执/6通知回执精确相等、外键0违规后，[删除](../migration-evidence/finance-p04/closure-current/cloud-cleanup-r2/result.json)owned Pages项目（4部署）及2个独立D1；正式和共享D1仍在，owner Wrangler keyring保留。

Windows508个重建缓存entries共12,106文件/1,244,107,990逻辑字节，以及5个owned合成Chrome profile共1,701文件/227,764,551逻辑字节已删除，总 **13,807文件 / 1,471,872,541逻辑字节**。源码、原失败、APK、SQLite/必要备份、受限证据保留；不承诺物理磁盘释放量。共享Preview3条失败audit作为事故证据保留。详见[清理报告](CLEANUP_REPORT.md)、[最终证据索引](FINAL_EVIDENCE_INDEX.md)。最终13组保护已PASS（E/protected-final.comparison.json，无added/missing/changed，8个Git工作树HEAD/branch/status相同）；最终Git SHA和总manifest记录于 `E/FINAL_DELIVERY_PROVENANCE.json`。

P04仍受原合同红项、原回归失败、安全集未执行项和真实微信来源/角色未归因限制。最终设备已执行范围按上文记账，清理/正式状态核验按实际后续证据更新；当前不宣布整体COMPLETE，Production继续HELD。


清理保留例外：`qa/finance-p04/closure/__pycache__`的最后删除被自动审批拒绝（仅`blocked by policy`，无具体理由），命令未执行、未换方式重试，故小型pyc缓存仍保留；见E/cleanup-policy-rejection-final.json。不得称零残留。

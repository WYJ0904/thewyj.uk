# FINANCE-P03 最终统一报告

2026-10-21，Asia/Hong_Kong。**PARTIAL；尚不具备完整关闭 P03 或进入 P04 的条件。**

本轮从 `1e04945d1964c0e6a9420b0aff99011001f4ab98` 继续同一个 P03，完成所有当前合法、可独立执行的调查、两处最小产品修复、新增回归、Samsung 合成链路、迁移/恢复与清理。原 28 条 P03 红灯中 2 条实质修复，26 条仍未达到原业务目标；历史一次 Activity 生命周期失败仍 UNRESOLVED。安全隔离、重复通过、TEST-key 验签不等于真实业务完成。

前版全文保留于 Git `1e04945`、`finish/baseline-report.md` 和原封存。没有重启 P01/P02，没有把 P03 再拆成独立实施/审批任务，没有进入 P04/P05/P06。P01 仍仅为 2026-10-19 历史静态审计，当前结论以本轮代码与实测为准。

## 基线、提交与实际代码差异

沿用 `%USERPROFILE%/.codex/worktrees/finance-p03-identity-preauth/thewyj.uk`，分支 `codex/finance-p03-identity-preauth`；起始 HEAD、干净 tracked 状态及旧封存已核实。本轮**实施提交：`b69b701ee3e363e830d9e23ed189a21360f4aa9e`**。报告提交后的完整 HEAD/tree/干净状态由 [REVISION.json](../migration-evidence/finance-p03/finish/REVISION.json) 固定，最终逐文件校验由同目录 `provenance.json` / `validation.json` 固定，避免让报告自引用其自身提交哈希。

产品只改 2 文件，56 行增加/13 行删除：

| 文件 | 可复现问题与最小修复 |
| --- | --- |
| `js/finance/app.js` | 显式旧 `pending_authorization` 被作为 expense 统计；解除行在 normalization 丢失。保留 payment_state/provider_reference/原 ID/金额，控制行不计正式汇总、活动历史、月份、预算及分类；全部状态审计可见“不计收支”。阶段变化进入缓存签名。 |
| `functions/_lib/task21-provider-evidence.mjs` | 合法 SDK 的 app-scoped `payer_open_id` 被固定 user-ID 读取拒绝。可信策略显式选择 user_id/open_id，核对选定签名字段，OpenID 另设命名空间；旧 user-ID/微信 scope 字节兼容，未知类型失败关闭。 |

精确补丁为 [product-diff.patch](../migration-evidence/finance-p03/finish/product-diff.patch)。Android 产品源、Room14、D1 历史/增量迁移、识别完成门槛、90 秒票据、金额识别/确认策略与既有 RC 保护没有改动。没有修改正式包名、版本、签名配置或正式安装。

旧授权 outbox 处理：给已证控制操作保留持久隔离标志、**原结构化 payload、operation ID 和队列项**。仅在队列副本增加服务端既有严格 allowlist 会拒绝的 payment_state 标记；其他合法操作继续按顺序排空，隔离项明确报待核实，不无限循环、不假 ACK、不重新生成正式支出。后来的人工修改不重放旧 held payload。证据不足的普通旧 expense 不按金额/商户/引用猜测或批量改账。

QA 新源码在 `qa/finance-p03/finish/`：独立回归、精确输入追踪、迁移、普通 Activity 对照、生命周期/主线程探针、normal-mode 通知驱动、正常 Settings UI、安装防陈旧产物保护、导出/清理/封存。旧 QA、P02 输入/断言和历史失败未改。完整源码列表与 SHA 见 provenance。

## 本轮自动化实测

证据选择及逐项结果：[最终统计](../migration-evidence/finance-p03/finish/delivery-phone-final/summary.json)、[JVM681](../migration-evidence/finance-p03/finish/delivery-final/jvm-681.json)、[新增38](../migration-evidence/finance-p03/finish/delivery-final/new-38.json)。离线 `delivery-final` 是当时设备尚未连接的快照，原样保留；后续手机结果在 `delivery-phone-final`，不以历史结果充当本轮 PASS。

| 集合 | 本轮实际结果 | 计数与覆盖边界 |
| --- | --- | --- |
| 原607 | 607 PASS / 0 FAIL / 0 SKIP | 原588 JVM + 13 Node + 6 DOM，原身份清单核对；Node/DOM 在最终 JS 修复后重新执行 |
| 标准JVM | 681 PASS / 0 FAIL / 0 SKIP | `final-source-full-junit`，95 suites；与原588及下列集合重叠 |
| P03既有集合 | 63/63、41/41、99/99、79/79 PASS | 不相加冒充不同测试；最终选择和原身份清单保留 |
| 本轮新增 | 38/38 PASS | 15 JS投影 + 10实际Chrome DOM/合成传输 + 8 TEST-key提供方单元 + 5 JVM方法 |
| 四组跨JVM/真实文件/HTTP/D1 | 全部 PASS | legacy/clearing/correction/unified，分别9/15/34/35次请求，含提交后503丢回执、重启、重放与原ID |
| Miniflare闭库二进制复制/重开 | PASS | 98表及sequence完整比对；`native-persist-2/result.json`，不是正式云备份 |
| 产品 Android Lint / Debug | PASS / PASS | 85 Warning、12 Hint，0 Error/Fatal；正式签名未使用 |
| 冻结608逐行 | **538 PASS / 7 FAIL / 40 EXPECTED_RED / 23 NOT_TESTED** | 原输入、原预期、原断言保持；仅两条 CW 原红灯转绿 |

新增38包括：授权/解除/过期不产生正式支出、原ID/金额/来源保全、退款/收入不变、真实浏览器预算/分类缓存、durable隔离/其他写排空/无重试死循环、实际旧1e JS writer失败关闭、人工后继不重放旧 payload、OpenID精确选择/命名空间/签名字节、Room四旧版本升级及整条迁移中断回退、C005/C007与24个A输入的实际 hook 追踪。追踪安全断言 PASS **不能**把原业务红灯变 PASS。

冻结 P04 的18条货币/汇率 EXPECTED_RED、P05 的 E004/E007/E008 三条 FAIL 均保留。F001–F015 模型/consent 集成及8条边界仍 NOT TESTED。边界行沿用冻结 `NO_DEVICE_NO_PRODUCTION` 文本，它不是当前设备未连接的陈述：本轮仅验证了下述受限 Samsung 子集，未满足整条多来源/真实业务/安全窗口/完整降级合同，故不擅自改绿。所有47条 FAIL/EXPECTED_RED 原错误及期望/实际见 [冻结608](../migration-evidence/finance-p03/finish/delivery-final/frozen-608.json) 和 [失败账本](../migration-evidence/finance-p03/finish/delivery-phone-final/failure-ledger.json)。

## 28条P03原红灯逐项结论

每项原输入、实际值、完整原错误、分类与恢复条件见 [case-analysis-28.json](../migration-evidence/finance-p03/finish/case-analysis-28.json)。**已解决2；未解决26：4 FAIL、22 EXPECTED_RED。** 没有将原合同冲突静默改成“预期拒绝已通过”。

| case | 旧状态 → 本轮状态 | 责任/处理 |
| --- | --- | --- |
| A009 | FAIL → FAIL | 零间隔同 slot/body/postTime；oracle-only 新事件标志不在产品输入，独立两笔无从证明 |
| A011 | FAIL → FAIL | 零间隔同 slot/body/postTime；oracle-only 新事件标志不在产品输入，独立两笔无从证明 |
| A021 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A023 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A069 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A071 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A117 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A119 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A165 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A167 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A201 | FAIL → FAIL | 零间隔同 slot/body/postTime；oracle-only 新事件标志不在产品输入，独立两笔无从证明 |
| A203 | FAIL → FAIL | 零间隔同 slot/body/postTime；oracle-only 新事件标志不在产品输入，独立两笔无从证明 |
| A213 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A215 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A261 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A263 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A309 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A311 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A357 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A359 | EXPECTED_RED → EXPECTED_RED | 同活动 slot/body、无 message/ref/version；延迟或重启不能证明两次独立交易 |
| A393 | EXPECTED_RED → EXPECTED_RED | 移除后 postTime 改变不足以证明同一交易；不能强合并为一笔 |
| A395 | EXPECTED_RED → EXPECTED_RED | 移除后 postTime 改变不足以证明同一交易；不能强合并为一笔 |
| A405 | EXPECTED_RED → EXPECTED_RED | 移除后 postTime 改变不足以证明同一交易；不能强合并为一笔 |
| A407 | EXPECTED_RED → EXPECTED_RED | 移除后 postTime 改变不足以证明同一交易；不能强合并为一笔 |
| C005 | EXPECTED_RED → EXPECTED_RED | 同一字面家族/零 revision；独立 Capture、修正、重投无法消歧，8000 ≠ 17000 |
| C007 | EXPECTED_RED → EXPECTED_RED | 无可靠生命周期引用；保留三源事件/待核实，0 ≠ 17000 |
| CW-AUTH-POST-RELEASE | EXPECTED_RED → PASS | 产品缺陷已修复；原授权/解除排除于正式收支，原行与 outbox 保留 |
| CW-HOLD-ONLY | EXPECTED_RED → PASS | 产品缺陷已修复；原授权/解除排除于正式收支，原行与 outbox 保留 |

A24 冻结入口直接调用核心 coordinator，绕过实际 `AndroidPaymentRecognitionHook`；本轮另对**同一原输入**执行真实 hook，全部为0未经证明的正式账并保留 pending 候选。原冻结核心记录数仍分别是1而非期望2，或2而非期望1；完整两条路径分开记录于 `traces-final/A24-input-and-hook-traces.json`。通知实例、移除和 postTime 只能说明投递，不能证明金融操作；`new_event_evidence` 是夹具真值标志，没有随产品输入传入，不能在实现中读取 oracle。

C005 完整逐步解析/Room各表见 [C005追踪](../migration-evidence/finance-p03/finish/traces-final/C005-trace.json)：USD200 授权不入账；USD80 Capture 入账；同家族、同字面操作引用、revision0 的 USD90 留待核实，原因 `reference_money_or_instance_conflict`；release 解析为 CLOSE，源事件仍在，不能把文本200误施加为已证数值解除200。最终8000分，原17000分目标未达。第二事件可能独立 Capture、金额更正或重投，没有可靠前驱/版本可选其一。

C007 [逐步追踪](../migration-evidence/finance-p03/finish/traces-final/C007-trace.json)保留全部三源行及候选，`lifecycle_reference_missing`，正式支出0而原期望17000。未用带独立引用的安全替代样本改写原真值。冻结诊断字段 `lifecycle_model_implemented=false` 是按字段名反射的粗探测，不是状态机不存在的断言；实际表/方法与测试另证。

恢复合同：需合法同账户/发行方/来源实例的独立操作引用，或完整前驱与精确 revision 证明；多正式ID消解还须完整受影响集合。否则保留原源/候选、账ID、回执、关系和明确隔离理由，允许显式人工核实；人工拒绝/编辑优先。**这是可审计隔离，不是独立交易业务支持。** 若所有者希望接受更窄自动化合同，须另行明确决定，当前原验收标准未变。

## 清算状态机与真实提供方边界

既有实现及本轮回归继续分开 A授权、C已清算、R已解除、H剩余冻结、F累计退款、N净正式支出；授权不是正式支出。独立 Capture 可多次/部分、与授权额度不同；可信最终清算允许超出原冻结并保留 over-capture，H不为负，不默认A=C。部分解除不超过已证剩余，明确关闭/过期关闭余量，累计退款不超过清算；乱序依赖、迟到回执、重复投递/进程恢复保留并按证据处理。修正/重归属同时验证旧新家族、账户/来源/操作角色/前驱/版本；多ID消解保留原ID、原金额、回执与替代历史，不伪造退款或覆盖较新人工决定。

商户提供方入口仍为**只读验签事实**：微信精确签名原字节、APIv3 AES-GCM、商户/App/付款方绑定；退款区分 payer_refund 与 gross，并保留原交易/退款引用。支付宝精确签名响应与已持久请求 auth_no/operation_id/out_request_no 绑定，显式 payer_user_id 或 app-scoped payer_open_id，信用授权不冒充现金冻结。本轮真实可证字段缺失已修复，但两者仍 `revision=null`、无前驱、`can_authorize_correction=false`，没有公开自动授予修正权限。

核对的主来源：[支付宝官方SDK响应字段](https://raw.githubusercontent.com/alipay/alipay-sdk-java-all/master/v2/src/main/java/com/alipay/api/response/AlipayFundAuthOperationDetailQueryResponse.java)、[微信官方SDK验签说明](https://github.com/wechatpay-apiv3/wechatpay-java/blob/main/README.md)、[退款通知DTO](https://raw.githubusercontent.com/wechatpay-apiv3/wechatpay-java/main/service/src/main/java/com/wechat/pay/java/service/refund/model/RefundNotification.java)、[退款金额DTO](https://raw.githubusercontent.com/wechatpay-apiv3/wechatpay-java/main/service/src/main/java/com/wechat/pay/java/service/refund/model/Amount.java)。这些是静态字段/协议依据，非当前账户真实响应；SDK DTO 不是完整原始 wire，不能因 DTO 未列某字段取消原商户校验。查询/通知时间与aggregate balance不能代替绝对操作revision或前驱。

没有合法商户凭据/真实授权样本，消费者App不能凭空访问商户API；没有伪造官方凭证或用 TEST key 给正式自动修正授权。本地可搭建的沙箱、验签/拒绝/账户隔离已执行，不再反复索要所有者已明确不存在的材料；真实消费者关联与更正仍 NOT TESTED。

## Samsung实测、宿主差异与历史生命周期FAIL

设备每次操作前核验唯一 Samsung SM-S9360、Android16/API36、主用户0。未创建用户/工作分区。隔离目标 `uk.thewyj.app.qa.financep03finish`，测试 `.test`；正式1.3.37/code50及其签名保留。QA证书SHA-256 `9ea45db6e2c398de90ce61affd145e432d63d0d1724dd6447ba4ba24193f4fac`，与正式不同。

最终实装/清理前公共APK逐字验证：

| 派生APK | SHA-256 |
| --- | --- |
| QA，83,107,165 bytes | `87fd5fe6b34294b9402566b0e5824a1332458d70c45d3ea5fa78da52126f5921` |
| AndroidTest，2,836,920 bytes | `ce840f98842f84345e32a6c3108633422ff7e8ef5154a8442a5a9d517e53dd74` |

规范副本在 `finish/artifacts/phone-maintenance2/`。124份产品 Android 源实读hash，MainActivity字节不变；3份生成副本仅有隐私门：NLS在extras前仅放行自有QA/shell且FINANCE_P03_ tag，仅已知key回放，不观察MediaStore；无障碍在私有来源树访问前拒绝，截图能力关闭；WebView只访问loopback。QA manifest移除SMS/媒体/安装权限，无shared UID/AutoBackup，TLS仅App内CA，不写系统信任。精确生成源码ZIP/覆盖ZIP/CA在 `artifacts/exact-qa-inputs`，最终manifest/hash在 `qa-generation-final.json`。

最早手机合成登录/完整原生账本/迁移/单测使用前一个同产品源QA构建；最后只调整独立命名空间/服务标签和QA诊断辅助。最终87fd/ce840对执行了下述30组矩阵、独立30轮、息屏、普通后台和normal-mode通知/绑定，所有构建/安装记录分别保留，**不把不同派生APK混称完全同一宿主**。实际产品Web JS均由同一最终本地服务提供；没有正式签名候选。

| 本轮真机项目 | 结果与实际边界 |
| --- | --- |
| 仪器化方法执行 | **198 PASS / 0 FAIL / 0 SKIP，13个方法身份**，含重复；不与607/JVM相加 |
| 原始连续六方法矩阵 | **30组/30组 PASS，180方法执行**，每组含3迁移+NLS+真实MainActivity页面/生命周期+Room/Keystore恢复；约18.8–20.8秒/组，无PC watchdog终止 |
| 普通Activity对照 | 两个QA元数据版本各30轮stop/resume/recreate，总60轮；最后固定APK30轮PASS |
| 产品MainActivity | 两次独立各30轮，原页面用例31次×3轮；总153个带断言轮次。最后固定APK独立30轮+连续矩阵90轮，全部PASS |
| 普通opaque自有Activity前后台 | 两次各5轮，共10轮，最后固定APK5轮PASS |
| 实际息屏/亮屏 | 1方法PASS，实际off/native恢复RESUMED；所有者既有延长解锁，仅执行一次普通滑动，无凭据输入/策略更改；原20秒检查不变 |
| 原生账本→Room/outbox→认证HTTP→本地D1 | PASS，typed synthetic授权200、独立Capture80+90、解除30、退款20，3正式行/净150/冻结0；含断网503及提交成功回执丢失。不是官方通知或真实支付 |
| 原生MainActivity/WebView金额 | 正式合成支出170、退款20、余额-150、历史80/90/20，首页余额负号与金额一致；全部WebView调用在UI线程 |
| Room/Keystore恢复 | 显式本QA force-stop与重新打开后原ID、outbox及凭据保留；不是系统LMK |
| 仪器化之外OS通知矩阵 | **先0 PASS/8 FAIL，普通启动后8/8，修正驱动后8/8**；所有失败保留，10秒回调期限不改 |
| 普通后台/显式重启新key | 先1 PASS/1 FAIL，补齐normal启动前置后2/2 PASS；自动系统重启与未知key积压回放仍NOT TESTED |
| 无障碍普通绑定 | 直接normal Settings后enabled=true、connected=true、截图0；仪器化设置助手此前“enabled但未绑定”的失败观察保留。真实支付页/识别NOT TESTED |

完整执行身份/重复列表：[physical-attempts](../migration-evidence/finance-p03/finish/delivery-phone-final/physical-attempts.json)、[unique-methods](../migration-evidence/finance-p03/finish/delivery-phone-final/unique-methods.json)。所有198方法通过不等于所有真机观察通过：OS矩阵累计16 PASS/8 FAIL；后台/重启外部脚本累计3 PASS/1 FAIL；维护失败另列，不隐藏。

新通知异常的受控证据：三次同APK序列“普通运行新key有回调→原Restore仪器化→receiver-only rebind下10秒无新回调→正常打开本QA再rebind恢复新key”全部复现，原生 stopped 位始终false。见 `nls-instrumentation-boundary/runs.json`。**确认了QA普通模式前置状态不足，未确认Android底层绑定内部机制，也不是产品日常自动恢复已经失效的证明。** 只补QA启动/绑定准备，不改产品；3个诊断缺席不计业务PASS。仪器化设置助手同样不再用于grant tap，host guard拒绝此动作，改为普通Settings节点/坐标的外部正常点击；没有ADB secure-settings写入、pm grant、Root、安全策略或硬件加速降级。

历史最终矩阵仍保留**23 PASS/1 FAIL**：请求RESUMED而最后STOPPED，109.113秒自行退出，原失败瞬间没有有效自身栈。本轮取得9754条探针事件、104次主/仪器化线程采样，健康样本主线程heartbeat最大248ms，没有新的同类失败或Renderer阻塞样本；不能以这些健康栈倒推历史原因。最终固定APK30组全部通过，但与历史相比包、QA探针、锁屏/延长解锁和窗口条件不严格等价，**根因仍INCONCLUSIVE/问题UNRESOLVED**，没有猜测驱动或擅改生命周期。

实际依赖 `androidx.test:core:1.7.0` AAR hash `f4dacd8edceeec48e0c76ecf28339b28f4b4f6b74f8e34e9e59b472c27d9eb81`，缓存二进制反编译证实stop/resume通过辅助Activity及FINISH_EMPTY_ACTIVITIES广播协调；这只是机制证据，不是上述一次失败的因果证明。原断言、20秒页面检查及SDK等待均未延长。精确每轮耗时/堆栈/限制见 `lifecycle-analysis.json`、`framework/`、`phone-evidence-before-cleanup/`；原1次FAIL仍引用 `device/device-final-native-suite.log`。**D-01/D-02保持CLOSED**，本轮额外P03失败未无证据归咎或重开历史故障。

## 迁移、备份、旧写端与安全回退

Room使用精确导出schema9/11/12/13→14：Robolectric实际SQLite核对原账ID、金额、outbox、无孤儿/重复；9→14链在13→14注入异常，事务回到9，重试14成功。闭库Room+outbox成对复制可恢复，旧9 opener失败关闭。Samsung实际验证schema9→14、中断回滚/重试、闭库副本及旧opener拒绝。旧Room11/12/13与D1增量链、中断重放/重复DDL无损拒绝、原回执/journal/sequence均重新通过；旧75e6561 Task16/21写端503检查仍通过。完整旧正式APK访问升级后的正式数据库仍NOT TESTED。

新隔离旧授权队列另用**实际旧1e前端**搭配当前真实server allowlist的合成浏览器传输验证：标记后的upsert拒绝且pending原ID保留，原payload另存；不据此宣称全面兼容降级。旧JS可能丢新本地metadata、旧显示逻辑仍错误；未逐一证明旧delete/restore写端合同。**不批准原地降级，不把Git回退当数据库回退。** 不清库、不重建用户数据、不删除旧正式账。

正式公共APK的Room委托schema9 identity hash已有原封存匹配；本轮再次核对公共APK哈希/版本不变，但没有读取正式私库实际user_version/内容或合法完整正式备份。当前本地后端独立合成账户，最终1838次请求，关闭后仅保留28张纯合成财务表33行/3笔账；过滤导出SHA `a72a552a423584e9806f80154a9501592d98a5ba8e850d1423fb41079d65a882`，排除认证表/密钥。98表Miniflare二进制恢复与这份合成导出，均不冒充Cloudflare Production备份/Time Travel或真实账户恢复。

正式部署/降级继续阻断。可执行前置合同：在单独授权下停止所有写入口，记录在途事件与outbox水位；闭库取得一致Room+outbox及对应D1恢复点，保全原ID/回执/替代关系/迁移版本；独立恢复目标核对余额、孤儿、重复、序列和写入幂等，再验证旧实际APK失败关闭。若回退快照会丢失升级后写入，先取得差额保全与可审计重放，不能直接退Git/覆盖私库。缺少这些证据，不允许正式升级或降级。

## 命令、失败保全和隔离核验

命令及退出码均在 `finish/*-run.json`、`regression-commands.json`、`extra-commands.json`、`frozen-node-release-commands.json` 和原生 `.log`，源驱动提供完整参数。关键可复核入口如下（现有目录故意拒绝覆盖，**不是让交付后自动重跑**）：

```text
python qa/finance-p03/finish/prepare-runners.py
pwsh -File qa/finance-p03/finish/run-regression.ps1
pwsh -File qa/finance-p03/finish/run-extra.ps1
pwsh -File qa/finance-p03/finish/run-frozen-node.ps1
node --import ./qa/finance-p03/finish/output-redirect.mjs qa/finance-p02/web-contracts.mjs
node --import ./qa/finance-p03/finish/output-redirect.mjs qa/finance-p02/web-dom.mjs
node qa/finance-p03/finish/legacy-controls.mjs
node qa/finance-p03/finish/legacy-browser.mjs
node qa/finance-p03/finish/provider-identity.mjs
python qa/finance-p03/finish/repeat-phone.py
python qa/finance-p03/finish/screen-phone.py
python qa/finance-p03/finish/notification-matrix.py --name notification-os-after-harness-fix
python qa/finance-p03/finish/notification-recovery.py --name notification-recovery-after-normal-start --prepare-normal
python qa/finance-p03/finish/collect-phone.py
```

最终Gradle精确参数见 `final-source-full-run.json` / `build-phone-maintenance2-run.json` 及trace/bridge各run文件：绝对init路径、隔离build/source输出、`:app:testDebugUnitTest :app:lintDebug :app:assembleDebug`，设备另编译`:app:assembleDebugAndroidTest`，仅localhost QA origin。冻结原非零退出、首轮红灯、新增红→绿和所有JUnit XML/NDJSON完整保存，不修改预期。

本轮修正的执行夹具错误也保留：初次relative init路径和trace import/type编译错误、原worker试图使用已存在目录被保留门拒绝、浏览器缺appShell导航失败、APK构建产物被后续输出替换导致的检查失败、QA标签资源重复编译失败、一次错误外层命令复制旧APK被明确标记STALE、restore日志名称冲突测试前BLOCKED、Settings focus查询范围错误。最终构建/安装新增双重guard，非零build或缺当前验证不能安装陈旧APK。它们不算产品PASS，也未删除。旧服务标签构建的失败XML与旧产物状态在 `artifacts/phone-service-label/`；真实产品回归、QA诊断/维护及冻结EXPECTED_RED分别统计。

保护校验 [protected-final.json](../migration-evidence/finance-p03/finish/protected-final.json) 对13组主工作区/Task26/Hotfix/D01/D02/候选/P02及raw比较全部通过；旧设备封存51个源码/报告条目、674个raw条目重新核验，唯一允许更新的是本统一报告，旧字节在baseline-report及Git保留。旧provenance SHA `50d10918661a705c14ecaa62cc336d2eedc13bfca81d52ca7b63501313a9b1c2` 未改。Task26原豁免仍是豁免，不标PASS。

## 清理、停止与剩余条件

按所有者本轮明确授权已清除**本任务**手机痕迹：新独立QA目标和测试包，以及精确hash匹配旧P03的 `.debug.p03acceptance` 共3包，仅user0；46个自有shell tag均实测removed，5个未观测原key的已知自有slot仅为清理重投再取消。QA active集合为空，其他QA及其UID原样保留。没有清理其他任务QA、正式App或私人通知。临时Settings XML逐个删除，ADB reverse19443移除，未创建工作资料/用户/分区。见 [phone-cleanup-final.json](../migration-evidence/finance-p03/finish/phone-cleanup-final.json)。

正式公共APK SHA `9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a`、1.3.37/50、lastUpdateTime 2026-10-10 15:24:26和UID10406未变。没有读取、导出、迁移、删除或写入正式私库；正式内容“完全未变化”因未读私库而明确NOT TESTED。正式通知监听保持所有者先前手动暂停的off状态；工具没有恢复该正式授权，避免触发私人通知采集。若需恢复正式使用，应由所有者按正常设置处理。

手机证据在卸载前仅从固定自有文件allowlist导出；所有账户/事件均为自建合成。电脑清理先逐路径盘点与边界/非reparse/大小校验，再删除本轮可重建build、生成源码、临时Chrome profile、私有TLS key和合成认证runtime，释放逻辑字节 **657,516,295**；保留规范APK、精确源码ZIP、公有CA、全部失败/线程/迁移/JUnit及必要合成DB。没有删除旧raw、P01/P02、Task26或Hotfix。QA后端/捕获进程已停止，19443无监听；本地提交后工作树干净，最终复核见validation。

仍需要且无法凭空独立取得的最少外部条件：

1. 合法提供方/账户绑定、独立Capture/Refund及真实前驱/revision证明；或所有者明确接受哪些不可观测业务合同改为人工待核实。当前26条原业务目标不满足，不能自行改变合同。
2. 在隔离目标上的真实通知/支付页/RC-6历史来源与真实云链验收，以及合法一致正式备份、旧实际APK和云恢复授权。真实微信10次/支付宝/真实交易、本轮均NOT TESTED，未主动发支付、转账、退款或消息。
3. 历史额外生命周期FAIL的有效复现/失败瞬间诊断或明确所有者处置；30组新PASS不能给出其根因。自动系统LMK、未知通知积压恢复、正式库原地升级/降级也未验证。

本轮所有可安全独立完成的工程工作已交付。**P03维持PARTIAL，禁止据此进入P04。** 不推送、不创建PR、不合并、不正式签名、不执行Production迁移/发布；停止并等待所有者审核。

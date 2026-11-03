# FINANCE P03/P04/P05 统一续作验收报告

2026-10-25，Asia/Hong_Kong。**P03_STATUS=PARTIAL；P04_STATUS=PARTIAL；P05_STATUS=PARTIAL。**

本轮完成独立 P04 Preview 交付，实际修改并验证了 P03/P04 票据恢复和 P05 页面/OCR/生命周期代码。
真实 Samsung、真实支付提供方、正式账户/财务库及 Production 验收按所有者最新授权后置，未借此停止本地开发。
未将安全隔离、合成页面、模拟 Task 或单元测试当作真实支付证明，也未开启 P06。

## 1. 代码、工作树和部署

| 项目 | 本轮状态 |
| --- | --- |
| 实际财务工作树 | `%USERPROFILE%/.codex/worktrees/finance-p04-multicurrency/thewyj.uk`，沿用已有隔离checkout |
| 起点 | ce7c87ef3e23907577c0266bfcccc002bcebcd2c；存在的 Preview WIP 先保护、完成，没有 reset |
| 当前分支 | codex/finance-p05-page-ocr，由包含 Preview 的 4344221 本地提交分出；没有新建重复源码树 |
| 继承关系 | ce7c87e、P03的5d96e1e、D01的57b622e、D02的8c0de9c均为HEAD祖先；final-preflight.json实际Git验证 |
| 精确本轮最终测试源码 | `25142acb9a22c5293d5c3b8a7710c4bd418f477c`；Source manifest 前后相同 |
| 正式/主工作区 | e2febc6 Hotfix WIP 保留；Task25/Task26、D01/D02状态未改；最终保护结果见第8节 |
| GitHub main / Production | 74eadf589b0a6ffe1e5ab7a9564115891c4ef2dc；Pages 566292b3-3c7f-4ef5-93b5-6977e606c14a；只读元数据核查，无发布 |
| P04 Preview | https://owner-p04-preview.thewyj-finance-p04-preview.pages.dev/finance |
| Preview 不可变部署 | fa42e9b0-5027-40f1-9377-b0942aaeb857 / https://fa42e9b0.thewyj-finance-p04-preview.pages.dev/finance |
| Preview 精确源码 | 298d5057d7b4c7432e0625bb5c9297ba9243b6df；P05未部署到此环境 |
| Preview 产物树SHA256 | 127d1c0f1b35026f2617e3c2baa6a7ddb6d078e9450442cb870364215798a928 |
| Preview 独立 D1 | 941b465f-185d-42a3-9a11-0c959c11aea4；无Production/共享D1、KV、R2或AI绑定 |
| 正式Android | 未操作、未安装或迁移；历史正式1.3.37/code50不是本轮真机读回 |

独立 Preview 使用全新认证材料和普通 `p04-owner` 账户，仅独立库授予财务体验权限。
所有者明确接受独立登录；它不是正式账户认证或会员迁移。初始账本0，另一个validation账户有6条合成测试账。
11项实际HTTP合同/38请求PASS；5份关键运行资源与staging逐字节相同；浏览器实际读取六币种与0笔账目并显示完整SHA横幅。
实际下载 Pages 配置先核对D1后才登录。Feature flags7项全OFF、无owner preference/override，默认Stable，但P04仍可用。
P04并无通道flag；Experimental只能评估当前部署已有开关，不能创造未部署源码或APK。Production flags和schema只用SELECT读取，rows_written=0。
完整版本/旗标对照及原截图 URL/环境/DeploymentID/MIME/hash见 [Preview溯源报告](../finance-p04/EXPERIMENTAL_DELIVERY_RCA.md)。

当前Git注册工作树（财务外的工作树只读；本轮报告文档提交的最终HEAD与干净状态由FINAL_PROVENANCE.json绑定，避免报告自身SHA循环引用）：

| 工作树 | 本轮核查HEAD | 分支 |
| --- | --- | --- |
| `%USERPROFILE%/Desktop/编程/thewyj.uk` | `e2febc6d9a33997bd9dc4cb042ecff216d31fde4` | `codex/android-accessibility-accounting-hotfix` |
| `%USERPROFILE%/.codex/worktrees/aeris-d01-control/thewyj.uk` | `94f517792edd11bb4c4c744057717df472544626` | `detached` |
| `%USERPROFILE%/.codex/worktrees/aeris-d01-lifecycle/thewyj.uk` | `57b622e40e22573ec652f4dfa21e8cd62b36c0e6` | `codex/aeris-d01-lifecycle` |
| `%USERPROFILE%/.codex/worktrees/aeris-d02-webview-thread/thewyj.uk` | `8c0de9ca23ff8fd04c281a0a0bbbcee66d206384` | `codex/aeris-d02-webview-thread` |
| `%USERPROFILE%/.codex/worktrees/aeris-hotfix-acceptance-candidate/thewyj.uk` | `1398c76d9321919ac8c94550f2d23c2c8e1a1e84` | `codex/aeris-hotfix-acceptance-candidate` |
| `%USERPROFILE%/.codex/worktrees/aeris-state-consistency/thewyj.uk` | `f6a2ec787f47468b6c0565141a1e4d82cd41330b` | `codex/aeris-state-consistency` |
| `%USERPROFILE%/.codex/worktrees/finance-p02-tests/thewyj.uk` | `6ff9b9fd89bb6dedf5837f28421825c4418925f9` | `codex/finance-p02-tests` |
| `%USERPROFILE%/.codex/worktrees/finance-p03-identity-preauth/thewyj.uk` | `5d96e1ee5d2064076bd0efa59eed86edb9b1c4cc` | `codex/finance-p03-identity-preauth` |
| `%USERPROFILE%/.codex/worktrees/finance-p04-multicurrency/thewyj.uk` | `25142acb9a22c5293d5c3b8a7710c4bd418f477c` | `codex/finance-p05-page-ocr` |
| `%USERPROFILE%/.codex/worktrees/task26-wrong-review/thewyj.uk` | `6247c4148904cafa264204fc1816b2e8e1d4360a` | `codex/task26-wrong-review` |

本轮本地提交链（不含随后只封存报告/QA的最终提交）：

```text
e509ae27416f447fd3e1e4c5887a5ee5c994aaf8 test(finance): prepare isolated owner preview with build provenance
298d5057d7b4c7432e0625bb5c9297ba9243b6df fix(qa): validate supported Pages config in preserved staging revision
4344221f551d5b5caedc248266680cf9a1ba139c test(finance): verify isolated owner Preview delivery and blank ledger
e9f3c8d4316be22a15e210ae6f1c4ac504fd0190 fix(finance): preserve ticket evidence and harden page OCR lifecycle
35895d8ff870c269a7fcf25bd7f6ea1f785ff4cb fix(finance): retain pending observations and bound OCR task ownership
30f8e29f2c4e125b974a2b3ffb0a0c19cb6eb79a fix(ocr): distinguish metadata labels from merchant text
c11e49044105d4f6198e7779bc2545259acedeb7 test(finance): serialize final non-device validation and evidence capture
d75f971c314d6a6ebf9a6284842bd13279ae7a4d fix(ocr): retain line structure and qualified outgoing transfer evidence
25142acb9a22c5293d5c3b8a7710c4bd418f477c fix(ocr): preserve payment roles in independent second-scale verification
```

## 2. P03 非真机收尾

- **修复真实恢复缺陷**：票据Room恢复曾将币种硬编码CNY，并丢失完成、证据来源及来源不确定性。先以产品Room往返测试复现失败，再修正持久化。
- Room16→17增量保存上述事实与结构化待定金额；17→18增量保存扫描预算。旧票据缺失币种/完成证据不补CNY或完成状态，缺失扫描计数按预算已用完失败关闭。
- 原ID、原金额、回执、旧账、Outbox及人工更正保留；旧版本访问升级库拒绝，迁移中断回滚后重试不清库。
- A009/A011/A201/A203及其余A组、C005/C007未被金额、商户、相同文本/时间或通知槽位推测修复。
  C005原USD80+90的17000最小单位真值不变，当前8000；两次capture只共用授权ref，无独立操作/版本，不能判定第二次是新增还是金额更正。
  C007原USD17000真值不变，当前0；授权/清算/解除的reference均空，原fixture的reference_required=true保留，未拿有ref样本替换。
- 原26行当前 **4 FAIL / 22 EXPECTED_RED**，不是26个额外执行次数；原输入、断言和失败原件保留。
- 独立操作、账户/来源、revision及前驱证明充分的路径继续通过当前模型、Room、HTTP、D1及跨JVM恢复测试；缺失业务事实标 `EXTERNAL_EVIDENCE_REQUIRED`。
- 财务旧失败账本的Activity异常没有新真机归因证据，保留INCONCLUSIVE/DEVICE_REQUIRED，不以3轮模拟器覆盖旧FAIL；已独立关闭的D01/D02仍CLOSED，不重开或重新归因三星驱动。

P03非真机工程取得恢复修复及本地回归证据，**不使用完整非真机/整阶段COMPLETE**：原隐式CNY合同仍需正式处置，独立业务事实不能由代码伪造。

## 3. P04 六币种、FX及兼容性

六币种CNY/USD/EUR/HKD/GBP使用2位、JPY使用0位；原币最小单位、原ID、时间、人工决议与回执不由展示折算改写。
精确十进制/整数累计、HALF_EVEN最终单位舍入、同币种/正反/交叉引用、缓存/过期/离线失败、历史快照、混币不直接相加均按既有合同重跑。
原币/结算/手续费角色继续分离；未知单位进入明确待核实，不按1:1或默认人民币补事实。
服务端既有Frankfurter v2日参考适配器实际请求 `/v2/rate/BASE/QUOTE?date=YYYY-MM-DD`，无第三方密钥；本轮未接入新收费服务。
参考数据不是银行实际成交汇率。6小时缓存、8秒网络deadline、64KiB响应上限、币种对/日期/十进制校验保留；非交易日最多7天lag明确保存真实rateTimestamp。
并发请求按DB/币种对/交易日去重；不可变snapshot使用内容hash，缓存指针按fetchedAt安全更新，过期/缺失不伪造1:1；历史交易仍引用原snapshot。
Web首页、列表、详情、月度/分类、预算、手工新增/更正及待核实沿用原页面；六币种控件和隔离Preview的实际浏览器/HTTP验证见第1节。
Android CurrencyMoney/货币决议/Room/Repository/原生待核实/WebView桥按同一单位与回执合同验证；未在真实手机安装或宣称通知来源通过。
继承功能逐文件范围见[原P04统一报告](../finance-p04/FINANCE_P04_FINAL_REPORT.md)，本轮实际结果以本报告原始日志为准，未将旧报告PASS带入。

| 本轮集合 | 实际结果 |
| --- | --- |
| P04原18当前传参合同 | 18 PASS |
| 原驱动原样18 | 12 PASS / 6 EXPECTED_RED；不以派生PASS覆盖 |
| HTTP/D1 | 39 PASS |
| migration/restore | 12 PASS |
| default-review migration | 8 PASS |
| 实际Chromium | 18 PASS |
| 精确金额/独立Decimal | 76 PASS / 219 PASS（含向量，非219独立业务） |
| 模拟FX / 实际公开参考读取 | 22 PASS / 12 PASS，二者分别记账，不代表银行成交率 |
| 原始传输 / 人工单位决议 | 36 PASS / 19 PASS |

6个原样红项来自原声明default_currency或FX参数未进入旧驱动。版本化驱动只补原声明前提，未改金额/币种/fixture/oracle。
schema目标16→当前版本的QA适配单列，旧raw失败不删除；旧v11测试不得继续用当前实体生成带未来列的伪历史库，修正后与提交的v11票据19列逐一一致。
Git回退不是数据库回退；不能旧APK打开新库或丢弃升级后账目。四组件同一时点备份、错误版本/账户/缺件/哈希拒绝和实际冷恢复分别提供证据。
正式个人备份/正式迁移回退仍 `PRODUCTION_VALIDATION_REQUIRED`。**P04非真机状态PARTIAL**，不把原回归/原样驱动合同差异改成PASS，不声明P04_NON_DEVICE_IMPLEMENTATION_COMPLETE。

## 4. P05 正式产品实现

原合同入口为冻结P02的E组39行，尤其E004/E007/E008；原始输入与断言文件13项hash全部不变。
新增扩展合同为source epoch、持久扫描预算、SDK任务位图所有权、结构化未知单位观察与主体方向约束，均单独测试，不伪装为原冻结输入。

| 产品实现 | 可证范围及安全约束 |
| --- | --- |
| 页面状态 | 支付/付款/收款/退款/转账详情；已完成、待领取/待付款、失败；列表/历史/余额/推广/加载/密码/聊天。非详情阻断，金额不等于完成。 |
| 金额角色 | 原价/优惠/余额/手续费排除；实付优先；冲突金额拒绝。六ISO单位前后缀、JPY整数、0.01、全角数字/符号、小数精度、标准分组及decimal-comma精确处理。 |
| 无符号/分行 | 已识别转账详情与状态/时间标签下唯一0.01可成为候选。未决币种不生成最小单位，结构化decimal存Room，现有待核实页明确显示币种/单位待确认。 |
| 不确定格式 | 不补丢失小数点、不把646猜成648；二次不同刻度必须一致。歧义中文逗号、无角色/无可靠币种时拒绝自动记账。 |
| 整页语义 | 主判断读取完整页面语义；二次OCR只是动态文字区域校验。缺glyph的区域按整页语义索引定位，不固定屏幕坐标；时间/单号标签不当金额，商户手机店不当手机字段。 |
| 行结构 | OCR相同符号/状态属于不同节点时保留，禁止distinct去重后把两个金额塌成一个。 |
| 方向与完成 | 精确状态不被退款帮助污染；到账时间/扣款规则不证明完成；结构化转账至个人账户优先于泛化到賬成功；方向冲突保持未知。 |
| 主体约束 | 同一转账ref可能同时出现在付款与收款端；依赖ref解除profile不确定性时还需已捕获方向与页方向一致。未取得真实profile证明不宣称消解旧微信歧义。 |
| 待支付→完成 | 未完成证据留在原票据/原预算中；相同观察幂等，不重复补拉；同状态完成证据更新，同ID只记一账；旧回调拒绝，人工编辑优先且不自动确认编辑结果。 |
| 异步 | 同window内容revision失效旧截图/OCR；ticket/account/窗口校验保留；一个verifier完整两轮OCR互斥；旧结果及过期不写新页面/账户。 |
| SDK资源 | 每次等待上限10秒；SDK继续处理时只持有私有bitmap副本，原图可回收；迟到结果不应用，未完成task不继续排队。测试使用真实GMS Task原语和可控完成，不睡眠。 |
| 独立二次像素验证 | 真实ML Kit模拟器首次发现优惠50/实付648同时进入二次区域时旧实现拒绝。二次读取改用自己的完整语义排名与币种校验，不接收expected金额、不挑匹配值；冲突/错币种仍拒绝。 |
| 生命周期预算 | 原90秒、8次、250ms下限保持；读取前后台线程通过Room事务原子预留，进程重启/内存淘汰不能重置；旧库无计数按8次已用完。 |
| 原时间/关系 | 捕获时间不伪装交易日期。只有18:49不推断日期/时区；既有candidate时间/ID不由迟到OCR重写；不产生额外收支/FX账。 |

新增标准JVM方法 **37**，当前 **37 PASS**，已包含在总标准JVM，不能另加。
另增扫描恢复seed/restore共2个方法、分两个JVM各执行1个，PID为 `28260` / `25476`，预算8仍耗尽、原expiry不变；未算入标准767等JVM方法口径。
Robolectric/合成完整文本/Mock OCR/TCS证明规则与数据/竞态；这些集合**不是实际提供方凭证或真实SDK像素准确率验收**。
另行完成API36/Google API/x86_64独立AVD，WHPX可用；测试仅专属ADB端口5039的127.0.0.1:5581，USB不接纳、mDNS关闭。
图形后端为模拟器默认SwiftShader；没有关闭产品硬件加速，不能把其通过当作Samsung图形栈根因/兼容性结论。
首次AVD创建因工具不在SDK标准目录失败；按[Android官方工具布局](https://developer.android.com/tools/avdmanager)修正，原失败不覆盖。
官方命令工具ZIP SHA256先验证，镜像只使用本机已接受SDK许可，无自动同意新协议。
实际bundled Chinese ML Kit处理1080×1600合成像素，未mock SDK文字或二次结果；没有赋予WeChat/分身来源证明。
首次5项=4 PASS/1 FAIL（多金额二次语义），before回归2项=1P1F，针对修复后25项PASS；5项当前模拟器 `PASS`：

| 实际模拟器方法 | 结果 | 耗时ms/循环 |
| --- | --- | --- |
| cold-cent | PASS | 1084 |
| split-cent | PASS | 629 |
| jpy | PASS | 227 |
| roles | PASS | 850 |
| main-activity | PASS | 3轮：1265 / 1122 / 1015；关闭=DESTROYED |

5项是独立于标准JVM的仪器化方法，不与标准JVM口径混加；3轮Activity在同一方法内，不算3个独立方法。
所有像素都是本轮画出的合成输入；首次冷SDK进程及后续重装进程分别记录，不能等同真实微信截图准确率。
真实Samsung/安全窗口/实际OS截图profile、实机息屏后台及真实云链均继续独立门禁。
模拟器[完整命令和数据](../migration-evidence/finance-p04/continuation-p05/emulator-validation-r2/result.json)、[JUnit控制台](../migration-evidence/finance-p04/continuation-p05/emulator-validation-r2/instrumentation.log)及四张输入PNG同目录保留。
入口依次为 `python qa/finance-p05/prepare-emulator.py`、`python qa/finance-p05/boot-emulator.py --label emulator-runtime-r2`、
`python qa/finance-p05/emulator-validation.py --attempt r2`、`python qa/finance-p05/close-emulator.py --attempt 2`；各attempt拒绝覆盖旧输出。
模拟器实际测试APK与最终全量Debug构建分别封存SHA，不把相同源码推断为二进制hash完全相同。
两份APK的容器SHA不同；实际解码后577个ZIP条目逐一SHA256完全相同，见apk-payload-sha256.json。
这证明相同代码/资源payload，未把它改称整包二进制相同或声称最终容器在真实手机跑过。
**P05非真机：已实现并验证上述限定范围；总体PARTIAL。** SDK/真实UI与来源模板不充分时仍保留人工/外部证据边界，不将安全拒绝当全部业务支持。

## 5. 本轮真实统计与重叠

| 集合 | 当前结果 | 口径 |
| --- | --- | --- |
| 原607 | 602 PASS / 5 FAIL | 588 JVM、13 Node、6 Chrome按原身份，不借历史PASS |
| 原730方法身份 | 724 PASS / 6 FAIL | 当前JVM中的原集合视图 |
| 当前标准JVM 767 | 761 PASS / 6 FAIL | 新方法已包括 |
| 冻结原608 | 552 PASS / 5 FAIL / 28 EXPECTED_RED / 23 NOT_TESTED | 原输入/断言完全不变 |
| 版本化608 | 558 PASS / 5 FAIL / 22 EXPECTED_RED / 23 NOT_TESTED | 前提补传单列 |
| 原P03 63/41/99/79 | 63: 58 PASS / 4 FAIL / 1 NOT_TESTED；41: 41 PASS；99: 99 PASS；79: 79 PASS | 与标准方法重叠，不累加 |
| 既有新增38 | 38 PASS | 不覆盖原26红项 |
| 显式v2安全 | 10 PASS | 独立前提，不覆盖隐式CNY原FAIL |
| Lint / Debug | 0 Error/Fatal，86 Warning / 12 Hint；Debug及测试APK构建完成 | Android组合仍exit1，未把产物当测试全通过 |

Node34命令30退出0/4退出1；其JS/SQL作用域字节锁与最新源码逐文件一致，执行HEAD4344221单独保留。
原Android本轮精确HEAD见第1节，不能谎称Node在该Git HEAD重新执行。原730测试版本/schema适配及v11夹具修复已披露。
本轮E004/E007/E008由FAIL→PASS（金额1、EXPENSE），E组39行全部通过；这是原解析器断言范围，不证明生成了真实支出。
其余原FAIL/EXPECTED_RED/NOT_TESTED逐行见当前[frozen-608.json](../migration-evidence/finance-p04/continuation-p05/final-r7/delivery-current/frozen-608.json)、[failure-ledger.json](../migration-evidence/finance-p04/continuation-p05/final-r7/delivery-current/failure-ledger.json)。

剩余标准JVM完整失败首行（完整栈在原JUnit/json）：

- `uk.thewyj.app.task21.payment.AndroidPaymentRecognitionHookArchiveTest.messagingStyleLinesReachThePaymentParser`：java.lang.AssertionError: expected:<10000> but was:<0>
- `uk.thewyj.app.task21.payment.AndroidPaymentRecognitionHookArchiveTest.incompletePaymentCarriesAuditableReasonCodesWithoutRawText`：java.lang.AssertionError: expected:<[amount, direction]> but was:<[amount, direction, currency]>
- `uk.thewyj.app.task21.payment.FinanceP03IdentityLifecycleTest.laterReferenceEvidenceAttachesWithoutRenamingEarlierBooking`：java.util.NoSuchElementException: List is empty.
- `uk.thewyj.app.task21.payment.FinanceP03IdentityLifecycleTest.durableMessageProofSurvivesRegistryCacheReplacement`：java.util.NoSuchElementException: List is empty.
- `uk.thewyj.app.task21.payment.FinanceP03IdentityLifecycleTest.multipleOrdersOnOneMessageProofForceASeparateReviewSeries`：java.lang.AssertionError: expected:<2> but was:<0>
- `uk.thewyj.app.task21.payment.LocalPaymentBookingTest.offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive`：java.util.NoSuchElementException: List is empty.

## 6. 本轮失败保全与修复证据

- before-E原组失败；before-ticket-proof真实Room证明币种/证据恢复缺失。
- targeted-r2编译错误（QA getApplication泛型）；targeted-r3的review-reason绕过被原安全测试捕获并修复，迁移fixture缺indices键也修正；均保留。
- final-r2全749=735P14F；修正历史实体和目标版本后final-r3全751=744P7F（另有假时钟未同时传TicketEngine的QA错误，已修）。
- decimal-comma-before实际复现100倍放大，status-label-before两项实际复现帮助/时间字段污染；修复后精确值及拒绝场景通过。
- pending-transition-before复现未完成票据过早消费；line-structure-before三项复现重复符号节点及繁体方向问题；修复与原断言一致。
- final-r5全764=756P8F，其中2项繁体方向回归已修；final-r6全765=759P6F；历史失败及独立PASS均保留，不用单次PASS覆盖。
- 模拟器r1=4P1F：二次区域含多个语义金额被拒绝；单元before=1P1F后修复；r2当前结果见上表，原图/真实SDK主输出/完整栈均保留。
- 跨批次并发造成过JUnit归档混入其他类的中间记录，不作为最终结果；最终final-r7全流程单owner串行、有lock/source witness。
- native/projection早期脚本路径/输入顺序失败保留；新序列使用正确源模块及当前Node输入，断言未改。
- SDK Task正例误在测试main调用阻塞await被平台拒绝；更正到worker执行，没有取消平台线程约束。

本轮没有删除原失败、放宽金额/状态断言、扩大模拟结果代替实集成，也未把所有EXPECTED_RED自动翻绿。

## 7. 完整命令与恢复结果

工作目录为上述财务worktree。主要入口为 `python qa/finance-p05/final-validation.py --label final-r7`，
包含原34 Node的当前字节锁、完整Android、测试APK、原JVM/冻结/进程/HTTP bridge、声明前提、四组件备份与持久化。
完整argv、UTC起止、退出码、JUnit/raw见 [extra-commands.json](../migration-evidence/finance-p04/continuation-p05/final-r7/extra-commands.json)、
[node-commands.json](../migration-evidence/finance-p04/continuation-p05/final-r7/regression/node-commands.json)、
[jvm-commands.json](../migration-evidence/finance-p04/continuation-p05/final-r7/regression/jvm-commands.json)。

| 执行 | 结果 | exit |
| --- | --- | --- |
| android-full | FAIL | 1 |
| android-test-build | PASS | 0 |
| jvm-regression | FAIL | 1 |
| declared-native | PASS | 0 |
| declared-dom | PASS | 0 |
| prepare-backup | PASS | fixture preparation |
| backup-seed | PASS | 0 |
| backup-restore | PASS | 0 |
| explicit-v2 | PASS | 0 |
| task21-capability3 | PASS | 0 |
| current-projection | PASS | 0 |
| native-persistence | PASS | 0 |
| explicit-currency-bridge | PASS | 0 |
| scan-process-seed | PASS | 0 |
| scan-process-restore | PASS | 0 |

原legacy bridge seed仍因隐式币种合同FAIL，restore NOT_TESTED；显式账户默认、clearing/correction/unified的独立双JVM/HTTP/D1路径通过。
四组件Room18/FX1/Outbox/偏好冷恢复及实际Miniflare105表二进制副本PASS，跨JVM不是实际Android杀进程证明。
Debug APK SHA256 `f2e23fb8fcdd04bfb233e8b07cecaa217cbbd0eade05ace536ee38b004a6076e`；原产物路径和大小见当前Android command.json。没有正式签名/发布或真实设备安装；仅独立模拟器安装Debug与测试包。

## 8. 数据、文件与环境保护

- 本轮未向真实设备发送ADB命令，没有真实手机权限/账户/正式App/微信/支付操作；模拟器只用专属本地目标，不能称Samsung PASS。
- Production与共享Preview仅元数据/全局flags SELECT，rows_written=0；独立Preview绑定实际下载复核。没有正式会员、D1/R2/Stable、APK签名修改，未push/merge/Release。
- 冻结P02全部13文件hash不变。原旧manifest核验不是全PASS：107项Kotlin/Java可重建增量缓存当前缺失，余4142项hash一致，0内容变化。
  缺失时间/归因NOT CONFIRMED，旧manifest与原FAIL不改，不补文件伪装。旧封存范围的报告、raw日志、夹具、源码、APK、SQL/SQLite备份及受限微信密文哈希一致，未解密。
- 当前13组工作树/证据保护全部一致，`protected-final.comparison.json`记录8工作树HEAD/分支/status/源码和5证据组；不能用旧核验冒充本轮。
- 先前403诊断与__pycache__拒绝未绕过，旧共享Preview3条失败审计保留。本轮不全盘清理，Downloads/游戏/其他项目不写不删。
- 新SDK/模拟器依赖仅环境准备，不复制正式凭据或用户账目；安装/许可/网络限制保留实际状态，不自动接受新协议或改安全设置。
- 本轮模拟器测试包卸载、专属AVD/5039服务正常停止见emulator-cleanup-r2.json。首次以TCP别名执行emu kill退出1保留；改用同一AVD已知控制台transport，未改任何物理设备目标。
  证据、APK、已验证SDK及复现AVD保留，未清理其他任务或用户目录。

## 9. 剩余工作与最低关闭条件

| 优先级/任务 | 阶段 | 当前条件 | 真设备 | 外部证明/用户动作 | 最低关闭条件 |
| --- | --- | --- | --- | --- | --- |
| P0/R01 | P03 | 原26缺独立事件事实 | 视提供方 | EXTERNAL_EVIDENCE_REQUIRED | 可信operation/ref/revision/前驱与账户来源；C005/C007不以金额补关系 |
| P0/R02 | P03/P04 | 原607五FAIL/原730六FAIL、原样18六ER | 否 | LEGACY_CONTRACT_REVIEW_REQUIRED | 正式处置v1隐式CNY与v2不猜币种差异；未批准前原FAIL不变 |
| P0/R03 | P05 | 真实窗口/profile/付款收款主体 | 是 | DEVICE_REQUIRED | 同事件OS uid/user/window与实际截图来源、正确角色/ref贯穿；不以同ref单独证明主体 |
| P0/R04 | P03/P04/P05 | 真实通知→识别→本地/outbox→云→三页 | 是 | DEVICE/PRODUCTION_VALIDATION_REQUIRED | 授权专用数据、无重复、精确币种/金额/ID与持久化证据；一笔不能代替10场景 |
| P1/R05 | P05 | 合成像素SDK与3轮MainActivity已测；secure-window、息屏/厂商后台仍缺 | 是 | DEVICE_REQUIRED | 精确新APK、真实服务/后台/重启；模拟器不能替Samsung |
| P1/R06 | P04 | 正式升级/真实备份/恢复/回退 | 是/生产 | PRODUCTION_VALIDATION_REQUIRED | 一致四组件/服务端备份与可恢复方案；旧客户端拒绝，Git回退不作DB回退 |
| 已处理/R07 | P05 | 独立AVD/镜像/UI可用 | 否 | 本轮已实际验证，见模拟器结果 | 不用模拟器通过覆盖Samsung门禁 |
| P1/R08 | 全部 | 历史缓存107缺失 | 否 | 审阅封存边界 | 保留FAIL与未确认归因，主证据4142一致不称完整4249通过 |
| P2/R09 | 发布 | CI/原签名/最终分发 | 后续 | OWNER_RELEASE_APPROVAL_REQUIRED | 所有适用门禁、精确SHA/产物/迁移/恢复/CI后独立发布审核 |

## 10. 本轮结论

**P03/P04/P05分别PARTIAL。** 当前已实现并验证的非真机范围、原合同冲突和必须真实环境的门禁分别记账。
独立非真机状态：P03=已处理当前可观测缺陷、原合同/外部证据未关闭；P04=PARTIAL（旧合同仍需处置）；
P05=本报告已列的规则、持久化、竞态和模拟器范围已实现并完成验证，整体真实来源/设备门禁未关闭。
不使用P04_NON_DEVICE_IMPLEMENTATION_COMPLETE覆盖未处置原合同，不将新安全隔离当全部业务完成。
所有当前可安全推进的本地代码/测试已实际执行；剩余真实环境、外部事实和合同处置不由虚构数据替代。
独立P04 Preview留供所有者体验；P05仅本地。最终本地Git与封存见本轮FINAL_PROVENANCE.json，源码/报告状态检查后停止。

本轮相对ce7的文件列表（包含Preview与P05；逐文件diff以Git为准）：

```text
android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/17.json
android/app/schemas/uk.thewyj.app.task21.store.NotificationDatabase/18.json
android/app/src/androidTest/java/uk/thewyj/app/OwnerSelectedChatServiceTest.kt
android/app/src/androidTest/java/uk/thewyj/app/PaymentLivePageRegressionTest.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentAccessibilityGateway.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentOcrTaskLifetime.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentOcrTransferAmount.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentPageAmountSelection.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentPageEvidence.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentPageSemantics.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentRecognitionCoordinator.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentScreenshotVerifier.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentTicketEngine.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentVerificationCenter.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/ThewyjPaymentAccessibilityService.kt
android/app/src/main/java/uk/thewyj/app/task21/store/NotificationDatabase.kt
android/app/src/main/java/uk/thewyj/app/task21/store/PaymentEntities.kt
android/app/src/main/java/uk/thewyj/app/task21/store/PaymentRecognitionStore.kt
android/app/src/main/java/uk/thewyj/app/ui/PaymentVerificationScreen.kt
android/app/src/test/java/uk/thewyj/app/finance/CurrencyReviewMigrationTest.kt
android/app/src/test/java/uk/thewyj/app/task21/payment/FinanceP05MigrationTest.kt
android/app/src/test/java/uk/thewyj/app/task21/payment/FinanceP05OcrTaskLifetimeTest.kt
android/app/src/test/java/uk/thewyj/app/task21/payment/FinanceP05PageEvidenceTest.kt
android/app/src/test/java/uk/thewyj/app/task21/payment/FinanceP05ScanBudgetTest.kt
android/app/src/test/java/uk/thewyj/app/task21/payment/PaymentTicketCurrencyRestoreTest.kt
android/app/src/test/java/uk/thewyj/app/task21/store/CloseoutV11Database.kt
docs/finance-p04/EXPERIMENTAL_DELIVERY_RCA.md
docs/finance/FINANCE_P03_P04_P05_CONTINUATION_REPORT.md
qa/finance-p04/experience/cloud.py
qa/finance-p04/experience/prepare-accounts.py
qa/finance-p04/experience/preview-ui.css
qa/finance-p04/experience/preview-ui.js
qa/finance-p04/experience/public-assets.py
qa/finance-p04/experience/runtime-proof.mjs
qa/finance-p04/experience/stage-preview.mjs
qa/finance-p04/experience/stage-preview.test.mjs
qa/finance-p04/experience/verify-preview.mjs
qa/finance-p05/README.md
qa/finance-p05/boot-emulator.py
qa/finance-p05/close-emulator.py
qa/finance-p05/collect.py
qa/finance-p05/emulator-validation.py
qa/finance-p05/emulator.init.gradle
qa/finance-p05/emulator/P05EmulatorTest.kt
qa/finance-p05/final-validation.py
qa/finance-p05/kotlin/P05ScanProcessTest.kt
qa/finance-p05/prepare-emulator.py
qa/finance-p05/prepare-regression.py
qa/finance-p05/run-jvm-regression.py
qa/finance-p05/seal.py
qa/finance-p05/write-report.py
```

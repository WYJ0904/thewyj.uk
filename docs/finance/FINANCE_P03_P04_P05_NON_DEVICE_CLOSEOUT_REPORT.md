# FINANCE P03/P04/P05 非真机收尾报告

2026-10-26，Asia/Hong_Kong。**P03_STATUS=PARTIAL；P04_STATUS=PARTIAL；P05_STATUS=PARTIAL。**

本轮实际修复了币种设置、来源隔离和OCR产品缺陷；没有把旧六项测试的缺失币种前提伪造为CNY。
33组真实ML Kit合成像素、跨Android进程预算恢复及跨模块合成链路均有独立证据。
原始回归仍有失败，真实Samsung、实际提供方与正式环境门禁继续独立保留。

## 1. 基线、提交和环境

| 项目 | 实际状态 |
| --- | --- |
| 工作树/分支 | `%USERPROFILE%/.codex/worktrees/finance-p04-multicurrency/thewyj.uk`；`codex/finance-p05-page-ocr` |
| 起始封存提交 | adbd4851410b47894cc8bf90ffb989e8e407ebdd；起始干净，无reset/clean或重复源码树 |
| 上轮测试源码 | 25142acb9a22c5293d5c3b8a7710c4bd418f477c；与上轮封存提交区别保留 |
| 本轮最终标准回归源码 | `f9ebc0d9a088c57e0df927d2659d797b4c091a91`；实际命令和source_before/after见新证据 |
| SDK实测提交 | `d5c443d478bd60f75f3841bfc83e310c3fed09e2`；后续测试/QA提交的产品代码逐文件相同，不以commit不同直接推断二进制相同 |
| 合成E2E提交 | `273f7f7a4f09eb6647bdf20e150412c6e8064c1b`；SDK产品字节匹配检查真实执行 |
| 最终本地提交/干净状态 | 新封存FINAL_PROVENANCE.json绑定，避免报告自包含自身SHA的循环引用；最终回复同时给出 |
| 新证据目录 | docs/migration-evidence/finance-p04/non-device-closeout/；旧continuation-p05不写入 |
| Preview/Production | 本轮未读取或修改远端；P04独立Preview保留原绑定/登录，未部署P05。以前的74eadf5部署观察仅历史，不冒充本轮新核查 |
| 真实手机 | 未查询/选择/操作物理设备；ADB仅本轮专属AVD，私有5041服务，明确loopback目标，USB不接纳、mDNS关闭 |

本轮本地提交链，最后文档/封存提交另由最终索引绑定：

```text
665cc40da2f018f9a81170e02dc7ed78043f843c fix(finance): bind currency preferences and identity evidence to durable scope
ab8082c206ec793c4e5f14600f498e3fa3c601e9 fix(ocr): reconcile full-page scales and preserve independent amount semantics
d5c443d478bd60f75f3841bfc83e310c3fed09e2 fix(ocr): veto uncertain competing amounts and balance-page variants
273f7f7a4f09eb6647bdf20e150412c6e8064c1b test(finance): align browser unit contract and preserve E2E cleanup evidence
f9ebc0d9a088c57e0df927d2659d797b4c091a91 test(finance): verify historical currency recovery and fresh regression provenance
```

## 2. 六个原始失败逐项结论

本轮先重跑三原类46方法，保留6个原FAIL。原三测试文件内容哈希保持不变。

| 原方法 | 修改前 | 最终 | 完整失败首行（栈另存） |
| --- | --- | --- | --- |
| `AndroidPaymentRecognitionHookArchiveTest.messagingStyleLinesReachThePaymentParser` | FAIL | FAIL | `java.lang.AssertionError: expected:<10000> but was:<0>` |
| `AndroidPaymentRecognitionHookArchiveTest.incompletePaymentCarriesAuditableReasonCodesWithoutRawText` | FAIL | FAIL | `java.lang.AssertionError: expected:<[amount, direction]> but was:<[amount, direction, currency]>` |
| `FinanceP03IdentityLifecycleTest.laterReferenceEvidenceAttachesWithoutRenamingEarlierBooking` | FAIL | FAIL | `java.util.NoSuchElementException: List is empty.` |
| `FinanceP03IdentityLifecycleTest.durableMessageProofSurvivesRegistryCacheReplacement` | FAIL | FAIL | `java.util.NoSuchElementException: List is empty.` |
| `FinanceP03IdentityLifecycleTest.multipleOrdersOnOneMessageProofForceASeparateReviewSeries` | FAIL | FAIL | `java.lang.AssertionError: expected:<2> but was:<0>` |
| `LocalPaymentBookingTest.offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive` | FAIL | FAIL | `java.util.NoSuchElementException: List is empty.` |

MessagingStyle文本确实到达产品解析器，拒绝原因是`¥`不能在无账号币种证据时区分CNY/JPY；并非文本丢失。
不完整银行提醒也无币种，v2如实增加currency缺失字段。另四项新建空库的Hook场景同样没有持久默认币种，尚未到达其原先预期的正式账创建路径。
有明确账号默认币种的独立v2合同本轮重跑 **10 PASS**；不能改称原六项PASS。
本轮没有设置testing=true就恢复v1默认、按应用/语言猜CNY、删断言或改frozen oracle。

## 3. 产品根因与实际修复

| 缺陷/根因 | 产品修复 | 本地防回归 |
| --- | --- | --- |
| 同revision不同默认币种可覆盖Room和运行缓存；负/小数revision被接受 | revision必须为非负安全整数，同revision只允许完全相同快照，旧revision不回滚；币种设置有界校验 | CurrencyCloseoutPreferencesTest，原始before失败保留 |
| Room提交与SharedPreferences镜像存在崩溃/发布顺序窗口 | 镜像同步commit、带账号/单调revision；恢复先使用已提交Room元数据，网络失败仍可恢复；坏类型失败关闭 | 离线恢复、晚发布、同版冲突、坏镜像与账号隔离 |
| 显式XYZ币种及订单号/商户中的CNY/USD可能被误作默认币种或金额证据 | 明确未知声明拒绝默认；只在货币位置识别单位，引用元数据不参加金额/币种选择；原引用本身继续保留用于身份 | 参考号USD123456不能成为123456美元，CNYSHOP不是CNY证明 |
| 单一引用把历史未知profile与当前已知profile视为同一来源 | 同包UID必须相等；canonical事件跨包/类型/UID拒绝；拒绝观察不向旧账追加proof，合法重复继续保存同scope新proof | 双向unknown/known、跨profile、旧账/别名/消息proof均实际Room测试 |
| 已有明确账务单位的精确重放会受新账号默认币种影响 | 只对同canonical事件复用其已验证持久账务单位；不作为新事件全局默认；显式新单位仍优先并受冲突保护 | 实际exported schema14升级18、冷重开，旧ID/金额/时间保持；无指数的旧JPY保持未核实 |
| 主/二次OCR区域金额语义不一致 | 同一精确ISO/角色选择用于区域与二次读取；唯一裸数可带无金额状态上下文，余额/手续费/编号/时间等仍拒绝 | 分组、小数逗号、分行0.01；不按expected数字挑结果 |
| SDK误读状态/标题后出现方向误判或信息丢失 | 未解码状态是安全否决；有界整页800/1600重读，保留完整页面，不拼接不同数字节点；跨次已知金额/币种必须一致；epoch/账号/期限逐次重检 | 真实SDK、跨次金额冲突、后续负页、取消、SDK忙和旧账户回调 |
| SDK把竞争付款标签/余额标题误读，导致错误接受 | 未知但涉及支付的竞争金额触发冲突；余额标题简繁/重复字形只作为负向阻断，不用错字补完成 | r2两次错误接受真实保存；修复后同图同oracle r3拒绝通过 |

没有修改90秒票据、最多8次截图尝试、250ms下限或单SDK任务10秒等待上限。
整页重读仅对不确定原图进行最多两次有界分辨率变换，每次仍检查原ticket/epoch；不再截图、不扩展期限，已识别负页不靠重读改成正页。
没有关闭产品硬件加速、增加正式签名、更新大量依赖或引入P06。

## 4. 历史币种、迁移和恢复

Git历史证明账号运行币种设置始于P04的3b710e3；更早代码多处硬编码CNY，不等于旧六项拥有过合法默认设置。
本轮完整审计结论及原三文件SHA见legacy-currency-audit.json。历史代码默认不能当成新交易的币种证明。
Room主库仍18、FX库仍1；没有为本轮增加不必要表结构或清库。
真实导出schema14的DDL、identity hash及旧字段构造合成旧库，再由产品迁移链升级18；没有把当前实体建库后改user_version伪装旧库。
已存CNY单位、交易ID/金额/时间/回执保持；旧JPY缺指数仍保留原整数并待核实，未按新指数重解释。
版本化偏好镜像是增量键，不重写历史财务记录；四组件备份、迁移中断回滚/重试、旧opener拒绝新库和冷恢复本轮重跑。
Git回退不等于数据库回退，正式个人数据库升级/备份恢复继续NOT_TESTED。

C005原USD80+90仍缺独立capture/revision证明；C007原无reference输入保持原真值。
原26红项本轮 **4 FAIL / 22 EXPECTED_RED**。可信操作引用/来源/前驱充分的合成路径独立通过，不用金额或时间相似度补事实。
财务历史Activity异常仍按旧证据INCONCLUSIVE/DEVICE_REQUIRED；D01/D02维持CLOSED，模拟器不推翻或重新归因旧Samsung失败。

## 5. 本轮实际完整回归

| 集合 | 最新结果 | 口径 |
| --- | --- | --- |
| 原607 | 602 PASS / 5 FAIL | 原588 JVM+13 Node+6 Chrome身份，本轮新执行 |
| 标准JVM 797 | 791 PASS / 6 FAIL | 包含本轮新增30方法；新增30 PASS |
| 原767身份 | 761 PASS / 6 FAIL | 当前结果视图，非旧PASS借用 |
| 原冻结608 | 552 PASS / 5 FAIL / 28 EXPECTED_RED / 23 NOT_TESTED | 原fixture/oracle哈希不变 |
| 版本化608 | 558 PASS / 5 FAIL / 22 EXPECTED_RED / 23 NOT_TESTED | 显式传递原声明前提，单列 |
| 原P04 18 | 12 PASS / 6 EXPECTED_RED原样；18 PASS当前前提 | 原样差异未翻绿 |
| 既有新增38 | 38 PASS | 与其他集合重叠，不另加总 |
| 上轮P05新增37 | 37 PASS | 仅借用原身份，本轮全量JUnit取状态；包含在797内 |
| Lint/Debug | 0 Error/Fatal；89 Warning、12 Hint；Debug及测试APK构建完成 | 组合命令有原FAIL仍保留exit1 |

标准JVM和原607均SKIP=0、NOT_TESTED=0；它们的FAIL如上保留。冻结608的SKIP=0，23条NOT_TESTED未计PASS。其他集合均按实际状态逐条保存，不将未运行项记作跳过后通过。
原63/41/99/79与标准JVM重叠，逐项结果见新delivery-current，不累计为额外独立用例。

| 重叠保护集合 | 本轮结果 |
| --- | --- |
| P03集合63 | 58 PASS / 4 FAIL / 1 NOT_TESTED |
| P03集合41 | 41 PASS |
| P03集合99 | 99 PASS |
| P03集合79 | 79 PASS |

原63的4 FAIL为上述3项身份测试及原legacy-bridge-seed（原预期3笔、实际1笔，缺账户币种前提）；依赖它的原legacy-bridge-restore未启动，保持NOT_TESTED。另行显式币种桥的种子/恢复通过，不能替换这项原NOT_TESTED。
原607内部拆分：JVM 585 PASS / 3 FAIL；Node 13 PASS；Chrome 4 PASS / 2 FAIL。
完整Node/HTTP/Chrome批次为34个命令，30个exit0、4个exit1；失败命令为aeris-dom, task21, p02-web, p02-dom，完整输出保留。命令数不冒充独立测试总数；原Aeris DOM两红项缺币种/指数，旧Task21客户端缺新能力声明，P02原币种驱动未传递fixture已声明的默认/参考率等前提，派生适配结果分别列出。
Lint相对旧86 Warning新增3条：1条ApplySharedPref来自币种镜像的同步commit，2条UseKtx分别建议替换偏好编辑和Bitmap缩放写法。保留同步commit是为了确认落盘，未改回异步apply、添加suppression或宣称零警告。逐条差异见lint-delta.json。
六币种、精确十进制/HALF_EVEN、历史FX/离线缓存、HTTP/D1、实际Chrome、Room迁移、Outbox及跨JVM桥结果均来自本轮。
与原767方法逐项比对，没有新增失败身份、没有原方法状态变化；本轮新增30方法全部通过，regression-comparison.json保存逐方法对照。该结论不抹去原六项失败或新增的Lint建议。
所有FAIL/EXPECTED_RED/NOT_TESTED和完整异常栈见[failure-ledger](../migration-evidence/finance-p04/non-device-closeout/final-r1/delivery-current/failure-ledger.json)、[JVM失败](../migration-evidence/finance-p04/non-device-closeout/final-r1/delivery-current/jvm-failures.json)。

P04专项集合（与其他集合存在重叠）：

| 集合 | 本轮结果 |
| --- | --- |
| HTTP_D1 | 39 PASS |
| migration_restore | 12 PASS |
| default_review_migration | 8 PASS |
| default_review | 11 PASS |
| Chromium | 18 PASS |
| live_FX | 12 PASS |
| raw_transport | 36 PASS |
| unit_review | 19 PASS |
| exact_money | 76 PASS |
| simulated_FX | 22 PASS |
| independent_Decimal_oracle | 219 PASS |

原18条币种合同，完整原输入、断言与前提转发差异见[currency-18.json](../migration-evidence/finance-p04/non-device-closeout/final-r1/delivery-current/currency-18.json)：

| Case ID | 原样冻结结果 | 声明前提显式传递结果 |
| --- | --- | --- |
| D004 | EXPECTED_RED | PASS |
| D008 | EXPECTED_RED | PASS |
| D012 | PASS | PASS |
| D016 | EXPECTED_RED | PASS |
| D020 | EXPECTED_RED | PASS |
| D024 | PASS | PASS |
| DW-FMT-JPY-10000 | PASS | PASS |
| DW-FMT-JPY-12345 | PASS | PASS |
| DW-MIX-USD | PASS | PASS |
| DW-MIX-EUR | PASS | PASS |
| DW-MIX-HKD | PASS | PASS |
| DW-MIX-GBP | PASS | PASS |
| DW-MIX-JPY | PASS | PASS |
| DW-HISTORY-2026-10-18 | PASS | PASS |
| DW-HISTORY-2026-10-19 | PASS | PASS |
| DW-FX-MISSING-OFFLINE | PASS | PASS |
| DW-DOM-MIXED-budget | EXPECTED_RED | PASS |
| DW-DOM-MIXED-category | EXPECTED_RED | PASS |

## 6. 真实ML Kit模拟器

本轮新AVD=FinanceCloseoutIsolated，API36/Google APIs/x86_64；WHPX可用，默认虚拟图形栈不是Samsung。
33组输入由Canvas生成，所有图片、SDK原始输出/每次整页读回、独立二次结果及断言保留。
r1=23 PASS/10 FAIL；r2=31 PASS/2 FAIL；r3=**33 PASS**。输入JSON和33张原PNG跨轮逐一哈希一致。
不是调字体、换金额或改断言获得PASS；scale-probe20次只是诊断，不计业务PASS。
5个主仪器化方法+1个独立Android进程恢复方法全部通过；33是参数向量，不能冒充33个JUnit方法。
旧账户/profile/epoch回调丢弃、串行OCR、取消、3轮真实MainActivity stop/resume/recreate、进程重启后8次预算仍耗尽均有证据。
合成UID只证明产品约束，未验证真实主/分身窗口身份；SDK像素不能充当真实支付凭证。
SDK APK及测试APK见emulator-r3/result.json；与最终全量产物分别列SHA，不宣称整包字节天然相同。
source-binding.json逐一核对167个主产品/Gradle文件，SDK与最终构建完全相同；Android清单差异仅新增历史迁移测试。SDK额外收录仪器化QA文件、全量构建额外收录exact-oracle，清单范围差异单列，不冒称文件改动。

## 7. 跨模块合成端到端

状态 **SYNTHETIC_E2E_PASS**。两独立JVM的产品通知/页面/Hook、Room、Outbox、真实HTTP认证API、Miniflare D1和实际Chrome财务模块相连。
SDK观察通过JSON在受控测试运行时之间传递；这是模拟数据边界，不能称真实OS来源归属或同一Samsung进程链路。
D1财务表没有手工seed账目：五笔均来自Android产品流水线。认证session/会员是独立本地合成fixture，未借正式账号。
固定独立oracle核对：CNY0.01、HKD12.34、JPY1000、CNY支出2.00及退款1.00；各自ID、币种、最小单位、方向、状态一致。
授权/解除、失败、待付款、身份未明、跨profile不新增正式支出；重复捕获/重投只保留原五笔。
服务端确实提交后故意丢一次回执，再冷重建D1；客户端第二JVM以持久outbox重试取得原canonical ID。
Chrome6检查通过，包括列表、编辑表面值、刷新幂等、401拒绝错误凭据；CNY支出201/退款100/净余额-101，HKD1234与JPY1000分组待换算，未1:1相加。
这是实际财务模块HTML/JS与实际API；完整网站导航、正式账户认证、微信支付和Samsung E2E均NOT_TESTED。
[浏览器截图](../migration-evidence/finance-p04/non-device-closeout/e2e-r2/web-finance.png)、[固定oracle](../migration-evidence/finance-p04/non-device-closeout/e2e-r2/coverage-oracle.json)、[HTTP日志](../migration-evidence/finance-p04/non-device-closeout/e2e-r2/wire.ndjson)可追溯。

## 8. 失败与QA修正完整披露

- 新缺陷before7项6 FAIL；拒绝Hook before1 FAIL，初版过宽还阻止合法duplicate proof，duplicate-proof-before1 FAIL后收窄修复。
- unit-metadata-before3 FAIL；早期durable测试引用名含CNY意外提供了币种线索，换成不含币种代码的引用后才隔离真实前提。原金额/单位/预期与冻结输入不变，早期结果保留。
- sdk-semantics-before4 FAIL；sdk-veto-before2 FAIL；r1/r2真实像素失败及r3同样本结果全部保留。
- E2E r1两JVM通过、浏览器5P1F：QA错误期待JS缓存持有amount_exponent字段，而产品按ISO精度规范化。改为校验真实currencyDigits和待核实标记，原金额/币种/ID断言保留，JVM/Room/D1指数仍严格核对。
  截图调用page.client并非现有harness接口、关闭次序问题亦修正；r1日志不覆盖，r2全部重跑。
- 发现上一轮派生DOM驱动把输出硬编码到准备目录，复制树可能含旧ndjson。本轮每轮重新生成驱动到最终目录，不复制旧结果；旧报告/原件不改，也不把旧路径数据计本轮PASS。
- final-r1完成Node/全量Android/测试APK后，桥接批次和前提生成进程分别返回1073807364、3221226091，尚无对应JUnit或生成结果；原因未确认，不能当作产品断言结果。原命令、空日志及283字节Gradle启动日志均保留。续跑只重启未完成尾部，另写extra-commands-resume-r1.json，原extra-commands.json不覆盖，已完成测试不重复累计。
- 源码绑定QA首次错误要求两个不同范围的清单完全同构；该前提失败另存source-binding-initial-premise.json。修正为所有共有文件和全部主产品逐字节相等、仅允许Android测试新增，同时披露清单范围差异；未修改产品或输入。
- 原始六项、A/C原红灯及失败后的后续PASS分别列出，没有删除、改期望或把安全拒绝等同完整业务支持。

## 9. 命令、产物和保护

主入口 `python qa/finance-p05/closeout/final-validation.py --label final-r1`；全34 Node命令本轮实际运行，不沿用前轮PASS。
中断后续跑 `python qa/finance-p05/closeout/final-validation.py --label final-r1 --resume-interrupted-tail`；先校验已完成Android源码哈希，保留并索引未完成的trace-five启动日志，再从JVM桥接执行。续跑未修改产品或原oracle。
模拟器入口boot-avd.py/run-emulator.py --attempt r3，E2E入口run-e2e.py --attempt r2 --sdk r3及verify-e2e.py。
完整argv、UTC、退出码、JUnit/JSON在[extra-commands](../migration-evidence/finance-p04/non-device-closeout/final-r1/extra-commands.json)与regression/node-commands.json、jvm-commands.json。

| 执行 | 状态 | exit |
| --- | --- | --- |
| node-full | FAIL | 1 |
| android-full | FAIL | 1 |
| android-test-build | PASS | 0 |
| jvm-regression | FAIL | 1073807364 |
| prepare-contract | FAIL | 3221226091 |
| jvm-regression | FAIL | 1 |
| prepare-contract | PASS | 0 |
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

最终全量Debug SHA256 `b9309838dba1e8b03a6b716f930d55bb56fd2cb91c4e6925bdf25b0c27ccfd6f`；源位置/字节数见android-current/command.json。没有正式签名/上传/发布。
普通Debug AndroidTest APK另存android-test-build-current/artifact.json及对应APK；其生成时间位于本轮成功构建命令区间，不能与专属SDK测试APK混用。
旧2830项封存起始逐一通过；其中51项工作源码/报告另保存原字节，后续授权产品修改通过Git和这份原字节副本区分。
旧raw证据不写入；更早107个编译缓存缺失例外原样披露，不能称旧4249项全通过。
13组工作树/证据最终比对、原冻结13文件及原三失败测试文件SHA见新FINAL_PROVENANCE.json。
Downloads/游戏/其他项目未读写清理；不读取根访问口令文件；无push/merge/PR/Release或线上旗标/会员/账目修改。
只清本轮独立模拟器测试包和专属5041服务；保留源码、样本、APK、必要备份和新封存。私有Chrome profile清理按本轮精确白名单记录。
本轮已删除两个确证拥有的Chrome临时profile（615文件、24,424,367逻辑字节），截图/DOM/HTTP证据保留；其余无完整归属证据的旧Temp浏览器状态不盲删。AVD磁盘、Gradle/SDK依赖和可复现夹具保留，不进行全盘缓存清理。
105表Miniflare实际二进制复制实验因Windows SQLite journal路径长度，使用result.json绑定的docs/migration-evidence/native-mvo3glym-35656短路径；active/restored二进制均保留并纳入新封存，未把它遗留为未索引临时文件。该实验是本地Miniflare持久化，不是Cloudflare正式备份或Time Travel。
中断后原AVD已停止，清理时仅正常重开同一AVD、核对名称/qemu标记并卸载两个debug包，再关闭AVD与5041服务；启动期offline结果保留。SDK自身的`adb -e`超时设置尝试因同一AVD双别名返回more than one emulator而未执行，本轮脚本仍显式指定专属目标；不将这些工具内部失败计为业务PASS。

## 10. 剩余条件和最小所有者决策

| 阶段 | 本轮非真机完成内容 | 阶段状态 |
| --- | --- | --- |
| P03 | 来源/profile拒绝与消息proof保护、精确历史重放、Room/Outbox/回执及清算/更正跨进程回归 | PARTIAL；26条原身份/业务红项仍保留 |
| P04 | 单调版本币种偏好与离线恢复、未知单位/元数据隔离、六币种与FX/迁移/备份回归、18条版本化合同核对 | PARTIAL；旧隐式单位合同和正式环境验收未关闭 |
| P05 | SDK发现的误读/多金额错误接受修复、33组真实SDK合成像素、生命周期/预算恢复与跨模块E2E | PARTIAL；真实Samsung/提供方身份与通知链未验证 |

| 项目 | 类型 | 最低完成条件 |
| --- | --- | --- |
| 原六项/原607币种预期 | OWNER_CONTRACT_DECISION_REQUIRED | 决定是否正式接受v2无证据不猜币种、将旧隐式CNY预期归档不兼容；或仅在有可审计账号默认前提下修订合同。推荐前者，未批准前原FAIL保持。 |
| A009/A011/A201/A203、C005/C007等 | EXTERNAL_EVIDENCE_REQUIRED | 实际独立operation/reference、账户/来源、revision与前驱；不能用同额同文本或同授权号推断。 |
| 真实通知/窗口/付款收款主体及安全窗口、厂商后台 | DEVICE_REQUIRED | 另行授权专用数据与真实设备，精确APK和真实来源证据；本轮不触手机。 |
| 正式备份、迁移、RC-6、真实云/三页与微信链 | PRODUCTION_VALIDATION_REQUIRED | 适用授权、可靠恢复、真实端到端与独立验收，模拟结果不替代。 |
| CI/正式签名/上线 | OWNER_RELEASE_APPROVAL_REQUIRED | 所有适用关闭门禁；本轮不执行、不进入P06。 |

本轮已完成列明的非真机产品修复、实际复测和隔离模拟验收；仍有原合同FAIL，**不声明任一整阶段COMPLETE**。
不能观测的业务事实和必须由所有者裁决的政策不会由代码伪造；它们未阻止本轮其他工程工作。

相对起点的本轮文件清单：

```text
android/app/src/main/java/uk/thewyj/app/finance/CurrencyDecision.kt
android/app/src/main/java/uk/thewyj/app/finance/CurrencyReferenceRepository.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/AndroidPaymentRecognitionHook.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentPageAmountSelection.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentPageEvidence.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentRecognitionCoordinator.kt
android/app/src/main/java/uk/thewyj/app/task21/payment/PaymentScreenshotVerifier.kt
android/app/src/test/java/uk/thewyj/app/finance/CurrencyCloseoutHistoryTest.kt
android/app/src/test/java/uk/thewyj/app/finance/CurrencyCloseoutPreferencesTest.kt
android/app/src/test/java/uk/thewyj/app/task21/payment/FinanceCloseoutOcrRecoveryTest.kt
android/app/src/test/java/uk/thewyj/app/task21/payment/FinanceCloseoutSourceScopeTest.kt
docs/finance/FINANCE_P03_P04_P05_NON_DEVICE_CLOSEOUT_REPORT.md
qa/finance-p05/closeout/archive-source.py
qa/finance-p05/closeout/baseline.py
qa/finance-p05/closeout/boot-avd.py
qa/finance-p05/closeout/cleanup-chrome.ps1
qa/finance-p05/closeout/close-avd.py
qa/finance-p05/closeout/collect.py
qa/finance-p05/closeout/e2e-browser.mjs
qa/finance-p05/closeout/e2e-server.mjs
qa/finance-p05/closeout/emulator.init.gradle
qa/finance-p05/closeout/emulator/CloseoutEmulatorTest.kt
qa/finance-p05/closeout/emulator/CloseoutScaleProbeTest.kt
qa/finance-p05/closeout/emulator/assets/closeout-cases.json
qa/finance-p05/closeout/final-validation.py
qa/finance-p05/closeout/kotlin/CloseoutFlowTest.kt
qa/finance-p05/closeout/legacy-audit.py
qa/finance-p05/closeout/prepare-collector.py
qa/finance-p05/closeout/prepare-regression.py
qa/finance-p05/closeout/run-e2e.py
qa/finance-p05/closeout/run-emulator.py
qa/finance-p05/closeout/scale-probe.py
qa/finance-p05/closeout/seal.py
qa/finance-p05/closeout/source-binding.py
qa/finance-p05/closeout/verify-e2e.py
qa/finance-p05/closeout/verify-sdk-inputs.py
qa/finance-p05/closeout/write-report.py
```

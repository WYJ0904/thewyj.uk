# FINANCE-P03 最终统一报告

2026-10-20，Asia/Hong_Kong。**状态：PARTIAL；不具备完整关闭 P03 的条件。**

本轮从 `976eed4644556e70266fe0ef5e54b7c8e419d0ba` 继续，完成新的原607及P03既有回归、Samsung实机合成通知/账本/页面/迁移与恢复验证，并修正可证实的QA夹具问题。**本轮产品源代码修改0。** 真实提供方自动修正授权、C005/C007原真值、正式备份与真实业务门禁没有被合成PASS替代；还保留一次最终候选连续矩阵的未归因生命周期FAIL。

本报告是唯一当前交付；前版全文保留于Git `976eed4` 及 `device/baseline-report.md`，此前P03实现和证据没有重启或覆盖。没有建立新的P03实施/审批停止节点，没有进入P04/P05/P06。

## 基线、修复与精确差异

沿用 `%USERPROFILE%/.codex/worktrees/finance-p03-identity-preauth/thewyj.uk`，分支 `codex/finance-p03-identity-preauth`。起始HEAD、干净tracked状态、旧封存52份源码/报告、1149份raw、630份候选输入已逐字节核验；保护基线为 [baseline.json](../migration-evidence/finance-p03/device/baseline.json)。当前写报告时源码HEAD为 `976eed4644556e70266fe0ef5e54b7c8e419d0ba`；最终本地提交、tree及工作树状态由 [REVISION.json](../migration-evidence/finance-p03/device/REVISION.json) 固定，封存及清理校验见同目录provenance/validation/cleanup。

既有实现提交 `22c36bf3d39b504ca65d74a357e130689dc084dc` 完整保留。相对本轮起点，`android/`、`functions/`、`js/`、`app.js`、D1历史迁移及Room历史schema的产品差异为0；新增内容集中于 `qa/finance-p03/device/` 与本报告。完整新增文件及SHA-256见 [source-files.json](../migration-evidence/finance-p03/device/source-files.json)，涵盖原生测试/保护门、QA manifest与资源、隔离构建与运行驱动、本地服务、统计/封存/清理脚本。没有Push、Merge、PR、正式签名、发布、远端迁移或Production写入。

| P03功能 | 现有实现与本轮验证边界 |
| --- | --- |
| 身份、引用、账户/发行方/来源隔离 | 可信独立引用保持独立；缺证据持续隔离；旧回执、重复投递、进程恢复、原账ID和人工优先级回归通过 |
| 授权与多次Capture | A授权、C清算、R解除、H剩余冻结、F退款、N净正式支出分开。授权不创建正式支出；80+90独立引用可得170 |
| 授权与实际金额不同 | 可信清算可超过原冻结额度，H归0并保留over-capture；不假设A=C，不用负冻结或假退款掩盖差额 |
| 部分解除、过期、部分/多次/全额退款 | 解除不超过已证剩余；明确完成/过期关闭剩余；退款累计不超过清算。乱序依赖、重复及迟到事件保留并按证据恢复 |
| Capture/Refund修正与重归属 | 完整同操作证明、账户/来源/家族/前驱和revision约束；旧新家族余额同时校验；不覆盖较新人工修改 |
| 多正式ID消解 | CONSOLIDATE须明确保留ID与完整受影响revision集合；原行/金额/回执/历史保留为系统替代关系，不伪造退款。无证明不强合并 |
| 控制事件版本 | CONTROL_REPLACE只处理同角色/引用/家族；用户拒绝与系统关闭分开；本地也拒绝超量解除和旧控制回执 |
| Room/D1/outbox/HTTP | 原四组跨JVM、真实文件和本地HTTP/D1全通过；本轮增加实机Room/Keystore/实际认证HTTP/本地D1路径 |
| 真实提供方及正式备份 | 仍未完整闭合；下文列明合法入口与数据边界，不能以安全隔离等同完整业务支持 |

上述金额、识别完成策略、90秒票据、RC保护均未在本轮变更。Room14、D1增量0030、Task21 DB6、Task16 DB3、wire1保持现有实现；没有降版本、清库或删除正式账。

## 隔离候选、设备与宿主一致性

唯一指定Samsung为SM-S9360，Android16/API36，实际模型/SDK在安装和测试中核验；仅主用户0的测试与查询。报告不公开序列号。正式包 `uk.thewyj.app` 为1.3.37/code50，独立目标 `uk.thewyj.app.debug` 为1.3.37-debug/code50，测试包为 `uk.thewyj.app.debug.p03acceptance`，保留既有 `.debug.test` 及其他QA包。三个包主用户UID各不相同。

正式APK公共签名SHA-256 `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`；QA签名 `9ea45db6e2c398de90ce61affd145e432d63d0d1724dd6447ba4ba24193f4fac`。provider authority均使用Debug包名，无sharedUserId，禁止AutoBackup。没有读取签名私钥或正式账目。

最终QA APK SHA-256：`7035533a08fb9235f4312f6884853c4670e147a3d1185c4c646900a318d5e2b6`，83222620字节；测试APK：`555f2bec3995fa96b1c1a7b48fc6f8c81bdf4bdd1f9c4403f929466f84cdbb2b`，2806504字节。规范保留副本位于 `device/artifacts-final/`，详见 [apk-final12.json](../migration-evidence/finance-p03/device/apk-final12.json)。这是一份带明确隐私约束的Debug验收派生包，不是正式发布包。

实际复制124份产品源文件，MainActivity字节不变；仅3份生成副本有QA隐私差异，见 [source-overlay.json](../migration-evidence/finance-p03/device/source-overlay.json)：NLS在读取extras前仅放行自有QA/测试包/shell且tag为FINANCE_P03_，仅回放已知合成keys，不启动MediaStore观察；无障碍在窗口访问前拒绝私人来源，资源禁用截图；WebView拒绝非loopback网络。SMS/媒体/安装权限与SMS receiver从QA manifest移除。这些派生差异限制了验收覆盖，不能把整包称为完全等价正式应用。

QA的Activity生命周期探针只记录本包元数据，前台MainActivity使用窗口FLAG_KEEP_SCREEN_ON，窗口停止即清除；不改锁屏、Freecess、硬件加速或系统CA。SDK辅助Activity最终使用AndroidX原始manifest。D-01/D-02历史结论保持CLOSED，本轮没有用不充分证据重开或改写旧报告。

HTTPS仅监听PC 127.0.0.1:19443，通过本轮adb reverse连接；应用仅信任本地测试CA，不绕过SSL验证。真实Pages catch-all路由、middleware、Task20/12认证及本地持久Miniflare D1服务一个合成账户。TASK15本地开关只满足既有网页health依赖；Workers AI关闭，无Production绑定或真实云端调用。

## 本轮自动化与冻结矩阵

所有下表结果为本轮重新执行，不把旧PASS算入；测试集合有交叠，禁止加总。

| 集合 | PASS | FAIL | SKIP/NOT TESTED与说明 |
| --- | ---: | ---: | --- |
| 原607：588 JVM+13 Node+6 DOM | 607 | 0 | 0；原3处P03夹具证明条件仍披露，未新增放宽 |
| 标准JVM总集合 | 681 | 0 | 0；包含P03部分测试，非额外681个独立能力 |
| 原P03新增63 | 63 | 0 | 本轮逐case ID复验 |
| 既有清算41 | 41 | 0 | 同上 |
| 既有修正/映射99 | 99 | 0 | 同上 |
| 既有统一新增79 | 79 | 0 | 含18 JVM、服务/验签/迁移/投影及跨JVM；不是本轮新造79个真机PASS |
| 冻结608行 | 536 | 7 | 42 EXPECTED_RED、23 NOT_TESTED；状态变化0 |
| 产品Lint+Debug | PASS | 0 | Lint85 Warning/12 Hint，无Error/Fatal |
| 最终QA Lint+Debug | PASS | 0 | Lint88 Warning/12 Hint，无Error/Fatal；所有失败尝试保留 |

四组新跨JVM/HTTP/D1桥接请求数分别9、15、34、35，均PASS，seed/restore PID不同。真实Miniflare本地持久目录关闭复制、独立重开核对98张表及序列PASS。原Room迁移、异常回滚、旧写端失败关闭与新增服务回归均重新运行。

完整命令、退出码、起止、JUnit、case实际值和失败栈见 [delivery-final/summary.json](../migration-evidence/finance-p03/device/delivery-final/summary.json)、[failure-ledger.json](../migration-evidence/finance-p03/device/delivery-final/failure-ledger.json)、`*-run.json`、`regression-commands.json`、`node-device/exits.json`、`frozen-node-commands.json`。最初3个冻结Node重放因旧输出根保护而在执行case前退出，保留为宿主失败；改为新输出根后原脚本实际重跑，Web/DOM红灯退出1、D1退出0，未把guard退出当业务通过。

## 真机实际结果

| 项目 | 结果 | 实际边界 |
| --- | --- | --- |
| 包/模型/SDK/隔离环境与加密会话登录 | PASS | 自有Debug、真实Keystore与Task20认证；合成账户 |
| 原生Room9→14 | PASS | 精确旧schema9夹具，原ID/金额保留；不是正式私库升级 |
| 13→14中断与重试 | PASS | 注入DDL失败真实回滚至13，再重试14；原行不丢失 |
| 闭库+成对outbox备份恢复、旧9 opener拒绝 | PASS | 原生SQLite/Room；不是完整旧正式APK或正式备份 |
| 原生清算/退款→Room→outbox→认证HTTP→D1→回执 | PASS | 显式合成核心输入：授权200、Capture80+90、解除30、退款20；3笔账，净支出150 |
| 断网与提交后503 | PASS | 只使本地QA backend返回503，未改手机网络；真实提交后丢回执，原请求重试幂等 |
| 自有进程停止重启 | PASS（账本/凭据/原ID/outbox） | 明确是本轮QA force-stop；不能冒充系统低内存回收 |
| 记账概览、历史、主页汇总 | PASS（执行过） | 真正MainActivity/WebView，170.00/20.00/-150.00，历史3笔；非桌面DOM替代 |
| MainActivity stop/resume/recreate连续矩阵 | **仍保留FAIL** | 最终同APK4组各6方法：合计23 PASS/1 FAIL（重复执行数），独立6方法；后三组全通过不覆盖首组失败 |
| 实际受控息屏/亮屏/恢复 | PASS一次，另一次SKIP | 原生power状态与RESUMED；后续已锁屏的检查跳过，没有把跳过算PASS |
| NLS真实通知、更新、移除重现、同额紧接、双来源 | 最终8/8 PASS | QA包UID与shell UID；最终候选重新执行8/8，正式账型数量仍3、净15000分 |
| 普通模式无障碍绑定 | 见下方最终读回 | 仅自有QA页面/状态；真实支付页面/截图/OCR未执行 |
| 真微信/支付宝支付、真实云/正式账/正式备份 | NOT TESTED | 无授权数据/账户/正式导出；未发支付、转账、退款或消息 |

普通模式最终读回：`{"status": "PASS", "utc": "2026-10-20T08:52:48.375358+00:00", "normal_mode_no_instrumentation": true, "observed": [{"elapsed_ms": 369.78, "accessibility_manager_enabled": true, "own_accessibility_enabled": true, "own_accessibility_connected": true, "qa_screenshot_count": 0}], "system_readback": {"device_alias": "Samsung-P03", "api": 36, "model": "SM-S9360", "user": 0, "formal_nls_enabled": false, "qa_nls_enabled": true, "qa_a11y_enabled": true, "qa_installed": true, "unique_test_installed": true}, "owner_normally_enabled": true, "reason": "Normal service enabled and actually connected; synthetic scope only. No payment recognition/OCR claim.", "earlier_not_tested_readback_preserved": "accessibility-normal-final.json", "evidence": "accessibility-normal-owner-confirmed-owned-snapshot.json", "true_business_ocr": "NOT TESTED"}`。

所有者最后正常开启后，普通运行已实际确认manager enabled、QA服务enabled及connected均为true，截图数0。前一次未启用的NOT TESTED读回与两次仪器化失败均保留；这次仅验证服务绑定，不证明支付页面识别。全部验收结束后才执行单独维护用例关闭QA捕获，再停止本轮QA进程；该维护方法不计入607、P03业务集合或最终四组矩阵。

NLS最终8行的独立case与字段在 [notification-os-final12](../migration-evidence/finance-p03/device/notification-os-final12/summary.json)。同slot更新/移除重现key保持一致而postTime改变；同额紧接两个不同slot的实测postTime差为1ms（不伪称0ms）。这些字段证明通知实例/投递，不证明两个独立Capture或修订前驱。工作资料/分身、多钱包真实账户、真实微信/支付宝来源均未因此验证。

QA旧发送夹具固定 `Notification.when=1000`（1970）时自身通知不进入活动队列/回调。原6个失败及仪器化失败均保留；同APK、同包/UID/tag/channel/body的反向序列“旧时间不回调→当前时间回调→移除→旧时间不回调→当前时间回调”确认QA夹具时间因素。修正只作用于新QA发送器和新测试，不改冻结608，不改产品识别。准确的平台丢弃实现未调查为系统/驱动根因。

最早UI宿主遗漏/select、status/health路由或本地开关，错误deep link，以及一次错误模块导入，全部保留；最终改用真实产品路由而非伪造health成功。早期QA manifest覆盖SDK helper导出/主题，已恢复SDK默认，未把该清理直接宣布为所有生命周期失败的根因。锁屏在原生Keyguard检查中实际确认，所有者正常解锁后原UI用例完整通过。

最终连续矩阵第一组仍发生ActivityScenario请求RESUMED而最后STOPPED，109.113秒完整退出，非PC watchdog强杀；本轮没有取得该次失败瞬间的有效自身栈。随后有采样6/6、无采样两组各6/6，主线程采样正常轮为do_epoll_wait，不能反推失败轮根因。[四组重复与原失败](../migration-evidence/finance-p03/device/delivery-final/physical-batch-repetitions.json)、[只读采样](../migration-evidence/finance-p03/device/lifecycle-watch1.ndjson)保持完整。此额外门禁仍未归因，不宣称产品修复，也不推翻D-01历史受控结论。

NLS后台回调曾实际观察；完整“force-stop后新key”恢复脚本仍有10秒无回调失败，未计完整PASS。QA回放为保护隐私只允许已知keys，不能据该失败直接归咎原产品完整回放。真正系统LMK和未观测新通知的系统恢复仍NOT TESTED。仪器化期间无障碍绑定两次失败保留，最终普通运行验证与该测试分开，不能仅凭设置开关算绑定成功。

## 提供方、C005/C007与冻结红灯归属

当前消费者入口取得package/UID、Android用户域、notification key/id/tag/channel/postTime/when、MessagingStyle线索及本地title/text/bigText/subText/textLines等。AndroidPaymentRecognitionHook已经使用textLines，infoText/summaryText有归档但不作为交易证明。没有真实提供方样本证明本轮丢失了已存在的合法Capture/修订引用，不能据合成字段推定产品缺陷。

商户接口可有商户/App/付款方作用域、独立订单/退款operation、原交易对应及签名；消费者通知身份不能替代这些字段。`task21-provider-evidence.mjs`仍是只读验签事实适配器：微信精确RSA字节+AES-GCM与付款方金额、支付宝精确签名响应绑定持久请求；不虚构消费者API，不把查询时间当revision。`revision=null`、`can_authorize_correction=false`；未接入公开自动修正授权。公开入口默认拒绝，不能伪造官方凭证来完成真机“自动更正”。

C005原样：200授权、80与90清算共用同一字面家族引用、200解除；期望17000分、实际8000分。缺独立Capture引用/版本前驱，90可能为另一Capture、对80的修正或重复流，通知更新/移除/postTime不能消歧。C007原样无引用，期望17000分、实际0分；不能可靠关联授权/清算/解除。两项均EXPECTED_RED。带独立引用的80+90原生设备路径另外通过，不替换原样本。

安全合同：保留源事件、候选、旧账ID、旧回执与隔离原因；只有同账户/发行方/来源实例、合法独立操作引用或明确前驱与精确revision集合可恢复。人工拒绝/编辑优先；不靠金额、商户、时间相似度合并或生正式支出。这是安全隔离，不是原17000业务目标已经满足。所有者尚未批准改变原合同，因此不关闭P03。

以下49条旧FAIL/EXPECTED_RED状态全部保持，原输入、期望、实际与错误栈见 [冻结608逐行](../migration-evidence/finance-p03/device/delivery-final/frozen-608.json)。A组和C005/C007属P03身份/清算证据边界；CW旧模型直接把授权包装成expense的目标仍需历史格式/迁移合同验收，不能以新入口不生成授权账抵扣。D货币/汇率属P04、E页面/OCR属P05，本轮不擅自开发；P06真实模型仍未测试。

| case ID | 最终原状态 | 范围/处理 |
| --- | --- | --- |
| A009 | FAIL | P03 identity/evidence contract unresolved |
| A011 | FAIL | P03 identity/evidence contract unresolved |
| A021 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A023 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A069 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A071 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A117 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A119 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A165 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A167 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A201 | FAIL | P03 identity/evidence contract unresolved |
| A203 | FAIL | P03 identity/evidence contract unresolved |
| A213 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A215 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A261 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A263 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A309 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A311 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A357 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A359 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A393 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A395 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A405 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| A407 | EXPECTED_RED | P03 identity/evidence contract unresolved |
| C005 | EXPECTED_RED | P03 lifecycle/legacy model unresolved |
| C007 | EXPECTED_RED | P03 lifecycle/legacy model unresolved |
| D004 | EXPECTED_RED | P04 currency/FX; not changed |
| D008 | EXPECTED_RED | P04 currency/FX; not changed |
| D012 | EXPECTED_RED | P04 currency/FX; not changed |
| D016 | EXPECTED_RED | P04 currency/FX; not changed |
| D020 | EXPECTED_RED | P04 currency/FX; not changed |
| D024 | EXPECTED_RED | P04 currency/FX; not changed |
| E004 | FAIL | P05 page/OCR recognition; not changed |
| E007 | FAIL | P05 page/OCR recognition; not changed |
| E008 | FAIL | P05 page/OCR recognition; not changed |
| DW-FMT-JPY-10000 | EXPECTED_RED | P04 currency/FX; not changed |
| DW-FMT-JPY-12345 | EXPECTED_RED | P04 currency/FX; not changed |
| DW-MIX-USD | EXPECTED_RED | P04 currency/FX; not changed |
| DW-MIX-EUR | EXPECTED_RED | P04 currency/FX; not changed |
| DW-MIX-HKD | EXPECTED_RED | P04 currency/FX; not changed |
| DW-MIX-GBP | EXPECTED_RED | P04 currency/FX; not changed |
| DW-MIX-JPY | EXPECTED_RED | P04 currency/FX; not changed |
| DW-HISTORY-2026-10-18 | EXPECTED_RED | P04 currency/FX; not changed |
| DW-HISTORY-2026-10-19 | EXPECTED_RED | P04 currency/FX; not changed |
| DW-FX-MISSING-OFFLINE | EXPECTED_RED | P04 currency/FX; not changed |
| CW-AUTH-POST-RELEASE | EXPECTED_RED | P03 lifecycle/legacy model unresolved |
| CW-HOLD-ONLY | EXPECTED_RED | P03 lifecycle/legacy model unresolved |
| DW-DOM-MIXED-budget | EXPECTED_RED | P04 currency/FX; not changed |
| DW-DOM-MIXED-category | EXPECTED_RED | P04 currency/FX; not changed |

## 备份、升级与回退

仅拉取正式安装位置的**公共APK代码**，SHA-256 `9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a`。该APK的Room委托identityHash与仓库schema9精确匹配：`d5362a876890e777ee3c1276a5c4ddf0`，见 [public-apk-room-delegate.json](../migration-evidence/finance-p03/device/public-apk-room-delegate.json)。未打开正式私库，所以实际user_version/行内容及完整原地升级仍NOT TESTED。

设备已验证匹配schema9副本→14、13→14中断回滚/重试、闭库Room+outbox成对副本及旧9 opener失败关闭。JVM中的旧Room11/12/13、D1中断重放与旧75e6561真实Task16/21写端503均重新通过。旧账ID、回执、journal和序列保留；重复DDL无损拒绝。完整旧正式APK访问新数据库、正式导出格式、Production Time Travel/云恢复未执行。

本地QA D1关闭后独立恢复，原3条账的ID/金额/revision/status逐字匹配；为新运行实例旋转的只是合成账户凭据。关闭复制98表原生目录的测试是本地Miniflare二进制恢复，不能冒充Cloudflare正式备份。正式部署继续阻断：先停止所有写入口并保全在途水位，取得合法一致Room+outbox与D1恢复点，在独立目标核对原ID/receipt/替代关系/孤儿/重复，再验证新候选与旧写端失败关闭。无差额保全及重放不能回退快照；Git回退不是数据库回退。

## 保护、清理与停止结论

正式APK公共hash、签名、版本和lastUpdateTime（2026-10-10 15:24:26）前后未变；正式私库、账户账目、聊天和交易未读取/导出/迁移/清除。正式内容“未变化”未通过读取私库证明，明确NOT TESTED。所有者按正常设置暂时关闭正式通知监听并授予QA权限；本工具没有用adb写系统授权、锁屏、Freecess或安全策略。

固定主工作区、Task26、Hotfix、D-01/D-02、原P02及旧raw共13组保护比较见 `protected-final.json`；本轮起点3909份既有历史文件只允许当前统一报告变化。旧报告/旧封存仍可由原Git提交复核，不因更新本报告改写旧结论。

按所有者最后要求，清理范围限本轮可重建build目录、生成源码副本、提取DEX与新生成测试私钥/合成认证runtime；保留源码、必要夹具、公有CA、规范APK、完整失败/JUnit/原始日志及哈希。清理记录：CLEANED_REBUILDABLE_ONLY，291123553 bytes；完整路径与保留清单见 cleanup.json。手机仅移除已知本轮合成通知，关闭QA捕获并停止本轮QA；不卸载、不清应用数据或其他QA包。正式通知监听在合成通知全部清理后可由所有者按原系统流程恢复。

手机维护的空tag命令错误、旧事件日志缺少移除回调导致的一次INCOMPLETE均保留在 `phone-notification-cleanup/`、`phone-notification-cleanup2/`。最终依据本QA的当前active集合为空及全部已知shell合成tag实际removed回调核验清理，未枚举私人通知；[最终清理核验](../migration-evidence/finance-p03/device/phone-notification-cleanup-final.json)同时披露4条旧QA回调缺口。维护没有降低业务断言。最终正式公共APK/版本/UID核验见 [device-final-protection.json](../migration-evidence/finance-p03/device/device-final-protection.json)。本地后端正常关闭后，保留28张纯合成财务表33行（3笔账）及639次请求路径/状态日志；删除测试私钥与包含认证的运行数据库，不将其加入封存。手机停进程导致QA无障碍再次停用属于本轮维护后的状态，不覆盖此前普通模式绑定PASS；正式通知监听仍保持所有者临时关闭状态，工具未恢复授权。

仍未满足的条件：真实提供方合法作用域/关联/修订证明与自动授权入口；C005/C007原目标；真实微信/支付宝、真实通知/无障碍识别、RC-6历史来源、真实云与正式备份/旧APK；另保留上述一次连续生命周期FAIL及真实LMK未验证。不得以“已能写代码/安全拒绝/后续单次PASS”宣告COMPLETE。

自行搭建的本地沙箱已完成，不再要求所有者提供其已明确不存在的材料。下一步最少外部条件是：合法只读提供方/账户绑定及关联证明、正式备份/真实业务的明确授权，或所有者明确决定是否改变无法从信息中恢复的业务合同；同时需保留生命周期额外失败的关闭门禁。本轮停止于P03的PARTIAL交付，不自动进入其他阶段，不推送、合并或发布。

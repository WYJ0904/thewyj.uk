# FINANCE P03/P04/P05 Samsung 联合验收报告

2026-10-26，Asia/Hong_Kong。**P03/P04/P05 = PARTIAL；D-01/D-02 保持 CLOSED。**

本轮仅开发、隔离测试及本地提交。项目 Production D1/R2/Pages、共享 Preview、既有独立 P04 Preview 均未修改；没有 push、merge、PR、正式签名或发布。真实 Workers AI 调用仅使用脱敏合成字段，独立于项目正式财务环境。

起始封存 `425776f086d5a2b9165f9b9de311826a8d218f9e`。工作树 `%USERPROFILE%/.codex/worktrees/finance-p04-multicurrency/thewyj.uk`，分支 `codex/finance-p06-ai`。产品修复提交 `a57ce56e7045167389ebbf7726c49fd043c5c7a7` 与 AI 实施 `07e54f94ea633661f95a8ad3a6ab8e88028fdc07` 分开；后续源绑定修复 `56f5c4921896f540ac0c4b167c26c1a676a00889`、原生授权/并发策略修复 `878f135dfca4d5d100aca65e18c1da7c3d8b3e10` 均保留。最终文档提交由 `finance-p06/FINAL_PROVENANCE.json` 绑定，避免报告包含自身 SHA 的循环引用。

## 设备与隔离

Samsung SM-S9360，Android16/API36，序列号仅公开尾号 EHJN。原系统指纹及完整命令保留在 `docs/migration-evidence/finance-p06/device/baseline/`。现有 user0、95、150 未变；主微信 UID10390、分身 UID9510390，用户150未发现微信。本轮未建立手机工作分区。

正式 App 保持1.3.37/code50，APK SHA256 `9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a`，初始公开APK签名验证 PASS，证书 SHA256 `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`；收尾 APK 哈希相同。正式私有数据库未读取，不能宣称取得了其字节级哈希。

仅使用 `uk.thewyj.app.qa.financep06` / `.test`，未覆盖正式或旧QA包。正式无障碍服务按既有所有者授权暂时暂停一次，取证后恢复原列表；正式通知监听在本轮基线已关闭，保持关闭。QA未申请通知读取或无障碍敏感授权，SDK/流水线通过隔离组件测试运行，不能冒充真实OS通知采集。

## Samsung OCR与生命周期

| 轮次 | 结果与边界 |
| --- | --- |
| p03-p05-r1 | 33像素中28 PASS/5 FAIL，另有QA lifecycle失败；原件保留 |
| p03-p05-r2 | 构建后中断，仪器化 NOT_TESTED |
| p03-p05-r3 | 31 PASS/2 FAIL；修复中出现的人工候选回归保留 |
| p03-p05-r4 | 同33图及同断言全部通过；5方法与独立恢复1方法通过 |
| p03-p05-lifecycle-r1 | 普通Activity30轮、未登录MainActivity30轮通过；该批在所有者舒适度反馈前完成 |
| joint-r8 | 当前产品源码：33 SDK像素、3个SDK保护方法、原生种子/新进程恢复2方法、Chrome8检查全部通过；真实收款页字节另作1个诊断 |
| emulator-joint-r3 | 与Samsung同APK哈希，独立API36虚拟设备；同合成链路及60轮生命周期对照通过 |

产品OCR最小修复涉及聊天损坏标题负向否决、待处理二次裁剪保留、全角单位独立读取、非金额时间标签及未知单位人工候选保留。新增7个原生回归全部通过。90秒、8次、250ms和单SDK任务10秒未改变。D-01的辅助Activity配置只修QA，不归因三星驱动，不改产品硬件加速。60轮MainActivity是未登录入口，不能证明登录后财务WebView或真实同步生命周期。

所有者反馈快速开关刺眼后，真机快速矩阵被禁用。后续聊天导航每次停留10秒；joint-r8为零前台Activity切换。压力循环只在无窗口模拟器运行。

当前Samsung APK SHA256：`c91ec86299b519361465fb24a33431d28ded18cffcf05c6a2a51af6728b225cc`；测试APK：`bac2a1eb747fe2756d6d2eb7d2ea9c593c36af33143ca149ffb2aaaf7d941136`。精确编译源和最终源码逐文件绑定见 `finance-p06/source-binding.json`。Samsung同33张PNG与r4哈希一致；模拟器只声明同输入配方，不把不同系统字体的像素冒充相同。

## 真实微信观察及未闭合链路

实际进入主微信相关转账聊天并观察已有收款详情，没有再次付款、转账、发送消息或领取。页面收款状态已显示，真实SDK读得小数候选0.01；未给默认币种时，产品结果为 `amount_minor=null / amount_decimal=0.01 / currency=null / completion=false`，零写账。所有者声明的CNY与页面单独的¥符号分开记录。缺少可绑定的业务引用及本轮真实历史通知，付款侧同一交易的严格关联未证明。

因此真实通知→无障碍→Room→Outbox→Hosted D1→Web完整链路仍为 NOT_TESTED，不能以页面可见、合成流水线或单笔真实转账替代W01–W10十次独立场景。支付宝按所有者条件豁免处理；微信完整门禁尚未通过，不记作实际执行PASS，原行数保留。

## 合成联合链路与保留的失败

joint-r8实际经过SDK→原生可选缓存→普通Outbox→认证HTTP→本地D1→Web编辑器→D1冷重建及回执重放→Android新进程拉回。同一原事件始终对应一笔CNY8800（人工将建议9000改为8800）的合成记录；采用建议只填表，确认前零账目，丢回执和重放后仍只有同一ID。模型为受控Mock，真实模型API另行计量，不冒充此链路的一部分。

joint-r1的stdin阻塞、r2的二进制传输损坏及缺少前提、r3缺少普通核实票据、r4字母引用被真实OCR误读、r5缺少canonical pending hint、r6网页按钮未恢复的失败全部保留。r4误读引用时产品正确拒绝；另建数值引用正向对照，并未修复或翻绿原字母图片。未修改冻结608或C007原真值。

## 当前回归与保护

| 集合 | 本轮当前结果 |
| --- | --- |
| 标准JVM | 821 PASS / 6 FAIL |
| 原607 | 602 PASS / 5 FAIL |
| 冻结608 | 552 PASS / 5 FAIL / 28 EXPECTED_RED / 23 NOT_TESTED |
| 原26身份红项 | 4 FAIL / 22 EXPECTED_RED |
| 新增OCR7 | 7 PASS |

原六项保留：

| 类 / 方法 | 最终结果 |
| --- | --- |
| AndroidPaymentRecognitionHookArchiveTest.messagingStyleLinesReachThePaymentParser | FAIL |
| AndroidPaymentRecognitionHookArchiveTest.incompletePaymentCarriesAuditableReasonCodesWithoutRawText | FAIL |
| FinanceP03IdentityLifecycleTest.laterReferenceEvidenceAttachesWithoutRenamingEarlierBooking | FAIL |
| FinanceP03IdentityLifecycleTest.durableMessageProofSurvivesRegistryCacheReplacement | FAIL |
| FinanceP03IdentityLifecycleTest.multipleOrdersOnOneMessageProofForceASeparateReviewSeries | FAIL |
| LocalPaymentBookingTest.offlineCaptureReceiptAndReplayKeepOneLedgerAndCloseArchive | FAIL |

MainActivity真实登录金融页、真实通知抵达、RC-6真实历史来源、真实云端与正式备份恢复仍独立 NOT_TESTED；历史财务Activity异常仍 INCONCLUSIVE。原来的一次重测PASS没有覆盖旧FAIL。13组保护结果见 `protected-final.comparison.json`，正式App/微信UID/profile及权限收尾见 `phone-cleanup-r2/result.json`。测试包已移除，私人证据以CurrentUser DPAPI加密保留并验证，明文清理另有清单。

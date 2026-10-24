# FINANCE-P03/P04 — Samsung 与真实微信验收

2026-10-24，Asia/Hong_Kong。**整体验收 PARTIAL；微信完整端到端 NOT TESTED。** 本报告记录本轮实际执行的设备组件及只读真实页面证据。金额识别成功、导航成功或合成同步成功均不能替代完整业务验收；未执行项目不计 PASS。

原始证据根目录为 `docs/migration-evidence/finance-p04/closure-current/`（下文简称 `E/`），为本地忽略目录。执行合同参考 [剩余验收矩阵](../ANDROID_HOTFIX_REMAINING_ACCEPTANCE_MATRIX.md)，权限以所有者本轮最新授权为准。后续授权缩小为仅微信真实业务；不要求支付宝真实支付，不授权工具再次支付、转账、领取或发送消息。

## 1. 验收对象与计数边界

| 对象 | 实际身份 / 边界 |
| --- | --- |
| 设备 | Samsung SM-S9360，Android 16 / API 36；仅已确认设备，未建立新 profile |
| 正式 App | `uk.thewyj.app`，1.3.37 / code 50；未用 QA APK 覆盖、清库或执行正式数据迁移 |
| 独立产品宿主 | `uk.thewyj.app.qa.financep04closure`；独立合成账户、Room、Outbox 和隔离后端 |
| 独立观察器 | `uk.thewyj.app.qa.financep04navigator`；与产品宿主分开作为 instrumentation target，避免为观察服务而重启其所在进程 |
| 早期本轮设备基线 | 产品源码 `94ab0fc82bc5b21b4f04237ff110574d10da565c`，由封存基线 `329aa0c8da33776d72bc778c9a3737865d26fd6f` 构建；本轮新执行，不能当作最终 OCR 修改后的重测 |
| 最终 OCR 产品源码 | `73764f77fd02ada240e41c24734e523c5dad8805`；仅实际证实的 OCR 币种上下文 / 金额区域确认修复，提交内容由统一报告另列 |
| 最终设备 QA APK | SHA-256 `0bf2e0d86f54094bded40313527453cfbe628c34fd9f2bd8d408207ef0b25d4d`，83,266,599 bytes；`E/device-ocr-r2/build/app/outputs/apk/debug/app-debug.apk` |
| 最终安装证明 | `E/phone-update-device-ocr-r2.json`；仅更新本轮独立包，44 个既有 QA 文件校验保全；清理前 `E/phone-final-data-seal.json` 再次读回实际安装base.apk SHA相同，未覆盖正式 App |

QA 宿主有明确的隐私隔离覆盖：通知只允许本轮合成来源、无障碍只允许本轮 QA 页面、WebView 指向隔离后端。`MainActivity` 与该次产品源码逐字节一致，逐文件产品 / QA SHA 在 `E/device-ocr-r2/source-overlay.json`。因此宿主证明的是限定 QA 路径，不能直接标记正式包或真实微信采集链 PASS。

JUnit 方法、循环轮次、方法内部币种向量和实际通知回调分别计数，不合并为独立测试总数。下表将早期成功与最终73764f7的新执行分开；后续PASS不覆盖原失败，未执行的完整链仍NOT TESTED。

## 2. Samsung 本轮组件结果

| 场景 | 实际执行与结果 | 证据 | 最终 `73764f77` 对应完整场景 |
| --- | --- | --- | --- |
| 独立 APK 安装、启动 smoke | 早期1方法PASS；最终首次1 FAIL：受控gate已开启，与smoke要求关闭前提不符 | `E/samsung-smoke-r1.json`、`E/samsung-final-smoke-r1.json/.log` | 证据封存后关闭QA guard，相同断言1 PASS，`E/samsung-final-smoke-after-cleanup-r2.json`；只证明清理状态，不冒充全新安装默认值 |
| 合成四组件冷备份与恢复 | 早期seed/restore各1 PASS；最终重新执行各1 PASS，临时隔离本轮QA币种偏好后按SHA原样恢复 | `E/samsung-final-backup-guard.json`、`E/samsung-final-backup-seed-r1.json`、`E/samsung-final-backup-restore-r1.json` | **PASS，同版本合成四组件**；不是正式个人备份或跨设备凭据恢复 |
| Room 实际迁移 / 回退保护 | 早期3 PASS；最终3方法PASS；旧 v9 到 v16 链、中断事务回退后重试、旧 opener 拒绝升级库 | `E/samsung-final-room-migrations-r1.json/.log` | **3 PASS** |
| 六币种 Room 与精度 | 早期3 PASS；最终3方法PASS，覆盖六币种、JPY、关闭重开及异常边界 | `E/samsung-final-six-currencies-r1.json/.log` | **3 PASS** |
| 本地账户登录 | 早期1 PASS；最终独立合成账户及本机HTTPS登录1方法PASS | `E/samsung-final-login-r1.json/.log` | **1 PASS** |
| 权限开启后的目标进程 instrumentation 绑定 | **1 FAIL**：无障碍静态连接未在原断言时间内就绪；没有删除断言或延长超时 | `E/samsung-accessibility-binding-r1.json/.log` | 原 FAIL 保留 |
| 目标进程 instrumentation 通知监听 | **1 FAIL**：监听器静态引用未在原断言时间内就绪 | `E/samsung-notification-callbacks-r1.json/.log` | 原 FAIL 保留 |
| 正常进程服务 / 通知对照 | 早期PASS；最终系统读回与连接均true，4次真实OS合成投递/更新/重投及1次移除，回调0.086–0.410秒，Room实际归档；账目数无增量 | `E/normal-notifications-final.json` | **PASS，限定合成通知**；不是微信通知 |
| 原生 Room → Outbox → HTTPS / 本机 D1 | 早期1 PASS；授权200、Capture80+90、解除30、退款20，净支出150；503/丢回执/重放最终队列0 | `E/samsung-native-ledger-http-r1.json/.log` | 原完整故障矩阵最终源码 **NOT TESTED**；最终另执行冷进程重读1 PASS，`E/samsung-final-cold-ledger-restore-r1.json`，原三ID/金额保留；不混为原矩阵重跑 |
| 实际 MainActivity 的三个 Web 财务表面 | 早期1 PASS；最终财务总额/历史/dashboard、三次STOP/RESUME/recreate、UI线程WebView 1方法PASS；不是原生通知/核实/Web全部三页面合同 | `E/samsung-final-main-surfaces-r1.json/.log` | **1 PASS，限定三个合成Web表面** |
| 普通 MainActivity 连续生命周期 | 早期30轮PASS；最终1矩阵30轮PASS，每轮956–1158ms，观察器与产品不同进程 | `E/samsung-final-normal-lifecycle-30-r1.json/.log` | **30/30 PASS**；不解释历史失败根因 |
| 正常息屏、唤醒与恢复 | 早期1次PASS；最终1次 **FAIL**：正常唤醒后仍需本人认证，原20秒检查未通过 | `E/samsung-final-normal-screen-r1.json/.log` | **FAIL保留**；所有者正常解锁后仅观察MainActivity RESUMED，`E/samsung-post-owner-unlock-observation.json`，不延长/重置断言或绕过认证；真实事件/90秒票据仍NOT TESTED |
| 实际 Android → Hosted / Outbox 跨进程恢复 | 最终r3 seed 1 PASS、不同PID恢复1 PASS；实际Task20/HTTPS、六币种各1最小单位、提交后丢ACK、精确重放、队列0、另账户不可见 | `E/samsung-hosted-native-seed-r3.json/.log`、`E/samsung-hosted-native-restore-r3.json/.log` | **PASS，独立合成NativeCloud**；r1无效device ID与r2超长引用FAIL保留，不是微信 |
| 最终实际 ML Kit / 产品 OCR | 7 个固定合成 bitmap 向量 PASS；30 次同条件重复均 PASS，即 210 次向量执行，仍只有 7 个不同输入 | `E/samsung-product-ocr-money-after-r2.json`、`E/samsung-ocr-series-r2.json`、`E/samsung-ocr-r2-round-01..30.json/.log` | **PASS，限定金额 / 币种 OCR 组件** |

两个 instrumentation 失败与正常运行成功必须并存。直接观察到 instrumentation 会影响其目标进程的服务可用性；普通进程正常系统重绑后连接成功。该对照支持测试观察方式的影响，不能据此断定产品永远无服务重连缺陷，也不能将两次 FAIL 改成 PASS。自身崩溃缓冲 `E/owned-crash-buffer-r1.log` 未提供可确认产品 FATAL 根因。

P03 早前另一次 Activity 异常仍 **INCONCLUSIVE**；本轮 30 轮新通过没有解释历史失败。独立已关闭的 D-01 / D-02 保持 **CLOSED**，不因本轮新问题无证据重开。

## 3. OCR 修复前后与保留失败

相同七个合成输入通过设备上实际安装的产品 `MlKitOcrEngine` 与 `PaymentScreenshotVerifier`，不是 mock OCR 或只测文本解析器。原始金额与断言保留：CNY `¥100.00 → 10000`、JPY `¥100 → 100`、USD / EUR / HKD / GBP `1.00 → 100`，缺少可靠币种的 `¥1.00` 必须拒绝。

| Attempt | 结果 | 解释与原证据 |
| --- | --- | --- |
| 原产品入口 before-r1 | 1 PASS / **6 FAIL** | legacy policy 1 未接收账户币种上下文；五种外币拒绝，UNKNOWN 错用 CNY。`E/samsung-product-ocr-money-before-r1-cases.json` |
| 首次修复 after-r1 | 6 PASS / **1 FAIL** | JPY 二次区域确认仍失败；未用其宣布完成。`E/samsung-product-ocr-money-after-r1-cases.json` |
| 最终修复 after-r2 | 7 PASS / 0 FAIL | policy 2 与按币种的区域 / 缩放确认；`E/samsung-product-ocr-money-after-r2.json` |
| 最终重复 r2 | 30 轮全部 PASS | 同七向量，每轮 2.803–3.097 s。`E/samsung-ocr-series-r2.json`；不作为 210 个独立业务事件 |

新增`safety10`为 **8 PASS / 2 NOT_TESTED，组级1方法FAIL**，`E/samsung-ocr-safety-r1.json/.log`。两项是explicit-usd-eur-conflict、password-page-is-not-evidence，SDK未正确保留场景必需的“支付成功”，产品null不能充作完整目标安全PASS。裸`¥100.00`无默认、默认币种冲突、JPY小数非法、多金额、聊天/商品页拒绝和两种pending方向/未完成在已观察必需OCR前提下通过。原七项UNKNOWN的`¥1.00`实际SDK曾读成`\1.00`，故原项拒绝不单独证明正确识别的裸yen拒绝；新裸`¥100.00`项提供该独立证据。

前序诊断及早期重复文件全部保留，未用最终成功覆盖。最初重复执行器第30轮输出名与汇总冲突，仅29轮执行；修正为独立series-r2输出后重新执行完整30轮，不能把首次29轮误称30轮。最终bitmap组件成功也不能证明真实提供方的账户、交易方向、独立操作引用或完成凭证成立。

## 4. 已存在的微信 CNY ¥0.01 转账

所有者声明：付款方为微信分身、收款方为主微信，金额 CNY ¥0.01；本人已领取该笔既有转账。工具没有再次转账、支付、领取或发送微信消息。页面由所有者打开；仅对指定转账详情进行最小只读观察，不扫描聊天、交易列表或其他账户资料。

早期文件名中的`main`/`clone`只是请求标签。最终证据证明取证前后OS元数据稳定在所列用户/详情窗口；**不能证明观察器实际OCR的截图层属于该profile**。QA观察器使用`UiAutomation.getRootInActiveWindow()`/`takeScreenshot()`全屏，而产品API34路径使用`takeScreenshotOfWindow`；两者不能视为等价产品服务采集。当前无足够安全材料复验截图层归属，故该归属 **NOT TESTED**，不能据OS metadata稳定把下列OCR自动绑定到付款/收款账户。[静态来源复核](../migration-evidence/finance-p04/closure-current/wechat-screenshot-provenance-review.json)记录了源码SHA和限制，历史raw未修改；未来执行器新增`image_profile_binding=NOT_TESTED`输出，不反写历史证明。

| 最终观察 | 主微信 | 分身微信 |
| --- | --- | --- |
| OS 页面元数据 | user **0**，`com.tencent.mm` / `RemittanceDetailUI`，取证前后相同窗口；截图层profile归属NOT TESTED | user **95**，同包名 / 同详情Activity，取证前后相同窗口；截图层profile归属NOT TESTED |
| 时间（香港） | 2026-10-24 10:17:48–10:17:50，仅观察时间 | 2026-10-24 10:19:18–10:19:20，仅观察时间 |
| 对QA截图执行已安装产品 OCR | `CNY` / 最小单位 **1** / `INCOME` / completion **true**；非已证user0服务采集 | `CNY` / 最小单位 **1** / **`INCOME`** / completion **true**；非已证user95服务采集 |
| 页面事实 | 可观察“已收款”；不是完整提供方业务回执 | 可观察“已收款”；没有足够付款方方向证明 |
| 可信 provider reference / 原始交易时间 | 未取得 / 未取得 | 未取得 / 未取得 |
| probe 创建财务行 | **0** | **0** |
| 稳定来源证据 | `E/wechat-main-receipt-final-r1-source-window.json` | `E/wechat-clone-receipt-final-r2-source-window.json` |
| 完整组件结果 | `E/wechat-main-receipt-final-r1.json` | `E/wechat-clone-receipt-final-r2.json` |

`E/wechat-final-role-facts-r2.json`保存限定状态词及布尔事实，无私人名称/文本。指定详情截图的金额/已收款组件观察存在；标为分身的probe输出INCOME与所有者付款角色声明不一致，**归因INCONCLUSIVE**。截图profile尚未被证明，因此不能把该probe当作“产品已读取user95付款页面却误判”的直接证据，也不能确认QA跨profile缺陷已复现。需补截图/窗口/账户一致关联后才可判断产品方向；不把completion字段等同完整转账生命周期。

两侧同额、同包名、状态相似和所有者声明不构成可供产品自动消歧的独立操作证明。不得据此跨 profile 合并、生成两笔收入、生成付款方第二笔支出，或人为补 operation ID / revision / 交易时间。本次只读探针均 `ledger_rows_created = 0`，没有把方向冲突输入正式账目。**真实通知进入 → recognition / ticket → Room / Outbox → Hosted / 云回执 → 三页面**尚未串通；真实 E2E 仍 NOT TESTED。

领取前后的旧观察另存 `E/wechat-main-receipt-ocr-r1*.json`、`E/wechat-main-receipt-accepted-r1*.json` 等，显示了等待领取与领取后的组件差异；不得用它们替代最终 profile 绑定，也不将只读观察计为独立交易。

原始截图 / OCR 文本仅在本机受限 `E/private/real-wechat/` 中 AES-GCM 加密，密钥由当前 Windows 用户 DPAPI 封装；摘要与受限证据相互校验。报告及 Git 不收录明文截图、姓名、微信号、交易单号、聊天内容、认证秘密。观察时间不冒充交易发生时间。

## 5. W01–W10 逐项状态

最新授权允许复用既有交易的真实证据，但一笔转账不自动证明十个独立场景。下表按原合同保留每行身份，完整链路均未完成，故 **0/10 完整 PASS**。

| ID | 原场景 | 当前实际覆盖 | 完整链路状态 / 缺口 |
| --- | --- | --- | --- |
| W01 | 主微信前台基线与三页面 | OS元数据user0稳定；QA截图OCR为CNY1、INCOME、completion true，截图profile归属未证 | **NOT TESTED**：没有真实服务采集到云回执/三页面同事件链 |
| W02 | 另一独立事件 / 可同额 | 未产生第二真实事件；禁止以相同金额猜身份 | **NOT TESTED**：无独立 operation / provider 证据 |
| W03 | 本机核实返回完成页 / 90 秒票据 | 仅指定详情只读 probe | **NOT TESTED**：无真实 ticket 绑定与到期链 |
| W04 | 真实事件写库后 Home / 返回 | 合成 MainActivity 组件已测 | **NOT TESTED**：没有同一真实事件写库 / 恢复证据 |
| W05 | 真实事件息屏 / 恢复 | 合成息屏一次、生命周期矩阵另列 | **NOT TESTED**：真实事件与有效票据条件未覆盖 |
| W06 | 本地保存后断网 / 恢复 | 合成 Room / HTTPS / D1 故障恢复 PASS | **NOT TESTED**：真实事件尚未合法入队，不借合成结果 |
| W07 | 同一 operation 重试不重复 | 合成 Hosted 幂等另证 | **NOT TESTED**：没有该真实交易可信 operation / receipt |
| W08 | 真实账目重启 / 新会话读取 | 合成冷备份 / Hosted 新登录另证 | **NOT TESTED**：真实记录未入账，无可重读终态 |
| W09 | 微信分身 / profile 边界 | OS窗口user95稳定；QA截图OCR为CNY1/INCOME，但截图层profile归属NOT TESTED | **NOT TESTED / INCONCLUSIVE**：QA来源关联和付款角色未消解；非已确认产品方向缺陷 |
| W10 | 同事件三页面与重载收敛 | 三个合成 Web 表面已测，不是此真实事件 | **NOT TESTED**：canonical / receipt / 真实三页关联缺失 |

微信真实通知监听交付、无障碍实际服务自动读取该事件、真实 Room / Outbox / 云回执、人工确认及恢复后的同事件去重均 **NOT TESTED**。金额 / 状态只读探针不等同于这些项目已执行。支付宝实际交易按最新范围不要求；与其有关的合成来源保护仍须保留，不能转成支付宝真实 PASS。

## 6. 仍需完成的验收和安全条件

1. 先补QA截图层、实际窗口、profile/账户的一致来源关联，再核实user95付款方向与同笔交易证明。工程侧不得用OS metadata、金额/时间相似度或虚构凭证填补；在证明前维持隔离，不记账。当前前台已非指定交易、旧task不再可用时，不扫描无关App/聊天重新定位。
2. 完成真实通知至同账户 / 同 canonical 的持久化、Outbox、合法回执、三页面和重启链。没有相应事件及授权事实的原合同维持 NOT TESTED。
3. 最终源码的已执行组件按第2节记账；原生待核实页/币种人工确认、真实账户切换/旧回执、完整90秒票据、真实事件后台恢复仍需同事件证据。正常生命周期30轮、合成Web表面与NativeCloud通过不替代这些未测合同；最终息屏原20秒FAIL继续保留。
4. 正式包、真实个人备份、Production、CI 与 RC-6 历史归因另见 [放行门禁](RC6_PRODUCTION_GATE.md)，未由独立包结果关闭。
5. `E/phone-final-data-seal.json`已记录冷数据5,658,112 bytes、SHA-256 `5dacd2735284a15dd94cc968b8270a4741601ce594c3ecf4915d3fe1b5a127a8`、实际安装APK SHA及8份真实详情密文的DPAPI/AES-GCM恢复校验。未导出明文密钥或正式App数据，不保证整包跨设备密钥恢复。随后仅4个owned APK实际卸载、QA敏感权限撤销，49个精确owned手机dump删除；正式无障碍通过正常Settings恢复，最终系统读回 **TRUE**，正式通知监听原 **FALSE** 保持，正式版本1.3.37/code50。见[卸载](../migration-evidence/finance-p04/closure-current/phone-cleanup-r1.json)、[最终读回](../migration-evidence/finance-p04/closure-current/phone-after-permission-restore-r1.json)、[临时文件清理](../migration-evidence/finance-p04/closure-current/phone-temp-final-cleanup.json)。allow点击辅助脚本因所有者已先确认、无匹配目标而终止，不能以该脚本成功作为恢复证据；结论取实际系统状态。

<!-- FINAL_CLEANUP_AND_SEAL_STATUS -->
owned手机/云/Windows清理及正式权限恢复已完成，见[CLEANUP_REPORT.md](CLEANUP_REPORT.md)；最终13组保护已PASS（E/protected-final.comparison.json）；最终Git SHA与总manifest记录于 `E/FINAL_DELIVERY_PROVENANCE.json`。未卸载微信主应用/分身、未新建profile、未清正式账库；其他来源未确认的旧QA包保留，不将其当本轮垃圾。

本报告没有删除失败、改变原输入 / 断言、修改正式数据或自行批准发布；P03/P04 关闭结论仍由全部合同及统一报告决定。


清理保留例外：`qa/finance-p04/closure/__pycache__`的最后删除被自动审批拒绝（仅`blocked by policy`，无具体理由），命令未执行、未换方式重试，故小型pyc缓存仍保留；见E/cleanup-policy-rejection-final.json。不得称零残留。

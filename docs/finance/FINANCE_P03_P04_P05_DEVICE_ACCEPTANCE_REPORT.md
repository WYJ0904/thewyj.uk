# FINANCE P03/P04/P05 Samsung 联合验收

2026-10-26，Asia/Hong_Kong。**PARTIAL，工作报告，联合验收继续。**

本轮从 `425776f086d5a2b9165f9b9de311826a8d218f9e` 开始，保留此前全部失败。
工作树为 `%USERPROFILE%/.codex/worktrees/finance-p04-multicurrency/thewyj.uk`，
新本地分支 `codex/finance-p06-ai`。本报告不授权或表示正式发布。

## 设备、隔离与正式 App

- 实际 Samsung SM-S9360，Android 16/API36，序列号尾号 EHJN。
- 构建指纹：`samsung/pa2qzcx/pa2q:16/BP4A.251205.006/S9360ZCSDCZI1_CHCDCZI1:user/release-keys`。
- 当前用户0；存在用户0、95、150；微信主应用 UID10390，分身 UID9510390，用户150未发现微信。
- 正式 App 1.3.37/code50，不可调试；公开安装 APK SHA256
  `9a4fad7f01c1dd1013efbcabd3931ea6c698b52dc2d2ce10cd18745ad7d7f55a`。
- 正式证书 SHA256 `2b322029a9b84de6f2d1ef603778b5079997a3f8df21d01ca8cb30c76b4f7d03`，apksigner验证通过。
- 独立 QA 包 `uk.thewyj.app.qa.financep06` / `.test`，开始时不存在，未覆盖已有QA包或正式App。
- QA移除SMS、相册和安装其他APK权限；本节SDK测试未开启通知/无障碍读取，未读取聊天或正式数据库。
- 全部ADB均显式选择本机 Samsung；没有把模拟器当手机。

证据位于 `docs/migration-evidence/finance-p06/device/`。公开APK、设备元数据与
私人原件分开；私人文件不进入Git或普通报告。

## 本轮发现、修复与保留的失败

| 轮次 | 实际结果 | 解释 |
| --- | --- | --- |
| p03-p05-r1 | SDK像素28 PASS/5 FAIL；主5方法3 PASS/2 FAIL；独立进程恢复1 PASS | 错误接受聊天上下文、4项识别/保留缺陷，以及QA生命周期失败；全部原件保留 |
| secondary-probe-r1 | 1个诊断方法完成 | 实际独立裁剪SDK读回，不计业务验收PASS；无expected金额输入OCR |
| p03-p05-r2 | 构建成功；控制进程中断，未开始仪器化 | INTERRUPTED_NOT_TESTED，保留APK及build.log，不推断运行结果 |
| p03-p05-r3 | SDK像素31 PASS/2 FAIL；主5方法4 PASS/1 FAIL；恢复1 PASS | 前五项修复后，新增重读丢弃两个原本正确的未知币种候选；失败保留 |
| p03-p05-r4 | SDK33/33；主5/5；独立Android进程恢复1/1 | 最终本轮OCR修复，同输入/同断言；不是微信真实交易 |
| p03-p05-lifecycle-r1 | 普通Activity30/30、产品MainActivity30/30；2个JUnit方法通过 | MainActivity未登录入口；不能代替登录后财务WebView全链路 |

三轮实际Samsung的33张原PNG及原cases.json逐项哈希相同，见
`device-input-integrity.json`。没有换字体、金额、原期望或删断言。

产品最小修复仅涉及3个文件：

1. `PaymentPageEvidence.kt`：聊天标题的分隔符及尾字丢失只作负向阻断。
2. `PaymentPageAmountSelection.kt`：明确待付款/处理中时可保留损坏金额标签，不能证明完成。
3. `PaymentScreenshotVerifier.kt`：初读负页立即拒绝；损坏单位只请求独立像素，不拼接ISO；
   单纯缺单位的精确人工候选不被弱读回覆盖；待付款的二次裁剪保留唯一已核验单位和数值，
   费用/余额/竞争值仍拒绝；严格整行非金额时间标签规范化不修改数字或交易日期。

保留90秒、8次、250ms、单SDK任务10秒。没有增加CNY默认，没有把OCR建议当成交易身份。
新增7个Robolectric方法，先保留6项原失败及1项重读回归失败，再对相关70方法执行最终定向回归，70 PASS。

生命周期失败来自本轮新QA overlay漏带D-01已确认的target-first辅助Activity配置。
补回 `debugImplementation androidx.test:core:1.7.0` 后辅助Activity与目标同UID；
原三轮及上述各30轮通过。仅修改QA，D-01/D-02保持CLOSED，不猜改产品生命周期，
不关闭硬件加速或修改Samsung冻结策略。

## APK对应关系

最终SDK复验 `p03-p05-r4/app-debug.apk` SHA256：
`1ccd15b8695bf17256a5a6910e4e4260245fd02c651b9921211c4d37a5243048`。
测试APK SHA256：`c2dc6ec1780cc9832cebb3e92be996ae345fa18a3b683e3a90b2e85a0c7dfd53`。
测试在本地提交前执行，记录的HEAD仍为起始425776f；真实编译字节以每轮
source_before/source_after为准，后续独立修复提交与这些产品字节再绑定。

## 所有者最新范围和舒适度限制

所有者授权从相关微信聊天寻找必要支付证据，不读取无关私人信息，不发起付款或领取转账。
支付宝真实支付验收在微信通过后按所有者豁免处理，原测试行及数量保留，
不冒充实际执行PASS；合成来源隔离等自动化仍照常回归。

所有者报告快速切换像闪光后，已停止QA进程。该60轮批次在停止命令前已完成，
不回写成未完成或删除原结果。之后禁用真机快速压力循环；同等断言的普通UI验证
在操作之间加入至少5秒停留，状态等待上限保持原值。压力循环使用模拟器。
`phone-comfort-policy.json`及`phone-pacing-preparation.json`记录指令和仅插入停留的QA派生证明。

## 尚未完成的门禁

真实微信聊天/转账取证、真实通知到达、双方最终状态/业务引用、真实来源进入
Room/Outbox/隔离API/D1/Web、登录后的MainActivity与息屏/恢复、P06联合链路继续验证。
此时均为NOT_TESTED，不因SDK或合成生命周期通过而关闭。

原六个JVM失败和26条身份/业务红项保留历史状态，本轮最终全量回归尚未执行；
不得将上轮统计当成本轮新结果。C005/C007缺独立事实仍为EXTERNAL_EVIDENCE_REQUIRED。
P03/P04/P05整体维持PARTIAL，P06实现与最终联合报告后续继续更新。

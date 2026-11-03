# 身份与重放可执行归因

## 已证实

1. A 中不同 providerReference 或真实 NotificationMessagingIdentity 产生的不同消息 timestamp/sender/conversation/source 能区分独立事件；同一强身份的更新/撤销重放可复用。messageIdentity 由 source+conversation+sender+message timestamp 哈希生成，不是正文或金额哈希；只改 text 保持 hash，相应实测在 A411–A416。
2. A009/A011/A201/A203 在零间隔、同槽位、先 remove、相同 postTime/正文、空 reference/message 下得到同 event ID、只有1笔而真值要求2。原因是 registry 的 removed grace 分支允许相同 postTime+evidence 复用。它是合成“隐藏真值与可观察输入不足”的复现；没有充分新事件证据，不证明真实三星吞单。
3. 未撤销同槽位完全相同正文/空身份，以及无稳定身份的新 postTime 重发，共20项 TARGET_SPEC 红灯；当前只靠有限信息无法满足所有新交易与重复事件要求。不同间隔并不等于合法身份。
4. B 中跨来源 0/5分钟/1小时/6小时及共享字面 reference 均保留2个独立来源/2笔。referenceHash 含 sourcePackage/channel；不推断跨平台字面引用可直接并账。
5. `PaymentRecognitionCoordinator.reconcile` 缺省3分钟，直接返回 Room `reconciliationCandidates`，DAO 按金额/时间最近排序且 **LIMIT 1**。B 两候选在窗口内仍返回第一项（2 EXPECTED_RED）；不产生 booking 写入。旧 hint 的唯一候选、来源约束是另一条接口，不应混为一谈。
6. Kotlin 全生产目录搜索未发现调用上述 amount/time reconcile 的静态入口；同名 PaymentVerificationState/Center/PendingReviewReconciler 是其它方法。因而只确认一个危险的可调用接口，**未复现经产品入口自动跨源合并账目**。反射/运行时动态调用、真实通知行为 NOT_TESTED。
7. 本地 D1 验证相同 event 三次只1笔、跨设备同 receipt 不变、同额同 fingerprint 不同 event为2笔、同渠道可靠引用复用、跨渠道相同引用独立、引用金额冲突拒绝；直接服务方法不等同系统采集/Hosted。

源码定位（均为未改产品）：`AndroidPaymentNotificationLifecycleRegistry.kt:64` 的 removed grace；`PaymentRecognitionCoordinator.kt:650` 的 amount/time 诊断接口；`store/PaymentDao.kt:137` 起的候选查询及146行 LIMIT 1。包路径均为 `android/app/src/main/java/uk/thewyj/app/task21/`，payment 或 store 子目录。

## 重现

`qa/finance-p02/test.init.gradle` 只添加测试 source；按 TEST_RUNS 执行 FinanceP02MatrixTest。逐条输入、event_ids、records、金额、状态和堆栈在最终 kotlin-A/B.ndjson。跨 JVM 使用 FinanceP02SeedTest 后在另一 Gradle Test worker 运行 FinanceP02RestoreTest；不能在同一个 JVM 运行来冒充重启。

## 未证实与 P03 前置

真实三星的消息槽位/profile/消息时间如何交付没有测试（本轮没有任何 ADB）。没有修改 registry、reconcile 或账本。后续先确认可观测新事件证明、缺失证明时的保守核对策略和跨来源产品政策；不得把 0/5/30 秒阈值或金额当身份。unused reconcile 的移除/收紧也须产品审查，不能只因这次直接调用红灯就猜改正在工作的入口。

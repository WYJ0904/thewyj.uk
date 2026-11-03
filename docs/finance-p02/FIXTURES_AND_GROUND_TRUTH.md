# Fixtures 与固定真值

日期：2026-10-19。全部为合成资料，无真实账户/短信/银行卡/OTP/支付凭证。

- 主集 `qa/finance-p02/fixtures/matrix.json`：525 项（A416/B26/C8/D24/E39/F12）；SHA-256 `a33d021d9919b5a7ada4ef6af6e548c88b2f2c278418df2ae6fdf9e67acc90ab`。
- 另有 JS 23、DOM 4、本地 D1/客户端 11、双 JVM 2、timing 1、实际 coordinator/Room 负样本5，F013–015 和边界方案由测试代码/最终 JSON 保存；既有 G 映射保留原 test class/method 与本轮 JUnit。
- 每项 fixture、expected、actual、结果、日志和标准化 fixture SHA-256 见 `docs/migration-evidence/finance-p02/report-results.json`。所有历史失败在 attempt1、matrix、metrics-rerun、各原始日志中保留，不覆盖为 PASS。

## 输入与真值

A 采用 2 来源×4 间隔（0/5/30/60秒）×同/异槽位×撤销/未撤销×引用/消息/空身份×新 registry/旧实例×同/异正文的 384 个组合，加 24 重放、2 交错和 6 消息身份。时钟是 fake wall clock；“restart”是同一虚拟 App 重新创建 registry，不能称真 Android 进程死亡。主矩阵会实际调用 registry、真实 Room/coordinator，用生成 event ID 入账。输入 payment outcome 的 providerReference 属合成结构化证据，不声称相同正文必然能从真实通知提取不同引用。

B 包括微信+招商包名 cmb.pb 在 0/5分钟/1小时/6小时后相同金额及相同/空引用，均保留来源；另有 1/2 候选与 0/179999/180001/300000/21600000ms 的直接 reconcile。多候选调用仅诊断返回，未接入真实入口。

C 包括 200 USD 授权→170 USD 清算→200 USD 解除、重复清算、金额变化、过期、撤销、部分扣款、退款、缺引用与两授权。本轮最终重跑已真正把合成参考号加入源文本；C008 的两个独立授权分别为 AUTH-A/AUTH-B，结算仅引用 A。初次遗漏参考号和两授权装配错误的结果另存，只用最终记录确认范围。原币/授权证据应保留且不计正式支出；不指定必须新增哪一个数据库列。结构字段探针只作诊断，最终断言针对金额/币种证据与汇总，未实现模型不能假造。

D 精度真值按用户冻结的六币种：JPY 0，其余 2；Intl 格式对照来自本机运行时。历史 2026-10-18 的 USD7/EUR8/HKD0.9/GBP9.5/JPY0.05 与翌日 USD7.2 **全是合成率，不是市场数据**。缺快照应明确未换算；不得从今天率重算旧账。主解析集同时含 USD100/$100/¥100/￥100/JPY1000/无单位及原币/清算/手续费。

E 使用完整文本行集合：698 原价、50 优惠、648 实付、352 余额，以及传统一分转账/18:49/拆符号/缺符号/646误读/冲突/列表/未完成/聊天/OTP。OCR engine 仅返回固定合成识别行（或抛异常）；验证器、二次金额校验、ticket/retry 都是真实产品类。不是 ML Kit 像素识别准确率。90秒边界、8次读取、250ms去抖、窗口复用、后台 cancel 与 overlay 边界都使用假时钟。

F 15 个 mock 示例：12 个响应/授权/白名单例子与3个冲突/可信候选/授权中途撤销线格式示例。没有生产 financial AI adapter，也没有任何付费/远端模型调用。示例不证明真实 opt-in 或脱敏已经实施；F012 的桩决议 accept 与冻结 review 期望不一致保留，产品集成仍 NOT_TESTED。

## 关键真值边界

A009/A011/A201/A203 被 fixture 宣称为两个独立交易，但可观察输入是相同槽位/正文/时间戳且无 message/reference；`new_event_evidence` 是作者意图标记，并非真实来源证明。四个 FAIL 保留，不能升级为“有充分新证据仍吞单”。相同可观察输入无法同时保证区分新交易与旧通知；P03 应先补证据合同，不能靠金额/时间强行一笔或两笔。

双 JVM 测试实际 PID 不同、Room 文件和离线队列从磁盘重开；Robolectric preferences 则显式从合成 JSON 重新灌入新的虚拟 App 目录，不冒充 Android OS 崩溃恢复。所有数据仅位于隔离 worktree 的 ignored 输出/虚拟 cache。

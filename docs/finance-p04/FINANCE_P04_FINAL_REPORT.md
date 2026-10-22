# FINANCE-P04 统一最终报告

2026-10-22，Asia/Hong_Kong。**P04 = PARTIAL；已完成当前授权范围内的非生产实现、
修复和可执行验收。** 原冻结 18 项为 12 PASS / 6 EXPECTED_RED，原 607 中的冻结
Chrome 缺币种 fixture 仍首项失败；不以派生测试代替原合同，不将部分通过标为 COMPLETE。
P03 仍为 PARTIAL，详见 [P03 统一报告](../finance-p03/FINANCE_P03_FINAL_REPORT.md)。

## 来源、继承和本轮边界

所有者明确撤销 `PAUSED_FOR_WINDOWS_HANDOFF`，要求同一云端线程继续单一 P03
收尾及完整 P04。没有分拆审批阶段、重做旧 main 或因没有手机而停下安全工程。
继承链为原 P03 `5d96e1ee5d2064076bd0efa59eed86edb9b1c4cc` → 云端 P03 收口
`dd5fc98b3ac636830a3517e2eae11fad14031b07` → 普通分支
`codex/finance-p04-multicurrency`。最终本地提交的 SHA/tree 由证据根 `REVISION.json`
固定，避免报告自引用提交哈希。

恢复前实际命令核对 HEAD/分支及检查点：77 个源码、1033 个证据、1118 个包内文件
全部 SHA-256 一致、ZIP CRC 通过；检查点 ZIP SHA-256 为
`8cad65e0922211dc803b20f82a7c9e1f8b88d376159b63ccc56b585dd8d5eb81`。
Windows 所有者提供的只读核验与本机一致；Windows 没有反向产品改动需要导入。
原检查点和全部失败日志保留；没有 reset、clean、stash 或覆盖 Windows 工作树。

本轮只用隔离云端、本地合成账号/D1/R2、JVM/Robolectric 和 Chromium。未运行 ADB、
模拟器、手机、APK 安装、权限/监听恢复、真实金融或聊天数据、Production D1/R2、
正式签名/部署/Stable/push/PR/merge/发布；未读取根目录 `访问口令.txt`。
未进入 P05/P06 或实施财务 AI/OCR；旧 OCR 的默认币种推断仅加防误解释门槛，
测试使用合成 enrichment 对象，没有调用真实 OCR。

## 最终行为及实现

| 领域 | 交付行为与安全约束 |
| --- | --- |
| 六币种和金额 | CNY/USD/EUR/HKD/GBP 保持 2 位、JPY 明确 exponent=0；严格十进制输入、整数最小单位、溢出拒绝；格式化不把 12345 JPY 除以 100 |
| 统一舍入 | JS 用 BigInt 有理数，Android 用 BigDecimal；HALF_EVEN，正负对称，只在最终目标最小单位舍入；交叉汇率不经过中间金额二次舍入 |
| 三类币种 | 原始交易币种、账户币种、展示币种独立；默认识别币种可为空，显式设置后按 revision 同步；未知/冲突符号进入核实，不偷偷设成 CNY |
| 原币/清算/手续费 | 保留 original、settlement、fee 三种证据角色及零手续费；原币金额匹配来源，拒绝字符串 minor；角色不构造第二笔交易或新身份 |
| Web 页面 | 手工交易/候选编辑、记录、首页/仪表盘、月份、分类、预算按原币或已保存参考显示；缺汇率显式分币和警告，不直接混币求和；旧 JPY 单位待核实 |
| Web 离线 | 设置 CAS 冲突保留用户选择并要求重选；历史参考离线重开仍在；配额不足先移除可重建 FX cache，原账/退款/待同步操作和 ID 保留 |
| Service Worker | 缓存命名空间追加 finance-money-v2、预缓存 money.js、更新壳使用 no-store；真实 Chromium 验证旧缓存被更新，无版本/Stable 发布操作 |
| Android | 实际通知/SMS hook 使用币种 policy 2；缓存账户默认币种、原币/单位/角色和参考；Verification/Hub/Archive 按原币格式化，未知 JPY 原金额不预填成已证零位单位 |
| 识别边界 | 币种不授予 operation 身份或完成证明；已知币种与页面冲突拒绝；未知币种不接受旧 OCR 默认 CNY；明确页面币种可补证，仍保留人工核实、不自动记账 |
| 同步/回执 | 新客户端携带 money capability 2；旧客户端读取/确认 JPY 要升级；精确旧回执先于新单位校验核验，原 body/ID/金额保留；新 unitless JPY 操作拒绝 |

主要代码为 `js/finance/money.js`、finance controller/candidates/format、dashboard/
home-widget、`functions/_lib/finance-{fx,money-units,source-units}.mjs`、Task16/21
服务和 API，以及 `android/.../finance/` 和既有识别/缓存/UI 的窄范围接入。
依赖声明、锁文件、Gradle wrapper、正式包名/版本/签名配置不变。

## FX：真实来源、时间和不可变历史

提供方为公开 **Frankfurter v2 daily reference**，使用官方 OpenAPI 的
`GET https://api.frankfurter.dev/v2/rate/{base}/{quote}?date=YYYY-MM-DD`，无 API key。
官方 README/OpenAPI 原件保留在证据目录。响应保留原十进制 lexeme，不先转二进制
浮点；校验币种对、日期/前一营业日（最多 7 天）、正数、范围和响应类型。
每请求超时最多 8 秒、批量参考总体 7 秒；并发去重、Web 每次有限批量、Android
history warm 最多 12 条，不阻塞通知上传或 enrichment。

可刷新 rate cache 为 6 小时，带 requested_date、rate_timestamp、fetched_at、
expires_at、source、rounding 和完整性摘要。第一次保存的交易参考按
账户/交易 ID/revision/展示币种固定；后续现价或 cache 变化不会重写历史。
原交易改 revision 后才生成对应的新参考。历史参考保留源金额与换算结果用于
复算校验；缺失、过期未保存、异常、离线和篡改不会回退到 1:1。
所有折算标识为“参考”，不是交易执行价或银行成交汇率，不改原金额/币种/身份。

早期 CONNECT 403 证据完整保留；本次公网实际已可达。最新 **12 项实时验证 PASS**：
五种外币与 CNY 的双向 10 对、周末前营业日、真实 D1 cache 命中及历史参考不变。
测试经既有环境代理调用产品适配器，记录实际 URL、起止 UTC、HTTP 状态、原公开
响应和 SHA-256；没有关闭 TLS 或绕开代理。模拟 FX 18 项单列，不算实时提供方结果。
这次公开汇率成功不代表真实支付 provider 身份证明、手机或 Production 验收。

## 数据迁移、旧队列与回退

- Room **14→15**：增加 `payment_money_units`，已知两位币种仅加单位证明，旧 JPY
  不补零位、不缩放；原实体金额、ID、时间、回执/outbox 保留。新独立
  `CurrencyReferenceDatabase` v1 保存参考、偏好、角色、来源单位和人工币种决定。
  Pending cache 分别持久化 JPY exponent=0 与旧 null。
- D1 **0031**：Task16=4、Task21=7，增加单位、偏好、rate/reference/role 表；旧 JPY
  保持 NULL。**0032**：增加独立来源单位表并置 Task21=8；没有重写原事件/回执。
  两次迁移只在本地合成库执行。实际 CLI 查询确认 Task16=4、Task21=8。
- 新 JPY 创建/确认明确要求零位证明；旧 pending 须重输原币金额。已存在的旧
  unitless JPY 精确回执跨两次迁移仍可重放，弱摘要旧回执逐字段比对原事实，
  改金额拒绝。旧序列化队列原 body 不改写，不给未证旧操作补一个 0。
- authoritative reconciliation（含 control 更正）在货币写入前检查 JPY 来源单位；
  无证明只进入 pending，账本前后逐字节不变；合成可信 proof 测试仍与真实 provider
  分开，默认公网调用不授予该权限。合法后继保留原交易 ID。
- 真实 D1 batch 故障测试覆盖 DDL/金额一起回滚、无损重试、部分 column 不能提前
  启用 JPY、重复无账本记录的 DDL 拒绝；完整逻辑备份恢复 **105 表**，独立 SQLite
  integrity_check 及关闭/复制/重开 Miniflare 二进制状态通过。

回退结论：升级后的 Room/D1 不支持直接运行旧二进制写入。测试实证旧 Room14
拒绝 schema15、旧 P03 服务拒绝升级后 D1。保留升级前合成快照和失败尝试，数据
恢复应基于完整备份及合适版本进行验证；不能把 Git checkout 当数据库降级，也
不能删除 ledger/outbox/用户编辑来通过测试。未声称完成真实 Cloudflare 备份或
Time Travel、正式手机数据库恢复。

## 最终验收计数

证据根：[final-20261022](../migration-evidence/finance-p04/cloud/final-20261022/)。
逐身份收集器 `qa/finance-p04/collect.py` 校验原 ID、fixture、集合大小与状态，
禁止把历史 XML、零测试或派生 fixture 混入原始结果。

| 集合 | 最终结果与证据 |
| --- | --- |
| 完整 Android | **705 PASS**，其中受保护 P03 681、P04 新方法 24；同一集合内计数 |
| Android Lint / Debug | BUILD SUCCESSFUL；0 Error/Fatal、76 Warning、12 Hint；完整 JUnit/Lint/命令已归档 |
| 精确金额/汇总 | 76 PASS |
| 模拟 FX 契约/缓存 | 18 PASS，不包含实时网络 |
| 独立 Python Decimal oracle | 216 原向量 + 3 缺失/过期检查 = 219 PASS；Android 使用同向量，互有重叠 |
| 本地 HTTP / D1 产品接口 | 35 PASS；真实环回 HTTP，不是直接 mock route |
| D1 迁移/回执/恢复 | 12 PASS |
| 实际 Chromium | 13 PASS，包含旧 unitless JPY 编辑、离线、配额、CAS 和真实 SW 更新 |
| 实际公开 FX | 12 PASS；保存实际响应，无 mock 提供方 |
| 原 607 | **601 PASS / 1 FAIL / 5 NOT_RUN**；588 JVM、13 Node、原 6 Chrome 首项失败 |
| 补币种的独立六 Chrome | 6 PASS，原断言不变；不会覆盖上一行 |
| P03 保护集合 | 63 / 41 / 99 / 79 各自全通过，不相加 |
| 新 38 / 四组桥 | 38 PASS；桥 HTTP 请求 9 / 15 / 34 / 35；两个 JVM PID 不同 |
| 二进制持久化 | 105 表内容和 sqlite_sequence 关闭/复制/重开一致 |
| 冻结 608 | **550 PASS / 7 FAIL / 28 EXPECTED_RED / 23 NOT_TESTED**；原 fixture/ID 全部一致 |
| 原冻结 P04 18 | **12 PASS / 6 EXPECTED_RED**，见逐行账本 |

以上方法、向量、浏览器用例、桥请求、原 607 和 P03 集合均可能重叠；**没有
“总计通过数”**。冻结 native 的 7 个矩阵聚合 JUnit 方法因原红项仍退出 1，不能
说该命令全绿；逐行业务状态独立保存。AI/OCR 的冻结失败/NOT_TESTED 未跨阶段处理。

Debug APK 仅作为构建证据，基础地址为 `https://isolated-finance.invalid`。
SHA-256：`9c025a3fe520238ae993471dad2fbfcb5cda95e76a4f726686cabb40d18f68b7`。
最终全量命令 UTC 为 02:57:28–02:59:06（香港 10:57:28–10:59:06），只运行一条
Gradle，没有安装。前一次 705 的全量、桥/trace 另一源集和最终 705 份 JUnit 分别
独立归档；最后只修新测试证据输出路径，原断言和产品代码不变后再跑完整三项。

## 冻结账本与残余缺口

[18 项逐行账本](CURRENCY_18_LEDGER.md) 保留原输入、断言、旧错误、产品变化和实际
新结果；[608 原始逐行结果](../migration-evidence/finance-p04/cloud/final-20261022/delivery-final-v2/frozen-608.json)
及 [非 PASS 账本](../migration-evidence/finance-p04/cloud/final-20261022/delivery-final-v2/failure-ledger.json)
不删除任何失败。只有 D012/D024、JPY 格式 2、混币纯函数 5、历史 2、缺汇率 1
共 12 行从原 EXPECTED_RED 转 PASS；其余 596 行状态不变。

仍为红的六项有明确边界：D004/D008/D016/D020 的冻结驱动没有传 fixture 声明的
default_currency，且运行 compatibility policy 1，所以仍得到 CNY；新实际 hook
使用 policy 2 和账户默认上下文，独立六条转发测试保留同输入/expected 后通过。
DW-DOM-MIXED-budget/category 的驱动没有把 synthetic_rate 交给 controller，却只
用 `/800/` 判定，虽然期望描述接受分币。产品明确分 CNY/USD、显示待折算；缺失
汇率时不从fixture外层或商户文本硬编码 7。原驱动/断言保持不动，六项不冒充通过。

原 607 的 Chrome fixture 缺 currency，当前正确显示未知/待核实，原 `/1.23/`
首断言真实失败，后五项未运行。另一个派生重放只给合成 fixture 明确 CNY、原
六断言不变并通过；它不覆盖原冻结结果。P03 原 26 条缺少可信 operation ID/
revision/前驱关系，保持 4 FAIL/22 EXPECTED_RED；历史 Activity 故障仍待真实
失败现场证据，不推断根因。外部支付业务门槛未满足，P03/P04 均保持 PARTIAL。

## 失败保留、环境和可复现入口

检查点两项 `CurrencyWireAndEnrichmentTest` 失败已通过真实 restartVerification
入口修复 fixture，保留所有原金额/币种/不自动记账断言。初次修正又暴露 fixture
同一毫秒内两个 ticket 的选择问题，推进合成时钟后 9 项 targeted 通过；最终
705 重跑通过。不是延长票据、放松身份或修改原冻结预期。

完整失败/修正过程见 [execution-notes.json](../migration-evidence/finance-p04/cloud/final-20261022/execution-notes.json)：
旧 USERPROFILE 映射错误、旧 CDP 进程/锁、直播测试新驱动键名错误、原矩阵红灯及
各早期 Android/Room 失败均保留，后续结果使用新目录。后两类驱动修正没有改产品
汇率值或断言真值。较早 702 PASS 的结果与 APK 保持历史，不作最终源码证据。

依赖和工具实际为 Node22.23.3、完整 JDK21.0.12.1+1、SDK36/Build Tools36、
锁定 Gradle9.4.1、Chromium；Android 不是可选项。只服务 allowlist Pages staging，
独立随机 `.dev.vars` 不输出/提交。本地 API 注册/登录/撤销、越权拒绝和 Chromium
登录 UI 已验证；CLI schema 查询确认 4/8。环境草稿已保存最新 schema 和说明，
未应用/发布环境配置，不保证新 VM 可从远端 main 还原本地未推送提交。

[完整命令与日志索引](VALIDATION_COMMANDS.md)、最终 `provenance.json`、
`command-inventory.json`、`REVISION.json` 保存在统一证据根。历史保护/只读 Windows
核验按来源披露，不算本轮生产或真机 PASS。完成本地提交后等待所有者审核，
不执行任何远端写入或发布。

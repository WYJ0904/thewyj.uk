# P04/P05/P06 与 P07 财务页面的最小接口兼容方案

2026-11-04，Asia/Hong_Kong。**只读分析，不修改 P07 HTML/CSS/工作树。**

财务起点为 PR #118 `fcc499ef4b33cd13d212c19523d82cd7966e2684`，OCR 候选提交为 `5f4965cc4d8ceeddf50bb4c9fdef7ba00f634f21`。
P07 本轮只读核实 PR #122 的确切 HEAD `d26bbb8112e7d10a5dfede40af0fe19c4c447866`，没有跟随未提交 WIP 或持续查询其进度。
将来的走势图、会员/账户中心或双语隔离版本需要以其新的实际 SHA 另行验收。

## 当前事实

P04 六币种代码确实存在于财务分支，包括 `js/finance/money.js`、`format.js`、`app.js`、`finance-fx.mjs` 及服务端能力守卫。
当前 P07 分支的金额编辑器仍明确标为 CNY，提交也固定 CNY；该页面未接入六币种不等于 P04 不存在。

实际读取 P07 Git blob 并运行其纯格式器：`amount_minor=123 / currency=JPY / amount_exponent=0`，显示 **`JP¥1.23`**；P04 正确显示 **`JP¥123`**。
这是受控格式器对比，不是对正式账目进行的操作。P07 旧客户端缺少能力声明时按 version 1 处理，财务后端处理该 JPY 对象要求至少 version 2，实际守卫以 `currency_client_upgrade_required` 拒绝。
因此当前不能通过单独添加 header 把旧 UI 宣称为兼容。

## 必须保留的合同

| 项目 | 当前财务合同 / P07 最小接入要求 |
| --- | --- |
| 原币金额 | `amount_minor` 为安全整数；`currency` 必须为 CNY/USD/EUR/HKD/GBP/JPY；JPY exponent=0，其余=2。不能统一除以 100。 |
| 原始金额输入 | 复用 `parseMoney(text,currency)`、`moneyText` 与 `formatFinanceMoney`；拒绝过精度、非支持 ISO、溢出和不明确符号；不从 `¥` 猜 CNY 或 JPY。 |
| 老数据 | 既有明确 CNY 保留原值。旧 JPY 单位不足、未知 ISO 或默认币种关联记录保持待核实，不补指数、不乘除 100 伪装成已验证。 |
| 版本 | JSON 同步 envelope `schema_version:1` 与 Money capability 是不同概念。`X-Finance-Money-Version:2` 理解 ISO 单位；version 3 还须保留默认币种核实状态。实际接完后才能声明 3。 |
| 核实字段 | 保留 `amount_exponent`、`money_unit_status`、`currency_review_required`、`currency_review_acknowledged` 与来源币种证据，不丢弃它们后默认 CNY。 |
| 幂等与冲突 | 原 `operation_id`、`entity_id`、`base_revision`、`since_version`、墓碑与服务端 receipt 原样保留。断网重试不新建业务身份；冲突进入原处理链。 |
| 来源与权限 | `source_kind`、身份批准、完成证明由原有受信链判定。客户端选择币种、填写金额或提高能力版本，都不能自行提升交易身份强度。 |
| 分币种统计 | 接受现有 `by_currency` 与未换算项；不同 ISO 的 minor 数字不能直接求总额。筛选、预算与 category 必须带币种。 |
| 展示币种 | `account_currency`、`display_currency` 与可空 `default_currency` 分开。默认币种不是每条通知的无条件货币证明。 |
| 汇率 | 返回 decimal string `rate`、base/quote、requested_date、rate_timestamp、source、fetched_at、expires_at、rounding、integrity_hash，汇率仅为 reference。同币种 rate=1 不代表缺失的跨币种汇率可回退到 1。 |
| 历史折算 | `references` 按 transaction id/revision/display currency 区分；保留 `original_minor`、`converted_minor`、`transaction_revision`、`reference_only`。只在目标端舍入一次，HALF_EVEN。 |
| 不可折算 | 显示原币与 `unavailable[].reason`，例如 `currency_unit_review_required`、provider unavailable、request deferred；不静默省掉金额，不改写原币账目。 |
| AI | `available:false`、无 consent、OFF/Kill、预算/超时/异常均显示可恢复不可用状态，保留原字段。采纳只填入原编辑器，显式人工确认仍独立；不自动提交。 |

现有接口，不新增平行 API：

- `GET/POST /api/finance/currencies`：preferences 与 revision。
- `GET /api/finance/fx?base=...&quote=...&date=...`：reference rate。
- `GET /api/finance/references?ids=...&display_currency=...`：逐交易历史参考快照及 unavailable。
- 原 bootstrap / transactions / changes / sync：保留原同步与能力拒绝。
- 原 `/api/finance/ai/config`、consent、evidence、suggest、suggestions：保留现有鉴权、权益、版本、预算和人工采纳链。

## OCR 候选接线要求

本轮导入的 `ReferenceOcrEvidence` / `ReceiptOcrEvidence` 尚未连接正式服务。它们只是字段候选：

1. 受信原生调用方先确认账户/profile、前台 app、权限、capture 与完整页面。字符串 `accountScope` 或 `completePage=true` 本身不是外部身份认证。
2. 保留 sourcePackage、captureId、采集时间、像素哈希、模型/variant、原始行及几何；编号不补字符、不做 0/O 或 I/l 猜测。
3. `rawNumber` 必须经完整 P04 币种/精度转换；`paidAmount`、`unambiguousText` 及两个读数一致都不是交易完成或身份批准。
4. `requiresManualReview` 始终为 true。多编号、冲突、缺单位、未完成、金额角色不足或来源不一致都进入人工核实。
5. 只有原 P03 身份/状态机与用户确认链可以形成写入；不要由新 UI 直接调用本地账本或把 AI 解释当作付款凭据。

这是一份接线要求，**本轮未实现新桥接或自动入账权限**。

## 建议的最小集成顺序与验收

保留 Flash 的布局、DOM ID 与原交互；由其所有者把当前财务控制器的精确金额、单位核实、分币种统计与错误状态逐项接回现有页面。
不要用整文件覆盖的方式把 P07 的新交互或财务分支的 P04 字段互相抹掉；asset release / service worker 缓存版本也需在最终组合版本核对。

最小组合验收：历史 CNY；JPY 整数/小数拒绝；六币种混合账本；`¥` 未知单位；旧 JPY 核实；缺汇率/过期/离线；同金额独立交易；并发修改与 receipt 重放；换账户；AI OFF/Kill/无 consent；不确定 OCR；预算币种与走势图单位。
上述纯格式器与能力守卫已本地验证；**P04 与新版 P07 UI 的实际组合浏览器/三星验收仍 NOT_TESTED**。

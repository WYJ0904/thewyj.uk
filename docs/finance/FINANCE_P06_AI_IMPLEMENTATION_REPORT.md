# FINANCE P06 AI实施与验收报告

2026-10-26，Asia/Hong_Kong。**P06 = PARTIAL；不满足正式启用或发布条件。**

本轮仅开发、隔离测试及本地提交。项目 Production D1/R2/Pages、共享 Preview、既有独立 P04 Preview 均未修改；没有 push、merge、PR、正式签名或发布。真实 Workers AI 调用仅使用脱敏合成字段，独立于项目正式财务环境。

起始封存 `425776f086d5a2b9165f9b9de311826a8d218f9e`。工作树 `%USERPROFILE%/.codex/worktrees/finance-p04-multicurrency/thewyj.uk`，分支 `codex/finance-p06-ai`。产品修复提交 `a57ce56e7045167389ebbf7726c49fd043c5c7a7` 与 AI 实施 `07e54f94ea633661f95a8ad3a6ab8e88028fdc07` 分开；后续源绑定修复 `56f5c4921896f540ac0c4b167c26c1a676a00889`、原生授权/并发策略修复 `878f135dfca4d5d100aca65e18c1da7c3d8b3e10` 均保留。最终文档提交由 `finance-p06/FINAL_PROVENANCE.json` 绑定，避免报告包含自身 SHA 的循环引用。

## 实际实现

后端使用既有Task12认证、Task13财务权限、Task16/21路由与Workers AI binding。`functions/_lib/finance-ai.mjs` 负责来源、授权、预算和决策；`finance-ai-provider.mjs` 将角色/候选ID结果归一化，金额和单位只从原始候选复制。默认必须同时配置 `FINANCE_AI_ENABLED=true`、`FINANCE_AI_KILL_SWITCH=false`、`WORKERS_AI_ENABLED=true` 及合法服务端模型；没有把正式开关打开，也没有修改Task15/26模型或额度。

现有待核实页接入可选脱敏分析、建议和原编辑器。规则已知金额、金额硬冲突、缺少UID/引用/方向/单位/完成证据、预授权/解除/过期或身份冲突均不调用模型。C005/C007缺失身份事实仍被隔离。AI不能创建金融事实、合并交易、确认支付或写账，所有建议须人工核对。

Android以独立 `FinanceAiDatabase` schema1缓存最小候选、授权及审计，主Room18/FX1不变。原生树/真实SDK的歧义候选经过账户、原票据、精确引用、单位和方向校验才进入协调器。已知单位的`currency_amount_unproven`可以接受建议，原核心待核实原因保留；其原始事件通过既有Outbox补同ID、金额为空的pending hint。没有新造provider proof、没有把模型金额上传成原事实。

Web继续使用已有财务候选展开区和编辑器，采用建议只填表，人工未保存修改优先。修复AI结束后保存/编辑/核实按钮停留disabled的问题。原生金额标签显示ISO，原生编辑器的同意、未保存修改、撤销和离开页面边界均回归。

## 安全与恢复

严格Schema、整数最小单位、六币种指数、有限角色词/品牌、证据ID和角色交叉校验；不上传截图、通知历史、聊天、姓名或真实订单号。Prompt injection、编造金额/单位/引用、选中优惠/费用/余额、低置信结果不能成为自动账。

持久缓存绑定账户、canonical hint、语义digest、模型/提示词/协议版本；同事件上限2次，日/月/用户预算及最大输出token有硬限制。0预算拒绝首次调用，尚未调用模型的配额拒绝可在额度恢复后CAS重试。原生断网授权撤销立即生效，待同步撤销持久保留。服务中断的running请求经过有界租期只转人工超时，不重新发模型请求；原远端调用是否收费不据此推断。

最后新增的三项隔离复现全部先FAIL：缓存建议遇到Kill Switch不刷新、撤销后重新授权复活旧建议、迟到running覆盖最终建议。修复后策略变更在事务中撤销旧可用建议，撤销优先于迟到授权，配置读取串行；发布SQL原子绑定授权revision和模型版本，弱状态不能覆盖已完成结果，原生显示/采用同时核对授权revision。没有更改90秒票据、金额识别、核心账本或Outbox内容。三份原失败JUnit与完全相同的新方法体保留在`native-policy-before/`；后续30个相关方法全PASS。

## 数据库及兼容

D1 `0034_finance_ai_assistance.sql`仅新增consent、observations、decisions、budgets四表。真实本地D1增量、部分batch回滚、重复迁移、原ID/金额/时间/人工备注保留及冷逻辑恢复7项通过。可选Room缓存二进制副本恢复、未来版本拒绝、主库18不升级均通过；没有fallbackToDestructiveMigration。原生策略修复只改DAO查询与JSON元数据，不增加表或迁移版本。

Git回退不能当数据库回退。未迁移正式App数据库，没有对Production D1运行SQL。旧财务数据库和回执通过本轮已有迁移/备份测试；正式个人备份、真实云端Time Travel及非兼容正式降级仍 NOT_TESTED。回退优先停用AI并保留新增表，不能删除正式金融事实。

## 实际自动化

| 集合 | 结果 | 性质 |
| --- | --- | --- |
| Native AI | 23 PASS | 真实产品逻辑/Room/JVM/Robolectric，包含并发和策略复现 |
| SDK修复防回归 | 7 PASS | 包含在标准JVM中 |
| 原P06 rich-provider契约 | 51 PASS | 受控Mock+实际D1 |
| 角色协议v2 | 23 PASS | 严格归一化/实际D1 |
| 预算与中断恢复 | 14 PASS | 实际D1/冷恢复+Mock |
| D1迁移 | 7 PASS | 真实本地SQL/事务/冷恢复 |
| 实际Chrome | 11 PASS | 实际HTTP/auth/D1/DOM；模型Mock |
| Samsung/AVD联合 | PASS | SDK/Room/Outbox/HTTP/D1/Web真实执行；模型Mock |

以上集合有覆盖重叠，不相加作为总用例数。Functions构建、模块图和storage contract均通过。当前标准JVM、Lint与Debug统计见统一报告及`docs/migration-evidence/finance-p04/p06-validation/final-r3`；原607、原六失败及冻结608没有借用历史PASS。

## 真实提供方与费用

共15次开始的`AI.run` binding调用：12次收到模型输出，3次调用抛错没有结构化输出。真实API使用临时AI binding、本地D1和纯合成脱敏输入，没有部署或绑定正式金融资源。最初12次结果保留，预算调整仅增加3次同输入模型对照。

| 轮次 | 真实结果 |
| --- | --- |
| live-r1 / r2 | 每轮3个原语义目标均FAIL，review/拒绝，没有写账 |
| live-r3 / r4 | 各1次语言/压缩诊断；不是产品业务PASS |
| live-r5，当前roles-2 | CNY退款PASS；CNY付款和JPY付款均FAIL，费用角色与净额选择冲突被拒绝 |
| live-r6 | 同退款场景重复PASS，不算新的独立业务场景 |
| live-r7，第二模型 | 3次binding异常，无结构化输出；语义能力NOT_TESTED，原因INCONCLUSIVE |

主要模型请求 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`，实际返回模型标识 `@cf/meta/llama-3.3-70b-json`。第二模型 `@cf/meta/llama-3.1-8b-instruct-fp8` 的异常原文在该轮未保存，name/status/输入hash/时间及安全失败结果保留；已补后续private异常保存，但不能猜测这三次原因。

已记录usage的调用数为12；可观测token合计 `{"prompt_tokens": 2929, "completion_tokens": 1488, "total_tokens": 4417}`，neuron字段合计 `{"neurons": "382.859937667846679"}`。调用耗时样本 `{"samples": 15, "min": 541, "median": 3487, "max": 8443}`。这些只描述已观测样本，部分调用没有usage。**实际发票费用 NOT_TESTED/null**，不把参考价格、免费额度或失败次数当作实付费用。完整逐次记录见`provider/aggregate.json`及各轮原件。

同三种当前主模型语义场景只有1/3独立场景通过，退款重复不增加分母；这一结果不足以标定真实业务准确率/召回率。合成Mock联合链路和规则33图不能替代真实模型+真实来源的联合指标。已测试错误接受路径为零自动写账，真实业务总体误记账率与人工复核率仍 NOT_TESTED，不能虚构百分比。

采用结构化接口仍须验证返回内容，官方JSON Mode也明确说明不能保证所有响应符合Schema。[Cloudflare JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)；第二模型的参数依据[官方模型页](https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fp8/)。模型可用性文档不是本账户调用成功的证据。

## 剩余门禁

主要模型付款/JPY角色质量、第二模型完整错误诊断、更大合法标签集校准、真实通知与提供方凭证、真实模型和Samsung全链路、登录后MainActivity/息屏恢复、Hosted金融D1与正式备份均未关闭。不能凭安全拒绝宣称完整业务支持。本轮未更新正式环境或既有Preview，没有可宣称已交付的P06线上Deployment ID或真实账户体验。

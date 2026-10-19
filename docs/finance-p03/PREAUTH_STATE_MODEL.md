# 预授权状态模型与限制

日期：2026-10-19（Asia/Hong_Kong）。P02基线 `6ff9b9fd89bb6dedf5837f28421825c4418925f9`；产品基线 `1398c76d9321919ac8c94550f2d23c2c8e1a1e84`；实施提交 `bbe97a6b1fdc1e618eae2b3ca7d2c87be648ed82`；分支 `codex/finance-p03-identity-preauth`。最终文档提交与Git tree见本地证据 FINAL_REVISION.json。


复用现有recognition/candidate/正式ledger。financialPhase是来源操作的结构化事实，family由referenceNamespace+lifecycleReference限定；providerReference是该次可幂等操作的可靠引用。没有共同引用不按金额/商户/时间关联。

| 操作事实 | 持久化/正式账目 | 原有UI状态 |
| --- | --- | --- |
| AUTHORIZED | 原授权金额/币种/引用保留；无正式支出 | FINANCE_PENDING_CONFIRMATION |
| SETTLED | 最终可信结算金额只记一次，不把授权额相加 | FINANCE_RECORDED；已关联hold关闭 |
| RELEASED/EXPIRED | 仅明确解除/过期证据关闭hold；不抵消已有支出 | 复用IGNORED关闭状态，原financialPhase保留 |
| REFUNDED/既有refund方向 | 独立退款ID/方向，原结算不覆盖 | FINANCE_RECORDED |
| REVIEW_REQUIRED/身份不足 | 金额、币种和冲突证据保留；不自动正式入账 | 现有待核实 |

200 USD授权→170结算→200解除最终仅170支出。重复结算/退款30次幂等；结算先到、授权后到不多记。不同授权引用同额同时存在不合并；有独立清算引用且明确同授权家族的80+90可保留两条清算并合计170。源未宣布过期时不凭时钟杜撰授权失效；7天无结算仍待结算，与90秒OCR票据不是同一时钟。

未完成部分：明确partial标记、无共同引用、无清算子ID、部分解除/残余冻结余额/复杂多次退款仍保守处理，不宣称完整清算系统。冻结C005只提供同一个AUTH引用的80与90，无法区分追加清算与金额修正；保留80及90冲突候选，不猜170。冻结C007无共同引用，0正式账且保留候选，原目标170不改。旧raw文本接口无此类型模型，授权/清算文字只入pending证据，须升级到结构化入口而非猜测关联。

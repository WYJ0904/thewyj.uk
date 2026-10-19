# 去重根因、责任与修复

日期：2026-10-19（Asia/Hong_Kong）。P02基线 `6ff9b9fd89bb6dedf5837f28421825c4418925f9`；产品基线 `1398c76d9321919ac8c94550f2d23c2c8e1a1e84`；实施提交 `bbe97a6b1fdc1e618eae2b3ca7d2c87be648ed82`；分支 `codex/finance-p03-identity-preauth`。最终文档提交与Git tree见本地证据 FINAL_REVISION.json。


CONFIRMED（源码+可失败合成回归）：原本地coordinator只按sourceEventId去重，不按可靠引用统一不同来源别名；同一引用的新ID可创建多笔。原Worker operationDigest的JSON replacer只保留顶层键，嵌套payload未进入摘要；同操作不同金额不能靠旧摘要安全判重。修复前Native12项8 FAIL、服务16项14 FAIL的完整证据保留。

修复：来源命名空间/角色与可靠引用查找、Room事务及持久别名，保留原ID；消息证明带profile UID并可在cache替换后从Room恢复。引用金额/实例冲突待核实；真实已持久化账目是权威，新冲突候选不能在第二次重放时晋升为自己的证据。post-capture的本地决定进入上传candidate门禁，review事件不借用其它hint的confirmed回执。不同订单ref优先于相同消息tuple。

旧金额/时间reconcile经全生产调用搜索无该coordinator方法调用；仍保留诊断功能，DAO取2并singleOrNull，不再在两个候选中取第一项，未接入生产记账。Task16旧raw入口另外存在score>=0.92自动合并和强引用受3分钟候选窗限制：相似度现在只提示，自动关系只接受同命名空间可靠引用；可靠引用查找跨时间窗口，多个历史ID或扫描不完整保守待核实，保留原历史账目。

回执：摘要改为递归稳定序列化；旧摘要仍保留，经完整原事件逐字段比较后允许兼容重放。确实已入账的receipt优先于迟到编辑器值，防止把999覆盖450；新不一致ingest仍拒绝。已synced本地交易不能被另一个迟到ID改名。新legacy模糊金额不正式入账，精确全别名全部confirmed且非空并一致才恢复；已存在旧账通过显式fixture继续验证保留。

边界：P02的A009/A011/A201/A203及20弱身份目标保留，输入没有足够新事件证明，且原直接调用宿主没接新Hook门禁，不能据此断言真实吞单。真实UID/消息槽位/重投递未授权测试。D-01/D-02不重开，不归因三星驱动。

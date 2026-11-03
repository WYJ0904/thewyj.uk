# P03 收尾清算与隔离合同

日期：2026-10-19（Asia/Hong_Kong；执行UTC时间见机器日志）。基线 `81d5aa7cc51b55d386b59414019c4a0f01272032`；实施提交 `69993ac2e738147ca49e5c407eae6eab39aa90f4`；分支 `codex/finance-p03-identity-preauth`。最终交付HEAD、tree和Debug APK SHA-256见 [CLOSEOUT_REVISION.json](../migration-evidence/finance-p03/closeout/CLOSEOUT_REVISION.json)。


家族键为用户+已验证发行方命名空间+显式授权引用，操作键另含角色与独立providerReference。系统槽位、金额、商户、时间不证明交易身份。部分事实必须同时有显式授权号及不同的操作引用；只有一个AUTH字面引用的80/90不证明两次Capture。

`lifecycleOperation`/`lifecycle_operation`为AUTHORIZE、CAPTURE、REFUND、RELEASE（部分解除）、CLOSE（全量解除/显式到期）；`lifecycleRevision`/`lifecycle_revision`保留来源版本，默认0代表旧消息未提供。版本>1进入`lifecycle_revision_requires_reconciliation`，不猜测它是累计额、增量额或最终替换额。

| 数值 | 合同 |
| --- | --- |
| A 原授权额 | 接受的同家族唯一原始授权金额；尚未到达时null，不从解除文本或Capture金额反推 |
| C 已清算额 | 独立可靠Capture的已记录金额，同canonical receipt只算一次；授权不计入 |
| R 已解除额 | 独立部分解除求和；全量CLOSE只在A及清算事实无矛盾时推导剩余解除额，不再次加原授权额；无法证明时null |
| H 剩余冻结投影 | max(A−C−R,0)，A未知或存在未解决矛盾时null；退款不增加冻结余额 |
| F 累计退款 | 可靠独立退款求和，新增退款必须≤C−既有F；超过时保留证据但不入账 |
| N 源净额 | C−F；正常未被用户改写的账目等于该家族净支出。正式账本被编辑/删除后的净额仍读原Task16，不能将源事实回写覆盖 |

授权不是最高扣款额度证明：可信最终Capture可以小于或大于原预留额；超出未解除授权覆盖的部分单列`overCapturedMinor=max(C+部分解除−A,0)`，不产生负H、不把授权额与清算额相加。跨币种家族冲突隔离，不做换汇。总额超出安全整数表示范围拒绝新写入并保留原账。

例如200→Capture80→Capture90→部分解除10→部分解除20→退款20和30，C=170、R=30、H=0、F=50、N=120。100授权→120可信Capture，支出120、H=0。100授权→80Capture→显式到期，只释放残余20，支出80不冲销。到期先到而原授权未到时，解除额未知；原授权到达后才可推导。没有来源到期事实时，不因墙钟或90秒OCR票据过期虚构授权失效。

这些是已接收源事实的投影，不证明银行实时可用余额或所有消息已经到齐；迟到可靠事实可以更新推导值，原事件和稳定账目ID不重建。关联不明、版本修正及金额矛盾使相应余额未知，不能将null显示为已验证0。

## 可恢复与不可自动恢复

- `lifecycle_completion_unproven`：部分清算/退款缺成功证明、解除或授权仍处理中时不能入账/解冻。完成事件必须有同发行方、家族、操作引用、角色、金额和币种的已接受回执/控制见证；重试、金额或时间相似不能自证。旧intent alias保留，完成发布使用新的不可变操作身份；迟到intent不覆盖完成态。
- 已接受的非入账控制事件闭合自身候选（复用rejected/IGNORED并保留accepted guard事实），不提前关闭仍有余额的授权，也不代表删除原事件。

- `lifecycle_capture_missing`：同发行方、同显式家族的实际Capture到达后，重新检查累计退款上限；一次有界扫描恢复，不轮询、不无限补拉。
- `lifecycle_authorization_missing`：原授权到达后重新检查部分解除及余额；全量关闭只证明关闭事实，不自动证明缺失的原额度。
- `lifecycle_refund_exceeds_capture`/`lifecycle_release_exceeds_remaining`：保留候选。只有后续精确家族事实使约束成立才能恢复，不能手工填一个金额绕过。
- 引用/资料实例/币种冲突、版本修正不随其它付款到达而自动清除。人工确认不能绕过这些阻断。
- C005若取得“90是另一独立Capture”的可靠子引用，可作为新的受证操作验证；旧歧义候选与该操作的精确映射仍须补充源事件/回执证明。不能把90重试当作证据，不能通过删旧80再建新账解决。
- 若证明90替换80，需要权威操作版本作用域、前驱版本及旧transaction/receipt对应关系，并与用户编辑/删除revision作CAS保护；当前未实现自动改写接口，继续隔离，不能宣称支持修正完成。
- C007缺家族引用时0正式账、候选及证据保留。原冻结170目标不变；后续必须取得可核对的共同引用与原发生事件关系，金额相似度不是恢复条件。

只接受测试明确提供的结构化操作语义；真实银行/微信模板是否提供这些字段仍NOT TESTED。旧raw文本接口继续保守待核实，没有扩展成第二套清算账本。

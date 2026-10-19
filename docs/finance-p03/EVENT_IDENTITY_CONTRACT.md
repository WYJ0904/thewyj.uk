# 事件身份与证据合同

日期：2026-10-19（Asia/Hong_Kong）。P02基线 `6ff9b9fd89bb6dedf5837f28421825c4418925f9`；产品基线 `1398c76d9321919ac8c94550f2d23c2c8e1a1e84`；实施提交 `bbe97a6b1fdc1e618eae2b3ca7d2c87be648ed82`；分支 `codex/finance-p03-identity-preauth`。最终文档提交与Git tree见本地证据 FINAL_REVISION.json。


| 层 | 可靠依据 | 不足时的处理 |
| --- | --- | --- |
| Android通知/SMS | 平台支付/银行解析器给出的引用+来源命名空间；或带来源/资料UID的MessagingStyle会话/发送者/消息when证明 | 无引用/消息证明进入待核实；保留金额、币种、原因、观察hash和候选 |
| messageIdentity | source+conversation+sender+消息timestamp的hash，再按UID限定；是投递/重放证据 | 不是正文hash，也不是postTime或交易号；同证明对应多订单时建立独立review系列 |
| 系统槽位 | key/id/tag仅用于捕获连续性 | 不把它或时间阈值当交易ID |
| coordinator | sourceEventId是调用者声明的稳定来源occurrence；生产调用只有Hook捕获/SMS入口并施加门禁 | 不能直接用旧测试宿主的任意ID替代真实来源验证 |
| OCR/无障碍 | 只为当前受控ticket补证据，保留UID/页面/金额冲突校验 | 金额已读到不自动清除身份、币种或清算冲突；不绕过确认 |
| 本地持久化 | 已有transactionId/实际receipt优先；新增来源映射到同recognition | 不能删旧账重建ID；业务身份不明不新建正式账 |
| outbox/云端 | 稳定operationId、完整payload摘要、源事件/平台引用/角色的别名 | 同ID内容冲突拒绝且原队列保留；旧摘要须核对已存不可变事件 |
| 用户确认 | 现有显式确认可处理普通identity_unproven候选 | 币种/清算/跨实例/引用冲突需要更多证明；未知canonical映射不能凭金额确认 |

A/B可靠重放或通知重建幂等，C不同可靠身份分别保留，D模糊输入保留待核实。金额相同、来源相同、零间隔不构成合并证据；长间隔也不解除可靠引用的幂等性。

微信/支付宝按其平台命名空间区分。同字面引用跨平台不直接并账。银行App与短信只有在已知发行方映射（例如cmb.pb/95555）或raw调用者明确声明同一canonical平台/issuer时才共享引用。银行名称文本不作为发行方证明。未知来源不猜跨平台共同引用。

Room payment_event_aliases保留来源别名/限定message证明/观察hash；proof和observation内部键不作为Web交易event_ids发布。原recognition、transaction/outbox ID不改。SDK消息when与UID的真实稳定性仍须P07设备证据；本地合成不证明Samsung投递事实。

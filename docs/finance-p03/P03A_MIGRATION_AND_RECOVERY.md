# P03-A 增量迁移与恢复边界

仅本地合成验证。原 Room1–12 导出、D1旧迁移及既有账目/receipt/outbox 保护由本轮 hash 清单核对；没有执行远端迁移。

## 模型和版本

Room12→13新增4张表：修正恢复日志、recognition 有效事实、逐通知别名覆盖、用户决定。账目仍在原 `local_payment_bookings`，原 ID 保留。迁移只 CREATE IF NOT EXISTS；旧结构和旧金额不重建。Room日志弥合数据库提交与原磁盘 outbox 写入/删除之间的进程退出窗口。

D1新增0029：4张修正/有效事件/校验/用户决定表及有效事件视图；Task21 DB metadata4→5。Task16 DB metadata1→2，以阻断不了解更正的旧财务 raw 写服务。客户端 Task16/21 wire schema仍1。当前服务兼容没有更正表的旧独立 Task16 schema1；已升级服务必须理解新身份保护。

原0028/v4不改写，0026仍属于独立Task26。正式目标分支的完整迁移顺序及该分支整合不在本轮执行范围。

## 已执行的独立门禁

- 真实文件 Room12→13 保留旧账 ID、USD金额及空修正状态；中断DDL事务回滚后重试，重复 CREATE 保留已 staged 日志。
- 实际旧 v12 Room opener 对 v13 默认失败关闭，旧 v11 opener 亦拒绝；没有安装旧APK或改低 user_version。
- Room关闭后，数据库文件和配对 outbox 分别快照、恢复到独立副本，原活跃文件不清空。
- D1 v4→v5 注入中断，新增表及metadata整体回滚，原账和旧操作回执保留；完整重试成功；重复原始DDL明确拒绝。
- 从09442c2 Git blob提取的实际旧Task21 API及旧Task16 API，在升级数据库上分别HTTP503 schema_not_ready；不是mock一个失败结果。
- 当前 status 正确认识 Task16 DB2；其它缺配置的合成本地服务降级项继续保留，不称 Production 健康。
- D1逻辑schema/行/序列导出为可检查的SQLite文件，由另一Node进程读取，再恢复到新D1 runtime。桥接在更正已提交后实际503，再重启D1 runtime、回放原请求，原账ID/修正revision保持。

这些证明本地逻辑恢复，不证明 Miniflare 内部二进制备份、Cloudflare Time Travel、真实D1备份、真实App导出或正式旧APK回退。对应项目为 NOT_TESTED；上轮持久化探针阻断资料原样保留。

## 后续部署阻断与可执行顺序

1. 另行获得所有者对真实备份/隔离恢复/部署的授权；先冻结所有财务写入口、采集和 outbox 发送，包括 Task16 与 Task21，记录在途请求及用户级水位。
2. 使用正式允许的导出通道，获得关闭且一致的Room数据库、队列、版本及hash；不得裸复制仍有WAL写入的数据库，不使用Root或绕过手机权限。
3. 获取提供方支持的D1恢复点/逻辑导出，在独立目标实际恢复；核对旧ID、货币、receipt、修正日志、有效关联、审计SHA及自增水位；验证升级后的新写入没有遗漏。
4. 审核理解Room13 / Task21 DB5 / Task16 DB2且保持wire1的候选及回退候选。备份不可恢复、旧写入口仍开放、提供方语义缺失或水位不一致时继续阻断。
5. 优先向前修复。Git回退不降低数据库版本；禁止改user_version、删除账目或清库来使旧包启动。
6. 恢复旧快照会丢失之后的新写入，不能称无损降级。只有证明没有新写入，或已经保全并审核差额重放/对账，才能评估成对恢复旧数据库和同水位队列。
7. 默认提供方验证器仍关闭。真实模板的账户/独立操作/前驱/绝对金额/完成及退款语义取得独立证据后，才能评估接入；不能把本轮合成验证器用于生产。

迁移设计遵循 [Room 迁移指南](https://developer.android.com/training/data-storage/room/migrating-db-versions) 与 [D1 batch 事务语义](https://developers.cloudflare.com/d1/worker-api/d1-database/)。实际成功/失败以本轮日志为准。未开始 P03-B、手机、真实交易、Production、正式签名、发布或合并。

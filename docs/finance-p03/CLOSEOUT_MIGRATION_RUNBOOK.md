# P03 收尾迁移、恢复与部署阻断

日期：2026-10-19（Asia/Hong_Kong；执行UTC时间见机器日志）。基线 `81d5aa7cc51b55d386b59414019c4a0f01272032`；实施提交 `69993ac2e738147ca49e5c407eae6eab39aa90f4`；分支 `codex/finance-p03-identity-preauth`。最终交付HEAD、tree和Debug APK SHA-256见 [CLOSEOUT_REVISION.json](../migration-evidence/finance-p03/closeout/CLOSEOUT_REVISION.json)。


Room11→12只增加两个默认空/0的证据列；保留1–11原schema、所有旧金额、ID、候选和outbox。D1 0028只增加两项来源事实、一项服务端核实原因及CHECK验证标记表，Task21 metadata变4，wire仍1。0026仍留给独立Task26，未复制或修改其工作区。没有destructive migration，没有批量补猜币种，没有修改正式版本/签名。

本地已验证：历史迁移链续接12，v10/11原ID及币种不变；中途DDL失败回滚后可重试；重复原始ALTER拒绝并保留原数据，正常按版本打开不重复迁移。不能把“DDL可重复执行”虚构成幂等：它会安全报错，版本/迁移账本必须控制仅执行一次。

v11 opener是从81冻结实体定义生成、使用原Room runtime的真实旧schema opener；对v12默认降级路径抛错，之后v12原行仍可读。不是安装旧APK的真机测试。D1从81复制的实际旧API/service/model在metadata4时HTTP503 `task21_schema_not_ready`，尚未进入鉴权或账本写入。这个门禁针对Task21；回退时必须同时禁止其它旧财务写入口，不能假定全站服务均被该metadata挡住。

Room关闭后复制数据库与配对队列：v11快照恢复旧1账/1队列，新v12快照恢复2账/2队列；原活跃副本不动。旧快照明确缺少升级后的新写入，因此恢复旧快照不是无损降级。D1逻辑schema/数据/自增水位在新runtime恢复，保留旧transaction/operation receipt及水位700；二进制持久化探针阻断仍保留，不以逻辑测试替代生产备份工具验收。依据[Room迁移指南](https://developer.android.com/training/data-storage/room/migrating-db-versions)和[D1事务批次语义](https://developers.cloudflare.com/d1/worker-api/d1-database/)，实际结果以本地日志为准。

## 现在可实际复验的安全恢复命令

见 `qa/finance-p03/closeout/README.md`：`prepare-baseline.py`校验旧模块，`run-gradle.ps1`运行旧opener/中断/DB与outbox快照测试；`migration.mjs`在全新空白D1 runtime执行逻辑恢复；`run-bridge.ps1`验证进程死亡、HTTP、回执和队列。本轮只运行这些合成副本，没有提取正式手机私有数据库。

## 将来部署前必须满足的顺序（本轮未执行）

1. 所有者另行授权真实备份、隔离恢复及部署，并先冻结采集、outbox发送、Task16/21 ingest、hint/confirm和其它财务写入口；记录用户级服务版本及队列水位，证明没有在途写入。
2. 通过被系统/应用正式允许的导出方式获取关闭后的Room DB及完整outbox、版本与hash清单；不能复制一个仍在写WAL的裸.db。正式App安全导出通道未验证时保持阻断，不使用Root或绕过手机权限。
3. 获取提供方支持的D1备份/恢复点和导出，记录schema/迁移账本/写入水位。到独立目标实际恢复，逐一核对旧ID、金额币种、receipt、队列、水位及孤儿/重复关联。真实云端Time Travel和正式备份本轮NOT TESTED。
4. 审查目标分支全部迁移顺序（含独立0026与27/28）、旧客户端行为和最小服务版本。协调部署理解schema4的服务与Room12客户端，绝不能先迁移后继续旧写服务。
5. 在仍冻结写入的条件下验收API readiness、队列重放、迟到回执、编辑/删除及历史候选。任一项失败、备份无法恢复或水位不一致，继续阻断部署。
6. 优先向前恢复：发布仍理解Room12 / D1 schema4的修复候选。Git回退不降低数据库版本；禁止改user_version、清库或重建历史账目来让旧包启动。
7. 只有证明备份后没有新写入，才可以评估成对恢复旧DB与同水位队列/服务快照。已有新写入时必须先保全两侧及回执，完成经审核的差额重放/对账；不允许直接恢复旧快照丢新账。
8. 所有正式备份、旧APK、Hosted及真实端到端门禁通过后才由所有者解除写冻结。当前不具备这些发布条件。

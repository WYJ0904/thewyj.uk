# P03 收尾命令、失败账本与隔离

日期：2026-10-19（Asia/Hong_Kong；执行UTC时间见机器日志）。基线 `81d5aa7cc51b55d386b59414019c4a0f01272032`；实施提交 `69993ac2e738147ca49e5c407eae6eab39aa90f4`；分支 `codex/finance-p03-identity-preauth`。最终交付HEAD、tree和Debug APK SHA-256见 [CLOSEOUT_REVISION.json](../migration-evidence/finance-p03/closeout/CLOSEOUT_REVISION.json)。


全部有效Node命令、真实参数向量、开始/结束UTC、退出码和日志在closeout/node-completion-final/exits.json。Gradle overlay命令向量在各`*-run.json`，最终有效运行索引在acceptance-index.json；completion-sequence.json保留了修正QA前的桥接FAIL，之后由clearing-ack-final-run.json接续（旧轮次final-gradle-sequence.json也保留）。标准完整命令为 `./android/gradlew.bat -p ./android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --rerun --no-daemon --console=plain`；环境和可复制命令见QA README及environment.json（Node24.18.1、Python3.15.0、JBR21.0.10、Gradle9.4.1、compile/target SDK36、Robolectric34；依赖未升级）。全量日志completion-full.log及-junit/、-lint.xml保留；更强的DB/outbox备份断言在room-backup-final重跑5个原方法，不另加5计入总数。

本轮没有删减冻结测试。原607仍为588 JVM+13 Node+6 DOM；继承前轮三个已披露夹具合同，本轮仅续接7个迁移路径到12。原P03 persistence/bridge的迁移注册也续接12，迁移脚本M02的目标续接4并实际断言DB metadata4；所有原ID/金额/receipt保护断言保留。P02脚本通过输出前缀重定向进入新目录，源文件/样本/hash不变，不进入原P02 worktree运行。

## 真实失败与中间执行（不由后续PASS覆盖）

- `clearing-before`：新增9方法在81行为上9 FAIL；说明缺能力，完整栈在XML/log。
- `clearing-attempt1`：32方法1 FAIL。QA helper把Capture和Release命名成同一source occurrence，产品正确拒绝不同角色；修正合成事件ID命名空间，断言不放宽。attempt2为32 PASS。
- `room-attempt1`：QA编译失败，RoomDatabase不实现AutoCloseable，改用显式finally关闭。该文件夹曾拷到旧XML，属于STALE_ARTIFACT，不计为本轮执行；后续launcher只归档开始时间之后的新XML。
- `room-attempt2`：8方法2 FAIL，长QA路径在PRAGMA journal_mode时CANTOPEN；仅缩短合成fixture文件名后attempt3为8 PASS。长度对照支持QA宿主路径限制，未归因Android；未修改产品journal、硬件加速、超时或手机策略。
- `server-attempt1`：合成用户名超过40导致启动失败，0业务case；缩短QA账户名。attempt2有11 FAIL，原因是跨合成账户复用了全局event_id；给case加前缀，attempt3原12例PASS。没有改变业务预期。
- `c005-release-before`：2方法2 FAIL；`node-verified`的N13也真实FAIL（12000不等于null）。本轮中间投影错误把有矛盾的全量解除残额当确定值；已以nullable解除额修复，后续新增处理中负向覆盖；最终16服务例和632 JVM通过。这不是声称81已有这项投影功能。
- `completion-before`：补充2方法2 FAIL，确认新部分状态把“结算通知/解除处理中”当作完成。已加独立完成证据门禁，精确完成见证才能恢复，迟到处理中消息不得降级已接受事实；规范完成upload ID保留旧intent alias，避免以新payload重放已ack的旧操作。最终全量重新执行，早先630/37结果只作中间证据，快照见draft-6187f06/。
- `clearing-completion-restore`：旧意图先收到candidate而本地已有完成账目，现有不删队列门禁保留1条，原过早清空断言FAIL。QA新增严格中间态：9条确认、只余指定意图、请求SHA原样、无永久拒绝，再以同请求获取receipt_reconciled后断言0队列和ID不变。产品ACK门禁未改，未延长超时；最终clearing-ack-final采用该依赖重放合同，要求至少15次请求，保留原FAIL/11请求记录。
- `d1-attempt1`及`persist-probe`：持久化Miniflare启动/探针阻断；只停止经PID和父子关系核对的本轮探针。未得到二进制恢复证据，不猜测平台根因。`d1-probe`一次shell quoting语法失败也保留，不能算作数据库失败。
- `node-final`启动器单参数被展开为首字符，多个脚本根本未运行，原日志MODULE_NOT_FOUND保留。改显式string[]，有效完整结果取node-completion-final；没有以这些启动失败计算607 PASS。
- 冻结P02聚合7方法4 FAIL，Web/DOM非零，以及F012 mock契约自检不一致继续保留。完整堆栈在NDJSON/XML，表格摘要不替代原始错误。

本轮PASS不覆盖上述执行记录。原81的十一份报告和800份原始证据也完整保留。真实Samsung、真实支付/通知、Hosted/Production、旧正式APK及正式备份全部NOT TESTED；持久D1二进制探针的NOT TESTED另列，不塞进冻结608行冒充覆盖。

## 外部保护核验

| 范围 | 文件数 | 新增/缺失/变化 | HEAD/branch/dirty |
| --- | --- | --- | --- |
| main | 832 | 0/0/0 | 相同 |
| repair | 840 | 0/0/0 | 相同 |
| task26 | 826 | 0/0/0 | 相同 |
| d01 | 859 | 0/0/0 | 相同 |
| d01control | 829 | 0/0/0 | 相同 |
| d02 | 871 | 0/0/0 | 相同 |
| candidate | 881 | 0/0/0 | 相同 |
| p02 | 901 | 0/0/0 | 相同 |
| phase3 | 140 | 0/0/0 | 原始证据相同 |
| d01Evidence | 870 | 0/0/0 | 原始证据相同 |
| d02Evidence | 207 | 0/0/0 | 原始证据相同 |
| candidateEvidence | 366 | 0/0/0 | 原始证据相同 |
| p02Evidence | 196 | 0/0/0 | 原始证据相同 |

固定主工作区、Task26、旧Hotfix、D01/对照/D02/候选/P02与原始日志均保持。没有ADB、手机、真实账户/交易、Production、正式签名、推送、合并、PR或发布。只在P03分支提交。正式App的实际设备状态NOT TESTED，仅能确认本轮没有操作它。最终源码、报告、APK与证据hash由closeout/provenance.json和validation.json封存。

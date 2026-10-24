# P03/P04 数据库恢复与兼容性

2026-10-24，Asia/Hong_Kong。本文核对本轮隔离证据并给出恢复操作顺序；没有执行新的构建、手机操作、云操作、迁移或恢复。

**隔离合成数据的迁移、备份及恢复已有实际通过证据；Production 数据库恢复门禁仍未通过。** Git 回退、APK 更新成功、旧 opener 拒绝降级，都不能代替数据库恢复。真正个人备份、正式 App 恢复、Production D1 Time Travel/迁移/恢复均为 **NOT_TESTED**。

## 1. 版本与证据身份

当前产品 HEAD 为 `73764f77fd02ada240e41c24734e523c5dad8805`，包含本轮 OCR 与 FX 两个本地修复。以下称 `E` 的目录为 `docs/migration-evidence/finance-p04/closure-current/`；本地最终重跑位于 `E/final-current/`。隔离数据不代表正式账户数据。

| 存储/协议 | 当前合同 | 恢复与兼容要求 |
| --- | --- | --- |
| Android 主 Room | 16；正式文件名 `wyj-notifications.db` | 保留原账、识别、修正日志、关系、单位和决议标记；禁止破坏性降级 |
| FX/人工币种决议 Room | 1；`wyj-currency-reference.db` | 含人工决定、来源单位、账户偏好和历史引用，不能按纯缓存删除 |
| 离线 Outbox | 原五列文件格式 | 原 operation ID、path、body、重试状态与账目配对保留 |
| 币种 SharedPreferences | `wyj-currency-context.xml`，按账户存默认币种 | 只备份币种偏好；登录凭据不在该四件包中 |
| D1 | 0031/0032/0033 增量；Task16 metadata 5、Task21 metadata 9 | 旧服务必须拒绝不理解的新 schema；客户端 wire schema 仍 1，币种传输 capability 3 |

主库 14→15 为已证币种增加单位记录，旧 JPY 单位保持未证；15→16 增加三个币种决议/提醒字段，旧行默认 false/空，不改旧金额、不重新生成账目。D1 0033 增加决议列并更新有效视图。实际检查见 [主库定义](../../android/app/src/main/java/uk/thewyj/app/task21/store/NotificationDatabase.kt)、[独立币种库定义](../../android/app/src/main/java/uk/thewyj/app/finance/CurrencyReferenceDatabase.kt)、[12 项迁移结果](../migration-evidence/finance-p04/closure-current/final-current/regression/migrations/migrations.json)和 [8 项决议迁移结果](../migration-evidence/finance-p04/closure-current/final-current/regression/review-migrations/review-migrations.json)。

本轮标准 JVM 730 项为 **724 PASS / 6 FAIL**，整组退出 1；Node 34 个脚本中 30 个退出 0、4 个退出 1。数据库专项通过不能改变这些原始结果，各重叠集合不相加。见 [最终 JVM 命令及逐项状态](../migration-evidence/finance-p04/closure-current/final-current/android-current/command.json)和 [Node 命令结果](../migration-evidence/finance-p04/closure-current/final-current/regression/node-commands.json)。

## 2. 已执行覆盖与不可借计的边界

| 检查 | 实际结论 | 证据与限制 |
| --- | --- | --- |
| 当前 HEAD 的 D1 迁移/回执/逻辑恢复 | 12 PASS | 包含事务中断回滚、原 ID/金额/时间/回执保留、未证 JPY 不缩放、旧服务拒绝新库、105 表逻辑恢复和独立 SQLite 重开；[结果](../migration-evidence/finance-p04/closure-current/final-current/regression/migrations/migrations.json) |
| 当前 HEAD 的默认币种决议迁移 | 8 PASS | 包含列/视图/metadata 中断回滚、来源决议与幂等回执恢复、部分 schema 不得提交；[结果](../migration-evidence/finance-p04/closure-current/final-current/regression/review-migrations/review-migrations.json) |
| 当前 HEAD 的四件冷备份/恢复 | PASS，两个不同 JVM | seed PID 14236、restore PID 34732；四件实际文件经产品读取器恢复；[结果](../migration-evidence/finance-p04/closure-current/final-current/native-backup/backup-restore.json)、[清单](../migration-evidence/finance-p04/closure-current/final-current/native-backup/backup-manifest.json) |
| 当前 HEAD 的本地原生持久化 | PASS，105 表 | 实际 Miniflare 关闭后复制原生持久化目录，再独立打开副本；[native-persist-auto](../migration-evidence/finance-p04/closure-current/final-current/regression/native-persist-auto/result.json)、[阶段记录](../migration-evidence/finance-p04/closure-current/final-current/regression/native-persist-auto/phases.ndjson)；不代表云端备份 |
| 本轮早期 Samsung Room 9→16 | 3 PASS，属于产品 `94ab0fc` 基线 | [结果](../migration-evidence/finance-p04/closure-current/samsung-room-migrations-r1.json)、[QA 源映射](../migration-evidence/finance-p04/closure-current/device/source-overlay.json)；QA 源提交 329aa0c 与 94ab0fc 之间仅报告/QA 改动，不能算作 73764f7 的重测 |
| 本轮早期 Samsung 四件 cold seed/restore | PASS，属于相同早期基线 | [seed](../migration-evidence/finance-p04/closure-current/samsung-backup-seed-r1.json)、[停止 QA 进程](../migration-evidence/finance-p04/closure-current/samsung-backup-cold-stop.json)、[restore](../migration-evidence/finance-p04/closure-current/samsung-backup-restore-r1.json)；合成 QA 包，个人正式备份未测 |
| 最终73764f7 Samsung Room/六币种 | Room迁移3 PASS；六币种3 PASS | [迁移](../migration-evidence/finance-p04/closure-current/samsung-final-room-migrations-r1.json)、[六币种](../migration-evidence/finance-p04/closure-current/samsung-final-six-currencies-r1.json)；实际Room关闭重开、9→16链、事务失败后重试、旧opener拒绝降级；不能替代正式App原地升级 |
| 最终73764f7 Samsung四件cold seed/restore | seed/不同进程restore各1 PASS | [guard与偏好恢复校验](../migration-evidence/finance-p04/closure-current/samsung-final-backup-guard.json)、[seed](../migration-evidence/finance-p04/closure-current/samsung-final-backup-seed-r1.json)、[restore](../migration-evidence/finance-p04/closure-current/samsung-final-backup-restore-r1.json)；仅临时隔离QA币种偏好，结束SHA逐字节恢复；不是个人正式备份 |
| 最终73764f7 Samsung既有账冷重读 | 1 PASS，原3个合成ID/金额保留、queue0 | [结果](../migration-evidence/finance-p04/closure-current/samsung-final-cold-ledger-restore-r1.json)；不是早期完整本机HTTP故障矩阵的重新执行 |
| 两次 owned Samsung QA APK 更新 | 每次 44 文件 SHA 全保留、changed_files=[] | [OCR r1](../migration-evidence/finance-p04/closure-current/phone-update-device-ocr-r1.json)、[最终 r2](../migration-evidence/finance-p04/closure-current/phone-update-device-ocr-r2.json)；只证明这些 QA 文件跨更新保留，不证明正式 App 升级或四件恢复重测 |

当前 JVM 已重新执行旧 Room opener 的失败关闭、关闭后快照与配对 Outbox 恢复：旧 v11/v12/v13/v14/v15 opener 不能打开升级后的主库，不降低 `user_version`、不清库；失败后当前 opener 仍可读取原账。见 [v14/单位迁移](../migration-evidence/finance-p04/closure-current/final-current/android-current/junit/TEST-uk.thewyj.app.finance.CurrencyLedgerMigrationTest.xml)、[v15/决议迁移](../migration-evidence/finance-p04/closure-current/final-current/android-current/junit/TEST-uk.thewyj.app.finance.CurrencyReviewMigrationTest.xml)、[P03-A](../migration-evidence/finance-p04/closure-current/final-current/android-current/junit/TEST-uk.thewyj.app.task21.store.FinanceP03AMigrationTest.xml)、[P03 closeout](../migration-evidence/finance-p04/closure-current/final-current/android-current/junit/TEST-uk.thewyj.app.task21.store.FinanceP03CloseoutMigrationTest.xml)和 [P03 final](../migration-evidence/finance-p04/closure-current/final-current/android-current/junit/TEST-uk.thewyj.app.task21.store.FinanceP03FinalMigrationTest.xml)。这是真实测试 opener 结果，未安装旧正式 APK。

## 3. 跨 JVM 与 HTTP/D1 恢复

| 桥接 | JVM 身份及结果 | 范围 |
| --- | --- | --- |
| 原 legacy bridge | seed FAIL；restore NOT_TESTED | 原 fixture 隐含 CNY，预期 3 账实际 1 账；保留失败，未修改原前提使其通过；[原命令](../migration-evidence/finance-p04/closure-current/final-current/regression/jvm-commands.json) |
| 显式币种 derived legacy bridge | seed 31240 → restore 11984；服务 9 请求 PASS | 单独版本化的显式默认币种前提；3 账 ID/原币/最小单位保留，恢复后同步、队列清空；[seed](../migration-evidence/finance-p04/closure-current/final-current/derived-current-client/legacy-bridge/seed.json)、[restore](../migration-evidence/finance-p04/closure-current/final-current/derived-current-client/legacy-bridge/restore.json)、[服务结果](../migration-evidence/finance-p04/closure-current/final-current/derived-current-client/legacy-bridge/server-final.json) |
| clearing bridge | seed 37512 → restore 35916；服务 15 请求 PASS | [seed](../migration-evidence/finance-p04/closure-current/final-current/regression/clearing-bridge/seed.json)、[restore](../migration-evidence/finance-p04/closure-current/final-current/regression/clearing-bridge/restore.json)、[服务结果](../migration-evidence/finance-p04/closure-current/final-current/regression/clearing-bridge/server-final.json) |
| correction bridge | seed 18740 → restore 39076；服务 34 请求 PASS | [seed](../migration-evidence/finance-p04/closure-current/final-current/regression/correction-bridge/seed.json)、[restore](../migration-evidence/finance-p04/closure-current/final-current/regression/correction-bridge/restore.json)、[服务结果](../migration-evidence/finance-p04/closure-current/final-current/regression/correction-bridge/server-final.json) |
| unified bridge | seed 35988 → restore 7392；服务 35 请求 PASS | [seed](../migration-evidence/finance-p04/closure-current/final-current/regression/unified-bridge/seed.json)、[restore](../migration-evidence/finance-p04/closure-current/final-current/regression/unified-bridge/restore.json)、[服务结果](../migration-evidence/finance-p04/closure-current/final-current/regression/unified-bridge/server-final.json) |

四条实际完成的恢复桥为 derived legacy、clearing、correction、unified；原 legacy 的 FAIL/NOT_TESTED 单独保留。这些都是隔离合成数据；跨 JVM、实际 HTTP/D1 回放与幂等检查不能替代 Production 重启、真实个人队列或真实交易回放。

## 4. 本地已停服务的实际 SQLite 恢复

`E/loopback-native-recovery.json` 记录了本轮已停、端口关闭的本地 Miniflare 服务实际 SQLite 恢复：**105 表、3 笔合成账、PASS**，`formal_data_read=false`、`production=false`。它使用实际 SQLite 来源，不是只重建一个空 fixture。见 [恢复结果](../migration-evidence/finance-p04/closure-current/loopback-native-recovery.json)和 [只操作该本地来源的脚本](../../qa/finance-p04/closure/recover-loopback.py)。

先前服务为何退出尚未确立，证据明确为 `NOT ESTABLISHED`。本结果不能归因为“已复现 crash 后恢复”，也不能声称曾正常优雅关闭。它与上一节受控关闭后的 `native-persist-auto` 是不同检查，不混写成同一次执行。

收尾另对实际已停的generation8来源执行[SQLite恢复](../migration-evidence/finance-p04/closure-current/loopback-native-recovery-g8.json)：105表/3笔合成账PASS，端口19443无监听。退出原因仍NOT ESTABLISHED，不称crash或优雅关闭；未读正式数据。

## 5. 真实远端隔离 QA D1 导出恢复

本轮从 owned remote QA D1 取得 SQL 导出，恢复到**新建、未绑定应用的独立恢复数据库**。最终只读核验：**105 表、12 笔合成账、24 条回执、foreign_key_check 0 违规**；精确 ID、币种、最小单位、exponent 与 revision 保留。见 [最终结果](../migration-evidence/finance-p04/closure-current/hosted-d1-restore-r2/result.json)和 [执行器](../../qa/finance-p04/closure/remote-restore.py)。

首次 r1 的新目标空库预检和 import 命令均退出 0，导入已完成；collector 因 Wrangler stdout 进度文本按 JSON 解析失败，`result.json` 保留 **FAIL**。r2 确认 r1 已成功导入后仅执行一次只读 verify，**没有第二次导入**。见 [r1 结果](../migration-evidence/finance-p04/closure-current/hosted-d1-restore-r1/result.json)、[r1 命令](../migration-evidence/finance-p04/closure-current/hosted-d1-restore-r1/commands.json)和 [r2 仅 verify 命令](../migration-evidence/finance-p04/closure-current/hosted-d1-restore-r2/commands.json)。不能把 r1 解析失败改写成数据库导入失败，也不能抹去该失败记录。

导出 SHA-256 为 `6a6070ad81bed09397062b689e781ed2af119fe12d476c8dba940361284f98d7`；核对用独立 SQLite 文件 SHA-256 为 `6a214472456460c863001074f63b78e74ad6fc5386d4393a15dd7cc2c1a6b730`。本文只引用非私有结果，不复制 private SQL、账户认证材料或原文。

这项证据覆盖真实云端 QA SQL 导出→独立目标导入→远端核验；数据仍是合成隔离数据。**Production Time Travel、Production 导出/迁移/恢复、生产目标切换及个人数据恢复未执行**，不能由 QA 通过推定。

清理前最新[final-backup-r2](../migration-evidence/finance-p04/closure-current/cloud-final-backup-r2/result.json)另导出完整owned QA D1，恢复到本机独立SQLite核对：**105表、19合成账、25财务回执、6通知回执，精确财务projection一致、外键0违规**。SQL为370,482 bytes，SHA-256 `2559089b97eaa77b8fd565ca057026285c5e0f74faae98d63208d3ef830be949`；SQLite为1,687,552 bytes，SHA-256 `3de6fc40a8bb8b294dfa5299d6b651cf239d787b0675f57a0668617a4e470a88`。该次`remote_import=false`，不冒充再次远端导入；此前12账/24回执是更早时点的独立远端恢复。最新备份校验后2个owned D1和owned Pages项目实际删除，正式/共享D1仍在，详见[清理报告](CLEANUP_REPORT.md)。

### 实际Samsung至Hosted回执恢复与手机封存

最终独立NativeCloud r3 [seed](../migration-evidence/finance-p04/closure-current/samsung-hosted-native-seed-r3.json)/[restore](../migration-evidence/finance-p04/closure-current/samsung-hosted-native-restore-r3.json)各1 PASS：实际Task20/HTTPS、六币种各1最小单位、服务器已提交但丢ACK、不同进程重新登录、精确原Outbox body重放、回执后queue0、另账户不可见。原r1无效deviceID与r2超长引用被拒保留；r3是新有效引用的独立合成数据集，不覆盖原失败，不是微信真实链。

清理前[phone-final-data-seal](../migration-evidence/finance-p04/closure-current/phone-final-data-seal.json) PASS：实际安装APK SHA与最终候选一致；owned QA冷数据tar为5,658,112 bytes，SHA-256 `5dacd2735284a15dd94cc968b8270a4741601ce594c3ecf4915d3fe1b5a127a8`，逐文件SHA/路径安全预检完成。原被拒6队列、新r3恢复证明及最终四件包均保留。8份指定详情密文与本机副本逐项一致，内存DPAPI/AES-GCM恢复校验通过，未导出明文密钥或正式App数据。整包含QA加密会话文件，**不保证跨设备Android Keystore/登录凭据恢复**；四件恢复合同仍要求重新登录，不能把tar封存等同正式灾难恢复。

## 6. 四件一致备份的执行合同

以下为后续实际恢复必须遵守的顺序，不代表当前已有正式个人备份导入功能，也不授予 Production 或正式手机操作权限。

1. **先冻结写入并记录水位。** 停止相关账户的通知/无障碍采集、手工财务编辑、同步入口与 Outbox 发送，等待在途事务结束。记录账户 ID、源码/候选版本、主库及币种库版本、D1 metadata、同步/回执/队列水位和封存时点；本地与远端分别确认，不能仅靠设备时钟认定跨端原子一致。
2. **落盘后关闭。** 等待队列写入和币种偏好持久化完成，关闭主库与独立币种库。不得裸复制仍写入 WAL 的 `.db`，不得把只有主库文件的副本当完整备份。现有合成证明使用偏好同步 `commit()`、两库 `close()` 后复制；正式环境须使用允许的一致导出通道。
3. **四件一起封存。** 将下表四件置于一个新备份包，生成同账户、同水位的 manifest，记录每件 SHA-256、主库 16/币种库 1 及格式信息。manifest 之外保留操作时间/版本/水位记录。任何凭据、Cookie、Token、签名密钥不得进入该包。
4. **在全新独立目标预检。** 不覆盖活跃目录；先检查账户、四件集合、每件 SHA 和支持的版本，缺件、错账户、损坏或版本不支持时停止，不做部分恢复。对文件实际数据库版本/完整性也要核验，不能只相信 manifest。
5. **恢复到同版本或经证明兼容的更高版本。** 四件作为一组恢复，先离线由当前读取器打开并检查原账/关系/修正日志/人工决定/来源单位/历史引用/队列。更高版本必须有已验证的向前迁移，不能因版本数字较高就默认兼容。
6. **正常重新登录并再次核对账户。** 凭据独立获取；登录后的实际账户必须与备份账户一致，再核对服务端版本和水位。检查精确回执后才允许队列发送，并确认重复回放不生成第二笔账、不吞掉未确认请求。
7. **对账后才恢复采集。** 校验旧 ID、原币/最小单位、人工更正、关系、回执、revision/序列和未同步请求；保留原始活跃数据及失败副本。对账未通过时维持冻结，不能清库或重标币种来消除差异。

| 合成包文件名 | 必须保留的内容 | 当前已核验 |
| --- | --- | --- |
| `notification.sqlite` | 主 Room 16，原识别与账目/修正/关系/单位 | 原始未知币种仍为 XXX，未被人工选择覆盖源事实 |
| `currency.sqlite` | FX/人工决议 Room 1 | 人工 JPY、来源 JPY exponent 0、默认 USD、历史 USD→CNY 引用及精确值 |
| `outbox.queue` | 五列格式的原请求与重试状态 | 两请求；原 body、币种确认 path、JPY 3725、capability 重试状态保留 |
| `currency-context.xml` | 同账户币种偏好 | 冷读取默认 USD；不含登录凭据 |

四件包结果及断言来自 [本轮实际生成的证明源码](../migration-evidence/finance-p04/closure-current/final-current/backup-proof-source/kotlin/CurrencyP04BackupTest.kt)、[清单](../migration-evidence/finance-p04/closure-current/final-current/native-backup/backup-manifest.json)和 [独立 JVM 恢复](../migration-evidence/finance-p04/closure-current/final-current/native-backup/backup-restore.json)。

### 拒绝条件的已测范围

| 条件 | 当前证据 |
| --- | --- |
| 错账户 | 已断言拒绝；他账户不可读取该人工币种决定 |
| 缺件/清单不含完整四件 | 已断言拒绝；不得只恢复主库和 Outbox |
| 任一文件 SHA 不符 | 已断言拒绝 |
| 旧读取器打开新主库 | 实际旧 opener 拒绝，原数据仍可由当前 opener 读取 |
| manifest版本/SQLite头部/目标版本预检 | 新增 **QA-only 9 PASS**，对实际封存四件包在内存预检：原包接受，Room17/FX2拒绝、目标Room15/FX0拒绝、缺件/错hash/错账户拒绝、即使重算hash但SQLite头部与manifest冲突仍拒绝；[结果](../migration-evidence/finance-p04/closure-current/backup-preflight-final-r1.json)。不提取/改写原数据库，不代表产品备份管理器或新SQLite完整性执行 |
| 未知Outbox格式/正式入口的所有版本组合 | **NOT_TESTED**；9项QA预检不覆盖任意格式与正式产品恢复入口，不能泛化为全部manifest版本兼容已通过 |
| 任意更高版本恢复/正式备份入口/重新登录完整链 | **NOT_TESTED**；当前实际通过是 Room16/FX1 同版本合成恢复，凭据不在包中 |

## 7. 升级后新账与回退

**升级后出现新账、新修正、新回执或新队列时，禁止以旧快照覆盖活跃数据库。** 当前 P03 快照测试实际展示：旧快照只有 1 笔账及 1 个请求，而升级后快照含 2 笔账及匹配队列。旧快照能单独打开，不等于恢复它可以无损保留升级后的新增事实。见 [当前重跑的测试结果](../migration-evidence/finance-p04/closure-current/final-current/android-current/junit/TEST-uk.thewyj.app.task21.store.FinanceP03CloseoutMigrationTest.xml)。

优先向前修复。若确需灾难恢复，先保全当前完整快照和新增水位，完成独立目标恢复、差额保全及审核后的幂等重放/对账；没有这些证据就继续阻断。不能通过 Git checkout、安装旧 APK、降低 `user_version`、关外键、删除数据库或重建账目绕过版本限制。APK 更新保留 44 个 QA 文件也不是该差额恢复的证明。

服务端须先具备经过隔离验证的 Task16 5 / Task21 9 和 capability 3 行为，再评估客户端放行。旧服务失败关闭是防止误写的保护，不是已经完成服务端回滚；旧无币种前提的失败与显式默认币种的单独通过必须同时保留。

## 8. 剩余门禁与最终结论

已证明的范围是：当前HEAD的本地增量迁移、旧opener/旧服务失败关闭、四件合成同版本冷恢复、四条独立JVM/HTTP恢复桥、本地实际SQLite与原生持久化恢复、真实远端QA D1 SQL导出至独立目标恢复。Samsung早期94ab0fc结果保留，最终73764f7已另执行Room迁移3 PASS、六币种3 PASS、四件seed/restore各1 PASS、既有合成账冷重读1 PASS及NativeCloud r3跨进程回执恢复；两次QA更新文件SHA保全和手机冷封存分别另列，不重复累计。

未证明的范围是：真实个人备份与正式App恢复、任意未知清单/Outbox格式组合、任意更高版本恢复、生产写入冻结与跨端一致水位、Production Time Travel/迁移/恢复/目标切换、升级后真实新增账差额恢复及Android Keystore跨设备凭据恢复。以上保持 **NOT_TESTED / RELEASE_HELD**。QA-only预检9项只证明其明确拒绝合同。前述远端12账/24回执属于早期时点；最新19账/25财务回执/6通知回执导出与本机恢复另列，不能互相替换。

<!-- FINAL_CLEANUP_AND_SEAL_STATUS -->
手机四件/冷数据与远端最终合成库封存校验、owned手机/云/Windows清理已完成，正式无障碍TRUE/通知监听FALSE读回。详见[CLEANUP_REPORT.md](CLEANUP_REPORT.md)、[FINAL_EVIDENCE_INDEX.md](FINAL_EVIDENCE_INDEX.md)。最终13组保护已PASS（E/protected-final.comparison.json，无added/missing/changed，8个Git工作树HEAD/branch/status相同）；最终Git SHA及总manifest记录于 `E/FINAL_DELIVERY_PROVENANCE.json`；不改变数据库正式恢复NOT_TESTED边界。

本文不改变 Hotfix 独立 Closure、Task26 `CLOSED_WITH_OWNER_WAIVER` 或原失败证据，不启动 P05/P06，不代表发布批准。最终产品门禁另见 [RC-6/Production 门禁](RC6_PRODUCTION_GATE.md)；数据库专项通过不足以宣布 P03/P04 整体 COMPLETE。


清理保留例外：`qa/finance-p04/closure/__pycache__`的最后删除被自动审批拒绝（仅`blocked by policy`，无具体理由），命令未执行、未换方式重试，故小型pyc缓存仍保留；见E/cleanup-policy-rejection-final.json。不得称零残留。

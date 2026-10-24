# FINANCE-P03/P04 收尾清理与保护核验

2026-10-24，Asia/Hong_Kong。**本轮owned测试残留清理已实际完成；P03/P04仍PARTIAL，Production HELD。** 清理成功不改变原失败或未测项。最终13组保护已PASS，无added/missing/changed，8个Git工作树HEAD/branch/status相同；最终Git SHA/总manifest记录于 `E/FINAL_DELIVERY_PROVENANCE.json`。

下文`E/`为本机忽略目录`docs/migration-evidence/finance-p04/closure-current/`。先核实所有权、扫描、封存并验证备份，再删除明确owned对象；未对正式数据库、微信或不确定来源的旧QA包执行清库/卸载。计数只代表实际执行，不将计划数量计入清理。

## 1. 删除前的必要保全

| 对象 | 实际结果 | 原始证据 |
| --- | --- | --- |
| owned手机冷数据 | PASS，5,658,112 bytes；SHA-256 `5dacd2735284a15dd94cc968b8270a4741601ce594c3ecf4915d3fe1b5a127a8`；实际安装APK SHA等于候选`0bf2e0d86f54094bded40313527453cfbe628c34fd9f2bd8d408207ef0b25d4d` | [phone-final-data-seal](../migration-evidence/finance-p04/closure-current/phone-final-data-seal.json) |
| 8份指定微信详情密文 | 设备与本机密文逐项hash相等，DPAPI/AES-GCM在内存恢复校验；未导出明文密钥或正式App数据 | 同上；私有原件不写Git/报告 |
| 四组件QA预检 | 9 PASS，原包接受，错误schema/目标版本/hash/集合/账户/头部一致性拒绝 | [backup-preflight-final-r1](../migration-evidence/finance-p04/closure-current/backup-preflight-final-r1.json)；QA-only，不是产品备份管理器 |
| 最终owned云库 | 105表、19合成账、25财务回执、6通知回执，精确远端财务projection与本机恢复相同、外键0 | [cloud-final-backup-r2](../migration-evidence/finance-p04/closure-current/cloud-final-backup-r2/result.json) |
| owned Chrome必要保留内容 | 删除前279文件备份校验；原日志/断言/结果保留 | [browser清理结果](../migration-evidence/finance-p04/closure-current/windows-browser-cleanup-r1.json)、[保留manifest](../migration-evidence/finance-p04/closure-current/synthetic-browser-retained-manifest.json) |

最终云SQL为370,482 bytes、SHA-256 `2559089b97eaa77b8fd565ca057026285c5e0f74faae98d63208d3ef830be949`；恢复SQLite为1,687,552 bytes、SHA-256 `3de6fc40a8bb8b294dfa5299d6b651cf239d787b0675f57a0668617a4e470a88`。该次是远端导出至本机独立SQLite恢复，`remote_import=false`；此前12账/24回执导入独立远端目标的证明另存，不能混成同一时点。

手机冷tar含owned QA加密会话文件，不能声称Android Keystore跨设备恢复已验证；四组件合成恢复不含凭据，需要正常重新登录。真实个人备份和Production恢复仍NOT TESTED。

## 2. Samsung实际清理与正式权限恢复

[phone-cleanup-r1](../migration-evidence/finance-p04/closure-current/phone-cleanup-r1.json)实际卸载且确认仅以下4个owned包：

- `uk.thewyj.app.qa.financep04closure`
- `uk.thewyj.app.qa.financep04closure.p03acceptance`
- `uk.thewyj.app.qa.financep04navigator`
- `uk.thewyj.app.qa.financep04navigator.test`

卸载前撤销owned通知监听/POST_NOTIFICATIONS；卸载后QA包及敏感服务授权已无。19443 reverse读回为空。[phone-temp-final-cleanup](../migration-evidence/finance-p04/closure-current/phone-temp-final-cleanup.json)精确删除49个本轮已创建Settings dump路径；不是通配清理手机目录，也不计为Windows13,807文件的一部分。

正式`uk.thewyj.app`经正常Settings恢复原无障碍，最终[系统读回](../migration-evidence/finance-p04/closure-current/phone-after-permission-restore-r1.json)为 **a11y TRUE、通知监听FALSE、1.3.37/code50**。allow辅助点击因所有者已先确认、无对应目标而终止；不把脚本退出当恢复证明，采用实际系统状态。正式通知监听原FALSE保持，没有误开。

未覆盖/卸载正式App、未清其数据库、未删微信主应用或分身、未创建profile、未执行新支付/领取/消息。其他旧QA包来源未确定，保留并不冒充本轮已清理对象。版本/授权读回不能证明正式财务数据库逐字节未变，本轮未为此导出私人数据。

## 3. 远端owned资源退役

[cloud-cleanup-r2](../migration-evidence/finance-p04/closure-current/cloud-cleanup-r2/result.json) PASS，备份校验后实际删除：

| 类型 | 精确对象 | 读回 |
| --- | --- | --- |
| Pages | `thewyj-finance-qa`，含4部署（含两次误绑定的旧部署） | 项目不再存在；原QA URL退役，不是可继续使用的交付站点 |
| 主QA D1 | `finance-p03-p04-qa` / `c2eb978f-9f49-4e4c-8286-f6b398fae0de` | 不再存在 |
| 恢复演练D1 | `finance-p03-p04-qa-restore` / `da1711d7-f770-4e30-b305-9d812588f8b4` | 不再存在 |

正式D1 `11c288d8-c584-409f-bb1f-7e7af11793e5`、既有共享Preview `a3e6253b-689f-49f3-998b-7c5828ea255a`及Production Pages仍存在，未执行Production迁移/发布。owner Wrangler keyring保留，不注销所有者会话。

初次部署误绑定共享Preview导致3条本轮失败登录audit，已披露；这些必要事故证据保留，没有再写共享库掩盖。不能宣称整轮共享Preview数据库未改动。cloud-cleanup-r1只在QA输出`Project Name`/`name`解析失败，尚未发delete；r2修正输出适配后执行并读回，原失败保留。

## 4. Windows清理统计

| 批次 | 实际删除 | 逻辑字节 | 证据 |
| --- | ---: | ---: | --- |
| owned可重建缓存 | 508 entries、12,106文件 | 1,244,107,990 | [windows-cache-cleanup-r1](../migration-evidence/finance-p04/closure-current/windows-cache-cleanup-r1.json) |
| 5个owned合成Chrome profile | 5 roots、1,701文件 | 227,764,551 | [windows-browser-cleanup-r1](../migration-evidence/finance-p04/closure-current/windows-browser-cleanup-r1.json) |
| **合计** | **13,807文件** | **1,471,872,541** | 两批目标独立；不含手机/云对象 |

这是逻辑文件长度，**不承诺NTFS物理空间释放量**。缓存批次另核498保留文件hash，Chrome批次先校验279必要文件备份。具体绝对路径、归属、删除前扫描及逐项结果见[最终inventory](../migration-evidence/finance-p04/closure-current/cleanup-inventory-final-r1.json)及两批结果；没有按扩展名删除原始SQL/SQLite、JUnit、lint、原失败、APK、源码/schema或必要备份。

5个Chrome目录均为本轮`finance-p04-chromium-`合成无账户测试profile；正常Chrome用户profile、全局Gradle/npm缓存、其他worktree及正式资料未清理。此前3目录的自动政策拒绝保留；所有者明确要求本次正常fresh whole-root重试后，先重新核实归属/路径/无活动进程再执行，5个根目录本次均成功。没有将旧拒绝记录改成PASS。

## 5. 服务、保留例外与审批记录

本机19443无监听；对已停generation8的实际SQLite执行[恢复](../migration-evidence/finance-p04/closure-current/loopback-native-recovery-g8.json)，105表/3合成账PASS。退出原因NOT ESTABLISHED，不称已复现crash或优雅关闭。必要源码、旧报告原字节、P01/P02冻结原证据、失败账本、SQLite/SQL备份、实际APK、受限微信密文、SHA和验收证据保留。

自动审批曾拒绝一次QA `/api/status` 403响应headers诊断及同组合Settings重启动作，只有`blocked by policy`，未给更具体原因；该组合未执行，也未绕过诊断拒绝。不能把被拒动作计为验收成功。

<!-- FINAL_CLEANUP_AND_SEAL_STATUS -->
最终13组保护核验PASS；最终本地Git SHA/证据总manifest记录于 `E/FINAL_DELIVERY_PROVENANCE.json`。该封存记录不改变上述已执行清理数量；P03/P04仍PARTIAL、Production HELD，不推送/合并/正式签名/发布。


清理保留例外：`qa/finance-p04/closure/__pycache__`的最后删除被自动审批拒绝（仅`blocked by policy`，无具体理由），命令未执行、未换方式重试，故小型pyc缓存仍保留；见E/cleanup-policy-rejection-final.json。不得称零残留。

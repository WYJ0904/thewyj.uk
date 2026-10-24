# P03/P04 Windows 当前命令与证据索引

2026-10-24 最新运行的完整argv/日志见 [最终证据索引](FINAL_EVIDENCE_INDEX.md)；最终集合为closure-current/final-current/delivery-current-r2。下方2026-10-23命令保留作历史与复跑参考，不能当作本轮通过。QA云资源和测试包已清理，重跑手机/云动作前必须新建独立数据与输出，不能覆盖旧证据。

2026-10-23。工作目录为隔离finance-p04-multicurrency工作树；全部D1/账户/备份为自建合成。旧cloud命令不计本轮通过。当前完整argv、UTC起止/退出码、Source-lock和JUnit分别在final-r2/android-current/command.json、regression/{node,jvm}-commands.json、extra-native-commands.json及各目录。

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME='C:\Users\78252\AppData\Local\Android\Sdk'
$env:FINANCE_NODE='C:\Users\78252\AppData\Local\npm-cache\_npx\d18f28baf1132559\node_modules\node\bin\node.exe'
$env:PATH=(Split-Path $env:FINANCE_NODE)+';'+$env:PATH
$env:AERIS_TEST_CHROME='C:\Program Files\Google\Chrome\Application\chrome.exe'
# 每次选新目录，脚本拒绝覆盖原结果；以下final-r2是本轮已执行路径。
$env:FINANCE_P04_OUTPUT=Join-Path (Get-Location) 'docs/migration-evidence/finance-p04/local/final-r2/android-current'
python qa/finance-p04/android.py
$env:FINANCE_REGRESSION_OUTPUT=Join-Path (Get-Location) 'docs/migration-evidence/finance-p04/local/final-r2/regression'
$env:FINANCE_NODE_WORKERS='3'
python qa/finance-p04/run-regression-node.py
$env:FINANCE_TRACE_ROOT=Join-Path (Get-Location) 'docs/migration-evidence/finance-p04/local/trace-current-source'
python qa/finance-p04/run-regression-jvm.py
```

Android实际调用锁定gradlew.bat：`:app:testDebugUnitTest :app:lintDebug :app:assembleDebug --continue --rerun-tasks --no-daemon --max-workers=2 --console=plain --stacktrace -PTHEWYJ_BASE_URL=https://isolated-finance.invalid`。无ADB/模拟器/安装/release任务。原607与681按已封存身份映射选择**当前JUnit**，另只读核对原Windows旧JUnit身份，没有把历史PASS加入当前数据。

版本化合同驱动：`python qa/finance-p04/prepare-contract-drivers.py`（FINANCE_CONTRACT_ROOT、FINANCE_PRIMARY_DOM指向原输入/新目录），随后执行该目录web-dom-declared-inputs.mjs。它用原声明的非市场率7/date进入真实FX/D1创建引用，原断言/fixture没变；Native driver仅转发default_currency+policy2，checkExpected未改。原样执行仍另行保留。

`python qa/finance-p04/prepare-backup-proof.py` 创建四组件seed/restore源码（在ignored目录）；`python qa/finance-p04/extra-native.py` 串行运行声明输入D矩阵及两JVM冷恢复。Root/output/源码hash/完整gradle命令分别保存，未读取或操作正式私库。`python qa/finance-p04/upgraded-legacy-http.py task21` 只修改导入路径和capability3请求头，保留原221行断言。

四桥全部命令见regression/jvm-commands.json；原legacy seed失败后restore未执行，单独FINANCE_P03_COMPAT_ROOT加显式合成CNY偏好的derived-current-client桥9请求通过，不替换原结果。projection使用`node --import ./qa/finance-p04/fresh-inputs.mjs qa/finance-p03/finish/projections.mjs`，输入本轮resolution/cases。

本地物理恢复：`node qa/finance-p03/nonphone/native-persist.mjs`，FINANCE_REGRESSION_OUTPUT/FINANCE_D1_BRIDGE_INPUT指向本轮unified bridge快照。试验输出native-persist(FAIL)、native-control(同版长路径FAIL)、native-persist-short/native-short-b(短路径PASS)、native-persist-auto(新默认自动短路径PASS)。只有QA运行目录不同；同源码/同快照哈希控制组保存。该默认路径修复后无需改数据或延长超时。不要复用旧目录。

汇总：`python qa/finance-p04/collect-local.py`；输出新delivery-v2，保留先前collector路径/缺历史副本问题与原始delivery。原历史JUnit原件在受保护Windows P03树；云端包中个别旧路径缺失时只用封存JSON身份，不借历史状态，且已与Windows原身份相等核对。

保护：`python qa/finance-p03/protection.py <new-output.json> --before docs/migration-evidence/finance-p04/local/protected-before.json`。执行前脚本明确排除并断言不读取根访问口令。最终同样重复校验；Git状态与13组文件hash详见provenance。npm/Python/JDK/SDK准备只在本地依赖/ignored QA目录，不升级产品锁、不使用Production凭据。

所有失败/重试均在独立目录。原始源码/预期/样本未删除，测试集合重叠不累计；真实设备/业务/Production/个人备份NOT_TESTED。

封存采用`python qa/finance-p04/seal-local-delivery.py precommit`，本地Git提交并完成最后13组保护核验后执行`python qa/finance-p04/seal-local-delivery.py postcommit`。脚本独占创建封存文件，核对统计、继承、锁文件、APK、报告链接和QA/报告源码，既有raw不改；最终提交和完整文件SHA索引见[REVISION](../migration-evidence/finance-p04/local/final-r2/REVISION.json)及[provenance](../migration-evidence/finance-p04/local/final-r2/provenance.json)。

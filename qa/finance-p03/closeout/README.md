# P03 收尾本地复验

仅本隔离 worktree、合成账户、Robolectric、loopback HTTP 和本地 Miniflare。禁止 ADB、手机、Production、正式签名、真实付款、推送和发布。先验证当前分支及 `81d5aa7` 继承关系。

旧 `docs/finance-p03/` 的十一份报告及其 ignored 证据是交接基线，保留不重写；不要用旧 report/provenance 生成器覆盖它们。收尾证据在 `docs/migration-evidence/finance-p03/closeout/`，报告入口为 `CLOSEOUT_REPORT.md`。

```powershell
python qa/finance-p03/closeout/prepare-baseline.py
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
Get-ChildItem Env: | Where-Object Name -Match '(?i)(SIGNING|KEYSTORE|STORE_PASSWORD|KEY_PASSWORD|KEY_ALIAS)' | ForEach-Object { Remove-Item -LiteralPath ('Env:'+$_.Name) }
& ./android/gradlew.bat -p ./android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --rerun --no-daemon --console=plain
& ./qa/finance-p03/closeout/run-node.ps1 -OutputName node-owner-review
```

每次选择新名字，保留非零退出码；Gradle 串行，不能同时执行两条 Gradle 命令。每次运行保存 stdout/stderr、退出码和新鲜 JUnit。不能把编译失败后遗留的旧 XML 算作本次测试。

```powershell
& ./qa/finance-p03/closeout/run-gradle.ps1 -Flavor P02 -Name owner-matrix -OutputName owner-native -Tests @('*FinanceP02MatrixTest','*FinanceP02TimingTest')
& ./qa/finance-p03/closeout/run-gradle.ps1 -Flavor P02 -Name owner-process-seed -OutputName owner-process -Tests @('*FinanceP02SeedTest')
& ./qa/finance-p03/closeout/run-gradle.ps1 -Flavor P02 -Name owner-process-restore -OutputName owner-process -Tests @('*FinanceP02RestoreTest')
& ./qa/finance-p03/closeout/run-bridge.ps1 -Profile legacy -Name owner-legacy-bridge
& ./qa/finance-p03/closeout/run-bridge.ps1 -Profile closeout -Name owner-clearing-bridge
```

桥接脚本在 seed 后启动本轮隐藏 Node 服务，仅监听随机 `127.0.0.1` 端口；校验其 PID，立即运行另一个 JVM 的 restore，然后只向自己的 `/_p03_shutdown` 发 POST。原六分钟 watchdog 不延长。legacy 配置仍要求三账/两待核实/九请求；closeout 独立要求四账/一待核实/十请求，不混用验收断言。

`output-redirect.mjs` 只把冻结 P02 脚本的旧固定输出路径重定向到本轮新目录，不转换源码、样本或断言。同步与命名 promise 导出均有自检，原 P02 文件的 SHA 再核验。P02 Web/DOM 的已知红灯应保留非零退出码。

Room 迁移 fixture 使用冻结 v11 实体及同版本 Room runtime 的真实 opener；不冒充在真机运行旧 APK。v12 拒绝旧 opener，事务失败可重试；闭合的数据库文件和队列分别配对快照，旧快照只有旧写入，新快照保留新写入，不能以旧快照替代无损降级。

D1 收尾脚本验证 schema 3→4 的事务回滚、重试、重复 DDL 拒绝、实际旧 v3 API 503，以及新空白 D1 runtime 的逻辑 schema/数据/自增水位恢复。持久化 Miniflare 二进制快照探针阻断原样保留，不能把逻辑恢复称为真实云端 Time Travel/Production 备份验收。

# FINANCE-P02 复验入口

这些文件只增加测试源/合成数据，不修改产品。结果有意保留失败退出码。没有 ADB、真实账户、Hosted、Production 或模型服务调用。开始前仍须遵守 AGENTS 和所有者当前授权。

首次执行使用独立 worktree。已有结果不得覆盖；下面命令适用于**没有 P02 原始输出的新隔离复验 checkout**。现有交付 worktree 的日志和全部失败应保留。Node 脚本输出到固定 ignored `docs/migration-evidence/finance-p02/matrix`，不得对已有交付目录直接重跑。Native 每次使用新的 output 目录；seed 和 restore 两个命令须共享该目录，分别启动 Test worker。

在该隔离 root 的 PowerShell 中设置进程级环境，不改全局配置：

```powershell
$p02Root = (Get-Location).Path
$p02Evidence = Join-Path $p02Root 'docs/migration-evidence/finance-p02'
if (Test-Path -LiteralPath $p02Evidence) { throw '保留已有证据；改用新的隔离复验 checkout。' }
New-Item -ItemType Directory -Path $p02Evidence | Out-Null
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
Get-ChildItem Env: | Where-Object Name -Match '(?i)(SIGNING|KEYSTORE|STORE_PASSWORD|KEY_PASSWORD|KEY_ALIAS)' | ForEach-Object {
    Remove-Item -LiteralPath ('Env:' + $_.Name)
}
npm ci --ignore-scripts --no-audit --no-fund
python qa/finance-p02/generate_fixtures.py
```

先执行原有 607（不带 P02 overlay），每条命令独立保留 stdout/stderr 和 `$LASTEXITCODE`：

```powershell
& .\android\gradlew.bat -p .\android :app:testDebugUnitTest :app:lintDebug --rerun --no-daemon --console=plain
node local-backend/test_aeris_state_consistency.mjs
node qa/aeris/state-consistency-browser.mjs
node local-backend/test_task21_notification_js.mjs
node local-backend/test_task16_d1_js.mjs
node local-backend/test_task17_d1_js.mjs
```

归档 `android/app/build/test-results/testDebugUnitTest/TEST-*.xml` 后再运行 overlay，避免把不同运行的 JUnit 混作一次结果。浏览器脚本只使用自身临时 profile 和 loopback 服务。若 Chrome 不在默认路径，设置 `AERIS_TEST_CHROME` 到本机 Chrome 可执行文件。

新增 Native 矩阵：

```powershell
$p02Qa = Join-Path $p02Root 'qa/finance-p02'
$p02Init = Join-Path $p02Qa 'test.init.gradle'
$p02Native = Join-Path $p02Evidence 'native'
& .\android\gradlew.bat -p .\android -I $p02Init "-Dfinance.p02.root=$p02Qa" "-Dfinance.p02.output=$p02Native" :app:testDebugUnitTest --tests '*FinanceP02MatrixTest' --tests '*FinanceP02TimingTest' --rerun --no-daemon --console=plain
```

本次基线预期退出 **1**，7 个 JUnit 方法中的5个矩阵组失败；513 个 A–E 动态 fixture 的结果与堆栈逐行写出。timing 和 negative 两个方法通过。不得删除 RED 或改金额真值来获取退出0。

双进程恢复使用两个独立命令；第一次目录须不存在。归档两次各自的 JUnit，核对导出的不同 PID：

```powershell
$p02Process = Join-Path $p02Evidence 'process'
if (Test-Path -LiteralPath $p02Process) { throw 'seed 输出已存在，保留它。' }
& .\android\gradlew.bat -p .\android -I $p02Init "-Dfinance.p02.root=$p02Qa" "-Dfinance.p02.output=$p02Process" :app:testDebugUnitTest --tests '*FinanceP02SeedTest' --rerun --no-daemon --console=plain
& .\android\gradlew.bat -p .\android -I $p02Init "-Dfinance.p02.root=$p02Qa" "-Dfinance.p02.output=$p02Process" :app:testDebugUnitTest --tests '*FinanceP02RestoreTest' --rerun --no-daemon --console=plain
```

Web/本地 D1 每条独立保存日志：

```powershell
node qa/finance-p02/web-contracts.mjs
node qa/finance-p02/web-dom.mjs
node qa/finance-p02/ledger-d1.mjs
```

前两条预期退出1；第三条本次为0。AI mock 自检失败不会自动变成产品 FAIL/PASS，实际适配器15项均 NOT TESTED。Miniflare 运行既有迁移到内存隔离库，绝不使用 Wrangler `--remote`。

`report.py` 是本次审计的证据索引器，按 TEST_RUNS 指定的历史文件布局读取，不是下载结果或生成伪 PASS 的工具。复验时应先归档原始 NDJSON/JUnit，再把新的运行目录显式映射到报告输入；不要把历史报告重生成当重新测试。本次完整机器输入与输出在 `report-results.json`，最终 C8 来源为 `preauth-reviewed`，D24 来源为 `currency-booking-final`，其余 A/B/E、负入账、timing 来源为 `validated-matrix`。

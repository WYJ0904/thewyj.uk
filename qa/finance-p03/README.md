# FINANCE-P03 本地复验

所有数据均为合成；禁止 ADB、手机、真实支付、Hosted/Production、正式签名、推送和发布。先读所有者 P03 授权及 AGENTS。使用本分支的隔离 checkout，保留 P02 工作树及其 ignored 原始证据。

标准源码包含 P03 JUnit，不需改 Gradle 产品配置或安装新依赖：

```powershell
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
Get-ChildItem Env: | Where-Object Name -Match '(?i)(SIGNING|KEYSTORE|STORE_PASSWORD|KEY_PASSWORD|KEY_ALIAS)' | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
npm ci --ignore-scripts --no-audit --no-fund
& .\android\gradlew.bat -p .\android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --rerun --no-daemon --console=plain
node local-backend/test_aeris_state_consistency.mjs
node qa/aeris/state-consistency-browser.mjs
node local-backend/test_task21_notification_js.mjs
node local-backend/test_task16_d1_js.mjs
node local-backend/test_task17_d1_js.mjs
```

每条命令保存 stdout/stderr、退出码和独立 JUnit 副本。Gradle 测试必须串行，避免共享 build 输出互相覆盖；不得把上次 JUnit 计入本次。

独立 D1 测试每次必须指定全新 ignored 输出目录。脚本拒绝覆盖自身结果文件；Miniflare 仅创建本地临时数据库，不使用 Wrangler 远端绑定。

```powershell
$env:FINANCE_P03_OUTPUT=Join-Path (Get-Location) 'docs/migration-evidence/finance-p03/my-server-run'
node qa/finance-p03/server.mjs
$env:FINANCE_P03_OUTPUT=Join-Path (Get-Location) 'docs/migration-evidence/finance-p03/my-migration-run'
node qa/finance-p03/migration.mjs
$env:FINANCE_P03_OUTPUT=Join-Path (Get-Location) 'docs/migration-evidence/finance-p03/my-legacy-run'
node qa/finance-p03/legacy-raw.mjs
```

`legacy-raw.mjs` 仅读取原 P02 已提交的模型函数作合成对照，不在 P02 执行构建或写入；需要其原路径保留。原 607 的断言不删减：一个离线同步夹具补充可靠引用，两个旧账保护夹具显式预置“旧版本已持久化账目”，迁移链加 v11。无身份新建账目的 0 账目约束由新增回归覆盖。详见 TEST_RUNS，不能把这些夹具调整隐瞒为完全相同输入。

双 JVM 闭环使用真实捕获装配、Room 文件、outbox、HTTP transport 和本地 D1：

```powershell
$p03Root=(Get-Location).Path
$p03Qa=Join-Path $p03Root 'qa/finance-p03'
$p03Run=Join-Path $p03Root 'docs/migration-evidence/finance-p03/my-bridge-run'
if(Test-Path -LiteralPath $p03Run){throw '保留既有证据，选择全新目录'}
& .\android\gradlew.bat -p .\android -I (Join-Path $p03Qa 'test.init.gradle') "-Dfinance.p03.root=$p03Qa" "-Dfinance.p03.output=$p03Run" :app:testDebugUnitTest --tests '*P03BridgeSeedTest' --rerun --no-daemon --console=plain
```

Seed 完成后，在本轮专用隐藏终端/命令进程启动 `bridge-server.mjs`，设置同一 `FINANCE_P03_OUTPUT`，仅监听随机 loopback 端口。它使用合成账户直接调用真实服务，**不证明真实登录、设备身份或 Hosted 鉴权**。首次已提交的响应故意返回503，验证远端成功而本地未收到确认。

```powershell
$env:FINANCE_P03_OUTPUT=$p03Run
node qa/finance-p03/bridge-server.mjs
```

服务报告 ready 后，在另一个本轮命令进程按相同 Gradle 参数运行 `--tests '*P03BridgeRestoreTest'`。核对两个 PID 不同、最终队列为空、正式账目数量及 ID 稳定。结束后读取 port.json，仅对本轮 loopback 地址 `POST /_p03_shutdown`；保存 server-final.json 并确认服务退出，不停止其它进程。

P02 文件及真值不修改。其 Matrix/Timing/Seed/Restore 使用原 `qa/finance-p02/test.init.gradle` 与全新输出目录重跑。Web 脚本输出固定在**当前隔离 checkout**的 ignored finance-p02/matrix，先复制保存，不要进入受保护的原 P02 工作树运行。保留 EXPECTED_RED 和当前 FAIL 的真实非零退出码；机器结果及逐案归属见 docs/finance-p03/TEST_MATRIX.md。

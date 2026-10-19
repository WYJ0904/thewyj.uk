# FINANCE-P03-A 本地复验

本目录只用于当前隔离 worktree 的合成回归。默认提供方验证器拒绝；测试注册器只在QA注入，不作为真实提供方证据。不可操作手机、ADB、Production、正式数据、签名发布、PR、合并或推送。

所有运行必须使用新的名字，启动器拒绝覆盖已有日志。只允许一条Gradle命令同时运行；Node可使用独立的Miniflare DB并行。完整命令及退出码保存在每次的 `*-run.json` / `node-*/exits.json`。

```powershell
python qa/finance-p03/phase-a/prepare-v4.py
./qa/finance-p03/phase-a/run-gradle.ps1 -Flavor Standard -Name owner-full -OutputName owner-standard -Tests @() -Full
./qa/finance-p03/phase-a/run-node.ps1 -OutputName node-owner
./qa/finance-p03/phase-a/run-one.ps1 -Name owner-reconciliation -Script qa/finance-p03/phase-a/reconciliation.mjs
./qa/finance-p03/phase-a/run-one.ps1 -Name owner-migration -Script qa/finance-p03/phase-a/migration.mjs
./qa/finance-p03/phase-a/run-gradle.ps1 -Flavor P02 -Name owner-matrix -OutputName owner-native -Tests @('*FinanceP02MatrixTest','*FinanceP02TimingTest')
./qa/finance-p03/phase-a/run-gradle.ps1 -Flavor P02 -Name owner-process-seed -OutputName owner-process -Tests @('*FinanceP02SeedTest')
./qa/finance-p03/phase-a/run-gradle.ps1 -Flavor P02 -Name owner-process-restore -OutputName owner-process -Tests @('*FinanceP02RestoreTest')
./qa/finance-p03/phase-a/run-bridge.ps1 -Profile legacy -Name owner-legacy
./qa/finance-p03/phase-a/run-bridge.ps1 -Profile closeout -Name owner-clearing
./qa/finance-p03/phase-a/run-reconciliation-bridge.ps1 -Name owner-reconciliation-bridge
```

P02聚合方法及Web/DOM保留真实非零退出，不能据此跳过后续独立测试。输出重定向只改本轮日志目录，不改冻结P02源码、输入或断言。原测试迁移注册续接Room13 / D1v5，旧schema和迁移DDL不改。

`run-complete.ps1` / `run-verified.ps1` 记录本轮两个完整串行执行批次，名字已被占用；复验可逐条使用上面的新名字。Standard 不加载跨JVM测试源码，防止把缺端口的restore方法误塞进全量JVM；桥接只按其seed/restore方法运行。

新桥接：JVM1把Room与原磁盘队列写到文件，JVM2重开；loopback服务验证种子里的精确合成操作，在修正已提交后实际返回503；导出可检查的SQLite逻辑快照，重建D1 runtime，然后重放原请求及30次重复。它不证明真实D1二进制备份、真实银行合同或手机行为。旧两组桥接原3账/2待核实/至少9请求、4账/1待核实/至少15请求断言保留。

`reconciliation.mjs` 每例保存真实账目、原始/有效事件、candidate、receipt、完整修正日志和审计表，独立核对审计SHA指向的完整before image。`FINANCE_P03A_CASE_FILTER` 仅用于已记录的失败前定点复现；正式验收清空该变量、执行全组，不把筛选执行冒充全组。

四份一次性实现变换脚本保存在 ignored `phase-a/implementation-transforms/`，包含中间失败，不属于复验命令；不要重复运行。源码、测试、文档最终状态及旧资料保护以本轮 provenance / validation 为准。不得运行旧report生成器覆盖P02/P03/closeout封存。

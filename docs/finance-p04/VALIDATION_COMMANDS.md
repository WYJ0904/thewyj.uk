# P03/P04 云端最终命令与日志索引

2026-10-22，Asia/Hong_Kong。工作目录 `/workspace/thewyj.uk`，所有数据库为合成本地
状态。以下记录实际命令；输出相对 `docs/migration-evidence/finance-p04/cloud/final-20261022/`。
完整参数/起止 UTC/退出码以 `regression/{node,jvm}-commands.json`、
`android-current/command.json`、`command-inventory.json` 为准。普通 shell 子步骤未
单独记录起止时间者在清单中标为 null，不从文件 mtime 伪造耗时。

## 激活与原地核验

```bash
source /workspace/.cloud-onboarding/android-env.sh
git branch --show-current
git rev-parse HEAD
git status --short
git merge-base --is-ancestor 5d96e1ee5d2064076bd0efa59eed86edb9b1c4cc HEAD
git -c core.whitespace=cr-at-eol diff --check
FINANCE_P04_OUTPUT=docs/migration-evidence/finance-p04/cloud/final-20261022/baselines \
  python3 qa/finance-p04/prepare-baselines.py
```

继续前通过 Python zipfile/hashlib 对封存 ZIP CRC、1118 个 payload、77 个 WIP
源码、1033 个证据与原目录逐一比对；记录于 `execution-notes.json`。不读取根密码
文件，不输出环境凭据。原检查点所有者 SHA 与本机一致。

## 最终 Android（串行）

```bash
FINANCE_P04_OUTPUT=/workspace/thewyj.uk/docs/migration-evidence/finance-p04/cloud/final-20261022/android-current \
  python3 qa/finance-p04/android.py
```

该入口实际执行：

```bash
bash android/gradlew -p android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug \
  --no-daemon --max-workers=2 --console=plain --stacktrace \
  -PTHEWYJ_BASE_URL=https://isolated-finance.invalid
```

退出码和 705 项当前 JUnit、Lint XML、APK SHA-256 在 `android-current/`。此前
`android/` 同样 705 PASS 的全量保留；最后仅修新测试输出为独立目录、不覆写
历史，再跑同一全量。旧输出已另存并由封存 ZIP 恢复历史版本。检查点 702 的
结果及后续两次 targeted ticket 失败也保留。

Targeted 命令选 `*CurrencyWireAndEnrichmentTest` 和 `*CurrencyReferenceRoomTest`，
其余 Gradle 参数同上：`android-target.log`、`android-target-second.log`、
`android-target-third.log`（9 PASS）以及各自 `target-*-junit/`。

## 原有 Node/Chrome、冻结 608 和跨 JVM 桥

```bash
FINANCE_REGRESSION_OUTPUT=/workspace/thewyj.uk/docs/migration-evidence/finance-p04/cloud/final-20261022/regression \
FINANCE_OUTPUT_REDIRECT=./qa/finance-p04/output-redirect.mjs \
NODE_OPTIONS='--import=./qa/finance-p04/fresh-inputs.mjs' \
AERIS_TEST_CHROME=/workspace/.cloud-onboarding/chromium-test \
USERPROFILE=/workspace/.cloud-onboarding/userprofile \
  python3 qa/finance-p03/cloud/run.py
```

这是实际批次的 USERPROFILE，导致仅 `p03-legacy` 缺旧基线模块；原错误保留。
该批次其余 22 个任务继续执行，非全绿：原 aeris-dom 首断言失败，P02 web/dom
因冻结预期红灯退出 1。各 23 个命令及日志都有 manifest。
修正环境路径后的独立原驱动重放（不改测试源码/断言）：

```bash
FINANCE_P03_OUTPUT=docs/migration-evidence/finance-p04/cloud/final-20261022/regression/p03-legacy-corrected \
USERPROFILE=/workspace/.cloud-onboarding/legacy-profile \
  node qa/finance-p03/legacy-raw.mjs
AERIS_TEST_CHROME=/workspace/.cloud-onboarding/chromium-test \
  node qa/finance-p04/legacy-browser-context.mjs
```

分别 `p03-legacy-corrected.log`（原 8 项 PASS）、`aeris-explicit-currency.log`
（派生 6 PASS，不代替原 6 Chrome）。旧 raw 模块及其唯一依赖逐字节匹配
`98ffe1d97e9cbbedbcb4faa609ed8a5db9046a67`；P03 旧服务匹配 `dd5fc98b`。
可用上述 prepare-baselines 只读 Git 对象核验/补齐，不覆盖不同文件，未读旧电脑。

```bash
FINANCE_REGRESSION_OUTPUT=/workspace/thewyj.uk/docs/migration-evidence/finance-p04/cloud/final-20261022/regression \
FINANCE_TRACE_ROOT=/workspace/thewyj.uk/docs/migration-evidence/finance-p04/cloud/trace-room15-source \
  python3 qa/finance-p03/cloud/jvm.py
```

十二个串行 Gradle 命令逐一记录到 `regression/jvm-commands.json`，执行 trace5、
冻结 matrix/timing、process seed/restore、四桥 seed/restore。仅 frozen-native 因
原聚合红灯退出 1；其余通过。Trace 派生副本只把最终 schema14 改为当前15，
保留原事件/金额/ID/outbox 断言，修改记录在 `trace-room15-source/adaptations.json`。

```bash
FINANCE_REGRESSION_OUTPUT=/workspace/thewyj.uk/docs/migration-evidence/finance-p04/cloud/final-20261022/regression \
FINANCE_P03_OUTPUT=docs/migration-evidence/finance-p04/cloud/final-20261022/regression/device-projections \
  node --import ./qa/finance-p04/fresh-inputs.mjs qa/finance-p03/finish/projections.mjs
FINANCE_REGRESSION_OUTPUT=/workspace/thewyj.uk/docs/migration-evidence/finance-p04/cloud/final-20261022/regression \
FINANCE_P03_PERSIST_NAME=../../finance-p04/cloud/final-20261022/regression/native-persist \
  node --import ./qa/finance-p04/fresh-inputs.mjs qa/finance-p03/nonphone/native-persist.mjs
```

`projections.log` 三项 PASS；`native-persist.log` 及 result.json 实际关闭/二进制
复制/重开 105 表。preloader 仅映射到本轮 D1 输入，不改断言。

## P04 专项

```bash
node qa/finance-p04/money.mjs
node qa/finance-p04/fx.mjs
node qa/finance-p04/oracle.mjs
FINANCE_P04_OUTPUT=docs/migration-evidence/finance-p04/cloud/final-20261022/contracts-projection node qa/finance-p04/contracts.mjs
FINANCE_P04_OUTPUT=docs/migration-evidence/finance-p04/cloud/final-20261022/migrations-weak-receipt node qa/finance-p04/migrations.mjs
FINANCE_P04_OUTPUT=docs/migration-evidence/finance-p04/cloud/final-20261022/browser-legacy-unit node qa/finance-p04/browser.mjs
FINANCE_P04_OUTPUT=docs/migration-evidence/finance-p04/cloud/final-20261022/live-fx-final node qa/finance-p04/live-fx.mjs
```

日志为 `money.log`、`fx-final.log`、`oracle.log` 和同名 folder 对应的 `.log`。
专项 JSON 用 wx 创建；迁移 SQLite 使用全新目录，旧文件未删。Live harness 用
既有 EnvHttpProxyAgent，无密钥/TLS 绕过；JSON 保留实际公网 URL/响应/HTTP 时间。
先前 live-fx 两次新驱动键名错误均保留。精确 oracle 源为独立 Python Decimal
100 precision、ROUND_HALF_EVEN，216 个固化向量未按产品结果生成答案。

## 本地运行时及静态检查

```bash
node scripts/check_js_module_graph.mjs
node scripts/check_storage_contract.mjs
npm run cf:check
npm run pages:stage
./node_modules/.bin/wrangler d1 migrations apply WYJ_DB --local \
  --config .wrangler/onboarding/wrangler.jsonc --persist-to .wrangler/onboarding/state
./node_modules/.bin/wrangler d1 execute WYJ_DB --local \
  --config .wrangler/onboarding/wrangler.jsonc --persist-to .wrangler/onboarding/state \
  --command "SELECT 'Task16' AS component,value AS schema_version FROM task16_metadata WHERE key='schema_version' UNION ALL SELECT 'Task21',value FROM task21_metadata WHERE key='schema_version'" --json
bash /workspace/.cloud-onboarding/start.sh
node /workspace/.cloud-onboarding/runtime-smoke-final.mjs
```

分别见 `module-graph.log`（57 文件/95 imports）、`storage-contract.log`（29 key
families）、`cf-check-final.log`、`pages-stage-final.log`、`runtime-migrations.log`、
`runtime-schema.json`（4/8）、`runtime-pages.log`、`runtime-smoke-second.log/json`。
Pages 仅服务 allowlist staging，D1/R2 只本地；CLI 提示的 --remote 未执行。
CDP 首次缺进程失败/旧 profile 锁保留，之后独立临时 profile 的 Chromium port9225
由本任务启动，未恢复 cookie/正式权限。公开 curl 的实际 200 头/正文也单独保存，
并未仅凭 curl 将产品适配器判 PASS。

## 收集与提交记录

```bash
python3 qa/finance-p04/collect.py
git -c core.whitespace=cr-at-eol diff --check
```

最终 `delivery-final-v2/` 创建失败即拒绝覆盖；前一 `delivery-final/` 保留。
源码/证据 SHA-256 在 `provenance.json`，提交后 HEAD/tree/清洁 tracked 状态在
`REVISION.json`。只做本地提交，不 push、PR、merge 或发布。

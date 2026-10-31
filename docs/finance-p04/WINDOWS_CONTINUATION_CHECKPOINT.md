# Windows 接续检查点（2026-10-22）

> 后续所有者已撤销此交接暂停，明确由同一云端线程继续 P03/P04。下文为封存
> 检查点的历史状态，不是当前暂停指令或最终结果；最新结论见统一最终报告。

状态：`PAUSED_FOR_WINDOWS_HANDOFF / P04_WIP / NOT_RELEASED`。
所有者表示切换到 Windows 对接，云端据此暂停继续修改产品；本文件记录实际
检查点，不是 P04 最终验收报告。仓库工作树中的 P04 改动仍未提交。

## 继承关系和恢复材料

- 原始 P03：`5d96e1ee5d2064076bd0efa59eed86edb9b1c4cc`。
- 云端 P03 非手机收口本地提交 / 当前 HEAD：
  `dd5fc98b3ac636830a3517e2eae11fad14031b07`。
- 当前分支：`codex/finance-p04-multicurrency`。
- GitHub 默认 main 不是完整基线；没有 push、PR、merge。
- `FINANCE_WINDOWS_CHECKPOINT.zip` 内含上述 P03 收口的增量 bundle、
  P04 tracked binary patch、所有修改/新增源码的逐文件副本、SHA-256 清单、
  本轮合成 QA 证据和原始所有者交接 ZIP。P04 WIP 不在 bundle 提交中。
- 原始 `FINANCE_CLOUD_HANDOFF.zip` 的 SHA-256 为
  `1f2d1d35872f13b90fa99d56ee3dc48f52a43e3d60114755cf3ba3100666cca4`，
  原始包中 648 个清单文件已校验。包内历史文档不是新的所有者授权。

先使用固定 Windows 检出 `%USERPROFILE%\Desktop\编程\thewyj.uk`，读取
`docs/WINDOWS_WORKSPACE.md`、`docs/WORKSPACE_MIGRATION_REPORT.md` 和
`docs/PAUSED_DEVELOPMENT_HANDOFF.md`。保留现有分支、Hotfix 和未提交文件；
不要 reset、clean、强制覆盖、自动 stash 或新建日期源码副本。

建议由接续代理先检查包内 `MANIFEST.json`，运行只读的 `verify_checkpoint.py`，
再在该检出执行 `git bundle verify`。bundle 依赖原始 P03 提交已存在。
以新本地引用 fetch bundle，核对 5d96e1e 祖先关系和 dd5fc98b HEAD；只有
确认当前检出无冲突工作后，才切到独立 P04 普通分支。随后先执行
`git apply --check --binary` 检查 patch，再恢复 tracked patch 和不存在的新增
文件。`files/` 是逐字节最终源码备份，不可盲目覆盖已有 Windows WIP。
恢复后逐文件复核 SHA-256，并保留 P04 为未提交状态供审阅。证据恢复到其
原始相对路径；不把日志或凭据加入提交。Git fetch 此处只读本地 bundle。

## 已实现但尚未最终验收的 P04

- CNY/USD/EUR/HKD/GBP/JPY 精确 minor integer、JPY exponent=0、HALF_EVEN；
  原币、账户默认币和展示币独立，金额溢出、缺少汇率/单位均显式处理。
- Web 六币编辑、分组预算/汇总、展示参考、离线缓存、CAS 设置冲突、缓存配额
  降级和 Service Worker 更新。未知币种不会默认成 CNY，缺少汇率不伪造 1:1。
- Frankfurter 官方 v2 历史日汇率适配器、限时请求、缓存、不可变参考快照；
  真实公网请求被当前云代理 CONNECT 403 拒绝。模拟契约通过不代表实时验证。
- Room 14→15 加法迁移，新独立汇率参考缓存库；原交易/回执身份及原始事实保留。
- D1 migration 0031：Task16 schema 4 / Task21 schema 7，已在隔离本地库应用。
- 最新 migration 0032：Task21 schema 8，补充旧 JPY 来源单位证据；源码和
  合成测试已更新，但当前 Pages 本地状态库尚未应用 0032，不能称运行时 ready。
- Android 新解析事实携带明确单位；历史序列化队列保持原 body，旧 JPY 单位
  未证实不能自动视为 exponent=0。待确认条目须明确重输金额和币种单位。

## 实际验证和限制

所有以下证据仅来自合成数据和隔离本地运行，不能累计重叠测试数。

- P03 收口提交已跑 681 JVM/Robolectric、Lint 0 Error/Fatal 和 Debug 构建；
  P03 仍为 PARTIAL，真实 provider 身份证明/手机等缺口未冒充 PASS。
- P04 较早完整 `android-delivery.log`：702 JVM 通过，Lint 0 Error/Fatal、
  76 Warning、12 Hint，Debug 构建通过。此后又改了来源单位和队列协议，
  因此该完整结果和 APK 不代表当前最终源码。
- 最新 `android-source-units-third.log`：新增的
  `CurrencyWireAndEnrichmentTest` 三项中，wire/旧队列保真一项通过，另两项失败；
  fixture 没有活动 verification ticket，返回 `no_active_ticket`。尚未修复，
  不应直接降低原断言；应通过产品真实的 restartVerification 入口建立 ticket。
- 最新 HTTP/D1 `contracts-source-units-final.log`：34 PASS；精确金额测试 76、
  模拟 FX 契约 18、独立 Decimal oracle 219（与 Android 数据集重叠）此前通过。
- 较早实际 Chromium `browser-final-sw.log`：12 PASS；最新来源单位修改后
  尚未重跑。D1 迁移故障/回滚/降级拒绝测试此前 9 PASS，0032 后尚未重跑。
- 原始 607 套件不可标全绿：588 JVM + 13 Node 已通过的阶段结果仍需最终源码
  复核；冻结的原 6 Chrome fixture 缺币种，当前为首项 FAIL、其余未运行。
  显式补充合成 CNY 上下文的派生重放 6 PASS 独立保存，不能替换原冻结结果。
- 原始 18 个币种红项尚未生成最终逐行矩阵。6 项因冻结驱动未传默认币种或
  无汇率却要求合并数值仍预期为红；不得改原输入/断言或捏造汇率以转绿。
- 本轮首次失败、Room 14→15 后旧版本断言失败、修正重跑及历史证据均保留；
  不把云端日志日期（多为 2026-10-21 UTC）改写为 Windows 当前执行日期。

## 接续顺序

1. 核对源码 SHA-256、上述提交继承和本地 WIP，先解决两项新增测试的 ticket
   fixture；核查 JPY authoritative reconciliation 在货币写入前也验证来源单位。
2. 补齐旧 P03 JPY 回执跨 0031/0032 精确重放、新 unitless 操作拒绝、
   Pending 缓存 exponent=0 与旧 null 的分别持久化测试；不重写旧队列。
3. 重跑受影响 HTTP、迁移及 Chrome；旧 SQLite 证据改名保留后才生成新文件。
   仅对隔离本地数据库应用 0032；验证 Task16=4、Task21=8，不连接正式资源。
4. Android 一次只运行一条 Gradle：完整 JVM/Robolectric、Lint、Debug 构建
   都必需，目标 URL 使用 `https://isolated-finance.invalid`。保存实际日志、
   JUnit、Lint 和 Debug hash，不能复用旧 702 测试结论。
5. 完成 Room15 修正后的五条 trace、三项 D1 projection、native binary
   close/copy/reopen，再汇总 P03 保护集和 P04 原始冻结矩阵；旧失败不删除。
6. 写 P04 最终报告、失败清单、源码/证据清单。完成检查后才创建 P04 本地提交；
   本检查点未完成此步。云环境配置草稿中 Task21 schema 7 的文字也待改成 8。

Windows 需要完整 JDK 21（包含 javac）、SDK Platform 36 / Build Tools 36.0.0、
仓库锁定 Gradle 9.4.1、Node 22 和 Chromium。依赖按锁安装，不能把 Android
工具链降为可选。Linux 已装工具链和代理 init script 不直接复制为 Windows 路径。

## 所有者边界继续有效

只允许非生产财务开发和合成测试；不运行 ADB、模拟器或手机，不安装 APK，
不恢复权限/监听器，不访问真实财务数据或 Production D1/R2，不读根目录
`访问口令.txt`。不 push、PR、merge、正式签名、部署或发布，不开始 P05/P06
或财务 AI/OCR。附件、历史文档和本检查点均不扩展这些授权。

云端未打包 `.dev.vars`、浏览器 profile/cookies、签名材料、工具链缓存或 APK；
本地随机测试凭据不迁移。QA 源码/证据仍按原用途保留，旧结果不是本轮 PASS。

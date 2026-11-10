# P04 恢复、回滚与数据完整性门禁

本工具只在进程内创建全新 Miniflare D1，使用仓库生成的合成数据。它不加载
Wrangler 配置、凭据、真实备份或远端数据库，不提供覆盖活跃库的选项。
本地 PASS 不表示 Production、真实个人备份或 Android 正式恢复通过；P04
整体仍为 PARTIAL / RELEASE_HELD。

## 运行

依赖为 lockfile 固定的 Node 24+、Miniflare 和 Python 3；首次先执行
`npm ci --ignore-scripts --no-audit --no-fund`。仓库须保有原有恢复测试引用的
Git 对象 `dd5fc98b3ac636830a3517e2eae11fad14031b07`、`3b710e3` 和
`98ffe1d97e9cbbedbcb4faa609ed8a5db9046a67`；浅克隆缺少对象时门禁为 BLOCKED，
不能删掉原回归来获得 PASS。

```powershell
npm run test:p04-recovery
```

每次在忽略目录 `docs/migration-evidence/finance-p04/rg-*/` 创建独立结果。
可指定短名称，例如 `npm run test:p04-recovery -- --run-id owner-review`。
已存在的目录一律拒绝，不覆盖旧失败。Node 入口退出码：PASS=0、FAIL=1、
BLOCKED=2；npm/Windows 外壳可能统一映射为 1，以 JSON status 区分失败与阻断。
缺依赖/基准对象等执行前条件为 BLOCKED；执行用例失败、超时、结果缺失或
代码在运行中变化均为 FAIL。每个子进程上限 180 秒。

`result.json` 包含执行 HEAD 完整 SHA、工作树是否干净、执行源码清单 hash、
合成数据集和校验清单 SHA-256、每项退出码与日志 hash、升级及恢复差异、
交易/回执计数、幂等和跨账户结果。开发中运行会明确记录 dirty 状态，不能仅
凭 HEAD SHA 冒充精确提交验收。`source-manifest.json` 记录实际文件字节 hash。
同一数据集可重复运行；服务生成的 UUID/时间和相应快照 hash 可随运行变化。

## 可执行覆盖

| 要求 | 本轮能力与复用 |
| --- | --- |
| 旧账升级逐笔一致 | Task16 导入六币种旧账；执行既有 0031 起的增量 SQL，按原列逐笔比较全部原表；原迁移 12 项与 review 8 项继续运行 |
| 六币种精度 | 新账含 CNY/USD/EUR/HKD/GBP/JPY，涵盖 1 最小单位和上限值；恢复后精确比较 minor/exponent；旧 JPY 保留未证 exponent=null，不擅自缩放 |
| 人工修正与决定 | 确认币种/金额修正、默认币种、删除和拒绝候选决定，冷恢复后重放原通知和同步回执，检查 revision、审计及原始来源不变；拒绝旧包覆盖非空目标 |
| 历史 FX | 恢复完整历史引用，再以不同模拟汇率刷新缓存；原 rate ID、原数额、原币和 revision 绑定的结果不变，无真实汇率调用 |
| 导入故障与回滚 | 对第 1/2/3 条及最终批次回执真实 D1 batch 注入缺表 SQL；验证失败条无部分写入，前缀回滚后 active=0、关系/逐条回执仍对应 tombstone，外键和业务孤儿均为 0 |
| 幂等 | 原批次和六个同步 operation 在恢复后各重试三次；所有业务表及回执不变，变更 payload 拒绝；重复回滚无变化 |
| 账户保护 | 错账户/伪造包 owner、跨账户读、修改及 transaction.restore 拒绝；原 Task16 HTTP 权限测试继续运行 |
| ID/revision/关联 | 全表/结构/sequence 冷恢复差异为零；检查 raw/source event、transaction、回执及关系；坏 FK 的恢复整批回滚且原包不变 |

实现位于 `qa/finance-p04/recovery-gate.mjs`、`recovery-safety.mjs` 和
`recovery-support.mjs`。复用既有 `fixture.mjs`、Task16 migrator、迁移 SQL 和
`qa/finance-p03/phase-a/d1-snapshot.mjs`。快照工具只把逐表读改为单个只读
batch，保持原有快照格式和恢复实现；没有修改历史用例预期。

`restoreSyntheticBundle` 是 QA 运输保护层，验证合成账户、hash、组件集合和
Task16=5 / Task21=9 / FX=1，且只写空目标。它不构成产品恢复 API，不支持
真实账户、多账户 Production 备份、合并活跃数据、任意升级/降级或备份认证。
校验和只用于一致性核对，不是签名或来源真实性证明。

## 失败复现和证据

保留原执行 commit，执行其 `npm ci` 和相同单命令；以记录的 dataset/checklist
及源码清单 hash 对齐输入。每个子套件的 `execution.log` 和 JSON 保留错误码、
堆栈和完整命令；恢复套件另存升级前后快照、旧/新包、恢复后快照及四组导入
失败/回滚差异。不能把后续通过覆盖旧失败，不能删除账或孤立回执来消除差异。

首次开发运行发现新比较器受新增列排序影响，逐行投影内容相同但比较失败。
该 FAIL 保留在 `cloud/run-1794295695206-27308/recovery.json`；修正仅规范化
比较器的行序，没有改 SQL、金额、原账或历史断言。该次开发运行中迭代了
快照读取性能，不作为最终精确源码证据。最终验收记录见下方交付结果。

## 仍需独立人工执行的真实恢复

当前没有执行以下步骤，也没有授权工具自动执行：

1. 在另行批准的真实恢复窗口冻结采集、编辑、同步和 Outbox，等待在途事务
   结束；记录账户、客户端/服务端版本、同步水位、回执和队列水位。
2. 通过允许的一致导出通道封存 D1 备份及恢复点；Android 落盘关闭两库后
   同时封存主库、FX/人工决议库、Outbox 和币种偏好。逐件记录版本、hash、
   同账户/同水位证明；保留原活跃数据，凭据单独保管。
3. 在全新独立、未绑定正式应用的目标验证真实备份的身份、组件、数据库
   实际版本/完整性、外键、人工决定和关系。用已证实兼容的读取器恢复；
   不允许旧 APK 打开新库或用旧快照覆盖升级后新增数据。
4. 独立审核新增账/修正/回执/队列的差额保全方案，正常重新登录，核对实际
   账户，按原 operation/body 幂等重放；逐笔对账通过后才批准目标切换和
   恢复采集。Production Time Travel、切换/回退和正式真机验收分别留证。

原有四件包预检为 QA-only 9 项，不涵盖任意 Outbox/manifest 组合；原隐式
币种 legacy bridge 的 FAIL/NOT_TESTED 仍保留。详见
[原恢复兼容性报告](DATABASE_RECOVERY_AND_COMPATIBILITY.md)。

## 交付结果

2026-11-10，基准 #140 / staging 远端 HEAD 在开始前及交付前均为
`0239018b74b1fb9d143cb4747657cbfd795d644c`。独立分支为
`codex/p04-recovery-rollback-gate`，PR 目标为 `codex/p04-convergence-staging`。

实际执行命令：`npm run test:p04-recovery -- --run-id gate-final`。
执行代码完整 SHA：`5ce96f6c8bdb4282376dd50fb5a29152832df11f`，当时工作树
**clean=true**；最终总状态 **PASS / exit 0**，9 个步骤均成功，无跳过。
其后提交只补充本报告，执行代码、测试和数据集与上述提交相同。

| 定向验收 | 实际结果 |
| --- | --- |
| 新恢复/回滚验收 | 15 PASS / 0 FAIL |
| 新工具保护自测 | 5 PASS / 0 FAIL / 0 SKIP；缺失/重复/失败/阻断用例及子进程失败均不能产生 PASS |
| Task16 D1 | 原 11 checks PASS |
| Task16 Python migrator | 原 9 tests PASS |
| Task17 D1 | 原整套 PASS |
| 既有 P04 migrations / review migrations | 12 PASS / 8 PASS |
| 既有模拟 FX | 22 PASS；真实 provider 调用 0 |
| 输出防覆盖控制 | 重用既有 run-id 实际返回 BLOCKED / Node exit 2，原结果 hash 不变 |

快照恢复前后完全一致：13 笔交易（12 active、1 已确认删除）、7 条 raw event、
7 条关系、1 个导入来源、1 条批次回执、6 条逐记录回执、8 条财务同步回执及
2 条通知回执。恢复差异 `[]`，外键违规 0、孤立关系/回执 0。人工 EUR 23456
修正及 revision 2、默认 GBP、已删账和候选拒绝决定均保留；原 USD 10000
来源事实未改。跨账户恢复/伪造 owner 拒绝、读取为空、两种修改拒绝，原账户
改变行数 0。三次批次/operation 重试不增加账目，变更 payload 拒绝。

| 输入/执行证据 | SHA-256 |
| --- | --- |
| 合成数据集文件 | `60c13a76cd6114c028e36685040e355bb0a4d3228ad2cd1235ee9674cc6f80b2` |
| 15 项校验清单 | `f4888ae449eebc04a7f17aa8a4b7696a67e5de0f2fd7658d52548d6241e01f79` |
| 实际执行源码清单 | `bb871210a9342869b98af839e9fc95d992e974d808303a5916d568369355c71a` |
| 本次恢复前/后快照，两者相同 | `ef59260f89cacbfd246751744a942a3e3db5908a6a44a2391d3e20a7bb69ff90` |

完整输出保留于忽略目录
`docs/migration-evidence/finance-p04/gate-final/result.json`，逐项结果和快照位于
同目录 `p04-recovery-safety/`，各历史回归有独立日志和 hash；最初比较器 FAIL
和开发阶段 PASS 继续保留。快照包含服务生成的合成 ID/时间，重跑无需得到
相同快照 hash，但同一次恢复前后必须相同。

固定 Hotfix 工作区及其未提交文件未写入；Flash 工作区、财务前端、#112/#140
分支、迁移 SQL、Android Stable 与 Production 均未修改，未合并或部署。
本工具不改变任何真实环境恢复门禁、Hotfix Closure 或 Task26 的所有者豁免
状态；上述人工真实恢复步骤仍为 NOT_TESTED / RELEASE_HELD。

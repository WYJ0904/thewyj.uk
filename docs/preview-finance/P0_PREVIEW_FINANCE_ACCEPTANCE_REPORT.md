# Aeris V6.3 S0：Preview 财务验收阻断核查

日期：2026-11-13（香港时间）。基线：PR #146，
`29bdbb9e3ae4cd88019b6c0046aabc6df574a942`。
独立分支：`codex/p0-preview-finance-acceptance`。

结论：迁移方案及本地保全/恢复验证已准备完成；**远程业务验收仍 BLOCKED**。
本轮只读确认缺少 0027–0034、缺少可用的授权测试身份，且 Task26 三个 Flags
全局 OFF。另外实际复现了财务模块在新安装 PWA 中无法离线加载的缺陷，已做
最小本地修复，等待独立 Draft PR 审阅和后续 Preview 部署。

本轮远程 SQL 均为 SELECT/读取元数据，成功结果 `rows_written=0`、
`changed_db=false`。Hosted 浏览器使用独立空白 Chrome 上下文和静态图片控制
页面，拦截全部 `/api/*`，记录到的 API 请求/响应均为 0。没有执行远程迁移、
创建账户、修改权限/Flags、读取现有用户密码或实际金额，没有触碰 Production
D1/R2、正式 APK、Azure TTS、Flash 工作树或 PR #148。

## 1. 精确目标与现状

| 项目 | 本轮只读结果 |
| --- | --- |
| Hosted URL | https://6d3ca922.thewyj-uk.pages.dev |
| Pages deployment | `6d3ca922-f444-4dd7-afeb-a3af33161f26`，Preview |
| 分支 / Source | `flash/p0-final-unified-convergence` / `29bdbb9` |
| 源码身份 | sw.js 和 83 项 required 资源均与精确 #146 字节匹配（文本规范化 LF） |
| D1 名称 | `wyj-cloud-preview` |
| D1 UUID | `a3e6253b-689f-49f3-998b-7c5828ea255a` |
| D1 大小 / 表数 | 2,895,872 bytes / 94 表 |
| 迁移表 | `wyj_d1_migrations`，27 行，最后文件为 `0026_wrong_book_review.sql` |
| 版本 | Task11/12/13/25/26：1；Task16：1；Task21：2 |

迁移账本额外保留 `0021_candidate_unknown_amount.sql`，其后续在源码提交
`0e26129d` 移除，但 Preview 的已应用记录仍存在。实际候选表允许
`amount_minor >= 0`、不允许 NULL。不能按“文件编号 26”推断只有 26 行账本，
也不能删除此历史记录或用仓库的旧 CREATE TABLE 重建现有表。
执行全部 8 个待迁移文件后，预计账本为 **35 行**（保留现有 27 行）。

仅读取的数据规模：账户 91 行（未删除 41，其中现有 super_admin 1；已删除
普通账户 50）、财务账目 7、原始财务事件 7、通知事件 13、Task11 学习记录
212。其他表的计数及完整迁移文件名见
[只读证据](evidence/readonly-preview.json)。没有读取用户名、密码哈希、
通知文本、学习内容或逐笔真实金额。该观察不是维护窗口中的原子业务快照，
正式操作前必须重新核对。

Flags 当前值：

| Flag | enabled / kill | channel / rollout | revision |
| --- | --- | --- | --- |
| adaptive_learning | 0 / 0 | experimental / 0% | 44 |
| mastery_score | 0 / 0 | experimental / 0% | 38 |
| adaptive_review | 0 / 0 | experimental / 0% | 42 |
| p07_accessibility | 1 / 0 | stable,beta,experimental / 100% | 56 |

三个学习 Flag 没有 enabled=1 的用户覆盖。代码明确先执行 global_off 和
channel 检查，单纯创建账户、授予语言权益或设置 user override 都不能绕过
全局关闭。因此 Flags 是第三项需要授权的准备条件。

## 2. 迁移依赖及本地验证

| 文件 | 依赖与作用 | 完成后 Task16 / Task21 版本 |
| --- | --- | --- |
| 0026 | wrong-review-v1 事件/状态；已应用，必须保留 | 1 / 2 |
| 0027 | 生命周期证据列、引用别名；依赖现有 Task16/21 表 | 1 / 3 |
| 0028 | 部分清算/退款控制列、lifecycle guards | 1 / 4 |
| 0029 | 不可变 reconciliation journal、effective view、用户决定 | 2 / 5 |
| 0030 | 系统替代关系、控制完成记录；不改旧账目金额 | 3 / 6 |
| 0031 | 五种两位币种新增 exponent=2；JPY 不重标度；FX/币种参考表 | 4 / 7 |
| 0032 | 通知来源单位独立证据表；旧 JPY 不回填单位 | 4 / 8 |
| 0033 | 币种人工确认来源/待核实标记，重建依赖 0029 的 effective view | 5 / 9 |
| 0034 | 四个 AI 辅助表及索引；默认 consent=0，不启用 Flags/模型 | 5 / 9 |

顺序只能是 0027→0034。0034 是精确候选已有的增量 SQL，核查它不表示启动
财务 AI 或开发 Task27。本轮未修改任何迁移 SQL；逐文件 hash 见
[本地验证证据](evidence/local-upgrade.json)。

复用 `qa/finance-p03/phase-a/d1-snapshot.mjs` 的 D1 逻辑导出、恢复及独立
SQLite 快照工具，新增一个范围限定的验证脚本：

```powershell
node qa/preview-finance/upgrade.mjs
```

脚本仅启动全新本地 Miniflare D1，无 Cloudflare 认证/远程数据库调用。两种
基线分别为仓库 0001–0026、远程只读 DDL 重建的结构；业务行全部为合成数据，
包含两账户、六币种账目及 12 条通知→raw→账目关系、未知金额候选、Task11 档案记录/changes、
Mastery、wrong-review 历史、旧通知/财务回执及待发 Outbox。

已通过的验证：

- 原有表的所有旧列/旧行逐一比较，保留 ID、币种、整数金额、关系、账户边界、
  学习历史和回执 JSON；只允许迁移声明的 metadata version 变化。
- 12 条六币种原记录不重标度；两条旧 JPY 的整数 12345 保持不变，新增
  amount_exponent 为 NULL；其余十条新增 exponent=2。
- 旧通知回执重放及同一待发 CNY 财务操作重试幂等，无重复入账；另一账户的
  查询不能读到该账户的新操作。Outbox 序列化内容在升级前后完全一致。
- 每个 0027–0034 文件分别注入一次真实失败，确认 DDL、数据及 ledger 同批
  回滚，然后继续未完成文件，保留全部旧记录：**8 个失败注入案例通过**。
- 在 0030 后停掉 workerd，再打开同一持久化本地 D1，仅续跑 0031–0034；
  迁移账本、原记录和回执保持完整。
- 按 ledger 再执行迁移为零变化；直接裸重放 ALTER 被拒绝，旧数据不改变。
- 迁移前逻辑快照恢复全部原表/行/ledger；前后 SQLite 备份均可重新打开，
  integrity_check=ok、升级后 foreign_key_check 为空。

最终增强通知/账目关联夹具后，完整 21 个检查均通过，包含全部 8 个逐文件
失败注入及持久化恢复；表数按实际 Preview 结构从 94 增至 112。
未把这些本地合成结果标成 Hosted PASS。旧 JPY 的单位仍需按现有能力门禁
人工确认，不能因迁移成功就自动把历史整数解释为已验证的 JPY 单位。

原始日志位于忽略路径 `.wrangler/preview-finance-evidence/` 和
`docs/migration-evidence/preview-finance/`。初始夹具对基础 schema 探针、候选
NULL 金额和旧 Miniflare `d1Persist` 选项的假设曾失败；现已按实际 DDL 和
固定 SDK 的 `resourcePersistencePath` 更正。原失败保留，未修改 SQL 或
放松金额/ID/回执保全断言。基础 schema 探针通过不代表新财务能力已就绪。

## 3. 实际 PWA 缺陷及最小修复

实际 Hosted 安装可完整缓存原来的 83 项资源，并保留本轮独立浏览器的合成
localStorage/用户 cache。`/index.html` 的 308→`/`→200 是正常同源规范化，
正文与 #146 相同，不记为产品失败。

但 `js/finance/app.js`、`format.js` 静态依赖的 `money.js` 不在 REQUIRED_SHELL。
同时阻断页面和 Service Worker 网络，并以未缓存只读路径确认网络真正被阻断
后，原 Hosted 的 money.js 请求报 NETWORK_ERROR。首次只对页面模拟离线时，
Worker 仍能联网，该结果未作为断网 PASS；最终以双目标阻断证据为准。

最小修复仅修改 SW：保留 CORE_SHELL 原 81 项和 Task26 原 2 项，增加独立
FINANCE_SHELL 的 money.js，并把其实际 UTF-8/LF hash 加入原子发布指纹。
REQUIRED_SHELL 变为 84；缺失或旧 money.js 会拒绝整次安装。新 publication
hash 为 `c4421bdb7443f61a028683272be5bb68ed92d29df7e504ce2e68d25d131217b0`。
没有更改业务模块、旧 release token、TTS、数据库迁移、Android 或 Flash 代码。

本地修复的 18 项 SW 单测及真实 Chrome 硬断网检查通过，money.js 可从新原子
缓存返回 200，用户缓存保留。提交后的正常安装、同 release 暖更新和 Task26
升级失败回滚 3 个浏览器场景、2 项派生回滚检查也通过。证据分别为
[原 Hosted 失败](evidence/hosted-pwa-baseline.json) 与
[本地修复通过](evidence/local-pwa-fixed.json)。原 Hosted URL 是不可变部署，
仍为 FAIL；本地修复不能当作它已更新。发布修复需要新的候选 SHA/Preview URL。

## 4. Hosted 功能矩阵

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 部署身份及 83 项 required 静态源 | PASS | [实际 HTTP 证据](evidence/hosted-static-identity.json)，API 请求 0 |
| 现有 SW 安装、已有 83 项缓存及合成用户 cache 保全 | PASS | 实际 Hosted，独立浏览器，无业务 API |
| 财务模块完整离线加载 | FAIL | 原 Hosted 缺少 money.js 原子缓存；本地修复尚未部署 |
| PWA 跨版本暖更新 | NOT_TESTED | 仍需对最终候选执行 Hosted 更新验收 |
| P07 三张主页悬浮卡的实际交互 | NOT_TESTED | 不运行会产生状态/限流写入的完整业务启动 |
| Task26 wrong-review-v1 / Mastery | BLOCKED | 测试身份、语言权益、三 Flags 全局关闭 |
| Task11 账户、档案和离线同步 | BLOCKED | 没有本轮授权的独立测试账户/凭据 |
| P03/P04 六币种、JPY、人工币种确认及待核实记录 | BLOCKED | 缺少 0027–0034 和独立测试身份 |
| 预授权、部分清算、退款、人工更正 | BLOCKED | 同上；不使用真实支付或手机 |
| 账户隔离、权限与实际云端回执 | BLOCKED | 需两个专用普通账户及授权写入合成数据 |
| Android 真机支付、Production | NOT_TESTED | 本轮不执行 |

## 5. 下一步

精确命令、备份、失败恢复、账户配置及清理见
[执行手册](PREVIEW_MIGRATION_AND_ACCOUNT_RUNBOOK.md)。所需最小授权为：

1. 对指定 Preview UUID 做完整私有备份、维护窗口内应用八个文件，以及必要的
   失败恢复范围；不授权 Production。
2. 创建两个普通专用账户，安全生成凭据，仅为它们授予 finance_access 和
   language_all_access，允许合成财务/学习验收写入及正常清理。
3. 在 Preview 将三个学习 Flags 临时 enabled=true、仍保持 0% rollout；
   仅这两个账户设置 experimental channel 和 enabled override，结束后按
   CAS/前置快照恢复，不覆盖并发变更。
4. 单独审阅 PWA 修复 Draft PR，之后由所有者统一收敛并授权新 Preview 部署。
   当前不合并 #146、#148 或其他 PR，不自行更新 Flash 的部署。

## 6. S0 收尾再核查（2026-11-13）

#149 原 HEAD `89e860ccc17b1093fbfabdc33a12dd36d7dd1123` 的 Core CI
[43359633199](https://github.com/WYJ0904/thewyj.uk/actions/runs/43359633199)
第 1 次执行为 **FAIL**：7 个 job 成功、2 个条件跳过，Cloud-only browser
在 `qa/aeris/p5-pwa-browser.mjs:11` 报 `84 !== 83`。原始日志及 artifact 保留。
这是上次未同步的验收脚本总数断言，不是原 81 项 CORE 合同改变。

本轮最小更正仅补齐该 P5 脚本的分层合同：独立断言 CORE=81 及原 RC5 指纹、
Task26 的两个精确模块、FINANCE 的一个 money.js，并断言组合完整为 84。
原有静态完整性、旧客户端字节、用户 cache、离线 guest shell 与在线恢复
断言保留。使用实际编译 Pages Worker、新建本地 D1/R2 和独立 Chrome 执行
该失败脚本，已通过；没有重跑 21 项迁移演练或 824 项 Android 本地回归。
新提交的精确 SHA / Core CI 以 #149 最新 head 检查为准，不将首次失败改写为 PASS。

同类依赖复核：当前 REQUIRED_SHELL 的 JS 闭包共 64 个可达模块，未发现其他
缺失的静态/字面量懒加载依赖；原 81+2+1 分层、11 项 integrity hash 和
`c4421b…` publication 均有效。未扩展到未启用功能或修改 TTS 分支。

实时只读核查再次确认 D1 UUID/名称及当前 Pages 项目 Preview WYJ_DB 绑定一致。
ledger 仍为 27 条至 0026，Task16/21=1/2，三个学习 Flags 仍 OFF/0%。八个 SQL
与 #146 原文件及既有验证 hash 一致；0031 只新增/回填两位币种 exponent，旧
JPY 的 amount_minor/currency 不缩放且 exponent 不自动确认为 0。

UTC 03:45:45 和 03:48:26 两次观察中，13 个被观察业务/策略表的行数与最大
活动时间未变；这不是全库停写证明。可见 Codex agent 树只有本任务，外部
Flash 的实时写入状态不可独立确认。故维护窗口仍 **UNCONFIRMED**，不执行
私有完整备份、remote migrations apply、注册、权益/Flags 写入或整库 restore。
已取得当次只读 bookmark 观察，执行前仍须重新捕获；它不等于已完成备份。

迁移前后证据：远程只有迁移前只读状态，没有远程迁移后保全 PASS。原 21 项
本地保全/故障恢复证据继续有效；不能用它们替代历史 Preview 的实际后置比对。
当前 Hosted 业务矩阵维持第 4 节：旧 URL 的财务硬断网仍 FAIL，登录/权益/Flags
所阻断的 Task11、Task26、财务和云回执均 BLOCKED，P07 实际交互/跨版本暖更新
仍 NOT_TESTED。本轮没有授权的独立测试账户，因而没有应撤销的本轮远端权益、
Flags 或测试数据；也没有将软删除标成物理删除。

### Samsung W01–W10

承接 [既有真实验收矩阵](../ANDROID_HOTFIX_REMAINING_ACCEPTANCE_MATRIX.md)
及 [W01–W10 方案](../AERIS_HOTFIX_PHASE4_WECHAT_PLAN.md)，本轮均为
**NOT_TESTED，0/10**；没有操作手机或真实支付。

| ID | 仍需单独授权并完成的真实事件条件 |
| --- | --- |
| W01 | 主微信、前台完整通知→合法 ticket/核实→Room/outbox→云 receipt→三页链路 |
| W02 | 第二独立事件，可同额；证明身份独立、不合并或重复记账 |
| W03 | 从本机核实到获准完成页，验证 90s ticket、来源与 profile 绑定 |
| W04 | 保存后正常 Home/返回，无手动刷新观察收敛 |
| W05 | 保存期间息屏/亮屏/解锁，分开记录人工等待，票据不续期 |
| W06 | 获准隔离网络中断/恢复，Outbox 与补拉完整 |
| W07 | 独立新事件内同 operation 重试，仅一份回执/流水 |
| W08 | 独立新事件完成后重启候选，验证实际持久化和新会话读取 |
| W09 | 单独授权的第二微信 profile/分身事件，禁止跨用户读取 |
| W10 | 第十独立事件，三页面/重载/云新会话核对同笔身份、金额和终态 |

每行都必须有独立真实事件并覆盖完整链路；重试和重读不能重复计数。正式 APK、
签名、权限、测试 origin、设备/WebView 身份及真实事件范围需要先冻结并单独
授权。Web/Android 回执协议的合成测试不等于 Samsung 验收。

### P0 最终发布前仍阻断

最新精确 SHA 的 Core CI 放行；合并后 PWA/TTS 源码收敛及新的获准 Preview；
指定历史库备份/停写/八项迁移和实际后置保全；两个 QA 账户、最小权益及三
Flags 的受控开启；完整 Hosted 业务验收；适用 Samsung 实机门禁。任何整库
restore、Production 或真实支付均不包含在本轮授权中。

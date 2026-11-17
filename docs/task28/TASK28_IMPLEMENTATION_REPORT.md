# Aeris V6.3 — Task28：统一安全文件与附件基础层（P1）

历史实现记录：2026-11-16；最终交接整理：2026-11-17（香港）。
Task27 已上线；Task28 后续收尾、集成验证和正式发布转交 Hydrogen，保持
`Draft / RELEASE_HELD`。Codex 完成本次交接后停止 Task28 工作。

## 交接结论（优先于下方历史验证）

- 最终代码/集成提交：`4b456e9a9f446ccd86266be6ff9de1b6431119c0`，已包含
  main `aec4857546c53505f05a8da5ce8e3460223b4742`；旧未完成基线合并已保存。
- 本轮只重测账户隔离：2 个必要准备步骤 + 1 个安全场景 PASS，2 个无关场景
  SKIPPED；未重跑 Android 大套件或已通过的 Task28 全功能。
- 客户端退出/换账户/迟到响应修复已提交；私有下载仍是 bearer grant，退出不
  自动吊销所有已发 token。这一旧凭证安全合同交由 Hydrogen 优先复核，未关闭。
- 旧 SHA `97c406c0` 的 Core CI 为 FAIL：Cloud-only 浏览器的回滚慢恢复用例
  帧采样为空；其他 7 个 Actions job 成功，2 个跳过，Cloudflare Pages 成功。
  最新资料提交的 CI 单独看 PR Checks，不复制旧结果，也不在本轮持续等待。
- [HYDROGEN_HANDOFF.md](HYDROGEN_HANDOFF.md) 给出准确顺序、剩余失败和保护边界。
  以下 PASS 为历史隔离证据，不能当作最终 main 集成、Hosted 或真机全验收。

## 基线与隔离

- 仓库：`WYJ0904/thewyj.uk`。
- Task28 分支：`codex/task28-secure-file-foundation`，独立 managed worktree。
- 初始开发基线：#155 的
  `8109e90fd83da110959a988f2a4aa692fee15051`；main 为
  `7766b80eb2c9e448dc08a3a4b317bfa62e0dff6e`。
- Draft PR #156 创建时，Task27 刚更新为
  `d13a588fa5475305252a4f9a1e10d656a98f384f`（Android/WebView 会话同步）。
  已仅在 Task28 分支普通 merge 该基线；唯一冲突是 SW 派生哈希，使用既有
  publication 脚本重算，保留双方源码，不 force push。后端 Task28 代码未被覆盖。
- 随后保存了 `ea283933` 发布准备基线的待提交合并；本轮普通 merge 已发布的
  main，并将 PR #156 比较基线改为 `main`，不再比较已合并的 Hydrogen 分支。
- 文件模块接入账户状态更新、
  退出和跨窗口会话变化时增加最小通知，隔离浏览器脚本另含 Windows 退出清理修复。
  不重复提交 Task27 基线增量，完整路径见变更清单。
  原 Hotfix 分支/WIP、Hydrogen 分支、原工作区及发布证据均未修改。
- 最新提交 SHA、Draft PR 地址及精确 HEAD 的 CI 结果由该 PR 的描述与 Checks
  记录，交付回复同时给出；本文件不提前冻结尚未发生的 CI 结论。

## 实现结果

原有能力已复用：[能力矩阵](EXISTING_CAPABILITIES.md)。Task14 临时内容、
Task22 multipart/续传/Range、分享 URL、访客、会员权益与两个清理 Worker 保留。

修复了实际缺陷：

- 客户端分片哈希未经校验：改为实际字节 SHA-256 比较，先预留不可变摘要，
  拒绝不同内容覆盖分片；不再把客户端声明或分片哈希当成整文件证明。
- 容量/日配额先查后写和并发分配超量：D1 条件写入、原子计数；相同初始化
  key 复用同一会话和文件，不重复占用容量/日配额。
- 完成与取消竞态：校验锁、条件发布和状态约束；取消的失败方不能删除已发布
  对象。R2 合并后 D1 失败可重试，D1 成功但确认丢失也不会误删已发布文件。
- Task14 超级管理员文件取消旁路：仅所有者可取消；原公开访问凭证继续适用。
- 请求体先整体读取、类型仅依赖声明：有界读取；共享文件头/文本验证；活动
  内容和未知二进制安全下载；历史声明哈希保持未验证状态。
- 清理页反复从头、部分失败和孤儿范围过宽：持久游标、精确规范前缀、对象
  操作预算、批次内进度、共享引用保护和失败 MPU 日志；不扫描其他桶前缀。
- 最后浏览器复核复现了退出后旧私有卡片/凭证缓存残留：账户应用顺序与退出/
  跨窗口会话通知已修正，立即清除旧视图和授权；旧所有者迟到的完成、续传和
  授权结果不更新新账户，也不能触发下载。身份恢复期间暂停文件读取。

Task28 新增：

- 版本化 `secureFilesV1`，复用 Task14/22，无第二套账户、会员、配额权威。
- 单附件初始化、所有者元数据、指定文件限时授权和撤销的 `/api/files/v1/*`。
- `access_scope=private`，在原 Task22 路由中也拒绝跨账户/管理员旁路。
- 最小迁移 `0038_task28_secure_files.sql`：扩展原表表达范围、验证、幂等、
  发布锁和清理进度；仅新增最小化文件审计与失败 MPU 清理日志。
- 原文件页面的私有附件选项、真实完整性提示、完成后预留列表刷新和必要
  控件样式；没有新增全站导航、网盘或管理 Dashboard。
- 交互式文件维护沿用 Task27 一次性 `files_cleanup` step-up 和 Task18 审计。

接口、验证字段、状态转换、错误码和兼容说明见 [服务合同](SERVICE_CONTRACT.md)。
完整文件清单见 [CHANGED_FILES.md](CHANGED_FILES.md)。未改旧迁移、套餐价格、
容量限制、签名/Stable、Room、通知/财务/学习业务，也未批量迁移历史对象。

## 验证

全部文件测试使用本地隔离 D1/R2 和合成对象。没有向远端资源写入测试数据。
机器可读汇总与执行证据指针见 [validation-summary.json](validation-summary.json)。

| 检查 | 结果与范围 |
| --- | --- |
| Task28 安全/功能/故障 | PASS，30 组；跨账户/管理员、访客隔离、类型/路径、哈希、重放、配额、完成/取消、D1/R2 失败、分页、未知结果、旧数据和审计副本下的超限请求取消 |
| 编译后 Pages Worker | PASS，3 组；真实 workerd multipart、原生流 Content-Length、全下载哈希、跨分片 Range 与撤销 |
| 桌面及移动浏览器 | PASS，5 组；真实 UI 上传/管理/下载/撤销、两账户切换及迟到授权、独立访客分享、375px 无横向溢出，Axe 无 serious/critical 项 |
| Task14 原回归 | PASS，13 组，临时文本/文件/授权及导入合同保留 |
| Task22 原回归 | PASS，等级配额、访客、续传、并发、幂等、下载次数、Range、逻辑引用与旧 API |
| 传输字节完整性 | PASS；源文件/R2/下载长度与 SHA-256、文件名、扩展名、Range 和安全 MIME |
| 队列/网络恢复 | PASS；账户隔离、session plan、暂停、断线、重试、取消和持久化边界 |
| Task27 安全回归 | 历史 PASS，早期 32 组，ea 集成工作区 33 组；含政策发布与轮换；本轮未重跑 |
| Android | PASS，新基线完整 121 suites / 834 tests / 0 failures/errors/skips（含 Task22 25 项）；Lint、Debug 构建成功；未安装手机 |
| 新基线会话桥接 | 原阈值复跑 PASS，JS 单测和 4 个浏览器仿真场景；首次慢恢复分支 FAIL 保留，原因未证实，稳定性不据此判定通过 |
| 迁移 | PASS，独立本地 Wrangler 台账 38 条，外键检查为空；旧用户/分享行与 R2 字节快照保持 |
| 构建和静态资源 | PASS，Functions 编译、两个清理 Worker dry-run、allowlist staging、模块图、storage 合同、静态 Python 31 项、SW 20 项、敏感文件审计 |
| 隔离 Hosted Preview 业务验收 | NOT_TESTED；未主动部署/迁移，不抢占 Hydrogen 共享环境 |
| 真实 Android SAF/WebView 与 Production | NOT_TESTED；未操作手机、Production D1/R2、邮件路由或 Stable |

Git 集成可能生成分支 Preview。Pages 构建绿灯不证明 Preview D1 已迁移，
也不代表 Hosted 业务或 Production 验收。CI 的 PASS/FAIL/SKIPPED 以精确
最终 HEAD 的 Checks 为准，不把未适用的发布/凭据任务标为 PASS。

workerd 真实传输样本为 16 MiB + 123 字节；32 MiB 读取硬上限和分片策略已
断言，未实测 GB 级峰值内存或公网吞吐。公开多文件整体授权不新增逐文件
R2 HEAD 扇出；指定文件授权与实际下载检查对应对象。

早期迁移、哈希实现、旧类型夹具和浏览器 fixture 的失败及其后续修复日志
保留在忽略的 `.wrangler/task28/evidence/`。浏览器 fixture 补齐隔离环境所需
的唯一 owner 和 Task18 开关，未隐藏 503 或放宽断言。传输测试保留全部字节
断言，仅为未知格式增加 application/octet-stream 的安全下载预期。

## 边界与后续

文件头验证不代表完整媒体解码或病毒扫描。多分片文件只宣称已验证分片，
不宣称整文件 SHA-256；未知格式仍可下载。R2 创建确认丢失且无 upload ID 时，
持久化 `create_unknown` 和 pending 计数，等待获授权的管理面核对，不猜测或
误删资源，也不标记为已清理。既有授权的正常 TTL 内重试保留，撤销/过期后拒绝。

Task29 导出/加密备份/恢复、Task30 全站删除、Task38 聊天、Task39 品牌分享、
Task48 知识库均只预留调用合同，没有实现其业务功能。

Task27 的潜在冲突集中于路由注册、step-up scope 单行、原文件 UI、SW 完整性
和 CI。本次 SW 哈希冲突已解决，新增会话同步基线补跑本地 JS/浏览器/Android
兼容检查。浏览器脚本在 Windows 的文件锁失败及 CDP 退出确认等待已保留记录，
仅限定测试退出清理的等待、关闭自建 Chrome 并重试临时目录清理；业务断言及
产品超时未改。未改其认证/MFA/邮件机制、迁移或分支；后续基线变化仍需重新比较和回归。

发布门禁和安全回滚见 [RELEASE_AND_ROLLBACK.md](RELEASE_AND_ROLLBACK.md)。
尤其不能直接回退到不理解私有附件范围的旧下载代码；需保留访问限制的维护
版本或先关闭相关入口。禁止清空库/桶、删除迁移字段或按前缀整批删除回滚。

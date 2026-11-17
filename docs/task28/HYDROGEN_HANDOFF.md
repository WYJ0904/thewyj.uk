# Task28 → Hydrogen 正式交接

日期：2026-11-17（香港）。所有者已将后续收尾、集成验证和正式发布交给 Hydrogen。
Codex 本轮只保存、定向核查、提交和交接；完成交接后停止开发。
Task28 保持 **Draft / RELEASE_HELD**，不据本文件批准上线。

## 1. 从这里开始

| 项目 | 交接状态 |
| --- | --- |
| 仓库 | `WYJ0904/thewyj.uk` |
| 工作树 | `%USERPROFILE%\.codex\worktrees\aeris-task28-secure-files\thewyj.uk` |
| 分支 | `codex/task28-secure-file-foundation` |
| 最终代码/集成 SHA | `4b456e9a9f446ccd86266be6ff9de1b6431119c0` |
| PR | [#156](https://github.com/WYJ0904/thewyj.uk/pull/156)，保留 OPEN / Draft |
| main | `aec4857546c53505f05a8da5ce8e3460223b4742`，已包含 Task27 #155 |
| 比较基线 | 本轮将旧 `hydrogen/task27-final-integration` 改为 `main` |
| 资料提交 | 此后的交接资料提交只更新文档；完整交接 HEAD 固定记录在 PR 描述和交付回复，本文所属提交可用下方命令准确取得 |

```powershell
git fetch origin main codex/task28-secure-file-foundation
git status --short --branch
git log -1 --format=%H -- docs/task28/HYDROGEN_HANDOFF.md
git merge-base --is-ancestor origin/main HEAD
```

本轮已普通 merge main 到 Task28，**没有把 Task28 合入 main**，没有 rebase 或
force push。最终交接资料提交完成后应为干净工作树；忽略的日志、备份、构建产物
继续保留，不等同未提交源码。接手时先核对 PR 的实际 head，不要使用旧 97c 代替。

## 2. 已完整保留的实现

- `secureFilesV1`、`/api/files/v1/*`，与原 Task14/22 适配，不建立第二套账户/配额。
- 私有 R2 附件、所有者元数据/授权/撤销、文件级限时 grant，管理员无所有权旁路。
- 服务端实际分片 SHA-256、不可变摘要、容量及日配额原子控制、初始化幂等。
- 分片/续传/Range 合同、完成与取消互斥、R2 合并后 D1 失败恢复、未知结果保留。
- 过期拒绝访问、清理预算/游标/进度、精确前缀和共享引用保护、失败 MPU 日志。
- 有界大小/类型验证、活动内容安全下载、JSON 解析上限和真实验证状态。
- 原分享界面私有选项、完整性/配额/到期提示；没有另建网盘或导航。
- `0038_task28_secure_files.sql` 及对应 D1/R2/Worker/浏览器和 Android 兼容证据。

这些能力已真实实现，后续复用现有代码，不要重写一套文件系统。
详见 [服务合同](SERVICE_CONTRACT.md)、[能力矩阵](EXISTING_CAPABILITIES.md)、
[实现报告](TASK28_IMPLEMENTATION_REPORT.md)、[变更清单](CHANGED_FILES.md)。

## 3. 安全修复现状及第一优先级

### 已提交并定向通过的客户端修复

`d2a9ec284e125a74085bb4c1196540c892307e33` 已保存此前未推送的修复与测试；
后续 main 合并保留它。重点文件：`app.js`、`js/transfer/app.js`、
`qa/task28/browser.mjs`、派生 `sw.js`。

账户应用后再通知文件控制器；退出/外部凭据变化立即清除旧私有卡片、列表、
配额视图和授权缓存，未知身份期间暂停读取。授权缓存包含所有者，迟到的上传
完成/续传/授权不会更新新账户，也不会触发另一个账户下载。保存原用户的续传
数据，不清空全站存储。服务端仍独立拒绝跨账户和管理员越权。

本轮在 main 合并后的相同代码上仅运行：

```powershell
node qa/task28/browser.mjs --owner-isolation-only
```

结果 **PASS：2 个必要准备步骤 + 1 个账户切换/迟到授权场景；2 个已通过的无关
场景 SKIPPED**。原 5 场景完整模式不变。验证覆盖 A→退出→B→A、旧缓存清除，
以及 A 的授权响应在 B 活跃时返回，等待原操作真正结束后确认没有下载。
本轮没有重跑 800 多项 Android 或 Task28 全功能套件。

证据：`.wrangler/task28/evidence/handoff-owner-isolation-2026-11-17.log`；
细节见 `validation-summary.json` 的 `handoff` 段。原始失败
`owner-isolation-before-fix.log` 及中间失败均保留，未重标 PASS。

### 必须先确认的私有旧凭证语义（门禁未关闭）

**私有下载仍使用文件级 bearer grant。** 创建授权必须是所有者，但当前
`task22-service.mjs:streamFileDownload` 的实际字节 GET 不再次校验账户/会话；
持有有效 token 者在 TTL 内可下载。`qa/task28/secure-files.mjs` 明确包含
`token:''` 的合法下载断言。文件撤销/到期会拒绝 grant；单纯退出登录目前不
等同服务端立即吊销已发 grant。不能把前端缓存修复说成会话绑定已经实现。

Hydrogen 应先核对“旧授权不能向账户 B 暴露”与 Android 原生下载、访客公开分享
的合同边界，决定是否需私有 grant 绑定所有者/会话或在注销时撤销，并增加针对
真实凭证切换的服务端回归。此项本轮只准确交接，不继续扩写；**未宣称私有旧
凭证隔离的全部安全门禁已通过**。管理员没有文件 ID 读取旁路，不代表持有被
转交的有效 bearer 凭证仍会被再次按角色拒绝。

## 4. Git 历史和基线变化

Task27 已按所有者确认在 2026-11-16 上线：#155 合并、Production D1 0035–0037、
Stable 1.3.40。GitHub 已独立确认 #155 merged 和 main `aec48575`；本轮没有
再读取远端 D1/R2、验证正式 APK 或改动生产设置。

| 提交 | 归属/用途 |
| --- | --- |
| `8109e90f` → `d13a588f` → `ea283933` → `1fe6ace0` / `fea24ba6` / `ba7b932e` → `aec48575` | Task27 的集成、政策/轮换/版本、SW 修复及 main 合并；不是 Task28 新增业务 |
| `e9f21c32c1a87491d4a88f9c6ef662f90741bfa4` | Task28 基础实现 |
| `97c406c07cd7d373a17c6704d9c6a18799afb752` | Task28 接入 d13 基线，旧远端候选/旧 CI |
| `d2a9ec284e125a74085bb4c1196540c892307e33` | Task28 账户隔离修复与回归 |
| `2ce2ca3e6d1d9c4baca88caf8705c3eda89a8bf4` | 完成此前已解决但未提交的 ea 基线合并，保存 47 个暂存文件 |
| `4b456e9a9f446ccd86266be6ff9de1b6431119c0` | 普通 merge 已发布 main，保留私有检查及定向验证入口 |

整理前 HEAD 为 d2，远端为 97c，暂存区处于 ea 的 merge 中；没有删除、reset
或丢弃它。已先保存 bundle、staged/unstaged binary patch 和 47 文件逐字节副本：
`.wrangler/task28/handoff-preservation/2026-11-17-7edfb12c0e/`，bundle verify 通过。

main 合并唯一冲突是 `sw.js` 派生哈希。保留 main 的 SW 运行逻辑，按合并后的
源码运行现有 `scripts/update_task27_publication.mjs`；对照证明除了 integrity/
publication 派生字段，其余 SW 与 main 完全一致。当前没有未解决冲突，main
是最终代码提交的祖先；Task27 源提交不再作为 PR 新差异重复展示。

## 5. CI 与历史验证，不能混用提交

旧候选 **97c406c0 / Core CI [43748832337](https://github.com/WYJ0904/thewyj.uk/actions/runs/43748832337)**：
GitHub Actions **7 success / 1 failure / 2 skipped**；外部 Cloudflare Pages success。
失败为 `Cloud-only browser, canonical session and toolbox` 中的
`Safe presentation rollback and roll-forward without clearing user storage`。
`rollback-browser.mjs` 的慢恢复用例得到空 `__rollbackFrames`，触发
`assert.ok(frames.length)`；此前 4 个用例 PASS。根因尚未在本轮证实。
main 此后已更新 SW 和该测试/诊断，本轮没有为交接重跑整条 CI，不能据此宣布
旧失败已修复。失败日志已保存为
`.wrangler/task28/evidence/handoff-ci-97c406c0-cloud-only-failure.log`。

需要复现时，使用 CI 已有的本地隔离 fixture 服务和合成管理员环境，再运行
`node qa/p07-release/rollback-browser.mjs --source <候选SHA>`；该脚本会创建测试
账户和修改隔离开关，**不能把其服务地址指向 Production**。本轮不执行它。

最终交接 HEAD 的自动 CI 由 PR Checks 另行记录；推送后可能 queued/in_progress，
**交接不等待、不手动重跑、不把旧 CI 或本地 PASS 复制为新 SHA 的全绿**。

历史本地隔离证据均保留，非本轮重新执行：

| 证据 | 实际范围/来源 |
| --- | --- |
| Task28 30 组、workerd 3 组、浏览器 5 组 PASS | ea283933 合并工作区（当时 HEAD d2 + 待提交 ea 合并），日志 `task28-ea-baseline.log` / `workerd-ea-baseline.log` / `browser-ea-baseline.log`；不是最终交接 SHA 的完整重跑 |
| Task27 33 组 PASS | 同一 ea 集成工作区，`task27-ea-baseline.log` |
| Android 121 suites / 834 tests，0 failures/errors/skips，Lint/Debug PASS | 同一 ea 集成工作区，`android-ea-baseline.log`；不是手机或正式签名验收 |
| Task14 13 组、Task22、源/R2/下载哈希与队列恢复 PASS | 早期独立候选的隔离 fixture，记录在现有 summary；未重跑 |
| 本地迁移台账 38、外键为空 PASS | 本地独立 Wrangler state；不证明 Production 台账 |

会话桥接仿真曾有慢恢复阈值内失败，原阈值复跑 PASS，原因未证实；Windows
Chrome 文件锁/退出等待失败和窄范围清理修复也保留。不要将这些记录当作稳定性
或真机全部通过。当前完整历史见 `validation-summary.json`。
`.wrangler/` 原始日志和 bundle 不随 Git 发布；若在另一台机器接手，需要从本
工作树接取这些保留资料。已提交源测试、汇总、截图及 CI 链接不受此影响。

## 6. 未完成验收和数据保护

- 隔离 Hosted Preview 业务、真实 Android SAF/WebView、GB 级峰值内存/公网吞吐：
  **NOT_TESTED**。自动分支 Pages 构建不等于业务验收或独立 D1 已迁移。
- 已验证流式样本 16 MiB + 123 bytes；分片上限 32 MiB。多分片仅为
  `parts_verified`，不能充当完整文件 SHA-256 或 Task29 备份证明。
- 文件头验证不是病毒扫描/完整媒体解码。JSON 对象解析限制 1 MiB，较大内容安全下载。
- `create_unknown` MPU 保持待恢复；没有 upload ID 不能猜测 abort 或删对象。
- 0038 文件已保留，main 源码迁移目前至 0037。本轮未执行 Production 0038，
  未写真实 R2、账户、开关、权限、签名或 Stable。先核对每个目标实际台账/备份，
  不覆盖、重编号或重放已经应用的迁移；不搬迁全部旧对象，不清空 D1/R2/Room。

**绝不能直接将已经包含 `access_scope=private` 私有附件数据的环境回滚到不理解
私有权限的旧下载代码。** 保留私有鉴权的兼容维护版本，或在独立批准下先关闭
相关入口/撤销授权再审查回退。不能 DROP 新字段、批量清空或按共享前缀删除
文件回滚。详见 [RELEASE_AND_ROLLBACK.md](RELEASE_AND_ROLLBACK.md)。

## 7. Hydrogen 接手顺序

1. 获取最终 Task28 head、main 和 PR #156；确认干净状态、main 祖先关系及独立差异。
2. 首先审阅第 3 节：复用已提交 UI 隔离修复，确认私有旧 bearer 的会话/所有者
   语义，补齐未关闭的安全门禁，保留 Android 和公开访客合同。
3. 查看最终 head 自动 CI；对旧回滚帧采样失败和慢恢复不稳定记录做定向诊断，
   不删断言、不忽略失败、不无依据放大超时。只重跑必要受影响验证。
4. 复用现有 secureFilesV1/Task14/22 和测试；基线若再前进仅做必要集成，不重写基础层。
5. 获授权后准备专用隔离 Preview D1/R2，复核 0038、外键/摘要、私有桶设置、
   清理预算、故障重试和旧数据兼容，避免抢占共享环境。
6. 所有者进行真实 Android SAF/WebView 和公网大文件验收；独立记录证据。
7. 通过门禁并获得独立发布批准后，才由接手方准备 Production 备份/0038/部署/
   回滚及适用 Stable 流程。本轮不执行这些动作，不启动 Task29。

交接完成后 Codex 停止 Task28 开发和持续 CI 跟踪；后续由 Hydrogen 负责。

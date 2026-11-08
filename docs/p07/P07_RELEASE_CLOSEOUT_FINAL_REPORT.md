# P07 正式版 Release 收尾 — 最终交付

**PRODUCTION_RELEASE_READY_FOR_OWNER_APPROVAL** · 2026-11-09 00:40:26 HKT

最终完整 SHA：`a72ec8a3186a0e91e28b6b2e286b89e21fa98ec8`。资源版本：`20261108-aeris-p07-release-rc7`。仍为 [Draft PR #137](https://github.com/WYJ0904/thewyj.uk/pull/137)，目标 main，未合并。

B1、B2、B3 技术阻塞已关闭。最终同 SHA [Core CI 42498090215](https://github.com/WYJ0904/thewyj.uk/actions/runs/42498090215) **8 个必需作业 SUCCESS / 2 个条件作业 SKIPPED**；SKIPPED 不计 PASS。新增真实 D1 API 兼容 15 项、Python 模型 9 项、SW 新 Profile 五类及安全回滚七项均在 CI 实际执行通过。CI merge tree 与候选 tree 相同。

[精确 SHA 隔离 Hosted ON](https://00ccfcce.thewyj-uk.pages.dev)，deployment `00ccfcce-7429-4c2a-9c32-250e957bd9b3`：11/11，通过启动、登录/账户/会员权限、慢请求恢复、账户切换/撤销、OFF/Kill、三卡、beta 灰度、完整规则 axe、移动端与真实新 Task11 数据契约。Preview 最终 Flag revision **36**，ON / Kill=false / 三通道 100%。生产 Flag 仍不存在，未执行任何生产开通。

真实同源暖升级：`e4844a5304709263a2810332eca5d2a87b069d3d` → `a72ec8a3186a0e91e28b6b2e286b89e21fa98ec8`，在 https://codex-p07-release-upgrade-la.thewyj-uk.pages.dev；旧 81 项缓存响应体匹配旧 Git，普通刷新实际 49 个 JS/CSS 响应匹配新 Git。登录、旧客户端模块、独立用户 cache / localStorage / IndexedDB 与离线回退保留。退出验证等待实际 /login 与会话清除；没有清缓存来通过。

发布输入：148 文件 / 5891895 字节 / manifest `98943f0badc0d6d41b5b9114b47a1f84227920faf4d73da97d2f6947f15b43a1`，本地 Git staging 与 CI 相同。安全回滚资产：148 文件 / `20261108-aeris-p07-safe-rollback-rc1` / manifest `eba1ab774ed66311199587614b16cec4dc86c80e81f52dee87f1a9c358f8082b`；位置 `.wrangler/p07-safe-rollback/a72ec8a3186a0e91e28b6b2e286b89e21fa98ec8/.wrangler/pages-output`。这是基础 UI 的受控回滚，保留安全 SW、身份与 Task11 修复，不是危险的旧 main deployment。

终场只读核对 main / canonical 仍为原版本，生产 D1 SELECT rows_written=0、changed_db=false；生产部署、main 合并、正式 Flag/D1/R2、远端迁移、真实付款、签名/Stable/手机变更均为 0。下一步仅由所有者批准，不自动执行。

剩余风险：

- 旧客户端的等时间戳歧义删除可能需要一次普通刷新；本机队列不丢失。
- Task11 服务端更新不受 UI 灰度隔离；安全回滚保留该修复，不回滚已发生的业务写入。
- 本轮没有正式数据/真实付款/真机/读屏验收；axe incomplete 保留人工复核边界，Task26 豁免仍为豁免。

[最终收据](release-closeout-evidence/FINAL_RELEASE_RECEIPT.json) · [精确生产灰度方案](release-closeout-evidence/FINAL_PRODUCTION_FLAG_GRAY_PLAN.json) · [回滚资产清单](release-closeout-evidence/FINAL_SAFE_ROLLBACK_MANIFEST.json) · [同 SHA CI](release-closeout-evidence/FINAL_CORE_CI.json)

以下保留冻结前报告和失败历史；其中待最终收据的 BLOCKED 状态为历史阶段，当前最终状态以上述同 SHA 收据为准。

# P07 B1–B3 Release 收尾报告

本报告承接 `e4844a5304709263a2810332eca5d2a87b069d3d` / Draft PR #137。RC6 SW 六并发、10 秒响应体预算、81 项完整版本校验、原子发布及旧缓存保留机制均保留，仅统一到 `20261108-aeris-p07-release-rc7`。不恢复金融 AI、Android Hotfix 或 Task26 扩展。

源码冻结前状态为 **PRODUCTION_RELEASE_BLOCKED**，直到最终精确 SHA 的 CI/Hosted 收据完成。最终收据、发布状态与完整 SHA 以 PR #137 正文和本报告的最终交付副本为准；历史失败不会因为后续通过被覆盖。

## B1：独立审查及最小兼容修复

PR #136 输入固定为 `f4ce8c7e7abc12b80895a570068fa7aa2f7a2a17`。没有直接合并或 cherry-pick；先独立复现 RC6 释义丢失、未确认版本导致的离线删除拒绝，再审查逐项产品差异。

原 #136 的 `same-client >= timestamp` 与 stale-base 放宽存在独立新 RED：同时间戳旧活记录可复活 tombstone，旧删除也能擦除更晚已落库的活记录。8 个独立 JS 向量中 RC6 4/8、原 #136 5/8、审查后修正 8/8；Python 对应 9 个向量为 4/9、6/9、9/9。它们是负对照与修正结果，未把原候选称为兼容通过。

纳入的必要修复：非空标准释义/词条字段保留；Python 保留毫秒；同客户端已确认当前版本的等时间戳编辑可接受；丢失 ACK 后较晚的同设备删除可重基；等时间戳重放不能复活墓碑；不同设备的陈旧删除仍拒绝。Web 本地时间戳单调递增、断网清定时/中止及拒绝迟到回答，导入控件在异步读取前清值以避免双重导入；隐藏错题列表保持与状态一致。

旧 Web 产生“同客户端、同时间戳、旧 base、欲删除活记录”的不可区分情况时，新服务端返回明确 409 `learning_sync_refresh_required`，不以活记录 ACK 把本机错题复活。本机 tombstone 保持 dirty；普通刷新加载新客户端后，其保留的同设备删除意图获得递增时间戳并完成同步。**旧窗口可能需要一次普通刷新**，不清用户存储，也不放宽跨设备保护。

新 Web 与旧服务端之间还验证并补齐：旧服务端 ACK 空释义时保存并修复非空释义；旧服务端拒绝未确认同设备删除时重基其版本后重发。只对同设备较晚意图重基，不把其他设备的更新当作自己的 ACK。

验证来源分开：模型/旧 Python 秒级模拟中，所有含新端的 20 项组合通过；真实旧/新认证 Task11 API + Miniflare D1 中，所有含新端的 15 项组合通过；旧 Web×旧服务端的已知缺陷保持 RED。包含同秒编辑、丢失 ACK、等时删除、重复提交、旧备份/账户隔离；实际 D1 API 的鉴权和限流保持开启。现有 D1 10 组、API 10 组及 Python 57 项通过。生产 D1/真实学习记录操作为 0。

schema_version 仍为 1；成功请求/响应字段与存储键不变；只增加明确的冲突错误码。无新增生产迁移、Room、Android 下载/签名、账号/会员/财务权限变化。

## B2：真实隔离配置、开通与灰度草案

使用既有 Git Preview：项目 `thewyj-uk` 的 **preview**，D1 `a3e6253b-689f-49f3-998b-7c5828ea255a`、R2 `wyj-cloud-preview`。连接器必须同时校验项目配置与部署快照、分支、完整 SHA 和非生产身份，才能执行测试。Production D1 `11c288d8-c584-409f-bb1f-7e7af11793e5` 不在写入白名单。

只创建本任务 4 个合成账户。一次错误的 owner 字段初始化被 D1 拒绝（HTTP400/7500），没有修改既有 owner；随后按 Task18 普通管理员角色表为新 QA 账户建立受限管理员夹具，保留单 owner 和角色约束。会员夹具通过正常管理 API 授予，没有真实付款。账号 secret/session 仅保存在 ignored `.wrangler/`，没有打印或提交。

P07 ON/OFF/Kill、灰度/账户覆盖均通过正常 Feature Flag API 和 revision CAS 执行，仅触及该 Preview。生产 Flag 没有创建/修改。首份 e484 ON 预检证明真实配置与权限路径；最终新组合必须重新验证，不能用该预检替代。

Hosted 门禁包括：精确静态输入、冷启动、合法登录、普通/无会员/管理员边界、三卡/键盘、账户/会员/财务/学习/工具/传输路由、真实慢 health 的有界恢复、跨标签换账户和撤销、OFF/Kill 保持既有业务权益、覆盖不能绕过 Kill、beta 5% 与公开策略 fail-closed、移动端完整 axe，以及最终新 Task11 服务端契约。

早期 Hosted QA 没等待副页到同源就写会话，造成换账户与依赖用例失败；修正后原用例通过。另一预检只等主页面可见，没有记录过渡/inert/挂载前提，不能倒填其旧 axe 失败的精确阶段。现在等待具体的交互前提（过渡层移除、inert 解除、挂载完成），不等“规则变绿”、不延长预算；移动端登录/已登录首页稳定态扫描零违规，原失败及 incomplete 人工复核边界保留。一次 TLS ECONNRESET 在执行浏览器断言前中止，单独记录环境失败。

正式开通草案只允许 `p07_accessibility`：创建 OFF+Kill / beta 0% → beta 5% → beta 25% → beta 100% → stable/beta/experimental 5% → 25% → 100%。默认 stable 用户在 beta 阶段不参与；公开无账户策略只有 stable+100% 才 ON。账号使用既有自愿通道与服务端确定性桶，不硬编码账号、不更改身份或会员，也不批量加覆盖。每阶段重新读取 revision 做 CAS，须由所有者单独批准，不自动推进。精确 payload 与终场生产只读 revision 见最终 Flag 方案。

任一确认的数据丢失、身份泄露或权限扩大立即停止放量并升级处理；普通刷新后仍重复冲突、持续登录/挂载故障或 SW 安装/版本混用同样不允许继续。UI 撤回只对此 Flag OFF+Kill，保留其他功能，既有有效租约最多 30 秒；不删除缓存或用户数据。

**灰度仅限制 P07 呈现。Task11 服务端修复会随整站 Functions 部署对已有客户端生效，不受 UI Flag 百分比隔离。** 这项风险由旧/新端兼容矩阵与保留修复的安全回滚资产作为发布门禁；不擅自引入关闭既有学习同步的新开关。

## B3：可审查的安全回滚资产

不直接回滚旧 main deployment。`qa/p07-release/rollback-artifact.mjs` 从精确候选的 committed allowlist 输入生成 148 文件资产：独立版本 `20261108-aeris-p07-safe-rollback-rc1`，HTML 声明受限的 legacy/base 呈现能力。该能力只能关闭 P07 呈现，不能打开 OFF 的服务器策略、不能授予业务权限。

回滚保留新候选已验证的身份/恢复机制、Task11 数据正确性修复和 RC6 安全 SW，所有 Functions 与候选相同；恢复兼容的基础 UI/URL/API 行为。它不是旧 main 的逐字节复刻，也不撤销已经发生的业务写入或回滚数据库。这样避免把旧 SW 的全删缓存和旧同步缺陷带回去。

回滚测试 7/7：真实登录与原 shell；服务器策略仍 ON 时普通刷新切换基础 UI；旧打开客户端的精确离线懒模块；旧/新 shell 和独立用户 cache、localStorage、IndexedDB 保留；离线身份恢复 fail-closed 与重连重试；缓存了另一账户时的慢 health 无泄露；再前进仍保留回滚缓存/登录/用户数据；新 profile 的基础 UI、三卡与登录/退出。

最初回滚 QA 把没有有效租约的隐藏冷标签当作已加载旧客户端，严格前提失败。修正为真实激活副页并验证 forward 应用完成后再切回主标签，没有修改产品隐藏页安全逻辑或放宽断言。原失败保留。

资产只经既有 allowlist staging 生成；不含开发目录、机密、运行时数据库或生产配置。最终需再次构建并冻结 manifest；CI 中实际运行回滚/再前进测试。正式部署回滚资产也必须另有明确批准，并在执行前确认原绑定与环境注入；本次只准备/非生产验证。

## 执行与回滚边界

main push 会自动 Production 部署，分支无保护不代表可以合并。本轮只允许本分支 Draft PR 和 Git Preview；不 dispatch 签名或发布工作流，不运行 Production deploy/migration，不修改正式 Flag/D1/R2/账号/账本/支付/Stable/手机。

首级 UI 回退为经 CAS 审批的 OFF+Kill；需要静态回退时只能用已冻结且测试通过的 safe rollback 资产。主分支停止后续发布；保全失败 SHA 与诊断；不清缓存、不反向迁移、不用 D1/R2 整库恢复覆盖用户新数据。服务器数据异常不是 UI 回退可以修复的问题，必须另行授权前向修复/数据处置。

所有者最终批准对象应包含：精确 SHA 与输入 manifest、完整必需 CI、隔离 ON/暖升级与回滚证据、Flag 阶段及 CAS revision、可执行安全回滚资产。即使技术门禁通过，也只能报告 `PRODUCTION_RELEASE_READY_FOR_OWNER_APPROVAL`，不得发布。Task26 原豁免继续为豁免，不能改称 PASS。

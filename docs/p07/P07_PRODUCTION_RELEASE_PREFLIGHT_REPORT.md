# Aeris P07 正式网站发布准备与生产安全门禁

日期：2026-11-08（香港时间）。最终发布状态：**PRODUCTION_RELEASE_BLOCKED**。

所有者已确认 RC5 五项人工体验检查通过。本报告承认该验收，不把它外推为后续组合、生产数据或发布批准。当前仅准备 Release、修复明确授权的 SW 冷安装阻塞、构建候选、运行 CI 和非生产验证。main 合并、Production 部署、正式 Flag、迁移、账户/财务/Android Stable 变更均未授权，也未执行。

## 1. 版本与候选

| 项目 | 精确版本 / 事实 |
| --- | --- |
| 远端 main / 现网源码 | `3eb268b748a6e7a1aaa7369059db474810bb59d4`；启动核对未漂移 |
| 所有者验收的 RC5 | `482580b0855e14a61b3f6b51e9d91ae7855296cb`，PR #135 |
| 第一预检候选 | `7795465814ab3c16a06db4f8a273ee29dd24d1b1`；完整 Git tree 与 RC5 相同，均为 `dfc1ed173161d624078f207cf8949af72a315532` |
| SW 产品修复冻结 | `854bac6a86191d916c3c38511c2f041b24ccb639` |
| 后续 QA 归因修正 | `e3030a57d44f4d89e3f17b89536a5b411e10d0eb` 及本报告所在提交；只改 QA/报告，不改该冻结的发布字节 |
| 资源版本 | `20261108-aeris-p07-release-rc6` |
| 独立分支 / Draft | `codex/p07-production-release-preflight`，目标 main，[PR #137](https://github.com/WYJ0904/thewyj.uk/pull/137)，禁止自动合并 |

报告自身无法包含“包含自身内容的 Git SHA”。最终候选完整 SHA、同 SHA CI run、精确 Hosted 部署 ID 和最终发布输入指纹统一写入 PR #137 的最终收据及 `FINAL_RELEASE_RECEIPT.json`；它们是本报告的组成部分。报告正文中的旧 SHA 均明确标注来源，不把后续文档 HEAD 冒充已测产品版本。

固定 Windows 主工作区原 Hotfix 分支及 WIP 未切换、stash、reset 或提交。本任务使用所有者明确要求的新 worktree，保留原目录和所有历史分支、证据、失败记录。

## 2. 129 提交与最小发布范围

完整逐提交分类、全部 484 个净变更文件和迁移逐文件 SHA-256 见 [完整分类](release-evidence/COMMIT_AND_FILE_CLASSIFICATION.md) 与 [机器清单](release-evidence/scope-inventory.json)。129 个提交均从 main 的 P07 分支展开；有 4 个合并提交、23 个纯文档提交，43 个提交触及运行时代码。不能把 129 个提交称为纯视觉修改。

RC5 相对 main 为 42 个运行时文件、57 个 QA/构建/CI 文件、385 个文档/证据文件。发布输入由原 allowlist 生成；这些证据不会上传为网站资源。保留完整上游历史，是为了保留已验收依赖与 RED 证据，不代表批量纳入其他功能。

| 分类 | 纳入的实际变化 / 依赖 | 边界 |
| --- | --- | --- |
| P07 UI、动效、无障碍 | V3 工作区、三张悬浮卡片、导航、表单/焦点/键盘/语义、账户/会员/管理/学习/工具/传输界面 | 依赖现有 `p07_accessibility`；未硬编码权限或强制 ON |
| 启动、登录、身份、恢复、策略 | 验证当前会话后呈现；挂载 generation；慢请求有限恢复；跨账户旧响应丢弃；BFCache 重验；30 秒策略租约 | 这是必要运行时依赖，不能仅复制 CSS 而省略 |
| 账户、会员、付款、管理员 | 账户与会员由叠加 modal 改为独立工作区；保留返回路径、真实权益和支付 QR 生命周期；已有反馈审计纳入管理员审计列表 | Task12/13 授权、套餐、付款写入和签名合同不改；审计接口仍校验管理员 |
| 财务、通知、学习、传输 | 财务趋势图/折叠和金额错误提示；金额转换仍为原 minor-unit 上限/两位小数，前端现在接受前导零；学习页恢复当前轮；传输只改呈现/资源引用 | 不含 P03–P06 后端；财务账本 schema/同步/通知归档/传输写入服务不改。学习同步既有缺陷见阻塞 B1 |
| Functions、D1/R2、API | 新增 `GET /api/ui/features`，只返回一个非敏感公开显示决策；既有管理员反馈审计读取 | 新公开接口仍会写既有限流桶，不能称为整个处理过程零写入；无账户/账本/付款 mutation；不需要新迁移 |
| Android Stable / 下载 | Android 源码、Room、签名、下载控制器、正式 APK 元数据和 Stable 指针均无变化 | CI Debug 构建不是正式签名或真机验收 |
| SW、缓存、自动更新 | RC5 完整版本 shell、HTML 最后发布、旧缓存/用户缓存保留、未来版本桥接；RC6 安装下载池修复 | 全部 81 个 CORE_SHELL 保留；不清理真实用户存储 |

官方品牌/Android 资源的 41 项保护检查通过；assets、vendor 与 main 字节相同。三张悬浮卡片保留。字体沿用 Segoe UI / YaHei / PingFang 等既有字体栈，仅增加缺字回退，没有引入远端字体或改品牌图像。既有 URL、API 形状和数据键保留；新增公开策略接口及管理员审计列表是可审查的增量。

纳入 #135 的完整 P07 技术依赖和本次明确授权 SW 修复。明确排除：#134、#136、#111、P03–P06 财务 AI/OCR 未完成成果及任何新 Android 发布。#134 的等待动画方案不能代替 RC5 已验收的首个可见帧修复，本次没有重复合入。

## 3. Cloudflare 真实部署与绑定

来源：[只读主收据](release-evidence/cloudflare-readonly.json)、[补充收据](release-evidence/cloudflare-readonly-details.json)。仅记录机密名称/类型，不记录值。使用现有 Wrangler OAuth 在进程内取得凭据；未打印、提交、复制令牌，也未读取根目录私人文件。

| 环境 | Pages / 分支 | D1 | R2 / AI |
| --- | --- | --- | --- |
| Production | `thewyj-uk` / main | `11c288d8-c584-409f-bb1f-7e7af11793e5` (`wyj-cloud-production`) | `wyj-cloud-production` / AI binding 存在 |
| Git Preview | `thewyj-uk` / 本任务非 main 分支 | `a3e6253b-689f-49f3-998b-7c5828ea255a` | `wyj-cloud-preview` / AI binding 存在；本次模型调用 0 |
| 已验收 RC5 隔离项目 | `thewyj-p07-ui-rc` / `codex-p07-final-integration`，生产分支为 `release-held` | `ee869f78-b54a-4018-bc99-871089ecb8cd` | R2、AI binding 均不存在 |

正式 canonical deployment 是 `0bc5e5bb-6cd3-4e02-8a65-2b8539ae80ba`，由 `github:push` main `3eb268b…` 触发，成功。实际 Pages 设置 `deployments_enabled=true`、`production_deployments_enabled=true`、production branch=main。因此 main push/合并就是潜在生产发布操作，绝对禁止。

GitHub Core CI 只运行检查；另两个工作流为特定分支 Hosted preflight 和手动签名候选。本次未 dispatch 它们。Pages Git integration 独立于 Core CI，生产发布不会自动等待 PR 检查。GitHub main 当前 `protected=false`，没有因此放松发布门禁。

实际构建为 `npm run build` → 既有 `scripts/stage_pages_deploy.mjs` → `.wrangler/pages-output`，不是整个开发目录。当前任务非 main push 自动生成的 Preview 已核对为上述非生产 D1/R2；没有执行 `wrangler deploy`、`pages deploy`、远程迁移或修改 Pages 配置。没有向旧 RC5 隔离项目重新上传版本。

Cloudflare 按环境注入 plain-text vars 与四项 secret_text（身份桥接、密码 Pepper、临时分享、设备会话）。仓库配置、项目配置及 canonical deployment 的实际绑定分别核对；没有把 development 顶层 vars 当成实际 Production。机密值未读取用于测试，测试使用独立本地随机值。

## 4. Feature Flag、AI 与既有功能

正式 deployment 的实际环境确实包含 `WORKERS_AI_ENABLED=true`、`TASK26_ADAPTIVE_LEARNING_ENABLED=true`、`TASK25_FEATURE_FLAGS_ENABLED=true`，不是仅看仓库推测。其后仍有 Task25 D1 配置、通道、账户覆盖、TTL、Kill Switch 和业务 API 的会员/账户授权检查。

只读 D1 结果：`adaptive_learning` 与 `mastery_score` 为 stable 100% 开启；`adaptive_review`、`ai_error_explanation`、`similar_word_explanation` 为 OFF/0%。现存账户覆盖均继承全局值，没有 enabled=1 的覆盖。全局 OFF、Kill、通道排除不能被账户覆盖绕过。现有 Task26 为历史正式功能，所有者豁免仍是 `CLOSED_WITH_OWNER_WAIVER` / `WAIVED_BY_OWNER`，没有改称 PASS，也没有擅自关闭它。

**正式库没有 `p07_accessibility` 记录。** RC5/RC6 对缺失记录均 fail-closed，公开策略为 missing/OFF，账户快照同样不授予该显示能力。直接发布源码不会自动给正式用户打开已验收 V3 体验。需要独立审批的精确 Flag 定义、通道/范围、预期 revision、回退条件；本轮不创建该记录、不调生产 Flag。

P03–P06、财务多币种/AI/OCR 后端与 #111 的 0026 扩展不在本候选，相关 Functions/schema/权限模块相对 main 未变化。没有因本候选新增它们的开放路径。`WORKERS_AI_ENABLED=true` 并不能证明财务 AI 已暴露，也不能成为擅自停用既有学习 AI 的理由。本轮没有确认新的未验收财务 AI 生产暴露；若后续发现，必须另立安全问题，不能借 P07 调整生产配置。

## 5. D1 与数据兼容

main 与 RC5 的 25 个迁移文件全部逐字节一致，候选没有修改它们。生产 ledger 已应用全部这些文件至 0025，实际为 26 条：另有历史 `0021_candidate_unknown_amount.sql`。该历史文件不在当前两端源码中；ledger 名称不是迁移内容哈希，不能冒充已核对历史 SQL 内容。没有补跑、删除、重写或“修正”账本。

生产仅执行白名单 SELECT（migration ledger、Task25 配置/表结构/汇总、相关表元数据）；D1 回执均 `rows_written=0`、`changed_db=false`。没有读取真实账户行、账本内容、订单、学习正文、R2 对象或手机数据。R2 仅查看 bucket 元数据。

新增运行时 SQL 只使用既有 Task25 schema 和已有反馈审计表；`ensureTask25Schema` 只读 schema_version=1。账户、会员、付款、账本、通知、学习 schema、离线队列、文件传输对象合同和 Android Room 均未新增迁移。**本候选不允许新增生产 D1 迁移。**

局部兼容检查与完整 CI 不能建立总体“绝无数据丢失”证明，B1 已直接否定学习同步的这一结论。财务既有数据、付款与传输仅通过合成/隔离合同检查，没有用真实正式业务验证或真实付款来取得通过。

## 6. 授权 SW 冷安装修复

所有者提供的独立 Flash 结果为 RC5 全新 Profile 4 轮 1 PASS / 3 FAIL；本轮没有取得该原始日志，按外部报告记录，并另做独立 RED，不编造其具体失败资源。

独立 Chrome RED：RC5 正常网络安装约 560ms；仅增加每资源 900ms 响应延迟，约 10.12s 后 install redundant，记录 `Release shell is incomplete`，没有新完成缓存、临时缓存已清理。控制服务最多同时处理 6 个请求，而 RC5 同时启动全部 81 个 fetch；10 秒预算包含浏览器连接队列等待。受控实验支持“并发突发使排队消耗截止时间”的因果解释，不声称已证明 Flash 每轮网络的全部细节。

最小产品修复只在 SW 安装路径：最多 6 个下载任务；资源计时从获得任务槽后开始；10 秒预算不增加，并延续到响应体写入 staging。全部核心下载/版本校验成功才打开最终缓存、最后发布 HTML、skipWaiting；失败仍拒绝 install 并清除本次 staging。旧版本/用户缓存、未来版本桥接、导航及 API 排除处理保持不变。

资源分级评估：81 个 shell/懒加载模块仍是完整离线合同的必需项，未降级或删除；只有原有 `/assets/logo.png` 继续作为可选品牌资源。受控验证覆盖正常、慢网络、单资源 503 与重新安装、响应体停滞、RC5→RC6 暖升级、旧客户端离线字节保留，以及独立 user Cache Storage / localStorage / IndexedDB。

预检中两次暖升级 QA 失败保留：第一次监听了退出的旧 worker；按 URL 修正后，前一次 install 的监听器又提前改写共享状态。最终按 worker URL + install generation 归因，原 45 秒预算和所有缓存/旧客户端断言未放宽。产品 SW 未为这两个测试归因错误再次改变。

最终精确 SHA 的 SW 浏览器/CI/Hosted 收据见最终票据。早期 RC6 `854bac6…` 已在实际隔离 Git Preview `506b67f3-9565-40df-8db9-4d4a2aae3924` 连续 3 个全新 Chrome Profile 安装并离线使用成功（18.905s、18.014s、16.328s）；全部 88 个公开资源逐字节匹配。它是该旧 SHA 的证据，不代替最后 SHA 的收据。

## 7. 门禁与证据解释

| 门禁 | 已有事实与判定方式 |
| --- | --- |
| 构建、发布 allowlist | 第一候选 148 项审计通过；最终版本重新构建并记录最终指纹 |
| 原始启动/策略单元 | 61/61；新增 SW 单元 5/5，核心集指纹固定，禁止删除核心资源 |
| 本地完整 P07 | 第一候选 12 组通过；RC6 新运行包括 ON、OFF、Kill、真实后台/账户切换、慢挂载、完整 axe 与 Lab；以最终收据列出的各 SHA 为准 |
| 数据正确性 | B1 FAIL；普通 application CI 偶然通过不能关闭已复现缺陷 |
| 新候选 Core CI | 必须列出全部作业；8 个必需作业和两个条件作业分别记录，SKIPPED 不计 PASS。最终 run 以票据为准 |
| Hosted | 旧 RC5 `20db867e…` 只作历史验收；本任务每次新 SHA 使用 Git 自动生成且绑定已核实的非生产 Preview。公开 shell/SW 验证不等于新版 UI ON 的 Hosted 业务验收 |
| 暖升级与数据保留 | main→RC6 普通刷新实际 49 个 JS/CSS 响应匹配，冷安装、离线及合成三类用户存储保留；未清缓存来通过。已登录的真实正式用户升级未测试 |
| 真人/设备/Production | 本轮未执行；不把本地、CI 或历史人工通过代替这些证据 |

初次 Hosted 字节审计错误地请求了 `_headers`：88 个真正公开文件相同，控制文件被 Pages 路由处理而产生一次审计 FAIL。原收据保留，修正仅把部署控制文件排除出公开 HTTP 清单；它仍在 allowlist 构建审计中验证。

`63ad14ee212b7295ecea9e1003fb3c907929ab54` 的 [Core CI 42475958597](https://github.com/WYJ0904/thewyj.uk/actions/runs/42475958597) 为 **5 SUCCESS / 1 FAIL / 4 SKIPPED**，不是通过；两个浏览器作业因 JS 前置失败未执行。反馈限流测试在 11:29:58–11:30:00 跨过实际 600 秒窗口，原第六次请求合法进入新桶返回 201，原测试却要求 429。[原失败](release-evidence/CI-63AD-RED.json) 保留。

初始时钟实验误按 60 秒建模，未复现原故障，且“下一窗口”假设失败；原无效实验单独保留，不作为产品 RED。读取路由实际 600 秒后，[独立 Miniflare/D1 实验](release-evidence/task11-ci-clock-proof-600s.json) 在旧夹具稳定复现 201≠429，修正夹具通过。仅对该隔离测试的反馈请求固定时钟，保留 5 次成功、第六次 429、错误码和 Retry-After，并新增进入下一个 600 秒窗恢复 201 的断言。没有调整产品限流、Task11 合并/同步或任何生产配置。最终完整 SHA 重新运行 Core CI，不靠随机重跑覆盖这次失败。

## 8. 仍然阻塞正式发布的项目

**B1 — 学习同步数据正确性。** 独立纯模型合成测试在 main、RC5 均得到：同客户端同时间戳的非空标准释义被旧空串覆盖；较新离线删除在服务器版本已前进但客户端未收到确认时被拒绝。旧客户端与 RC5 的相关模型字节相同，本次不会新增该缺陷，但这不能构成“无数据损失”的释放证明。#136 定向对照三个用例通过，尚未完成对其整个客户端/后端组合的独立兼容验收，故未合入。证据与可复现脚本：[模型结果](release-evidence/learning-sync-independent-probe.json)、`qa/p07-release/data-correctness-probe.mjs`（预期当前返回非零，不能改写为 PASS）。

建议受控方案：先批准对 #136 的最小 Task11 修复做独立评审，再选择独立关闭后重放 P07，或明确批准进入新的 P07+Task11 候选。必需证明：旧/新 Web × 旧/新服务端、同秒/乱序/重复/中断确认、跨设备冲突、tombstone 防复活、离线导入/复习/重连、账户切换、Task26 普通回退/队列；无新迁移和权益变化。之后才冻结新 SHA、完整 CI 与隔离 Hosted。不能直接 cherry-pick，也不能靠关闭既有学习功能绕过问题。

**B2 — 生产 P07 激活方案缺失。** 正式 Flag 记录不存在，必须先审批精确的开通与回退方案；本次不能更改生产数据库/Flag。Git Preview 同样返回 missing/OFF，因此其公开 shell/SW 通过没有关闭 P07 ON 的新 Hosted 业务验收。

**B3 — 直接回滚旧 main 会清理用户缓存。** main `sw.js` 的 activate 删除除其自身 shell 外的全部 Cache Storage。独立纯 VM 合成激活确认会删除 user cache 和 RC6 shell（没有操作任何真实浏览器数据）。证据：[回滚缓存探针](release-evidence/main-rollback-cache-probe.json)。因此不能把“点击回滚旧 deployment”当成满足本任务数据保留条件的完整回滚。需先构建并验证保持旧网站行为且保留安全 SW/缓存机制的受控回滚资产，或获得明确的独立风险处置决定；目前未发布、未改生产 worker。

**B4 — SW 新候选门禁。** RC5 的冷安装 FAIL 是正式阻塞。只有最后候选精确 SHA 的新 Profile 矩阵、全部必需 CI 与真实隔离 Hosted 均通过，才可关闭该局部项；最终票据须明确其结果。即使关闭 B4，B1–B3 仍阻塞整体 Release。

## 9. 发布前、发布后与回滚方案（只准备，不执行）

发布前：重新只读确认 main、canonical deployment、生产/Preview 绑定、迁移和 Flag revision 未漂移；关闭所有 B 项；确认最终完整 SHA、精确构建指纹与实测隔离入口；审核管理员/普通/无会员/换账户/撤销/旧客户端与 SW 失败重试；留存旧版本资产、当前成功 deployment 与安全回滚资产。发布方案不得带生产迁移、账号操作、APK 或全局 AI 开关变更。

Production 的下一次 main 更新会自动部署，应将“合并 main”与“实际部署开始”视为同一个高影响动作，需要最后明确批准和当时状态复核。普通 Git Preview push 不是授权 Production。

发布后健康清单：确认新 canonical SHA/资源指纹、HTTP 与必要 API、无新增鉴权/会员失败、正确账户身份/撤销/跨账户丢弃、P07 OFF/Kill 不扩大权限、冷安装/普通刷新/离线/旧客户端资源、学习待同步/错题不复活、账本/订单/文件传输兼容。真实付款、数据修复和正式测试写入仍需分别授权，不靠生产造数据取证。

回滚触发：错误身份/权限扩大、学习/账本/订单/队列数据异常、认证大面积失败、持续 SW 安装失败或版本混用、关键页面不可用。先停止后续发布，保全错误 SHA、资源/服务状态与不含机密的诊断；不得清理用户缓存、恢复覆盖 D1/R2 或回滚数据库。

Cloudflare 当前成功旧版本包括 canonical `0bc5e5bb…` 和前版 `55b78a0f-8419-4054-b9c2-3ffc26da3f20` 等，完整历史在补充收据。Pages 可回滚的是网站部署，不会回滚数据；但由于 B3，目前这些旧 SW 不能直接作为安全回滚目标。安全回滚资产验证通过并获批准后，才能按确切资产/目标执行；若发生身份或财务风险，由所有者单独审批针对性的服务器策略，而不是擅自全关既有功能。

## 10. 所有者下一次必须明确批准的事项

1. 是否授权 #136 的最小 Task11 独立兼容审查/修复进入候选；当前未合入。
2. 精确 P07 生产 Flag 的开通范围、通道、revision 和撤回条件；当前未改变。
3. 经测试的安全回滚资产及其触发处置；当前直接旧版本回滚存在用户缓存风险。
4. 全部门禁关闭后，针对最终完整 SHA 的 main 合并/随之触发的 Production 部署；本轮明确不授权。

本轮不请求用户批准一个仍阻塞的生产发布。交付后停在审查关口，保持 Draft 和 **PRODUCTION_RELEASE_BLOCKED**，等待所有者下一条明确指令。

方法依据：[Pages 分支部署控制](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)、[Pages Wrangler 配置](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)、[Pages 部署回滚 API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/rollback/)。实际环境结论以本仓库/Cloudflare/GitHub 的时间戳收据为准。

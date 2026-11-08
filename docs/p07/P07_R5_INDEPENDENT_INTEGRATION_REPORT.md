# P07-R5 独立集成复核

状态：**P07_R5_PARTIAL**。运行候选已在独立分支准备；人工 READY 暂缓。本文不宣称 P07 COMPLETE。

RC4 补充：RC3 封装 `9387340df75b8703a2fed39a7458fc2ddf8acbf7` 的同 SHA 冻结 25/25、主工作区 3/3、运行 7/7、策略 5/5、扩展浏览器 12/12、暖升级、OFF 2/2、Kill 2/2、PWA 全部通过。组合套件仍失败：E 的后台移动溢出以及 F 的 8 条发现均原样保留，见 [组合结果](evidence/r5-independent/green/runtime-938-suites.json)。新代码没有用整体 PASS 掩盖它们。

E 补充复现证明，375px 时旧移动规则将 `.admin-tabs` 设为 `position:static`，动画的绝对定位指示条越出容器，布局视口变成 767px（较多夹具时约 868px）。[原始 DOM](evidence/r5-independent/red/admin-overflow.json) 与 [截图](evidence/r5-independent/red/admin-overflow.png) 保留。仅为该标签栏恢复正常文档流的相对定位并设 `top:auto`，不隐藏整个页面溢出。修复后 clientWidth / innerWidth / scrollWidth 均为 375，并实际点击用户与功能发布标签；[GREEN 记录](evidence/r5-independent/green/admin-compact.json) 含 elementFromPoint 与命中坐标。允许标签栏自身横向滚动，不要求其内部每个标签同时位于视口；E 同时加强为按 documentElement.clientWidth 断言，而非被撑大的 innerWidth。

旧失败 CI `42186871114` 的离线复习超时仍为 **未定位的间歇风险**。`9387340…` 的后续 CI `42320602975` application 已通过，新独立本地离线复习也通过；这些不构成历史失败根因已关闭的证据。RC4 的最终精确 SHA 将再次执行现有 CI，不使用无依据重跑获得全绿。

## 固定输入、祖先与部署

2026-11-07 恢复时再次读取 GitHub，三个 PR 均仍为 Draft：

| 引用 | 精确 SHA / 含义 |
| --- | --- |
| PR #128 | `5f83167d9b6a8433565775b372631c8764eb052e`，本集成分支的唯一产品起点 |
| PR #129 | `4e2fc0cf553e9490e2282a2ad169c2a8622b0ee3`，Flash 最终报告 HEAD |
| 共同祖先 | `c8ff0aa55b36e96561dd083bbaf032e4a24b6cd0` |
| R5 首个产品提交 | `8e63969`，账户/会员布局、财务折叠与工作流预选 |
| R5 后续产品提交 | `9f02ad85f7d244cebe7787e5d1983586169514ac`，SWR/策略视觉状态调整 |
| R5 证据提交 | `607f3b8bb091917f8bb931fa383ca593259b3c4f`；原报告称其为“最新代码提交” |
| R5 Preview 部署 | `852fc79d-50c5-4382-bdeb-295128ef7ae4`，部署元数据指向 `9f02ad85…` |
| 新独立候选 | [Draft PR #130](https://github.com/WYJ0904/thewyj.uk/pull/130)，`codex/p07-r5-independent-integration` |
| 定向产品修复 | `1c20797f8ff41c53b786c8dc8efb5fc5ad3cb0af`；后续为 QA、诊断及本报告封装 |
| 首次报告封装前 QA | `de25585efb86fae4a7198de94650306d7593a689` |

R5 **不是**最终 R4-C HEAD 的后代。逐文件核对证明，R5 改动的五个产品文件在共同祖先与最终 R4-C 中的 blob 完全相同。因此以 R4-C 建独立工作树，只导入五个经过审阅的产品增量，未重复应用 R4-B/P07-E，也未合并 PR #129 的整段历史。见 [导入清单](evidence/r5-independent/import-manifest.json)。

原 R5 浏览器脚本含共享 QA 凭据字面量，同时用手动 `document.hidden`、`bootState` 及固定延时验证部分行为。本候选不导入该脚本或含凭据的提交历史。新增测试复用既有 Chrome CDP/隔离 Pages/D1 机制，使用随机本地账户与合法管理员夹具；不记录会话令牌。

本报告不嵌入自身提交的 SHA。最终封装 HEAD、最终同 SHA 的结果与 Core CI 链接记录在 PR #130 的验收评论；本地最终运行的 `r4a-driver-provenance.json` 同时固定 `product_sha`、`qa_source_sha`、冻结浏览器和附加脚本哈希。旧证据中的 SHA 保留原值，不改写成最终 HEAD。

## 审查结果与修复

| 问题 | 原因和实际 RED | 候选处理及通过标准 |
| --- | --- | --- |
| 账户切换继承 A 的 V3 视觉权限 | R5 在 boot ready 后把任何 pending 继续当 ON。B 的真实账户策略为 OFF，等待 B health 时 A 资料仍可见，功能策略已是 false | 恢复 R4-C `decision()` 权威语义。未知身份/pending 主画布不可见；B 的真实 health 和策略裁决后仅显示 B |
| 注销、公有 Kill、TTL 失效 | 注销等待公开 OFF 时继承账户 ON；后台 1 秒 TTL 夹具到期仍 ON；公有有效缓存阻止前台重新验证真实 Kill | 保留同一身份、未到期快照的合法续租；不延长 TTL，不跨身份保留；前台读取公开权威策略，OFF/Kill 立即生效 |
| 启动后的错误无恢复入口 | R5 用 boot ready 永久隐藏策略状态面板 | 错误明确显示、V3 fail closed、重试实际获取权威响应后恢复；断网/503 是隔离替身，不是 AI 验收 |
| 晚到的 A 响应污染 B | 通用 GET 重试使用实时会话，401/403/成功副作用未验证请求所有者；health 刷新也未固定身份 | 请求捕获 session owner；身份变更后返回 `AbortError/account_changed`，不回放给 B、不清除 B、不打开 B 的会员页；合并中的旧 health 完成后调度 B 自身刷新 |
| BFCache 撤销窗口 | 真实 Chrome `pagehide.persisted=true`、`pageshow.persisted=true`、同一文档实例，撤销后第一 RAF 帧仍显示私有账户 | 离开时冻结为未验证状态；清除功能策略的旧身份权威；恢复后先验证健康状态和新策略。错误有有限恢复入口，保留本机数据。有效账户恢复原路由，撤销账户转登录 |
| 同源缓存混用 | R5 修改静态文件但沿用 `20261106-aeris-p07-r4c-rc2`，实际暖升级报 `mixed release bytes: styles.css` | 通过既有发布脚本生成 `20261107-aeris-p07-r5-independent-rc4`；保留 R4-C SW 生命周期和 release 查询合同，逐响应比对实际 JS/CSS 字节与离线恢复 |
| 工作流长列表模板无法命中 | 侧栏 sticky 且无高度/滚动约束，多个实际保存的工作流把模板推到视口外；`scrollIntoView` 后仍无法点击 | 桌面侧栏约束为视口可用高度并可独立滚动；单列宽度改为正常文档流。保留列布局、模板、执行及业务逻辑；375–1920px 必须实际命中模板与运行按钮 |

保留 R5 已完成的账户双摘要、8 条详情、会员 7 个原有业务目标/价格/流程、财务 6 月展示和账户独立折叠偏好。没有重新设计首页、学习页、财务或会员页面。

根因修改集中在 `app.js`、`js/core/api.js` 和工作流侧栏的 CSS。`js/core/public-ui-policy.js` 与策略 pending CSS 恢复最终 R4-C 合同。其他大量 JS/index/SW 行改动只更新同一资源版本，未修改业务模块实现。后端 `functions/`、D1 migration 和 Android 产品代码无增量，见 [范围清单](evidence/r5-independent/scope-manifest.json)。

## RED → GREEN 证据与测试边界

| 测试 | 原始证据 | 已执行结果 / 最终要求 |
| --- | --- | --- |
| R5 账户/TTL/Kill/重试 | [5/5 RED](evidence/r5-independent/red/policy-results.json) | 相同期望在修复后 `r5-policy-green-v2` 为 5/5 PASS |
| 真实 BFCache 撤销首帧 | [同实例、pageshow 与 RAF RED](evidence/r5-independent/red/bfcache-frames.json) | `r5-browser-rc3` 同一合同 PASS，且有效账户断网恢复也 PASS |
| 晚到会话响应 | 新增 3 条 Node 用例，原版全部 RED | 修复后与已有策略/启动/SW 合同合计 52/52；已纳入 Core CI |
| 真实浏览器 R5 行为 | [RC3 11/11 PASS](evidence/r5-independent/green/browser-rc3.json) | 包含后台真实 reload、Splash 后滚动、慢 access 前工作流帧、直接路由首帧、财务、28 个宽度/路由组合、模态焦点和权限 |
| 财务账目 | 随机本地账户通过真实表单写隔离 D1，再真正普通/强制刷新、跨路由、UI 注销并重新登录 | 收入 1,000,000，支出 10,001,000，余额 -9,001,000；B 为空且默认展开，A 恢复折叠。测量可见账目 section 的文档坐标，避免拿隐藏列表/滚动锚点当几何 PASS |
| 冻结门禁 | `r5-frozen-v1` 固定 `89ad35fd6a8b6282fb99fc1f8881aabe7c96f2a4` | 浏览器 25/25、主工作区 3/3、R4-A 运行 7/7、P4 工作区 PASS；最终 HEAD 仍须执行同一冻结门禁 |
| 同源暖升级 | [原始 CSS 混用失败](evidence/r5-independent/red/warm-upgrade.json) | 初次修复暖升级 PASS；最终 RC3 再比较实际字节、普通刷新、离线及用户状态保留 |
| PWA/旧客户端 | `r5-aux-rc3/p5-pwa.json` | PASS：离线 guest、重连、旧客户端缓存与用户缓存字节保留；最终运行复核 |
| E 文件/工作流/后台/候选 | 上轮在新工作流 surface 可见、lazy 模板尚未创建时点击 null | 保留原失败；等待真实可见模板后保留原执行、几何、权限和主题断言，不增加固定等待、不跳过页面 |
| Core CI | [42186871114](https://github.com/WYJ0904/thewyj.uk/actions/runs/42186871114)，精确 `5eac9d88…` | 7 success / 1 failure / 2 skipped。Cloud-only PASS，application 离线复习提交超时；增加状态诊断和独立离线复习测试，不宣称已定位该历史超时 |

新增离线复习测试只验证已保存释义的本地规则。所有 AI binding 仍 OFF，不把本地判定写成真实 AI 质量 PASS。实际三星/Android 物理设备、收费模型、真实支付均 NOT_TESTED；冻结运行中的 Android Web Back 只是浏览器桥合同。

历史测试修正有完整保留：最早测试拦截器追加而非替换、读到旧文档 ready、online 后误读中间 pending、未选模板即查运行按钮、自动同步忙时点击、移动账目 disclosure 未展开、UI 注销后复用已撤销夹具 token、一次新增脚本语法错误。这些是测试自身修正，原日志不覆盖；产品 PASS 只采用修正后的语义就绪断言。被中断的 `r5-aux-rc3` 后半段和 `r5-raw-library-hit-red` 标记 INCOMPLETE，不用目录存在冒充完成。

真实截图：[账户 375](evidence/r5-independent/green/layout-accountModal-375.png)、[账户 1440](evidence/r5-independent/green/layout-accountModal-1440.png)、[会员 375](evidence/r5-independent/green/layout-membershipModal-375.png)、[会员 1440](evidence/r5-independent/green/layout-membershipModal-1440.png)、[工作流](evidence/r5-independent/green/layout-toolsPanel-1440.png)、[财务真实测试账目](evidence/r5-independent/green/finance-real-ledger.png)、[原长侧栏失败](evidence/r5-independent/red/workflow-long-library.png)。均为运行中的 Chrome 页面，不是生成图。

## P07-F：8 条全部保留

已有工具固定基线 `bf07d4007599f67f3ac23038115ec7e7f299c9a9`。统一候选上执行后仍有 8 条发现、3 条 serious/critical，见 [复核原始报告](evidence/r5-independent/f-review-before-attribution.json)。**没有一条可因 R5 布局变化自动关闭**。

| axe 规则 | 影响 | 结果 |
| --- | --- | --- |
| aria-allowed-role | minor，10 个工作区，`#versionNotice` | REVIEW_REQUIRED |
| landmark-unique | moderate，首页/财务 | REVIEW_REQUIRED |
| page-has-heading-one | moderate，登录/会员/账户/工作流 | REVIEW_REQUIRED |
| aria-prohibited-attr | **serious**，学习 `#statusDot` | REVIEW_REQUIRED |
| heading-order | moderate，学习/后台 | REVIEW_REQUIRED |
| landmark-complementary-is-top-level | moderate，财务两个 aside | REVIEW_REQUIRED |
| color-contrast | **serious**，账户 `#accountSyncBadge` | REVIEW_REQUIRED |
| label | **critical**，工作流 `#workflowImportInput` | REVIEW_REQUIRED |

F 的总体 `P07_F_PREFLIGHT_READY` 只表示工具产物生成；本候选保留独立 `unifiedAcceptance=REVIEW_REQUIRED` 和非零退出。旧报告一次 LCP 为 `STRONG` 且没有祖先归属，不能确定是工作台。现在只补充 LCP 元素祖先、工作区和 Splash 归属取证，不调整阈值。Splash LCP、一次 lab 读数及无用户交互的样本都不能代表主工作台/field INP 性能通过。

补充归属后的 [精确 9387340 记录](evidence/r5-independent/f-review-with-lcp-attribution.json)：本次 LCP 908ms 来自 publicHome 内的 STRONG，`inSplash=false`；这是公开首页的单次本地 lab 样本，不代表登录后工作台、field INP 或全站性能门禁通过。8 条 axe / 3 条 serious-critical 仍未关闭。

## Preview、Logo 与交接

只读 HTTP 核验时，原 [R5 Preview](https://852fc79d.thewyj-p07-ui-rc.pages.dev) 的公开策略为 enabled / revision 17 / public_stable，app.js 字节与原 R5 一致，仍引用 R4-C RC2 的资源键。[核验记录](evidence/r5-independent/hosted-readonly.json) 明确 `isIntegrationPreview=false`。这不是 SW 故障结论，也不是本集成 HEAD 的 Hosted PASS。

未对该 Preview 执行账户写入/数据库操作；未替 Flash 重做环境配置或部署。须由 Flash 部署 PR #130 最终精确 HEAD，返回部署 ID、commit hash、公开 Flag 与测试账户级策略证明后，再跑同 SHA 只读联合验收。原 Preview 的配置证明属于其原部署，不能自动外推到新部署。

[Logo 保留清单](evidence/r5-independent/brand-preservation.json)：41 个既有品牌及 Android 资源 blob 全部与 R4-C 一致；index 的差异归一化 release 后为零。未生成、重绘、替换 Logo，Header、登录/PWA/favicon/Android 既有品牌资源均保留。

Flash 交接见 [P07_R5_FLASH_HANDOFF.md](P07_R5_FLASH_HANDOFF.md)。本分支保留 R4-C G01/G02、History workspace、单主工作区、Kill/灰度/fail-closed 和 SW 合同，不给前端硬编码 ON。PR #128/#129/#130 保持 Draft；不合并 main、不发布 Production、不改正式 D1/R2、不清理真实数据、不启用财务 AI/OCR。

## 最终复核命令

提交干净输入后执行；每次标签必须唯一，禁止覆盖历史证据：

```powershell
$env:P07_QA_ROUND='p07-r5'
$env:P07_R5_FINAL='1'
$env:AERIS_PHASE1_BASE_URL='http://127.0.0.1:18964'
$env:AERIS_PHASE1_CDP_URL='http://127.0.0.1:19364'
node qa/p07-r4a/run-gates.mjs r5-rc4-runtime --compiled-runtime --round3 --primary-workspaces --p4-workspace
```

同一最终 HEAD 分别运行未设置 `P07_R5_FINAL` 的 `--flag-off`、`--kill-switch`，以及 `--cache-upgrade --warm-r4c`。完整本地证据保留于 `docs/migration-evidence/p07-r5/<label>/`，含截图、实际 DOM/命中、响应字节、源清单及固定 QA 哈希。最终 SHA 和结果以 provenance 与 PR 最终验收评论为准，部署与人工验收继续独立列示。

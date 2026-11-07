# P07-F 八项无障碍定向收尾

专项预检结论：**P07_F_A11Y_PASS**。最终封装的同 SHA 冻结/CI 结果见新 Draft PR 的最终验收评论和本地 provenance；不把本专项外推为 P07 COMPLETE 或 Hosted/人工验收通过。

## 固定基线与范围

- 产品基线：PR #130，`72940bede5cff2aacd3bc3c66af5b16be40b243e`。
- 独立分支：`codex/p07-f-a11y-closeout`；新 Draft PR 目标为 `codex/p07-r5-independent-integration`。
- 本次产品实现提交：`1f6f37c9b01621a9e33c504b7f9dd9660cedae2f`；后续仅补充 QA 取证、报告与证据封装。
- 原 P07-F 工具基线：`bf07d4007599f67f3ac23038115ec7e7f299c9a9`。复用现有工具与 vendor axe，不修改原规则、阈值、扫描范围或退出门禁。
- 原冻结 QA：`882efdb9978f2608c54bc6c9c19eb8843e80945f`；原浏览器 SHA-256 仍为 `227c4f69d473186fdbe307fa3a6da4a9a6d5a0c41d485ff51d19beed608fa61d`。
- 资源版本：`20261107-aeris-p07-f-a11y-rc4`，由既有 `scripts/update_asset_release.mjs` 生成。SW 文件只有相关资源版本串更新，缓存策略、会话、API、路由及 Flag 逻辑未变。

任务开始时已核对 PR #128/#129/#130 仍分别为 `5f83167…`、`4e2fc0c…`、`72940be…`，均为 Draft。没有移动这三条分支，没有介入 Flash 正在进行的隔离部署。

## 原八项逐项对照

以下“节点”采用原固定工具的统计口径：按工作区累加节点发生次数。`#versionNotice` 在十个工作区出现十次，不误称为十个不同 DOM 文件。

| 原规则 / 严重程度 | 修复前 → 后 | 节点与必要修改 |
| --- | --- | --- |
| aria-prohibited-attr / serious | 1 → 0 | `#statusDot` 增加合法 status 角色，用 `aria-describedby=modelLabel` 关联既有实时服务文字；不改变服务状态逻辑 |
| color-contrast / serious | 1 → 0 | `#accountSyncBadge` 使用既有 `--ds-success` / `--ds-success-soft`；文字、状态、尺寸不变 |
| label / critical | 1 → 0 | `#workflowImportInput` 用 `aria-labelledby=importWorkflowBtn` 关联可见导入按钮。保留输入、Tab 停靠和导入功能，为剪裁输入的焦点提供可见行轮廓 |
| aria-allowed-role / minor | 11 → 0 | `#versionNotice` 从 aside 改为 div，保留 status/live。原登录 form 的非法 tabpanel 也修正为合法 div 面板包裹原生 form；注册面板使用相同合同 |
| landmark-unique / moderate | 2 → 0 | 首页外层工作区保留名称，移除英雄介绍子 section 的重复命名；财务说明容器不再伪装成重复 complementary landmark |
| page-has-heading-one / moderate | 4 → 0 | 登录/注册共享标题、会员、账户、工作流使用真正可见 H1，保留原视觉字号、行高、字重及间距 |
| heading-order / moderate | 2 → 0 | 既有英语/日语项目文字成为 H2，学习子标题层级自然衔接；后台用户/审批卡片标题成为 H2。H1 提升后的会员、账户、工作流子标题同步采用合理 H2/H3 |
| landmark-complementary-is-top-level / moderate | 2 → 0 | 财务同步说明和预算列改为普通 div，保留类名、布局、实时更新和全部内容，外层原有章节语义不变 |

原固定报告中合计 24 次节点发生已降为 0。依据：[原始 72940be 报告](evidence/f-a11y/BASELINE-72940be.json)、[规则数量对照](evidence/f-a11y/RULE-COMPARISON.json)、[修复后固定工具](evidence/f-a11y/GREEN-fixed-tool.json)。没有修改 `verify-p07-f-preflight.mjs`、axe vendor 或原 `runOnly` 标签列表。

HTML/ARIA 的角色选择依据 [W3C ARIA in HTML](https://www.w3.org/TR/html-aria/)；文字对比度按 [WCAG 2.2 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) 的普通文字 4.5:1 要求测量，没有降低标准。

## 扩展发现及视觉保护

扩大到暗色、注册页、英语页和导入后的工作流后，发现并处理了同类问题：

- 暗色会员 `.membership-warning` 与 `.danger-note` 的固定亮色前景在暗底上只有 1.57:1。使用现成警告 token，保留内容、边框和排版；两节点分别达到亮色 5.18:1、暗色 7.19:1。
- 账户同步徽章由亮色 2.27:1 改为亮色 4.92:1、暗色 6.94:1；五种宽度实际计算值一致。
- Preview 通知也使用 aside/status 组合，按相同语义改为 div/status，并增加本地显示该既有通知的完整 axe 测试。该可见性夹具不代表 Hosted 部署验收，也不修改环境配置。
- 标题提升时实际测出了工作流和后台行高变化，已恢复原行框。没有用放宽尺寸阈值解决。随机测试用户名造成的固有文字宽度差异改用固定夹具文本消除，凭据仍每次随机生成。

实测保留的文字样式比较包含字号、字重、行高、字距、上下间距、宽高；120 个页面/宽度/主题组合均与固定基线一致。账户、会员、财务和工作流未重新设计。

主要产品改动文件：

| 文件 | 必要原因 |
| --- | --- |
| `index.html` | 合法角色、关联标签、原生表单面板、可见标题层级、财务容器语义 |
| `app.js` | 只同步登录面板显示状态、学习 H2 的空状态及后台卡片标题；没有修改业务鉴权、导航或启动策略 |
| `spatial-experience.css` | 既有成功/警告色 token、标题原样式及输入焦点可见性 |
| `styles.css` / `product-ui.css` / `workspace-experience.css` | 既有标题样式兼容 H1/H2 语义提升，支持基础回退界面 |
| 既有发布资源引用 | 单一独立版本；防止旧 CSS 与新 HTML 混用。非新增产品实现 |

[保护清单](evidence/f-a11y/PROTECTION.json) 验证 41 个品牌/Android 资源 Git blob 不变，三个 `data-home-widget` 悬浮卡片子树相同。会话、API、Feature Flag、路由及 SW 的差异经版本串归一化后为零。没有替换 Logo、改动价格/支付/账目或启用 AI/OCR。

## 真实浏览器验证

使用现有 loopback compiled Pages + Miniflare + 本地 D1/R2 + 独立 Windows Chrome CDP。无正式账户、正式数据或收费模型调用。原始 RED、新增中间失败、修正原因均保留，不覆盖证据标签。

| 验证 | 预检实际结果 |
| --- | --- |
| 原固定 P07-F 十工作区 | 0 条发现、0 serious/critical |
| 扩展整页 axe | `axe.run(document)`，全部默认规则，无 excludes；12 个页面 × 2 主题 × 2 扫描宽度，另加 Preview 通知和导入执行后状态，共 51 次扫描，0 violation |
| 布局与样式 | 375、390、768、1024、1440 × 亮/暗色 × 12 页，共 120 样本；无横向页面溢出，原标题样式一致 |
| reduced-motion | 矩阵用真实媒体偏好 reduce；另以 no-preference 验证正常动效下键盘导入和焦点 |
| 登录/注册 | 原生 form，合法 tabpanel 与 controls/labelledby 实际关联；切换后对应面板真实可见 |
| 学习状态 | status 角色与既有 polite 文字关联；真实离线后文字为离线模式、指示在线类清除，恢复后重新在线 |
| 账户反馈 | 既有状态文字及同步说明保留，实际亮暗对比度通过 |
| 工作流导入 | Tab 到原输入，焦点轮廓可见；Chrome AX 中名称为导入 JSON；Space 打开真实文件选择器并导入本地 JSON，实际执行得到 alpha/beta |
| 模态焦点 | 375px 下八次真实 Tab 均留在对话框且焦点可见；Escape 后恢复原账户按钮，未提交删除 |
| 回归 | Core、会员/管理员、动效和工作流单元组已通过；最终同 SHA 另执行既有 R5 冻结/扩展/策略/历史/离线/暖升级及 Core CI |

浏览器 AX 树与键盘功能已验证；没有把自动 AX 检查写成 NVDA/JAWS 实际朗读验收。axe 的 incomplete 数据保留在扩展原始结果中；本专项不是全站 WCAG 认证。

补充的 incomplete 复核：七个已观察到的命名容器补充合法 group 语义（其中原 CTA footer 改为同样式 div），不改变三个悬浮卡片子树。账户菜单目标 DOM 和 menu 角色确实存在；[axe 4.9 原实现](https://raw.githubusercontent.com/dequelabs/axe-core/v4.9.1/lib/checks/aria/aria-valid-attr-value-evaluate.js) 对带 aria-haspopup 的 aria-controls 有意统一返回需复核，展开也不会自动消失。因此保留原 incomplete，用真实可见 DOM 与 Chrome AX 关系复核，未删除属性或禁用规则。[原测试失败](evidence/f-a11y/INTERMEDIATE-MENU-REVIEW.json) 保留。渐变/背景图导致的对比度不确定项也完整保留，属于基线既有人工复核边界，不冒充已经自动检查通过。

取证：[原七组预检](evidence/f-a11y/GREEN-extended-cases.json)、[完整 RED 扫描](evidence/f-a11y/BASELINE-full-axe.json)、[中间失败与修正依据](evidence/f-a11y/INTERMEDIATE-FAILURES-v1.json)。中间登录用例曾错误复用管理员会话访问登录页，已通过清理本地夹具会话后导航修正；文件选择器使用平台原生 Space 激活，保留原失败，没有删除导入断言。

截图：[账户亮色 375](evidence/f-a11y/F-Account-375-light.png)、[账户暗色](evidence/f-a11y/F-Account-1440-dark.png)、[暗色会员](evidence/f-a11y/F-Membership-375-dark.png)、[登录](evidence/f-a11y/F-Login-375-light.png)、[工作流](evidence/f-a11y/F-Workflows-1440-light.png)、[输入焦点](evidence/f-a11y/workflow-file-input-keyboard-focus.png)、[真实导入执行](evidence/f-a11y/workflow-import-executed.png)。均为运行中的浏览器页面，不是生成图。

## 性能有效性边界

复用固定 probe，并追加独立 LCP 元素祖先观察，不改变 Splash 或页面架构。参照 [web.dev LCP 生命周期](https://web.dev/articles/lcp)，保留首次可信 Tab 交互前的标准候选；不把任意自定义 ready 时间命名为 LCP。

每种环境三次，共 12 样本：公开首页、登录后的首页外壳、账户、财务。环境为本地 compiled Pages/Miniflare，Windows 桌面 Chrome，1440×960 CSS px、DPR 1、CPU 节流 1、无网络节流、浏览器缓存关闭、仅此 Lab 绕过 SW。数据包括真实 URL、UA、视口、元素/祖先、观测窗口及截图。

预检数据说明：

- 公开首页约 1008–1024ms，元素属于公开 hero。
- 登录后首页约 1124–1160ms，但仍是同一公开 hero 文本；**不能当作个性化主工作台性能**。
- 账户三次中一次 948ms 归属账户 DD，另两次归属 Splash，明确记为该工作区 LCP 无效，未删除或重跑取好值。
- 财务空账本约 1068–1080ms，额外观察器明确记录 `financePage` 和空状态文字。旧通用 probe 没把 finance 纳入 closest 选择器，原字段保留；最终版本通过同一时间戳的原生 LCP entry 关联，不捏造数值。

完整原始预检见 [Lab 原件](evidence/f-a11y/LAB-preflight-raw.json)。最终封装仍按相同条件各取三次，所有有效/无效样本均记录。财务为空账本；本地 Lab 不能外推到 Production、真实手机、重数据工作台或 Field 性能。

**Field INP = NOT_TESTED**：没有真实用户样本。probe 内脚本交互数字或零值不作为 Field INP。性能结论为 LAB_VALIDITY_RECORDED，不是全站性能 PASS。

## 最终验收与部署交接

本报告不嵌入自身提交 SHA。新 Draft PR 的最终评论及 `docs/migration-evidence/p07-f-closeout/f-a11y-final/` provenance 固定最终产品、QA、axe vendor 与冻结脚本哈希；最终 Core CI 和各组结果在同一 SHA 上核对后封存，避免为补结果再次移动被测 HEAD。

命令复用既有框架：

```powershell
$env:P07_QA_ROUND='p07-f-closeout'
$env:P07_R5_FINAL='1'
$env:P07_F_FINAL='1'
$env:AERIS_PHASE1_BASE_URL='http://127.0.0.1:18974'
$env:AERIS_PHASE1_CDP_URL='http://127.0.0.1:19404'
node qa/p07-r4a/run-gates.mjs f-a11y-final --compiled-runtime --round3 --primary-workspaces --p4-workspace
```

另对最终 HEAD 单独执行 OFF、Kill 和 `--cache-upgrade --warm-r5`（从固定 72940be 暖升级）。

Flash 交接见 [P07_F_A11Y_FLASH_HANDOFF.md](P07_F_A11Y_FLASH_HANDOFF.md)。不修改 PR #128/#129/#130，不合并 main、不发布 Production、不碰正式 D1/R2 或正式权限。本专项没有改动或关闭历史离线复习超时；最终集成 SHA 的 Hosted、性能边界和历史风险继续独立评估。

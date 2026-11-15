# Task27 人工验收修复 A：广播关闭与页面闪动

状态：**本地验证通过，待 Hydrogen 集成与统一部署**。

## 版本与交付

- 修复分支：`codex/task27-web-notification-fixes`
- **修复提交：`f3b199f872864d25ac921f659fa1b724e13d2e7f`**
- 开始时 fetch 核实的集成基线：`54fbf76194f4eeba98ef39e7fb5ff380198abf75`。
- 工作树：`aeris-task27-web-notification-fixes`。工具不接受请求中的下划线名称，使用等价的连字符标识。
- 开发期间 Hydrogen 并行集成已前进到 `8d562950e1bcf5ff1a99b1931753e516aaf20a0a`；本修复没有覆盖或合并其邮箱/MFA核心变化，采用精确 cherry-pick 交付。
- 本轮不新建会触发仓库 Android/APK 通用 PR 工作流的 PR；未修改工作流规则，也不宣称 GitHub CI 通过。

## BUG-01 根因与修复

`mfaAdviceBroadcast` 使用已部署的固定 ID `task27-mfa-advice-v1`；Task18 的
`cleanMessageId` 原先只接受 UUID，因此普通关闭 POST `/api/messages/receipt`
返回 `400 message_id_invalid`，前端 catch 后保留弹窗和背景 inert，导致主页面被挡住。

此外，MFA 建议是在 Task18 普通广播的 first-seen 回执批处理之后追加，首次返回时没有
写入对应的 first-seen 回执。生成函数却已经写入 `task27_security.mfa_broadcast_at`，
所以刷新后广播被 30 天展示节流抑制；**这不能证明关闭状态已保存**。基线截图和数据库
夹具记录均复现了“主页面被锁、关闭回执不存在、刷新后消失”。

修复内容：

- ID 校验保留 UUID 规则，仅兼容这一个已部署的保留 ID；现有账户、受众、消息状态与到期检查仍生效。
- MFA 建议与普通广播共用 first-seen 回执流程。关闭现在真实写入 `dismissed_at`，不写 `acknowledged_at`。
- 普通关闭立即在当前页面收起弹窗；保存进度/失败显示为不阻挡操作的状态提示，失败提供手动“重试保存关闭状态”。不会自动无限重试。
- 保存失败后，未保存的普通广播在刷新时仍会出现；成功重试后，刷新及重新登录不会再次出现。
- 需要确认的广播显示“稍后确认”；暂时收起和保存重试不代表确认，刷新仍提示，只有明确的确认操作写确认回执。
- 个人收件箱消息拒绝普通广播的 `dismiss` 操作；普通已读/全部已读不写政策确认。
- 广播请求、保存回调及确认回调按当前账户/会话检查；账户切换清空旧队列与失败提示。已有弹窗优先，后台广播等待其关闭，避免抢占证明/确认流程。

保留现有约 30 天 MFA 建议展示节流，没有清理真实用户时间戳或虚构历史关闭回执。
过去已被展示节流的账户不会因为本修复立刻重新弹出；应使用隔离测试用户验证，不能以“不再弹”代替回执校验。

## BUG-06 已确认的根因与前后对比

Chromium 实际测得，`body.modal-open { overflow:hidden }` 移除纵向滚动条后，
页面、工作区和固定导航宽度从 1351 变成 1366 像素；关闭时又恢复。每次弹窗开关
都引发整页重排和横向跳变，表现为闪动。

在滚动锁定规则附近给根滚动容器设置 `scrollbar-gutter: stable`，保留滚动条占位。
没有禁用动画、修改全局动效开关或掩盖业务渲染。正常按钮按压、弹窗 backdrop/panel 动画及减少动态效果语义保留。

| 场景 | 修复前背景宽度变化 | 修复后背景宽度变化 | 修复后主界面最小 opacity |
| --- | ---: | ---: | ---: |
| 账户安全打开/关闭 | 15px | 0px | 1 |
| 个人收件箱打开/关闭 | 15px | 0px | 1 |
| 账户菜单、普通按钮 | 0px | 0px | 1 |
| 390px 窄屏收件箱 | 旧铃铛被移动端搜索按钮样式隐藏 | 0px，账户菜单入口可用 | 1 |
| 深色主题收件箱打开/关闭 | 未作为基线采样 | 0px | 1 |

共记录 12 个交互场景，每帧检查页面、工作区和导航几何及 opacity。已测普通按钮没有
重启全局淡入，弹窗打开仅有正常 backdrop/panel 动画；刷新后受控 SW 已激活，页面导航记录为 1，
未观察到每次点击引起文档重载。没有确认“所有按钮都有另一个全局渲染缺陷”。

窄屏中铃铛继承旧 `.home-search` 隐藏样式，故增加账户菜单中的“个人通知收件箱”入口，
复用现有 `openInbox()`，没有复制收件箱或修改邮箱/MFA模块。

## 实际修改文件

| 文件 | 范围 |
| --- | --- |
| `functions/_lib/task18-model.mjs` | 仅保留 ID 兼容校验 |
| `functions/_lib/task18-service.mjs` | first-seen 合同、个人消息不能走广播关闭 |
| `app.js` | 广播队列、账户归属、非阻塞保存/手动重试、确认回调、收件箱菜单入口 |
| `index.html` | 非阻塞保存提示与账户菜单入口 |
| `design-system.css` | 滚动条占位、保存提示样式 |
| `sw.js` | 静态资源字节摘要和 publication hash，保留 81 核心身份及 89 必需资源 |
| `local-backend/test_task27_web_notification_js.mjs` | 8 组新增 API 合同回归 |
| `qa/task27/web-notification-browser.mjs` | Chromium 交互、逐帧几何、故障重试、刷新/重新登录及确认回归 |
| `package.json` | `test:task27:web-notifications` 运行入口，无依赖变更 |

受保护路径与基线逐字节相同：`task27-auth.mjs`、`task27-security.mjs`、`email-service.mjs`、
`email-api.mjs`、`js/account/security-center.js`、`android/` 及 `cloudflare/migrations/`。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 新广播/个人通知 API 合同 | 8 组 PASS：固定 ID、first-seen、幂等关闭、重新登录、受众隔离、普通 UUID、政策确认、必确认广播 |
| Chromium 157 本地真实 UI | PASS：12 个交互场景；保存失败立即释放主页面、刷新重现、手动重试、重新登录、必确认广播延后/重试/最终明确确认 |
| Task18 原回归 | 8 组 PASS |
| Task27 原回归 | 31 组 PASS |
| Functions 构建 | PASS |
| SW 安装/完整性 | 20 项 PASS |
| 动效既有回归 | PASS：取消、重复安装、按压、键盘、减少动态效果、大型披露等 |
| 模块图 / 存储 / cloud-only / 功能矩阵 / JS 语法 | PASS |
| Pages allowlist 字节构建 | PASS，191 文件；只生成本地 staging，没有部署 |
| 仓库敏感资料审计 | PASS；提交前再次检查报告与脱敏证据 |

既有真实 Preview 仅用新的匿名 Chromium 配置只读观察主页、登录页、注册页；没有登录真实账户，
未写真实回执。认证广播、故障注入和重新登录验证在本地隔离夹具完成。
数据库操作全部限于测试进程新建的临时夹具，没有对任何已有数据库执行迁移，也未调用迁移 CLI。
未运行 Gradle、APK 打包或真机操作。未修改邮件配置、共享 Preview 或 Production，也未关闭/合并 #153/#154/#155。

证据：[前后指标与合同记录](task27/web-notification-fixes/evidence/before-after.json)、
[原关闭错误截图](task27/web-notification-fixes/evidence/before-invalid-id.png)、
[失败后可继续操作](task27/web-notification-fixes/evidence/after-save-failure.png)、
[窄屏收件箱](task27/web-notification-fixes/evidence/after-narrow-inbox.png)、
[深色收件箱](task27/web-notification-fixes/evidence/after-dark-inbox.png)。
原始逐帧 JSON、失败日志及截图保留在忽略的 `.wrangler/task27-web-notifications/`，摘要收据另存于证据目录。
早期测试探针初始化和移动端定位错误均保留；基线的有效桌面测量与中止原因分别记录，没有伪装为整套基线通过。

## Hydrogen 集成说明

在 Hydrogen 自己的受控集成工作树中，从其最新集成分支执行：

```sh
git cherry-pick f3b199f872864d25ac921f659fa1b724e13d2e7f
```

该提交包含产品修复、回归测试和修改边界文档；本报告/证据是随后的独立文档提交，可按需一并 cherry-pick。

已经观察到的 `8d562950` 并行修改没有改动本修复的 Task18、`app.js`、`index.html` 或
`design-system.css`，但双方均改了 `sw.js`。该文件应保留目标分支全部壳层、验证逻辑与资源键，
然后对合并后的真实资源运行 `node scripts/update_task27_publication.mjs` 重新生成摘要。
不能用本分支旧的邮箱/MFA模块摘要覆盖 Hydrogen 的新内容，也不能整文件覆盖其并行修复。

集成后至少运行：

```sh
npm run test:task27:web-notifications
npm run test:task18
npm run test:task27
npm run cf:check
node --test qa/p07-release/sw-install.test.mjs
```

由 Hydrogen 统一部署共享 Preview 后，再请所有者复测原广播关闭及实际浏览器操作。
本轮没有宣称目标分支 `8d562950` 合并后的组合已经验收，也没有宣称共享 Preview 已修复部署。

# Aeris V6.3 Phase 1｜全站功能与导航入口保留矩阵

> **零删除原则**：本矩阵核对 `js/core/router.js` 全部 27 条合法路由、`js/tools/catalog.js` 全部 104 项工具、`workflows.js` 12 项能力、账户/安全/备份/隐私/会员/通知/管理后台入口，确保 Phase 1 全局框架、导航与首页重构后 **100% 功能保留且清晰可达**。

## 1. 侧边栏分类导航（#v3Sidebar，Guest 与 Auth 通用，可展开/折叠，移动端为抽屉）

| 业务分组 | 导航项 | 路由 / 触发器 | 访客可达性 | 登录用户可达性 | 权限 / 锁标识处理（9.6） |
|---|---|---|---|---|---|
| **个人空间** | 首页 | `/` (`data-v3-nav="home"`) | 直接打开访客极简首页 | 直接打开个人极简启动台 | 公开/全员可用 |
| 个人空间 | 语言学习 | `/language` (`data-v3-nav="language"`) | 引导至 `/trial`（免登录最多 10 题） | 进入语言选择与学习工作区 | 全员可用（会员权益按语言校验） |
| 个人空间 | 免费试用 | `/trial` (`data-v3-nav="trial"`) | 进入 5 项本地免登录试用 | 可直达本地试用页 | 公开可用 |
| 个人空间 | 财务账本 | `/finance` (`data-v3-nav="finance"`) | 点击提示登录并安全回跳 `/finance` | 进入财务账本（无权限时展示明确锁屏与开通入口） | 无 `finance_access` 时显示锁图标，不隐藏入口 |
| **效率工具** | 工具箱 | `/tools` (`data-v3-nav="tools"`) | 引导至 `/trial`（文本/JSON/图片试用） | 进入 104 工具目录（无权限时展示明确锁屏与开通入口） | 无 `tools_access` 时显示锁图标，不隐藏入口 |
| 效率工具 | 工作流 | `/tools/workflows` (`data-v3-nav="workflows"`) | 点击提示登录并回跳 `/tools/workflows` | 进入工具工作流列表与编辑器 | 保留原有权限校验 |
| **跨设备与资源** | 文件传输 | `/transfer` (`data-v3-nav="transfer"`) | 跳转登录/说明页（`/share/*` 分享链接保持独立直达） | 进入文件传输与我的分享 | 保留 `temporary_share_access` 校验 |
| 跨设备与资源 | 下载 Android | `/download` (`data-v3-nav="download"`) | 进入官方 APK 下载与 SHA-256 校验页 | 同左 | 公开可用 |
| 跨设备与资源 | 更新日志 | `/changelog` (`data-v3-nav="changelog"`) | 进入版本更新日志 | 同左 | 公开可用 |
| **管理**（仅管理员） | 管理后台 | `/admin` (`#v3SidebarAdminLink`) | **严格隐藏**（不向普通用户暴露） | 仅 `isAdmin(account)` 时显示并直达 | 严格服务端与前端双隔离 |

## 2. 侧边栏底部账户区与向上菜单（#accountMenu / #accountMenuPopover）

| 入口 | ID / 触发器 | 归属位置 | 说明 |
|---|---|---|---|
| 头像与账户触发器 | `#accountMenu` / `#accountBadge` | 侧边栏底部（展开显示头像+名称+等级；折叠仅显示头像+悬停 Tooltip） | 点击向上弹出菜单，键盘 `ArrowUp/Down/Esc` 可控 |
| 个人通知收件箱 | `#notificationInboxMenuBtn` | 底部账户菜单 + 移动端/页面通知铃铛 `#notificationBellBtn` | 显示未读计数，打开收件箱 |
| 账户中心 | `#accountBtn` (`/account`) | 底部账户菜单 | 进入账户设置（同时承载原首页隐藏的「学习数据同步与备份」`#learningSyncNowBtn` / 导出 / 导入） |
| 账户安全 | `#securityCenterMenuBtn` | 底部账户菜单 | 打开邮件、MFA、设备会话与修改密码中心 |
| 会员与订阅 | `#membershipBtn` (`/recharge`) | 底部账户菜单 | 打开套餐选择与充值核对流程 |
| 主题切换 | `#themeToggleBtn` / `#sidebarThemeBtn` | 底部账户菜单（Auth）+ 访客顶栏/侧边栏底 | 系统 / 浅色 / 深色三态循环 |
| 帮助与反馈 | `#feedbackBtn` | 底部账户菜单 | 打开反馈提交、我的反馈与功能投票 |
| 管理后台 | `#adminBtn` (`/admin`) | 底部账户菜单（仅管理员可见） | 进入管理后台 |
| 退出登录 | `#logoutBtn` | 底部账户菜单底部分隔 | 安全登出并清理账户隔离状态 |

## 3. 首页（#publicHome）保留与重构对照

- **登录态首页**：
  - 保留真实时间与真实用户昵称问候（`#dashboardGreeting`）及副标题（`#dashboardGreetingPrompt`）。
  - 保留并升级中央搜索入口（`#homeLauncherSearchBtn` → 唤出统一命令面板 `#commandPaletteModal`）。
  - 保留用户可自定义快捷入口（`#homeQuickShortcuts` + `#customizeShortcutsBtn`，配置按账户隔离保存在 `aerisHomeWidgets:v2:<accountId>`），以及存在未完成测验时的继续测验入口（`#dashboardResumeSection`）。
  - **清理冗余堆叠**：取消原首页中的 `#workspaceBentoGrid` 6 大卡片矩阵、`#homeV3SummaryGrid` 假进度条摘要带、营销 Hero 文案及 `#accountBar` 独立大顶栏；将原首页折叠区内隐藏的学习数据同步控件（`#learningSyncNowBtn` / `#learningSyncExportBtn` / `#learningSyncImportBtn` / `#dashboardSyncStatus`）迁移至账户中心 `#accountModal` 的「安全与数据」分组中，确保 100% 同步功能与数据备份恢复能力完全保留且位置更合理。
- **访客首页**：
  - 保留 Aeris 品牌、中央搜索入口、4 项本地免登录实时体验（语言一题、JSON/文本统计、收支试算、本地文件核对）、登录/注册/免费试用/下载 Android/更新日志/查看套餐入口，以及底部法律与隐私链接（`/terms`、`/privacy`、`/security-privacy`、`support@thewyj.uk`）。
  - 取消大型营销 Hero、3D 倾斜屏幕框与 5 格 Bento 墙。

## 4. 全部 27 条路由可达性确认

`/`、`/select`、`/login`、`/register`、`/forgot-password`、`/terms`、`/privacy`、`/security-privacy`、`/trial`、`/changelog`、`/download`、`/language`、`/language/english`、`/language/japanese`、`/tools`、`/tools/:tool_id`（104 工具 + 退役 ID 兼容）、`/tools/workflows`、`/finance`、`/transfer`、`/account`、`/recharge`、`/admin`、`/share/text/:id`、`/share/file/:id`、`/share/clipboard/:code`、`/share/qr/:id`、`/share/room/:id` —— **27/27 全部保留并经命令面板/侧边栏/直达 URL 验证可达。**

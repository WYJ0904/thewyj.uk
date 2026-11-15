# Task27 人工验收修复 A — 并行修改边界

基线：`hydrogen/task27-final-integration`，`54fbf76194f4eeba98ef39e7fb5ff380198abf75`。
修复分支：`codex/task27-web-notification-fixes`。
工作树工具只接受连字符名称，因此工作树标识为 `aeris-task27-web-notification-fixes`。

本轮允许修改范围：Task18 广播/回执模型与服务；`task27-notifications.mjs` 的 MFA 建议广播合同；
`app.js` 的广播队列、普通广播关闭失败处理及全局渲染/弹窗；实际闪烁根因涉及的共享 UI/CSS；
相关测试、SW 发布完整性摘要与本轮报告。

共享文件按具体函数/选择器提交可审阅差异，不整体覆盖 Hydrogen 的并行修复。
`task27-auth.mjs`、`task27-security.mjs`、`email-service.mjs`、`email-api.mjs` 及
`js/account/security-center.js` 的邮箱/MFA/恢复模块不在本轮修改范围内。

使用新的 Chromium 配置与仅本地临时 D1/R2 测试夹具；不运行数据库迁移命令，不接触已存在的
Preview/Production 数据库、真实账户或邮件。既有测试的临时建表仅用于隔离的内存夹具。
不进行 Android 开发、APK 构建或手机操作。共享 Preview 的部署与后续集成由 Hydrogen 统一执行。

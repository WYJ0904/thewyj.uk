# P07-R5 精确候选部署交接

候选：[Draft PR #130](https://github.com/WYJ0904/thewyj.uk/pull/130)，分支 `codex/p07-r5-independent-integration`，基于最终 R4-C `5f83167d9b6a8433565775b372631c8764eb052e`。部署前读取此 PR 的最终 HEAD，并与 Codex 最终验收评论中的精确 SHA 比对；不得把下面的产品实现提交或旧 R5 Preview 当作最终封装 HEAD。

- 定向产品实现：`5eac9d880b547dd6ebea7f6f054651e0fe5e29b7`。
- 唯一资源版本：`20261106-aeris-p07-r5-independent-rc3`。
- 保留的接口：`decision()` 权威裁决、有效 TTL 续租、History workspace、单主工作区、Android Web Back、SW release 查询参数及用户缓存保留。
- 新恢复状态：`data-session-verification="pending"` 时私有主画布不可显示；真实 health 后重新获取功能策略。错误恢复入口不能隐藏。
- 不要重新引入 boot ready 后全局 pending→ON 的 SWR 绕过；不要删除 GET/POST/health 的 session owner 检查。
- 工作流 sticky 侧栏现有可滚动视口约束，单列宽度使用普通文档流。不要恢复无界粘性长列表。

部署责任仍由 Flash 承担。使用既有 allowlist Pages staging/build 脚本；不能上传整个工作区。继续使用现有官方 Aeris Logo，不修改品牌资产。不得合并/发布 Production，不运行 remote migration，不启用 AI/OCR。

请返回同一 SHA 的独立部署 URL、部署 ID、commit hash、静态资源字节校验和配置证明：隔离 Preview D1 身份、R2/AI binding 边界、AI OFF、公开 V3 Flag 以及合法 QA 账户级策略。已有隔离项目 `thewyj-p07-ui-rc` 的历史配置不是新部署的自动授权证明。

QA 账户凭据通过安全渠道提供，不能写入源码、脚本、报告或 PR。Codex 将复用 `qa/p07-r4c/verify-hosted.mjs` 的只读精确 SHA 校验，复核 guest/member、权限隔离、主页面排他、刷新与前进后退。使用预先准备的测试账目，不向未知 Hosted 数据库写入。

P07-F 的 8 条发现/3 条 serious-critical 仍 REVIEW_REQUIRED，详见独立报告。不得以 Preview 部署成功替代 Core CI、冻结浏览器或人工验收；本次不建议人工 READY，直到同 SHA 联合验收及剩余质量门禁关闭。

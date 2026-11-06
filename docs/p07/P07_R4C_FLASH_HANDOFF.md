# P07-R4-C 给 Flash 的部署与联合验收交接

2026-11-06。当前准确集成提交：`c8ff0aa55b36e96561dd083bbaf032e4a24b6cd0`，分支 `codex/p07-r4c-integration`，Draft PR #128。后续报告／证据提交会更新 HEAD；部署前请再次以 PR #128 当前 HEAD 为准，固定并返回部署的 40 位 SHA。

资源版本：`20261106-aeris-p07-r4c-rc2`。静态 CSS、JS、模块和 manifest 入口采用 `?release=`，用于兼容已安装的 R4-A SW；SW 注册仍为 `/sw.js?v=<同一资源版本>`。不要把静态资源改回旧 `?v=` 或混用其他构建目录。`scripts/update_asset_release.mjs` 已支持首次迁移参数 `--release-query`；以后新版本保留 canonical release 查询键。

集成已经包含 R4-B `15fdd2b` 和 P07-E `22d71bd`。P07-E 仅一个独有提交，已按共同祖先无冲突 merge，不要重复应用。后续 P07-F 先提供明确 commit SHA 和 ancestry；尚未在统一候选上运行的 F 无障碍／性能项不能记 PASS。

## 环境责任与部署要求

- 按所有者安排，隔离 Preview 配置和部署由 Flash 完成；Codex 此后不重复操作环境、正式 D1 或 Production Feature Flag。
- 自动 `thewyj-uk.pages.dev` Preview `eb0120ec` 返回公开策略 disabled/revision=0/reason=missing，是缺少环境配置时的正常 Fail-Closed，不是本轮 SW 暖升级故障。
- 保留 decision()、账户级 Task25 决策、灰度和 Kill Switch；不得前端硬编码 V3 ON，不得用普通匿名 ON 代替登录账户级决策。
- 仅使用既有 allowlist staging／提交 blob 发布，绑定必须先证实隔离；不上传整个开发工作区，不使用正式 D1/R2，不启用收费 AI/OCR。
- 返回：隔离 Preview URL、实际 deployment commit SHA、公开 `/api/ui/features` 决策摘要、隔离 binding 的可审计证明，以及可用的合法 QA 登录方式。不要把会话、Cookie 或密钥写进报告、PR 或普通消息。

## 联合回归的分层结论

Codex 继续处理冻结 QA 和 Core CI。公开访客 V3 ON、登录账户体验策略、同一 SHA 的部署资源、以及 P07-F 是否在统一候选上运行，将分别记录。Flash 的正确隔离 Preview 交付后再验证未登录／登录页面、工作区排他、刷新／History、暖升级和 OFF/Kill Switch。此前保持 Draft，人工验收状态不得提升 READY。

Codex 在此次补充要求之前已完成的隔离开发 Preview `071a17fe.thewyj-p07-ui-rc.pages.dev` 属于 `cef7db9` 的公开访客证据；不能替代 Flash 对最终精确 SHA 的联合交付或登录策略验收。

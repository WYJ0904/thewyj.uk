# Aeris P0 财务推送隔离记录

日期：2026-10-31（香港）。状态：分支控制和独立资源/迁移已验证，Hosted 业务及候选 CI 仍待本轮实测。该文件不是发布批准或财务验收通过声明。

本轮从 `253a776f4bab013b13fdbf7545c932d45c91314b` 在 `codex/aeris-p0-closeout` 继续。所有者最新 P0 指令允许修复、隔离云资源和通过门禁的独立交付；P07 保持暂停。固定主工作区、旧财务工作树、D-01/D-02、原始失败和封存证据保留。

## 已实施的共享 Preview 保护

Pages 项目 `thewyj-uk` 原来对所有分支自动部署，Preview 连接共享 D1、R2、Workers AI。2026-10-30 只修改 Git 分支自动构建规则：`preview_deployment_setting=custom`，包括 `*`，排除 `codex/finance-release-convergence`、`codex/aeris-finance-quality`、`codex/aeris-p0-*`。2026-10-31 重新读取相同状态；没有再次 PATCH。

这三个排除项禁止未合格的财务候选自动部署到共享环境；没有停用主线或 P07/Hotfix/原 Task26 分支的原有构建规则。Production 分支、自动部署开关、全部 deployment_configs 摘要、域名及正式 deployment ID 在该次变更前后相同。数据库查询、模型调用、绑定变更和 Production 数据写入均为零。

`qa/p0/cloud_guard.py` 保留旧规则，先验证仓库和主线，再按当前设置增量计划；已有窄 includes 或 none 不会被扩大。10 个离线用例通过。规则依据 [Cloudflare 分支构建控制](https://developers.cloudflare.com/pages/configuration/branch-build-controls/) 和 [项目更新 API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/edit/)；excludes 优先于 includes。

原始证据在 ignored `docs/migration-evidence/aeris-p0-closeout/`：`isolation-unit-r1.log`、`isolation-plan-r1/`、`isolation-apply-r1/`、`isolation-readback-20261031-r1/`。文件不包含授权 token。

## 独立财务环境

- Direct Upload Pages：`aeris-p0-finance-rc`，Production branch 名为 `release-held`，不连接 Git 自动部署，不绑定正式域名。
- 新建 D1：`08ced2a0-6f77-4550-a34e-2b20fd7119db`；独立恢复副本：`43285c83-06f1-479f-a381-bf37fd26ddb2`。不是 Production、共享 Preview 或 P07 数据库。
- 专用库已用固定 Wrangler 4.118.0 执行 33 个原有增量迁移（0001–0025、0027–0034；此分支没有 PR111 的 0026）。没有为凑编号生成空迁移。
- 没有 R2、Workers AI、服务或 KV 绑定。`WORKERS_AI_ENABLED=false`、`FINANCE_AI_ENABLED=false`、`FINANCE_AI_KILL_SWITCH=true`；通知云端写入、所有 import 和 Task26 扩展默认关闭。
- 密码 Pepper 和会话 Secret 均为新随机 QA 值，双环境上传后保存在 ignored private，未复制正式登录、密码、账户或账目。仅有两个人工标记 synthetic 的测试账户。
- 配置守卫 8 项与共享分支守卫 10 项通过；实际 runtime staging、28 项 staging 边界、独立产物扫描、模块图和 storage 检查均通过，日志在 `build-guards-r1/`。

独立环境前几次 inventory 请求因 Pages API 实际拒绝文档中的分页参数返回 8000024；改用固定 CLI 的项目列表。首次 secrets 上传又被 CLI 拒绝：Pages 不支持配置里的 `account_id`。已移除该字段，用进程环境选择账户，沿用原生成的 Secret 重传成功，没有轮换测试身份。这些失败均在 `cloud/audit-r1..r3/`、`cloud/secrets-r1/` 留存；没有隐去后记为首次成功。

主线合入曾有 5 个冲突文件，逐项保留财务新增 import、money-v3 cache、Windows 本地开发启动器及双方 CI 条件；工具代码沿用已发布 main。实际 staging 随后拒绝两个未被审阅许可的 runtime `*-evidence.mjs`。现仅新增 `payment-currency-evidence.mjs` 和 `task21-provider-evidence.mjs` 两个精确路径的许可，QA/private 任意 evidence 文件仍拒绝，独立产物校验器使用相同精确清单。没有放宽目录或通配匹配，也没有改变这些模块的业务规则。

## 恢复条件

不得在未合格财务分支仍可推送时盲目恢复 all。需要撤销本轮规则时，先确认相关分支已停止自动部署风险或已完成发布门禁，再读取当前配置、核对所有无关字段未变，仅恢复 `isolation-apply-r1/result.json` 中的三个旧 Preview 字段。恢复前后分别保存只读元数据并比对绑定及正式 deployment。若出现并发配置变更，重新审查；不以旧整个项目对象覆盖新设置。Git 回退不会恢复该云端配置，也不会回滚数据库。

## 保护状态

本轮首次重验：原 19 组保护目录仅 18 组可用且字节/Git 状态一致。原 Task26 目录缺失，仍为 `CHECKOUT_PATH_NOT_PRESENT`，不是第19组 PASS。五份旧 manifest 的 6,135 项证据逐项一致。恢复新的 Task26 审计工作树不会改变该历史缺口。尚未完成的真实业务、数据库和 AI 质量门禁保持原状；没有依据分支控制成功宣布 P03–P06 COMPLETE。

# Aeris V6.3 Phase 8 管理员后台交付报告

## 分支与验收地址

- P8 分支 `hydrogen/v63-phase8-admin-redesign`。Antigravity 原始产品提交为 `e542b90995046224a5e4c0f78dbd7090b19fff47`，其直接父提交为指定的 P7 基线 `2027572e64cddabf3383d1d36db37f95f45a983c`。Stacked Draft PR 以 `hydrogen/v63-phase7-account-redesign` 为基分支。 [P7 Draft PR #188](https://github.com/WYJ0904/thewyj.uk/pull/188)
- Hosted Preview 管理后台和不可变部署地址。 [P8 管理后台](https://v63-phase8.thewyj-v63-p6p9-preview.pages.dev/admin) · [部署 266a059b](https://266a059b.thewyj-v63-p6p9-preview.pages.dev/admin)
- Cloudflare API 返回项目 `thewyj-v63-p6p9-preview`、环境 `preview`、部署 ID `266a059b-f0d2-4bbb-b616-c0c21a667bb5`、分支 `v63-phase8` 和源提交 `e542b90995046224a5e4c0f78dbd7090b19fff47`。隔离 D1 为 `aeris-v63-p6p9-preview`，R2 为 `aeris-v63-p6p9-storage`，AI bindings 为 0，Workers AI 和外发邮件均禁用。 [原始部署回执](evidence/hosted-preview-deploy.json)
- 两个线上地址各有 97 个可直接取回的 allowlist 静态文件通过字节比对，覆盖 P8 改动的全部 34 个静态文件。部署 staging 的 214 个文件均与产品提交一致，文本比较允许 Git 的 Windows 换行转换。116 个 Functions 源文件与 P7 的对应内容相同，线上 `/api/status` 返回 HTTP 200 和 `environment=preview`。
- P6 和 P7 原别名各返回 HTTP 200，分别提供 `20261127-aeris-p6-transfer-v2` 和 `20261128-aeris-p7-account-v4`。
- `ASSET_RELEASE` 为 `20261128-aeris-p8-admin-v1`。对照 Git 与线上内容复算的 `PUBLICATION_HASH` 为 `7ed26b6567f5de1b26e60205a9be439622184196e0f2d2ac830d00b26ca5a97e`。80 个 Service Worker 完整性条目全部匹配，安装 shell 为 89 项。交付整理只追加报告和验收回执，沿用原部署。

## 功能与既有验证

- 用户管理、充值审核、工具统计、反馈、站内消息、邮件中心、审计日志、登录记录、角色管理和功能发布控制台共十个管理模块。保留服务端权限、会员 SKU、Task27 二次验证和既有 API。差异核对确认 Functions、迁移、Wrangler 配置、Android 和 GitHub 工作流在 P7→P8 区间与基线相同。 [功能保留矩阵](FEATURE_INVENTORY_MATRIX.md) · [参考映射](REFERENCE_MAPPING.md)
- Antigravity 最终一轮本地 Miniflare 与 Chromium 先生成上述 release 和 publication hash，再通过 8 组后台场景。保留 14 张截图和 4 段本地合成夹具录屏，覆盖后台表格与抽屉、会员操作、充值审核、反馈、消息、角色、功能控制台及 320–2560 px 响应式。报告中的后台入口样本为 1085 ms，低于原测试 4 秒门槛，高于文档 1 秒目标。标签切换为 33 ms。 [本地浏览器报告](evidence/verify-report.json)
- 五项技能审计保留原始发现和复测记录。P8 样式区 Hallmark 静态扫描为 0 项，三个认证后台快照复测清除了 Gate 40 输入边框对比问题。Hallmark 独立快照全项扫描仍各报 22 项并退出 1，保留该结果。复制检查保留邮件模板语法导致的既有 1 FAIL / 1 WARN，也保留早期阶段的静态发现。 [五项技能审计](FIVE_SKILLS_AUDIT.md)
- 原发布回归通过 Service Worker 浏览器场景 7/7、Python 静态 31/31、Node 单元 29/29 和功能保留检查。仓库审计曾因报告内个人绝对路径失败，路径修正后原复测与接管复核均通过。
- 接管复核通过 ES 模块图 67 个文件、121 项导入，存储契约 31 类，I05 shell 静态与单元测试 3 项，Service Worker 发布与安装单元测试 24 项。原 I05 全套浏览器测试卡在登录后的模块选择环节，随后修复本地夹具绑定的诊断已到达 `/select`。该旧套件全量重跑未有完成回执。
- 原产品提交的 CSS 末尾空白行被 `git diff --check` 标记。保留该文件字节，使既有 Preview 的内容和完整性清单继续吻合。

## Hosted Preview 权限验收

2026-11-28 18:11 HKT，在原部署上使用真实登录表单和会话 API 验证四个账号。功能发布控制台沿用 P7 的管理员权限，角色管理沿用所有者权限。保留原站点所有者、免费用户和永久会员账号。仅在核对隔离绑定后创建独立的委派测试账号，使用站点所有者二次验证执行授权，其余权限检查读取既有状态或验证拒绝路径。所有测试会话退出成功，Chrome 无未捕获运行时异常。 [线上验收回执](evidence/hosted-preview-roles.json)

| 验收身份 | 后台页面 | 用户列表 | 角色管理读取 | 功能开关读取 | 所有者状态 | 账本 |
| --- | --- | --- | --- | --- | --- | --- |
| 站点所有者 | 可进入，角色管理可见 | 200 | 200 | 200 | 200 | 200 |
| 委派管理员 | 可进入，角色管理隐藏 | 200 | 403 | 200 | 403 | 403 |
| 免费用户 | 返回首页，后台入口隐藏 | 403 | 403 | 403 | 403 | 403 |
| 全功能永久会员 | 返回首页，后台入口隐藏 | 403 | 403 | 403 | 403 | 200 |

访客打开 `/admin` 跳转至 `/login`，读取用户列表返回 401。委派管理员完成二次验证后尝试角色变更仍返回 403。所有者和委派管理员的后台用户 KPI 均与 API 总数一致。实际浏览器确认所有者后台在 1440 和 390 px 无横向溢出。免费与会员页保留相应的权益标识与账本权限。四组凭据交由所有者通过本机权限保护文件读取。

## 远程 CI 与交付边界

使用仓库现有 Core CI 的 `pull_request` 触发器，检查交付提交 SHA 对应的原生结果。Draft PR 的 Checks 页提供实际运行及各项结论。 [P8 Core CI 运行列表](https://github.com/WYJ0904/thewyj.uk/actions/workflows/ci.yml?query=branch%3Ahydrogen%2Fv63-phase8-admin-redesign)

接管沿用既有 Antigravity 工作树，保留原报告、截图、录屏和历史失败记录。Aeris Resource Guard 下，接管只调度一组本机重型浏览器验收，静态比对使用现有 staging，独立 GitHub runner 执行 CI。验收会话和进程已退出。Windows 工具策略拦截了删除临时 Chrome 配置目录，目录留在受权限保护的本机路径。交付范围到 P8 Draft PR 和隔离 Preview 验收为止。

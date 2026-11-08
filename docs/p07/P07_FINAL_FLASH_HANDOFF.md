# Flash 最终隔离部署交接

本候选位于 `codex/p07-final-integration`，Draft PR 目标为 `codex/p07-task25-d1-concurrency`。#132/#133 的合并点为 `80b54be6eebce13d3205a281823118d68e4afbde`，之后包含本轮定向安全与首帧对比度修复；不要部署原 #133 或把它再向 main 合并。

**部署完整 SHA 必须取新 Draft PR 最终验收评论中的 Final SHA 收据**，并与分支 HEAD、Core CI head_sha 一致。该收据在本文件提交冻结后写入，防止报告自引用导致 SHA 漂移。若 HEAD 再改变，原收据不再授权其验收结果外推。

资源版本固定 `20261108-aeris-p07-final-rc4`。使用现有 allowlisted Pages staging 脚本，不能上传工作树、QA 凭据或日志。不要把 RC1/RC2/RC3 与 RC4 的 HTML/JS/CSS/SW 混用。

第一次冻结的 `25406b3414b227bc277f6436286c77fed10b48a4` 存在慢财务挂载被启动恢复拆掉的问题，Core CI Cloud-only 真实失败。它已被后续候选取代，不可作为最终部署 SHA；RC3 资源也不能混入 RC4。必须使用最终收据所指的新完整 SHA。

仅可在已证实隔离的 `thewyj-p07-ui-rc` 项目与专用绑定部署，AI/OCR OFF。不要操作 Production、正式 D1/R2、用户权限、Stable 或 Android。公开 V3 Flag 由合法环境配置提供，前端不硬编码 ON；公开与账户策略必须分别验证。若公开 API 返回 missing/OFF，记录环境问题，不能擅改 fail-closed 语义。

交付 Hosted URL、Cloudflare deployment ID、完整 commit SHA、资源版本、公开 `/api/ui/features` 的非敏感结果、隔离绑定证明。账户测试凭据走安全渠道，不写 Git、报告或评论。

该精确部署再联合检查：

- 游客与登录身份的 V3；首启、登录、真实后台恢复连续帧。
- 3 秒及更慢响应、失败后重试；未验证会话不出现旧账户内容。
- 会员/账户/财务主画布排他、侧栏、刷新、Back/Forward。
- 同源旧客户端普通刷新升级、离线与用户数据保留。
- 账户切换、注销、撤销、OFF/Kill、到期 fail-closed。
- 官方 Logo、三卡、键盘/焦点及本轮无障碍无回退。

本地/CI 的 INTEGRATION_PASS 不代表 Hosted 或人工 READY。历史 D1 并发与离线复习超时继续 NOT_DETERMINED；Field INP 无样本继续 NOT_TESTED。Hosted 同 SHA 和所有者人工确认之前，整体保持 PARTIAL。

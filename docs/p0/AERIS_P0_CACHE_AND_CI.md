# P0 候选 CI 与缓存模块修复

2026-10-31。财务候选仍为 Draft / RELEASE_HELD。

候选 `c12456c78fbdffaaea7af47d95566febc77d8194` 已正常 fast-forward 更新 PR112，没有 force push。共享 Pages 对该分支执行 branch exclusion；实际 skipped 记录和独立 Preview 分开保存，不能将 skipped 当 Hosted 通过。

[CI 41160296372](https://github.com/WYJ0904/thewyj.uk/actions/runs/41160296372) 已完成：10 个 Actions job 中 3 PASS / 4 FAIL / 3 SKIP。Android 是 844 方法、原 6 FAIL；Pages allowlist、敏感路径检查和独立 Task25 emulator 合同通过。JS 最先停在旧 Node DOM 宿主未提供 CSS；两个 Python 系统各有以下三个静态失败。被依赖关系跳过的浏览器未计通过。

## 真实缓存缺陷

P04/P06 新 `money.js` 和 `ai-assistance.js` 的部分浏览器 import 没有统一 release query；money 在 Service Worker 列表中也未版本化，AI 模块未进入离线壳。`sw.js` 的 cache 名另接 finance 后缀，和统一 release 合同不一致。

修复仅统一公共资源的版本串为 `20261031-aeris-p0-finance-r1`，为原相对 JS import 添加同一 query，并把新 AI 模块列入既有 Service Worker 壳。新 cache 名自身唯一，因此保留 money-v3 的缓存更新目的；没有金额、币种、身份、AI 决策、页面布局或路由重构。

另一个 Python 失败是旧静态宿主只接受 package 中直接写 `wrangler pages dev`；Windows 迁移已使用 `scripts/dev_pages_local.mjs` 检查本地绑定后启动。现测试要求精确 launcher 命令，并核查拒绝远端配置、无 AI、仅 development D1/R2 的实际保护，而非删除本地隔离断言。`test_static` 新运行 31/31 PASS，旧 CI 三个 FAIL 保留。

## Node 旧输入的边界

旧 `test_finance_candidates_js.mjs` 虚拟 DOM 未实现 CSS.escape / querySelector；现产品进入币种补全编辑器时访问它们，CI 在业务断言前抛 ReferenceError。独立派生驱动仅补宿主 API 并保留原输入/断言，用于检查后续语义，原测试文件保持原字节。

该旧 fixture 仍省略币种，不应为了关闭 CI 而补 CNY、删确认断言或让产品绕过审核。派生探针及完整失败存于 `docs/migration-evidence/aeris-p0-closeout/legacy-candidate-host-r1/`；它不会作为旧合同 PASS。

## QA 环境的两个配置失败

首次 Hosted 17 检查 13 PASS/4 FAIL，第二次 14 PASS/3 FAIL，所有结果保留。Task13 的写路由还要求 `TASK13_PAYMENT_PRIMARY_ENABLED`；只开写权限仍正确返回503，测试 owner 因而没有 finance_access，读取正确403。仅在新建的 synthetic QA 环境完成该服务前提，不配置真实支付、R2 或付款凭据，不调用充值/付款路由；无 R2 的完整健康状态继续可能 DEGRADED，不能伪称全服务健康。

两次 Node 静态 HTTPS 读取错误没有当作产品内容不符。后续独立 Python HTTPS 原样校验全部公共文件 SHA，使用正常 TLS 和已有网络代理，无重试或校验降级；每次失败及成功证据分别保留。汇率来源的测试错误从小写正则改为产品声明的精确 `Frankfurter v2 daily reference`，未修改冻结 P02 输入和预期。

该文档中的本地通过不替代最终提交的 CI、Hosted、真实 Samsung 业务、备份恢复或发布门禁。所有没有执行的检查仍为 NOT_TESTED。

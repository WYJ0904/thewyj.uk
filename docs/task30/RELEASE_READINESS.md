# Task30 上线前检查与发布边界声明 (`RELEASE_READINESS`)

## 1. 严格发布边界声明

根据本次任务指令及 `AGENTS.md`：

- **Production 环境现状（严格零触碰）**：
  - Production D1（`wyj-cloud-production`）：**未执行** `0040` 迁移。
  - Production R2 / KV / Secrets / 正式域名 `https://thewyj.uk`：**未变更**。
  - GitHub PR：停留在 **OPEN 待审阶段**，**未合并**至 `main`。
  - Android APK 签名、Stable 指针（`1.3.41` / versionCode `54`）与手机实体数据：**未变动**。

---

## 2. 迁移与开关就绪性检查 (`0040` & Feature Flag)

1. **增量迁移**：`cloudflare/migrations/0040_task30_privacy_retention_erasure.sql`
   - 仅使用增量 DDL（`CREATE TABLE IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS`、`INSERT OR IGNORE`），零破坏既有业务表。
   - 不包含行内 `--` 注释，兼容 Wrangler D1 解析与 Miniflare 离线执行。
   - 已在本地 D1 重放（`0001..0040`）与远程隔离 Preview D1（`thewyj-task30-preview`）实测应用成功。
2. **特性开关 Fail-Closed 防护**：
   - 后端路由以 `featureFlags(env).task30Privacy`（环境变量 `TASK30_PRIVACY_ENABLED`）及 D1 `task25_feature_flags`（`task30_privacy_v1`、`enabled=1`、`kill_switch=0`）双门控。
   - 若未来上线需灰度关闭或紧急熔断，可将 `task25_feature_flags` 中 `task30_privacy_v1` 的 `kill_switch` 设为 `1`（或关闭环境开关 `TASK30_PRIVACY_ENABLED`），接口将立即安全失败封闭而不影响账户核心登录与既有记账/文件主服务。
3. **跨服务兼容性**：
   - 对未执行 `0040` 迁移的半迁移状态库，`hasTask30Schema()` 会在可选同意、墓碑或注销联动阶段安全降级返回 `false` 或明确 `503 privacy_schema_not_ready`，避免在“先部署代码、后跑迁移”瞬间触发未捕获 SQL 异常。
   - 政策基线保持在 `2026-11-16-v1`，归档版本 `2026-11-18-v1` 不打断已有用户日常登录态。

---

## 3. 正式上线前置步骤清单（供审阅与后续发布使用，本次不执行）

1. 审阅并合并 Task30 PR 至 `main`。
2. 对 Production D1 执行 `0040_task30_privacy_retention_erasure.sql` 增量迁移并校验 `task30_*` 表及 `task25_feature_flags` 中 `'task30_privacy_v1'` 状态。
3. 部署含 `TASK30_PRIVACY_ENABLED: "true"` 与更新后 `sw.js` 的正式构建包至 Cloudflare Pages。
4. 在生产环境执行抽样只读探针（`/api/status` 确认 `task30_privacy: true`，`/privacy?version=2026-11-18-v1` 返回 200），按需开启外部 Cron 定时调用 `/api/privacy/v1/cleanup/run`。

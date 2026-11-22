# Aeris V6.3 — `origin/main` 分叉审计与安全协调报告

- **初始分叉基线**：`origin/hydrogen/i09-system-feedback` @ `0f5247addbe0a8eead732b561c89744e6be19051`
- **合并目标分支**：`hydrogen/i-v6-final-ui-integration`
- **远端 `origin/main` 快照**：`92323ce4eeee9ac54ea6d982bb926aee8337fd0e`
- **共同祖先（Merge Base）**：`7c111ae4452d8eef493bca6fab71c613e380761c`（I09 相对 `main` ahead 56 / behind 23）
- **合并提交**：`75793b96`（`merge: integrate origin/main (DS SSO, Native Identity, Task27-30) into hydrogen/i-v6-final-ui-integration`）

## 1. 审计范围与 23 个差异提交核查

`7c111ae4..origin/main` 共包含 23 个提交、37 个变更文件，涵盖：
- DS SSO Provider 与 Formal Client 配置（`0041_ds_sso_provider.sql`, `qa/ds-sso/provider.test.mjs`, `wrangler.jsonc`）
- DS Native Identity 与 Aeris 账户安全联动（`0042_ds_native_identity.sql`, `functions/_lib/ds-native-*.mjs`, `js/account/security-center.js` +24 行账号名修改入口）
- DS Ownership Proof 与 Recovery Review（`0043_ds_account_ownership.sql`, `0044_ds_ownership_recovery_review.sql`, `functions/_lib/ds-ownership*.mjs`）
- DS Account Merge Bridge 与会员/财务投影（`0045_ds_account_merge_bridge.sql`, `functions/_lib/ds-account-merge.mjs`, `ds-merge-*.mjs`, `task13-ds-merge.mjs`, `qa/ds-sso/merge-policy.test.mjs`）
- CI 与 Task11/Task27/Toolbox 稳定性修复（`.github/workflows/ci.yml`, `qa/task11/profile-restore-browser.mjs`, `qa/task27/browser.mjs`, `local-backend/test_tools_browser.mjs`）

## 2. 冲突处理原则与结果

| 文件 | 冲突类型 | 处置方式 | 合约验证 |
|---|---|---|---|
| `js/account/security-center.js` | 自动合并 | 保留 `main` 新增 `.task27-security-summary` 账号资料修改卡片，并叠加 V6 分组卡片样式 | `qa/ds-sso/*.test.mjs`、`npm run test:task27:browser` PASS |
| `functions/_lib/task12-service.mjs` / `task13-service.mjs` / `functions/api/[[path]].js` | 无冲突 | 完整保留全部 D1/API/DS SSO 逻辑 | `npm run cf:check`、`qa/ds-sso/*.test.mjs` PASS |
| `sw.js` | `TASK26_INTEGRITY` / `PUBLICATION_HASH` | 保留 I 系列 `81 / 89 / 89` 核心资源清单并通过 `npm run task27:publication` 对合并后字节重算 SHA-256 与发布哈希 | `test_i05` / `test_i06` / `test_i08` / `test_i09` / `test_static.py` PASS |
| `cloudflare/migrations/0041..0045` | 新增文件 | 无修改全部保留，独立本地与隔离预览库按序执行 `0001..0045` 全部成功 | `wrangler d1 migrations apply --local` 45/45 ✅ |

## 3. 合并后跨模块回归证明

合并 `75793b96` 之后在 `hydrogen/i-v6-final-ui-integration` 上执行并通过：
- `npm run build` & `npm run cf:check`: Compiled Worker successfully
- `node scripts/check_js_module_graph.mjs`: 67 files, 116 imports, zero cycles
- `node scripts/check_storage_contract.mjs`: 31 stable key families audited
- `node --test local-backend/test_i0*.mjs local-backend/test_v6_ui_contracts.mjs qa/ds-sso/*.test.mjs`: **66 / 66 PASS**
- `npm run test:task25`, `npm run test:task26`, `npm run test:task27:login-guard`, `npm run test:task28`, `npm run test:task29`: **PASS**
- `npm run test:task27:browser` (11/11), `test:task28:browser` (5/5), `test:task29:browser` (5/5), `test:task30:browser` (4/4): **PASS**
- `qa/i07` (10/10), `qa/i08` (5/5), `qa/i09` (4/4), `qa/aeris/p3`, `p31`, `p33`: **PASS**

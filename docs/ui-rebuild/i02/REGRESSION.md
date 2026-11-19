# Aeris I02 Regression Verification Ledger

所有下方记录均严格区分运行作用域（静态检查 / 隔离 D1&R2 / 本地 Chrome CDP / 确定性构建 / 远端 CI 参考），未合并跑分，未将跳过项或已知远端 Flake 伪装为 PASS。

## 1. 全量静态与核心门禁结果（全部在最终 CSS 修改完成后实测通过）

| 测试 / 检查项 | 命令 | 作用域 | 实测结果 |
|---|---|---|---|
| **CSS Token/级联契约** | `node --test local-backend/test_i02_css_contracts.mjs` | 静态 CSS / HTML 解析 | **PASS (6/6)**：0 未定义 Token、V1.1 Token、`a.primary`/Checkbox/Switch、`!important` 上界、`.achievement-tier` 语义防回退、加载顺序 |
| **应用级浏览器回归（CI 同款）** | `node local-backend/test_app_browser.mjs` | 本地隔离 `server.py` + AI Stub + Chrome CDP (`8892`/`9223`) | **PASS (24/24)**：完整跑通 `mobile language question state and rejudge scenarios A-H`、`#achievementsView` 对比度审查、财务、管理后台与 0 `runtimeErrors` |
| **静默/静态核心测试** | `python -m unittest local-backend/test_static.py` | 静态契约（补修后复测） | **PASS (31/31 OK)** |
| **全量 Python 后端/静态测试** | `python -m unittest discover -s local-backend -p "test_*.py"` | 本地 Python 隔离服务器与静态断言 | **PASS (186 tests OK)**（补修前全量通过，补修仅涉及 2 份 CSS） |
| **Task 25 Feature Flags** | `npm run test:task25` | 隔离 Miniflare D1 | **PASS**：D1/API 12 组 + Client 19 向量 |
| **Task 26 Adaptive Learning** | `npm run test:task26` | 隔离 Miniflare D1 & 引擎 | **PASS**：引擎 32 组 + API/D1 + Wrong-review (15 + 13 + 6) |
| **Task 27 Security & Email** | `npm run test:task27` | 隔离 Miniflare D1 | **PASS (33/33 组)** |
| **Task 28 Secure Files & Browser** | `npm run test:task28` & `npm run test:task28:browser` | 隔离 Miniflare D1/R2 + Chrome | **PASS**：API/D1 31 checks；Browser 5/5 (含 375px 移动端与 `axe` 校验) |
| **Task 29 Backup & Browser** | `npm run test:task29` & `npm run test:task29:browser` | 隔离 Miniflare D1/R2 + Chrome | **PASS**：API/D1 7/7；Browser **5/5** (`1440/768/390/375` Light/Dark + 复测修复 `input[type="file"]` `axe-core` 零违例) |
| **Task 30 Privacy & Browser** | `npm run test:task30` & `npm run test:task30:browser` | 隔离 Miniflare D1/R2 + Chrome | **PASS**：API/D1 10/10；Browser **4/4** (`1440/768/390/375` Light/Dark + `>=44px` 触控与零溢出) |
| **Aeris State / Finance / Public** | `npm run test:aeris-state`, `test_home_widgets_js.mjs`, `test_aeris_public_js.mjs` | 前端状态/控件隔离单测 | **PASS**：13 组状态一致性、Home Widgets 与 P3 Preview 全部通过 |
| **Service Worker 安装** | `node qa/p07-release/sw-install.test.mjs` | SW 隔离模拟 | **PASS (20/20)**：`c9e8c6ee7517...` 20 条发布完整性锁全部匹配 |
| **仓库与功能门禁审计** | `python scripts/repository_audit.py` / `functional_audit_gate.py` | 仓库全文件 / AST | **PASS**：1905+ 文件；27 路由、24 流程、104 工具、51 模式、7 复选框、12 工作流能力、27 工作流流程 |
| **ES 模块图与存储契约** | `node scripts/check_js_module_graph.mjs` / `test_module_graph_js.mjs` / `check_storage_contract.mjs` | 前端模块图 / Storage | **PASS**：67 文件 / 110 导入 / 5 自测；31 组稳定存储键族 |
| **Pages Functions & 确定性构建** | `npm run cf:check` + 连续两次 `npm run build` 哈希比对 | Pages 构建产物 `.wrangler/pages-output` | **PASS**：Worker 编译通过；构建产物数 `203`，两次全目录 SHA-256 均为 `cb3a48a7653834ca26bcbea3f2322436fae22c02e6d874f6d97ae1799ae010af` (`deterministic: true`) |

## 2. I02 回归中捕获并已闭环修复的真实缺陷

1. **Tablet `768px` 顶栏导航换行超高 (`97px > 70px`)**：因 `public-experience.css` 的 `@media (max-width: 760px)` 与 `@media (max-width: 720px)` 在 `761px–860px` 区间断层，已增设 `@media (min-width: 721px) and (max-width: 860px)` 紧凑规则，实测 `768px` Light/Dark 恢复 `61px` 单行且保留下载/更新入口。
2. **`#backupRestoreFileInput` 丢失文件输入对比度规则**：I02 为保护 checkbox/radio 时一度排除了 `:not([type="file"])`，被 `npm run test:task29:browser` 在 1440px Light 捕获 `axe-core color-contrast` 报警；随后改为仅排除 `checkbox/radio/range`，并补充 `input[type="file"]` 与 `::file-selector-button` 语义样式，重跑 `test:task29:browser` 5/5 通过。

3. **CI Run `44448189085` 发现并闭环修复的 `span.achievement-tier` 对比度回归（1.84:1 → 6.85:1+）**：
   - `b8cfdf1b` 在远端 `Browser flow (application)`（`local-backend/test_app_browser.mjs`）报错：`#achievementsView` 锁定条目 `span.achievement-tier` 计算前景为 `rgb(139, 189, 211)` (`#8bbdd3 !important` 来自 `styles.css:1041`)、背景 `rgb(237, 244, 255)`，对比度仅 `1.84:1`。
   - 根因：I02 此前移除了 `product-ui.css` 的 `!important` 覆盖，却未清除 `styles.css` L1041/L3250 的旧 `!important`。
   - 补修：改 `styles.css` 为 `.achievement-item .achievement-tier` 去除 `!important` 并回落语义 Token，同步去除 `product-ui.css` L2941 `!important` 且为已解锁 `.achievement-tier` 补齐 `--color-success-soft` 背景；实测 P07 ON/OFF × Light/Dark 全部达到 `>= 5.20:1`（Light 锁定 `6.85:1` / 解锁 `5.20:1`，Dark 锁定 `9.14:1` / 解锁 `7.78:1`），本地 CI 同款 `test_app_browser.mjs` 24/24 通过。
   - 同时确认 Run `44448189085` 中的 `Cloud-only browser, canonical session and toolbox` 最终结果为 `success`。

## 3. 远端既有 CI 基线说明（真实历史状况）

- 启动 I02 前核查最近远端 GitHub Actions：`main`（Run `44283236300`）与 `hydrogen/i01-design-foundation-shell`（Run `44304343747`）均在远端任务 `Run complete toolbox browser matrix on Cloudflare D1 and R2`（`timeout waiting for canonical transfer item`）存在既有失败，其余 8 个非跳过 CI Job 在 I01 均通过。
- **隔离声明**：该远端传输工具箱超时属现有外部 CI 问题，与 I02 CSS 重整无关，本报告不隐瞒、不将该未运行或历史失败项标为 PASS。

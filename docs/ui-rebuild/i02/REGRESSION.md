# Aeris I02 Regression Verification Ledger

所有下方记录均严格区分运行作用域（静态检查 / 隔离 D1&R2 / 本地 Chrome CDP / 确定性构建 / 远端 CI 参考），未合并跑分，未将跳过项或已知远端 Flake 伪装为 PASS。

## 1. 全量静态与核心门禁结果（全部在最终 CSS 修改完成后实测通过）

| 测试 / 检查项 | 命令 | 作用域 | 实测结果 |
|---|---|---|---|
| **CSS Token/级联契约** | `node --test local-backend/test_i02_css_contracts.mjs` | 静态 CSS / HTML 解析 | **PASS (5/5)**：0 未定义 Token、V1.1 Token、`a.primary`/Checkbox/Switch、`!important` 上界、加载顺序 |
| **全量 Python 后端/静态测试** | `python -m unittest discover -s local-backend -p "test_*.py"` | 本地 Python 隔离服务器与静态断言 | **PASS (186 tests OK, 102.96s)**：包含 `test_static.py` 对对比度、字体、`dsModalPanelIn/Out`、SW 81 资源清单的全部守护 |
| **Task 25 Feature Flags** | `npm run test:task25` | 隔离 Miniflare D1 | **PASS**：D1/API 12 组 + Client 19 向量 |
| **Task 26 Adaptive Learning** | `npm run test:task26` | 隔离 Miniflare D1 & 引擎 | **PASS**：引擎 32 组 + API/D1 + Wrong-review (15 + 13 + 6) |
| **Task 27 Security & Email** | `npm run test:task27` | 隔离 Miniflare D1 | **PASS (33/33 组)** |
| **Task 28 Secure Files & Browser** | `npm run test:task28` & `npm run test:task28:browser` | 隔离 Miniflare D1/R2 + Chrome | **PASS**：API/D1 31 checks；Browser 5/5 (含 375px 移动端与 `axe` 校验) |
| **Task 29 Backup & Browser** | `npm run test:task29` & `npm run test:task29:browser` | 隔离 Miniflare D1/R2 + Chrome | **PASS**：API/D1 7/7；Browser **5/5** (`1440/768/390/375` Light/Dark + 复测修复 `input[type="file"]` `axe-core` 零违例) |
| **Task 30 Privacy & Browser** | `npm run test:task30` & `npm run test:task30:browser` | 隔离 Miniflare D1/R2 + Chrome | **PASS**：API/D1 10/10；Browser **4/4** (`1440/768/390/375` Light/Dark + `>=44px` 触控与零溢出) |
| **Aeris State / Finance / Public** | `npm run test:aeris-state`, `test_home_widgets_js.mjs`, `test_aeris_public_js.mjs` | 前端状态/控件隔离单测 | **PASS**：13 组状态一致性、Home Widgets 与 P3 Preview 全部通过 |
| **Service Worker 安装** | `node qa/p07-release/sw-install.test.mjs` | SW 隔离模拟 | **PASS (20/20)**：`e6f6125edb6d...` 20 条发布完整性锁全部匹配 |
| **仓库与功能门禁审计** | `python scripts/repository_audit.py` / `functional_audit_gate.py` | 仓库全文件 / AST | **PASS**：1897 文件（终态复测）；27 路由、24 流程、104 工具、51 模式、7 复选框、12 工作流能力、27 工作流流程 |
| **ES 模块图与存储契约** | `node scripts/check_js_module_graph.mjs` / `test_module_graph_js.mjs` / `check_storage_contract.mjs` | 前端模块图 / Storage | **PASS**：67 文件 / 110 导入 / 5 自测；31 组稳定存储键族 |
| **Pages Functions & 确定性构建** | `npm run cf:check` + 连续两次 `npm run build` 哈希比对 | Pages 构建产物 `.wrangler/pages-output` | **PASS**：Worker 编译通过；构建产物数 `203`，两次全目录 SHA-256 均为 `d77d16fcb3bb0ef892564ebc67f7bd9c8404a5df66a0759322a64eb15c54cfce` (`deterministic: true`) |

## 2. I02 回归中捕获并已闭环修复的真实缺陷

1. **Tablet `768px` 顶栏导航换行超高 (`97px > 70px`)**：因 `public-experience.css` 的 `@media (max-width: 760px)` 与 `@media (max-width: 720px)` 在 `761px–860px` 区间断层，已增设 `@media (min-width: 721px) and (max-width: 860px)` 紧凑规则，实测 `768px` Light/Dark 恢复 `61px` 单行且保留下载/更新入口。
2. **`#backupRestoreFileInput` 丢失文件输入对比度规则**：I02 为保护 checkbox/radio 时一度排除了 `:not([type="file"])`，被 `npm run test:task29:browser` 在 1440px Light 捕获 `axe-core color-contrast` 报警；随后改为仅排除 `checkbox/radio/range`，并补充 `input[type="file"]` 与 `::file-selector-button` 语义样式，重跑 `test:task29:browser` 5/5 通过。

## 3. 远端既有 CI 基线说明（真实历史状况）

- 启动 I02 前核查最近远端 GitHub Actions：`main`（Run `44283236300`）与 `hydrogen/i01-design-foundation-shell`（Run `44304343747`）均在远端任务 `Run complete toolbox browser matrix on Cloudflare D1 and R2`（`timeout waiting for canonical transfer item`）存在既有失败，其余 8 个非跳过 CI Job 在 I01 均通过。
- **隔离声明**：该远端传输工具箱超时属现有外部 CI 问题，与 I02 CSS 重整无关，本报告不隐瞒、不将该未运行或历史失败项标为 PASS。

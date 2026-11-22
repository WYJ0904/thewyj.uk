# Aeris I02 Risks & Rollback Plan

## 1. 已识别风险与缓解措施

| 风险点 | 影响范围 | 已采取缓解措施 | 验证结果 |
|---|---|---|---|
| **多文件 CSS 覆盖引发回归或隐藏元素失效** | 弹窗、P07 开关切换、管理后台 Tab | 不做一次性全删 `!important`；逐模块精准移除 77 处冗余 `!important`，保留 60 处 `[hidden]`/Reduced Motion/主题切换/`200%` 大字重排护栏 | `test_i02_css_contracts.mjs` + Chrome 10 场景实测通过 |
| **V1.1 中性主按钮对比度或状态可辨识度下降** | `#111113`/`#F8FAFC` 主按钮、表单错误、禁用态 | 深浅双主题分别显式配对前景文字色；表单错误保留语义文字与显式色差；禁用按钮维持 `test_static.py` 对 `opacity: 1` 的要求 | `axe-core` 全页面零违例通过 |
| **原生 Checkbox / Radio 被通用输入框规则误拉伸** | 文件传输开关、Feature Flags 后台、同意勾选框 | 在 `design-system.css` 与 `product-ui.css` 使用 `:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"])` 精确隔离 | Chrome 实测 Checkbox `<= 24px` 正常勾选 |
| **`ASSET_RELEASE` 更新遗漏 SW 缓存清退** | 已安装 PWA / Service Worker 客户端 | 同步更新全站 30 个文件的 `20261119-aeris-i02-preview`，并执行 `npm run task27:publication` 重算 20 条发布完整性哈希 | `qa/p07-release/sw-install.test.mjs` 20/20 通过，构建完全确定 |
| **Prototype HTML 文件本地缺失** | 对照核验颗粒度 | `PROTOTYPE_MAPPING.md` 严禁臆造 HTML 内容，依据工作区可读的 `Aeris_I_series_UI_refactor_execution_baseline_v1.1_2026-11-17.txt` 与执行指令完成映射并明示差异 | 文档透明留痕 |
| **既有远程 CI 外部 Flake** | `main` (`44283236300`) 与 `I01` (`44304343747`) 中远端工具箱 D1/R2 浏览器矩阵超时 | 与 I02 CSS 改动无关，不在总结中伪装其为本地已修复或 PASS；本地隔离回归全部独立运行验证 | 明确区分本地验证、Preview 验证与远端 CI |

## 2. 回滚方案（Rollback）

1. **运行时特性开关秒级回退（无需代码回滚）**：
   - 将 Task 25 Flag `p07_accessibility` 的 `enabled` 设为 `0` 或开启 `kill_switch`，所有公开与登录态界面在 30 秒缓存周期内安全回退至遗留 P07 OFF 基础界面（经 I02 Chrome Scenario 10 验证可用且业务路由完整保留）。
2. **Git / PR 级代码回滚**：
   - I02 工作全部隔离在独立分支 `hydrogen/i02-css-component-foundation` 及 stacked Draft PR，未合入 `main`，亦未修改 I01 分支与工作区。直接关闭或 revert PR 即可 100% 回到 I01 基线 `3f5cffc3c86d2b92006cc78dab828a80f2068a65`。
3. **Preview 分支隔离**：
   - I02 Preview 部署使用独立预览别名 `i02-css-component-foundation`，完全独立于 `i01-design-foundation` 与 Production `thewyj-uk`。

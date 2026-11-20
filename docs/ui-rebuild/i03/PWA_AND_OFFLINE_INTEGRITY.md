# PWA 离线发布与 Service Worker 完整性报告

## 1. CORE_SHELL 81/89 不变量保持

- 未在 `index.html` 或 `sw.js` 中新增外部或拆散脚本/样式资源，所有 I03 与 I07-A 修复均内聚于已有发布白名单模块（`js/core/motion.js`、`js/core/public-experience.js`、`js/core/router.js`、`js/core/download.js`、`js/core/home-widgets.js`、`js/transfer/app.js`、`design-system.css`、`public-experience.css`、`spatial-experience.css`、`product-ui.css`、`app.js`）。
- `CORE_SHELL` 保持精确 **81** 项，归一化后 SHA-256 严格匹配 RC5 锁定指紋 `a33d01c43f6f20a6963ab1384fb2305ee3b2447e0e68dc8c1f3015f1a2a6deae`，`REQUIRED_SHELL` 保持 **89** 项。

## 2. ASSET_RELEASE 统一升级与发布签名

- 全局统一升级 `ASSET_RELEASE`：`20261119-aeris-i07-preview` → **`20261119-aeris-i03-preview`**（覆盖 `index.html`、`sw.js`、`app.js`、`tools.js`、全部 `js/**/*.js` 模块引用及 `qa/i07/fixture.js`）。
- 已执行 `npm run task27:publication`，重新计算 `TASK26_INTEGRITY`（20 条核心入口校验和）并写入最新 `PUBLICATION_HASH`：`c56b55391395cb8089ff679cbac2b310c29a0de664d48a656508adc688a5d622`。
- `node qa/p07-release/sw-install.test.mjs` 全部 **20 / 20** 项原子安装、并发限流、陈旧资源拦截与兼容性缓存测试通过。

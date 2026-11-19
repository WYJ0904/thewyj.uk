# `/trial`、`/download`、`/changelog`、`/login` 与 `/register` 专题重构报告

## 1. `/trial`（`#trialPage`）

- **控件降噪**：将原本 5 张高 132px 的大卡片网格替换为紧凑型单行药丸分段控制器 `.trial-tool-tabs.ds-segmented`（`role="tablist"`, `data-indicator-style="pill"`），下方仅保持 1 个激活的 `.trial-workbench`。
- **ARIA 与键盘交互**：使用规范的 `role="tab"`、`aria-selected`、`aria-controls`、`roving tabindex` 与 `ArrowLeft`/`ArrowRight`/`Home`/`End` 键盘切换（修复首轮 `axe` 发现的 `aria-allowed-attr` 问题）。
- **`<select>` 右侧箭头间距**：统一设置 `select, .trial-workbench select { padding-right: 36px; }`，避免 `#trialQuizLanguage` 与 `#trialImageFormat` 原生下拉箭头压住中文选项。
- **既有试用限制保留**：语言小测上限 10 题，文本统计/JSON 工具上限 200,000 字符，单张图片压缩/转换上限 12 MB / 2000 万像素，全部零匿名存储、零网络写请求。

## 2. `/download`（`#downloadPage`）

- **信息层级与诚实状态**：卡片头部增加 `#downloadStatusBadge`，随 `/api/app/config` 返回诚实展示「正式版可下载（success）」「发布配置待完善（warning）」「元数据读取失败（保留下载入口，error）」。
- **SHA-256 与文件名防截断**：文件名列改为 `word-break: normal; overflow-wrap: anywhere;`，防止版本数字被硬折行；64 位 `SHA-256` 独立占满整行并置于 `<code>#downloadSha</code>`（等宽字体、安全折行）；无有效校验值时自动禁用 `#downloadCopyShaBtn` 并明确提示。
- **主次操作**：实心高对比主按钮 `.button-link.primary#downloadMainBtn`（「下载 APK」）+ 次级「备用下载链接」与幽灵「复制校验值」按钮。

## 3. `/changelog`（`#changelogPage`）

- 沿用 `WYJ_CHANGELOG` 本地基线与 `/api/changelog` `mergeChangelogEntries()` 数据融合。
- 为版本与日期启用 `tabular-nums` 对齐，保留锚点筛选与空/加载/异常兜底文案；未将未发布的 I03/I07 渲染成生产发布记录。

## 4. `/login` 与 `/register`（`#authPanel`）

- 居中极简卡片配真实 Aeris 标志（`.auth-logo`）、`46px` 高可点输入框、清晰错误提示 `#loginError`、移动端触摸友好的提交按钮与找回入口。
- 将 `.auth-tabs` 激活文字从 `--ds-brand` 提升至 `--ds-brand-hover`（满足浅色白底 WCAG >= 4.5:1 对比度）。
- 100% 保留既有 DOM ID 与 Task 27 条款同意（`#registerTermsConsent`）、密码强度和 MFA 流程契约。

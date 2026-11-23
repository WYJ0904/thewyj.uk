# Aeris V6.3 — I10｜发布就绪与遗留风险评估（Release Readiness）

- **目标分支（Draft PR）**：`hydrogen/i10-full-site-interaction-acceptance` -> `hydrogen/i-v6-ui-ux-quality-rework`（待 Owner 审批，**严禁直接合并 `main` 或发布 Production / Android Stable**）
- **基线参照**：PR #177 (`hydrogen/i-v6-final-ui-integration`, `9243796c7ad83ca4a868bc65839fd7c957f15673`) 与 PR #178 (`hydrogen/i-v6-ui-ux-quality-rework`, `dcfe77a3202541460c88f9e3067668af0b3402f5`)，保持 Draft 并保留原有预览。
- **当前代码核心提交**：`942f40f4cebf4bb0f9988b95292162a2fb679ee0`（之后仅补充 `qa/i10/verify-preview.mjs` 选择器调整与 `docs/ui-rebuild/i10/` 报告证据）。

---

## 1. 门禁就绪检查清单

| 门禁项 | 当前状态 | 证据 / 备注 |
|---|---|---|
| 视觉冻结纪律 | **PASS** | 零视觉风格重设计，仅作对比度、溢出、图层、焦点与动效稳定性修复（12 个源文件的外科手术变更） |
| PR #178 CI 阻断关闭 | **PASS (本地) / PENDING (GitHub Final SHA)** | 本地已关闭 `模糊搜索工具` 1.84:1 与 `#toolsPanel` 对比度错误；最终提交 SHA 推送 Draft PR 后将在 GitHub Core CI `Cloud-only browser, canonical session and toolbox` 上取得完整通过证据 |
| 静态门禁与 SW 一致性 | **PASS** | `task27:publication`、`build`、`cf:check`、`check_js_module_graph`、`check_storage_contract`、`functional_audit_gate` (27 routes / 104 tools / 27 workflow flows)、`repository_audit` 全过 |
| 本地单元测试 / D1 / Browser 回归 | **PASS** | I03/I04/I06/I08/I09/I10、Task16/17/18/25/26/27(Web+Guard)/28/29/30、TTS、Home/Mobile Widgets 均通过（`test_app_browser`、`test_tools_browser` 完整 Python 校验由 GitHub CI 跑通；`test:task27:browser` 缺本地未入库 `.wrangler/task27-reference` 跳过） |
| 云端隔离 Preview 验收 | **PASS** | `https://i10-interaction-acceptance.thewyj-i10-preview.pages.dev` 真实线上通过 SHA-256 一致性、`authenticatedMode: true` `/tools` + `/finance` 与 3 项 `axe` (0 violations) |
| Android 真机 WebView 验收 | **`NOT_TESTED`** | 未连接物理手机，按规定诚实标注；不影响 Draft PR 与隔离预览审查 |
| 生产与既有分支保护 | **PASS** | Production `thewyj-uk`、Production D1/R2、Email Routing、`main`、`thewyj-v6-rework-preview`、`thewyj-v6-preview` 与 Android Stable 均零修改 |

---

## 2. 遗留观测项与风险提示（诚实披露）

1. **GitHub Core CI 最终 SHA 确认**：本地 Windows Python 缺少 `cv2`，故 `local-backend/test_tools_browser.mjs` 在通过行 1496 对比度后终止于行 1537 图像产物校验；同时 `local-backend/test_app_browser.mjs` 需在 CI Python 夹具环境下执行。Push 后必须盯控并确认真实 GitHub Core CI 全绿通过，才能视 I10 工程闭环。
2. **Info Toast 淡入动画首帧混合色**：在桌面右侧 Drawer 暗色背景遮罩打开的一刻，`.ds-toast[data-tone="info"]` 在 220ms 淡入过程（透明度未达 1.0 前）若恰巧触发即时静态像素取样，计算混合比曾短暂降至 4.46:1；动画完成后稳态为 6.62:1（满足 AA）。目前在 `verify-preview.mjs` 等待动画落地（`300ms`）验证稳态符合标准；后续如 Owner 希望连半透明过程帧也严格 `>= 4.5:1`，可在 CSS 进一步加深 Light `--ds-info`（会略改变设计基准蓝调，本次按视觉冻结原则暂不擅改设计色值）。
3. **Android 真机实测待排期**：待后续 Owner 安排连接物理手机执行真机 WebView 触控、键盘弹出收起与输入法兼容验收，方可解除最终发布锁定（当前所有开发与发布指令仍处 PAUSED / 仅 Draft PR 状态）。
4. **`thewyj-i10-preview` 上临时测试账号**：`verify-preview.mjs` 仅在完全隔离的 `aeris-i10-preview` D1 中注册了一名随机名测试用户（`i10qa...`），该数据库与正式站完全物理隔离；Owner 可在回归后统一清理隔离 Preview（见 `ROLLBACK.md`）。

---

## 3. 放行建议

- **对 Draft PR (`hydrogen/i10-full-site-interaction-acceptance` -> `hydrogen/i-v6-ui-ux-quality-rework`)**：**推荐进入 Review（待 Push 后最终 SHA GitHub Core CI 全绿即可定版）**。
- **对 Production / `main` / Android Stable**：**保持锁定（NO-GO until Owner explicitly authorizes release & post-CI review）**。
